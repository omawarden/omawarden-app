# Omawarden App: macOS Adaptation Specification

> **Target Repository**: `omawarden/omawarden-app`
> **Status**: Ready for Implementation
> **Primary Goal**: Decide what *finished adapting* means. The first
> specification made macOS a **supported host** — credentials persist, the app
> launches, the Linux-only assumptions became `Host` values. This one closes the
> gaps that remain now that it runs, and states plainly which claims a green
> check does and does not support.

---

## Problem Statement

The first specification (`docs/specs/macos_support_spec.md`) answered "can this
app run on macOS and keep a session". It could not answer "does the app behave
as a macOS app", because the defects of that kind do not show up as missing
files or failed syscalls. They show up as things that silently do less than
their Linux counterparts, and they are invisible from a machine that is not a
Mac:

1. **A single reserved keystroke disables twenty shortcuts.** `keymap.bind`
   validates *every* keystroke in the object it is handed before making any of
   them, and returns an error on the first reserved one. The whole object is
   discarded. A `mod+h` binding — Command+H is macOS's "hide the app" — therefore
   did not cost the user password history; it cost them the command palette,
   vault search, lock, and the arrow keys, with no message. The same class of
   mistake is available on Linux (`Ctrl+Q`, `Alt+F4`, bare `F11`), so this is a
   policy gap, not a macOS bug.

2. **The UI's shortcut symbols were written by hand.** Badges and inline prose
   spelled `Ctrl+K` as a string literal. On macOS those badges named keystrokes
   the user cannot press, in a menu whose whole purpose is telling them what to
   press.

3. **A capability with no macOS implementation was offered anyway.** The
   second-factor screen listed FIDO2 as available on macOS because the value was
   hardcoded. The engine discovers keys by requiring a `/dev/hidraw` node and
   shells out to `fido2-token`; macOS has neither. The user could select the
   security key, be told to install `libfido2`, install it, and still be exactly
   where they started. A dead end is worse than an absent option.

4. **A host-supplied default carried a `~` into a path comparison.** The
   download-directory arm of the attachment allow-list compared an absolute
   candidate against a path whose first component was literally `~`, so
   `Path::starts_with` never matched and the arm was dead **on both hosts**. A
   macOS path sweep surfaced it; Linux users had been losing it too.

5. **The log redactor knew only Linux path roots.** macOS reports paths under
   `/private/var/folders/…`, `/Users/…/Library`, `/Applications` and `/Volumes`;
   none were scrubbed, so a diagnostics report copied to the clipboard for a bug
   report could carry a home directory.

6. **Nothing compiled or exercised any of this on macOS.** The workflow ran one
   `ubuntu-24.04` job. "The branch is tested" and "the platform works" are
   different claims, and only the first was true: `Host`-as-parameter makes the
   macOS *logic* assertable anywhere, which is why most of the first effort is
   covered — but the macOS *build* had never been compiled by CI at all.

There is a seventh problem that is not macOS-specific but became visible the
first time the macOS job ran: **the headless tests raced work that runs behind a
timer.** The store defers every bridge call that touches the network or the disk
so the press that starts the work paints first. A test step resolves once the
app has rendered nothing for a fixed quiet window, which does not cover a timer.
On a fast machine the timer wins and the assertion sees the final state; on a
slow runner the step resolves while the work is still pending. Nineteen tests
failed on the macOS runner and passed on Linux and on a real Mac. Raising the
deferral to three seconds on Linux reproduced 52 of them, so the winner was
never the platform — the tests had always been passing on luck.

## Solution

**Adapting means three things, and only the third is about macOS.**

**A capability the host cannot complete is reported, not offered.** Where a
Linux mechanism has no macOS implementation, the option exists in the model,
declares itself unavailable, and says why no install will satisfy it. It is
never hidden into a false green, and never offered as a fix that changes
nothing — the Diagnose row stays and reads "Unavailable", the second-factor
provider stays listed and refuses to be selected, and the install action that
would run a package manager is simply absent.

**Platform differences stay values.** Every rule this specification adds is a
function of `Host`, not a `cfg!` branch: which keystrokes are reserved, what a
shortcut label is, whether a provider is available, what a dependency row says.
The single `cfg!` read in the crate remains `Host::current()`. This is what lets
the macOS answers be asserted from Linux CI — and the new macOS job is what
proves the answers are also compiled.

**And the checks have to be honest about what they cover.** A macOS check that
passes because it declined to look is worse than no check, because it looks like
a claim. So the pin inspection fails when it cannot inspect, the macOS job names
what it cannot do in the job itself, and tests wait for the work they assert on
instead of racing it.

## User Stories

1. As a macOS user, I want every shortcut in the app to work, so that binding
   one of them cannot silently disable twenty others.
2. As a macOS user, I want the shortcut shown beside a command to be the
   keystroke that command actually listens to, so that the menu teaches me the
   right keys.
3. As a macOS user, I want modifier glyphs to be the platform's (`⌘`, `⌥`)
   rather than another platform's words, so that I do not translate in my head.
4. As a macOS user, I want a key name that is not a modifier combination to be
   spelled the same everywhere (`↵`, `Esc`, `Tab`), so that only the parts that
   differ change.
5. As a Linux user, I want the same shortcut to keep working where it does
   today, so that adapting to macOS does not cost me a feature.
6. As a maintainer, I want keystrokes chosen by whether they are reserved on
   *either* host, so that one binding serves both platforms.
7. As a maintainer, I want a test that loads the app under both platforms, so
   that a reserved keystroke fails in CI rather than on a user's machine.
8. As a macOS user, I want a security key that cannot work on this platform to
   say so, so that I am not sent to install a package that changes nothing.
9. As a macOS user, I want the second-factor providers to show only the ones I
   can complete, so that the screen is a choice and not a maze.
10. As a macOS user, I want the Diagnose view to keep listing the unbuildable
    dependency and mark it unavailable, so that a diagnosis is complete rather
    than quietly rounded down.
11. As a macOS user, I want the dependency page to skip the install action for a
    package no installer can provide, so that the button does not lead to a
    terminal that fails.
12. As a macOS user, I want a dependency that is genuinely missing to still be
    reported as missing, so that "unavailable" is not a blanket excuse.
13. As a user on either host, I want a download saved to my configured directory
    to open, so that saving an attachment is not a one-way trip.
14. As a Linux user, I want that same download path to work here too, so that a
    fixing pass aimed at macOS does not leave my host broken.
15. As a user, I want a diagnostic report I copy to a bug report to carry no
    home directory, so that sharing it is not a privacy decision.
16. As a macOS user, I want macOS path roots redacted from log lines, so that
    the redaction is not Linux's idea of "personal".
17. As a maintainer, I want the app's Rust compiled for a real macOS target on
    every pull request, so that a macOS-only branch cannot rot.
18. As a maintainer, I want the headless suite run in a process whose platform
    is macOS, so that the one thing a Linux run cannot do is done somewhere.
19. As a maintainer, I want the macOS job to run the same version, pin, privacy
    and formatting checks as Linux, so that "green on macOS" means the same
    thing as "green on Linux".
20. As a maintainer, I want the pin check to fail when CI cannot inspect the
    pinned engine, so that a check that never ran cannot print a green tick.
21. As a maintainer, I want the job to name what it does not cover, so that a
    green macOS check is not read as "the bundle is signed" or "the Keychain
    round-trips".
22. As a maintainer, I want a test that asserts the settled state of deferred
    work to wait for it, so that the result does not depend on how fast the
    machine is.
23. As a maintainer, I want one test that deliberately observes the transition
    to keep observing it, so that fixing the race does not delete the only
    evidence that the transition exists.
24. As a maintainer, I want a preference written behind a press to be verified
    as landed before a relaunch reads it, so that a persistence test tests
    persistence rather than timing.
25. As a maintainer, I want the deferral to remain a real delay, so that a
    test-driven change does not take away the moment the user sees their press
    acknowledged.
26. As a maintainer, I want the spec to say which of its decisions have landed,
    so that a later reader does not mistake a record for a plan.
27. As a maintainer, I want a rule for how a platform fact gets decided, so that
    the next adaptation question follows a path instead of a preference.
28. As a macOS user, I want the app to stay a Dock application with the system's
    own menu bar, so that adapting does not silently change how I launch or quit
    it.
29. As a user, I want the app to behave the same whether it was built for
    packaging or run from a development checkout, so that a packaging-only
    difference cannot surprise me at release.
30. As a maintainer, I want the gaps the checks cannot close recorded as gaps,
    so that the next effort starts from what is known rather than from what is
    assumed.

## Implementation Decisions

### 1. A reserved keystroke is a host property, and the rule is per host

The set of keystrokes the platform keeps for itself is data about `Host`:

| Host | Reserved |
| --- | --- |
| macOS | `Cmd+Q`, `Cmd+H`, `Cmd+Opt+H`, `Cmd+M`, `Ctrl+Cmd+F` |
| Linux | `Ctrl+Q`, `Alt+F4`, bare `F11` |

Two consequences are part of the decision, not commentary:

- **Keystrokes are chosen by whether they are reserved on either host.** One
  binding table serves both platforms, so a keystroke that is free on the
  developer's host but reserved on the other is still a defect. Shift is outside
  every reserved arm, which is why password history is `mod+shift+h`.
- **The check is per host, so one platform's pass proves nothing about the
  other.** The test that guards this opens the app once as each host. What it
  asserts is deliberately thin: that module evaluation finished. Reaching the
  assertion is the whole claim, because a discarded binding table throws during
  `open()`.

Three bindings moved under this rule, and all three had to move together because
the visible badge, the binding, and the palette's own keystroke comparison are
separate carriers of one shortcut:

| Was | Is | Why |
| --- | --- | --- |
| `mod+h` | `mod+shift+h` | Command+H hides the app on macOS |
| `ctrl+\` | `mod+\` | `mod` is already Control on Linux, so Linux is unchanged; one spelling both platforms can read |
| `mod+r` | `mod+r` (kept) | The reload key only bites `dev` builds, so it is not worth spending a documented shortcut on |

Label embeds this rule, so the specification does not need to repeat it later:
**displaying a reserved keystroke is fine; binding it is not.**

### 2. A label standing for a bound keystroke comes from the keymap

The single source for a shortcut's rendered form is the keymap's own label
function, which already owns the glyph table and follows the running platform. A
key name that is not a modifier combination stays a literal (`↵`, `Esc`, `Tab`,
`Enter`) because there is nothing platform-specific to say about it.

No wrapper is built around this. A wrapper would be a second label table whose
only job is to disagree with the first. Reach covers inline prose, not just
badges: a tooltip that says `Ctrl+K` is the same defect as a badge that does.

One Linux change is accepted knowingly: `Ctrl+↵` reads as `Ctrl+Enter`. The
badge names one keystroke, and `mod+enter` is the one to name.

### 3. A capability the host cannot complete declares itself unavailable

**FIDO2 on macOS.** The engine's discovery requires a `/dev/hidraw` node and
shells out to a libfido2 CLI; macOS has neither, and no package provides one.
So the provider row is built from `Host`:

- `available` is derived, not copied from the server's offer. A provider the
  server offers and this host cannot complete is `available: false`.
- The reason travels with the challenge, so the UI can explain rather than
  merely disable.
- The security-key card reads the same value: its library-missing branch is
  gated on *not* being unsupported, so macOS never shows an install command.

This is a rejection, not an implementation. Making FIDO2 work needs IOKit's HID
manager and is out of scope; what is in scope is refusing to pretend.

**The Diagnose row stays.** Hiding an unbuildable dependency would make the
diagnosis quietly incomplete, and the next reader would have to rediscover why
the row is absent. The row exists, carries an `unsupported` reason, and:

- the state label reads as unavailable rather than missing;
- the reason is rendered where the missing-package advice would be;
- the "missing packages" list that drives the install action filters it out, so
  the install action is not offered for something no installer can provide.

A genuinely missing, genuinely installable package on either host is still
reported as missing. "Unavailable" is not a blanket excuse, and the tests assert
both directions.

Mock paths construct their provider rows through the same function as the real
path, so a mock view can name the host it pretends to run on and the derivation
is tested rather than bypassed.

### 4. A host-supplied default is expanded before any path comparison

A default directory configured with a leading `~` is a value the host handed
over, and comparing it against an absolute candidate never matches — the first
component is literally `~`. Expansion therefore happens at the call site, before
the allow-list sees it, rather than inside the comparison: the comparison stays
a pure function of two absolute paths, and the expansion is the wiring's job.

The regression test pins the wiring, not the comparator: it configures the
engine's own default (the one that keeps its `~`), opens a file in it, and
asserts the open is attempted. Testing the comparator with an expanded path
would have passed before the fix.

### 5. Redaction follows the host's path roots

The log redactor's idea of a personal path is not Linux's idea of one. It covers
the macOS roots alongside the Linux ones: the per-user temporary tree, the
library directory, the applications directory, and mounted volumes. This is a
privacy floor, so it is property-tested in the same shape as the existing rules
rather than eyeballed.

### 6. A check that could not run has not passed

The engine-pin check inspects the pinned source to prove it carries a macOS
Keychain provider. In CI that source arrives only with the dependency, so:

- the job fetches dependencies **before** the pin check, on both platforms;
- when no engine checkout can be found, the script **fails under CI** and warns
  locally. A developer without a sibling checkout is missing a convenience; a CI
  job that skips the inspection is missing its reason to exist.

The script also accepts Cargo's own checkout as a source of truth, because that
is where the pinned revision actually lands in CI — a sibling checkout and a
Cargo checkout are the same fact from two directions.

### 7. The macOS job is a compile-and-suite claim, and says so

The workflow gains a job on GitHub's macOS runner that runs the same gates as
Linux: version consistency, the pin check, the privacy check, formatting, the
TypeScript type-check, and the headless suite. The suite covers `cargo test`
through the runner's own configuration, so there is no separate step.

**Why the job is worth its cost.** It compiles this app's Rust for a real macOS
target — the one thing no Linux run can do, and the reason a macOS-only branch
can rot unnoticed. It also compiles the engine's macOS-gated code on every run,
which is a welcome side effect rather than a coupling: this repository cannot
build without the engine, so a broken engine is this repository's failure
whether or not the job names it.

**What the job must not claim**, written into the job itself so the check cannot
be read as more than it is:

| Not claimed | Why |
| --- | --- |
| A real Keychain round trip | The suite is headless; credential behaviour is asserted through the mock, never against Security.framework |
| A signed bundle or packaged artifact | `nsh package` is never exercised, so bundle layout, `Info.plist` and ad-hoc signing are exactly as unverified as before |
| Real windows, real input | No runner has an interactive session, so the development host never starts |
| Bundle-level platform behaviour | `open({ platform })` says the macOS branch *computes* what it should, not that a macOS window *behaves* |

That last row is the honest limit of the whole approach and belongs in the job,
not in a footnote: the job raises the floor from "never compiled" to "compiles
and its logic passes", and stops there.

### 8. Deferred work is waited for, not raced

The store runs bridge calls that touch the network or the disk behind a short
delay, so the press that starts the work paints first and the user sees their
input acknowledged. That delay is a product behaviour and stays.

A test step, however, resolves when the app has stopped rendering for a quiet
window — it does not wait for a timer. So a test asserting the *result* of
deferred work must wait for that result explicitly:

- the settled view or text, by waiting for it to appear;
- a closed surface, by waiting for it to disappear;
- a preference write, by waiting until the stored value has landed before a
  relaunch reads it.

The exception is a test whose subject *is* the transition — the loading state
that has to be visible before the work finishes. It keeps plain assertions,
because waiting for the settled state would delete the thing it exists to prove.

The regression proof for this decision is not the macOS runner: it is raising
the deferral well beyond any plausible scheduling jitter on Linux and requiring
the whole suite to stay green. A suite that only passes at the real value is
still racing, just more quietly.

## Testing Decisions

**What a good test is here.** These are behavioural questions with a platform
parameter, so a test asserts the *value* a host produces — which rows exist,
what a badge says, whether a provider is selectable, which keys bind, whether a
path opens — and never that a particular branch was compiled. Nothing spawns a
launcher, touches a real clipboard, or opens a real Keychain.

**Where the tests live, following existing prior art.**

- **Platform derivations** sit beside their module in the existing Rust test
  blocks, next to the ones the first specification added: dependency rows per
  host, the unsupported reason's presence and absence, the install action's two
  answers, redaction of each path root, and expansion of the default download
  directory. The pattern to copy is the first specification's: construct both
  hosts, assert the difference, and make the negative case present so a blanket
  "unavailable" cannot pass.
- **The keymap guard** is its own file rather than a case inside the suite,
  because its claim is "the app loaded", which a behavioural test cannot make.
  It opens each host in turn.
- **The deferred-work cases** stay where they are, in the suite that drives the
  app like a user, and are converted from "assert now" to "wait for it": the
  settled view, the closed modal, the stored preference. The loading-state case
  is left observing the transition, with its comment saying why.
- **The mock host** is a parameter, so a case that needs the macOS derivation
  asserts it on a machine of either kind.

**What is deliberately not tested.**

- The macOS Keychain, the pasteboard provider, bundle layout and signing are not
  reachable from a headless suite and are not faked to look covered.
- The job's runner differences are not simulated. When the runner is slow enough
  to expose a race, the race is fixed; the runner is not taught to be patient.

**The regression surface.** The whole Rust suite and the whole headless suite
must stay green, at the real deferral and at an exaggerated one. The second run
is the guard that catches a reintroduced race without needing a slow runner;
the first is the guard that the fix did not change what the user sees.

**Acceptance flow (macOS, by hand).** Launch, sign in, quit, relaunch (the app
must come back *locked*), unlock, log out; confirm the Keychain item is gone and
carries no plaintext secret. Then: press the password-history shortcut, open the
palette, confirm every shortcut in the menu works; reach a two-factor challenge
offering a security key and confirm it declares itself unavailable; open a
downloaded attachment. The agent cannot run this; a report must say so rather
than imply it was verified.

## Out of Scope

- **Engine-side macOS work.** The recorded dependencies live in the engine
  repository: Keychain items surviving a re-sign is still open, and the macOS CI
  job and the host-aware opener were closed there and are what the pin carries.
- **Making FIDO2 work on macOS.** Needs IOKit's HID manager, not a CLI. Only
  declining to offer it is in scope.
- **Touch ID / system-authentication quick unlock, and screen-lock auto-lock.**
  Separate decisions with their own UX.
- **Code signing, notarization, a release workflow entry, and Apple Silicon vs.
  Intel.** Ad-hoc signing is the current ceiling.
- **Menu-bar-only presentation.** Settled during charting: the app stays a Dock
  application.
- **A custom application menu.** Settled during charting: the system default
  supplies Quit/About/Hide, so there is no gap to close.
- **A template (SVG) tray icon.** Visual polish; the tray is not a primary entry
  point for a Dock app.
- **Everything the first specification already ruled out**, including Windows,
  web, iOS and Android.
- **The Diagnose page's overall frame.** It no longer names a Linux distribution
  or a compositor, and unbuildable rows declare themselves, but the page is
  still shaped like a package-manager screen. On macOS the action is absent and
  the page degrades gracefully; deciding whether it should look different there
  is a UX decision this effort does not make.

## Further Notes

### Open questions

Three questions were left open when this specification was written. They are
listed here rather than quietly dropped, because each one is a claim the current
suite cannot make.

1. **Tab focus traversal on macOS.** The app moves focus itself, on the stated
   premise that the platform's native traversal visits only text fields. On
   macOS the platform's documentation says Tab visits fields *and* pressable
   views. Either the premise is stale or macOS steps twice. Not measured, so not
   decided — measuring it first is the whole work.
2. **What a packaged macOS bundle needs.** `nsh package --target macos` has
   never been run. Bundle layout, the daemon's place inside it, and whether the
   result is launchable at all are unknown. The first specification argued from
   source that the bundled-daemon lookup already probes the right directory;
   that argument has never been checked against an artifact.
3. **The `ctrl+enter` alias.** It is a redundant spelling of `mod+enter` running
   the same handler. The label rule does not need it, since the badge names one
   keystroke. Whether the alias should exist at all is unasked, not answered.

### How a platform fact gets settled here

The route that produced this specification is reusable, and worth naming because
the next adaptation question will follow it:

1. **Ask what the host does, from the host's own documentation**, not from this
   repository's habits. The authoritative source for platform behaviour is the
   framework's documentation, and `AGENTS.md` requires consulting it before
   touching UI or native bindings.
2. **Express the answer as a `Host` value**, so it can be asserted from any
   machine. A `cfg!` branch anywhere but the single platform read is the signal
   that the difference was not turned into data.
3. **Ask which of the two readings a symptom admits.** "The tool is missing" and
   "the platform has no such tool" produce the same status string; only `Host`
   can tell them apart, and choosing correctly is the difference between a fix
   and a dead end.
4. **Look for the second instance before fixing the first.** The reserved-key
   rule found three carriers of one shortcut, and the `~` defect existed on both
   hosts. A platform fix that touches one call site is usually half a fix.
5. **Prove it where the defect is invisible locally.** If a test cannot fail on
   the developer's machine, either make the machine's disadvantage reproducible
   (an exaggerated delay) or add the job that has it (the macOS runner).

### Why the CI job found what a Mac did not

The person who fixed the first effort's defects ran the suite on a real Mac and
got 356 out of 356. The job that was added afterwards, on a slower runner, got
nineteen failures on the same commit. Neither result was wrong: the tests were
asserting settled states without waiting for them, and the faster machine won
the race every time. This is worth keeping as a rule — **a green run on fast
hardware is not evidence that a test is not racing**, which is why the guard for
this class is an exaggerated delay rather than a rerun.
