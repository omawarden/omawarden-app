# Omawarden App: macOS Host Support Specification

> **Target Repository**: `omawarden/omawarden-app`
> **Status**: Ready for Implementation
> **Primary Goal**: Make the app work on macOS as a real host rather than a
> Linux program that happens to compile there — starting with credentials that
> actually persist in the system Keychain.

---

## Problem Statement

The app is written for Linux all the way down, not just at packaging time. A
user who builds it on macOS gets four different kinds of breakage:

1. **Credentials never persist.** The engine revision the app pins predates the
   pluggable Keyring Provider, so it has no macOS backend at all: the only
   provider it knows is `secret-tool`, which is not on macOS. Signing in appears
   to work and nothing survives the process.
2. **The app opens things with a binary macOS does not have.** Opening a URL,
   and opening a decrypted attachment, both shell out to `xdg-open`.
3. **The Clipboard Guard silently never fires.** The clear is a hardcoded
   `wl-copy --clear`. On macOS the copy succeeds through the engine and the
   clear does nothing, so a sensitive value stays on the pasteboard forever.
   This is a security regression, not a cosmetic one.
4. **The app tells the user the working parts are broken.** The dependency
   surface lists `secret-tool` and `wl-copy` as *required*, the Diagnose surface
   names them, and the process RSS reads `/proc/self/statm`, which does not
   exist. A correctly working macOS install reports two missing requirements and
   zero memory.

There is a fifth problem that is not macOS-specific but blocks any honest
verification of the above: **the engine pin is not actually enforced.** The
local build patches `omawarden` to a sibling checkout, while CI removes the
patch and fetches the pinned revision. Nothing compares the two, so a developer
can develop against an engine the release will never ship — and every local
check still passes, because the symbols involved exist in both revisions.

## Solution

macOS becomes a supported host alongside Linux, with **credential persistence
first** as the milestone that makes the app usable at all.

The engine pin moves to a revision containing the pluggable Keyring Provider,
which selects the system Keychain through Security.framework on macOS and the
Secret Service through `secret-tool` on Linux. The app's own platform
differences — the URL/file opener, the clipboard clear, the dependency rows, the
health rows, the install action, and the memory reading — stop being inline
`cfg` checks and become **data passed into pure functions**, so the macOS branch
is exercised by unit tests on any host.

Linux behaviour is unchanged. Where a capability has no macOS implementation
yet (Polkit quick unlock, screen-lock auto-lock, FIDO2), it is reported as
unavailable, which the engine already does, and the interface hides it rather
than failing.

## User Stories

1. As a macOS user, I want to sign in and have the session tokens stored in the
   system Keychain, so that I am not asked for my master password on every
   launch.
2. As a macOS user, I want the app to reopen in the locked state after a
   restart, so that I know my credentials were persisted and my vault is not
   silently unlocked.
3. As a macOS user, I want unlocking after a restart to use the retained
   refresh token, so that I do not re-authenticate against the server.
4. As a macOS user, I want logging out to remove the app's Keychain items, so
   that a shared machine keeps no trace of my session.
5. As a macOS user, I want to copy a password and have it disappear from the
   pasteboard after the configured TTL, so that another application cannot
   harvest it later.
6. As a macOS user, I want the Clipboard Guard to leave the pasteboard alone
   when another application has replaced my copy, so that the guard does not
   eat something I copied afterwards.
7. As a macOS user, I want copying a non-sensitive field to stay on the
   pasteboard, so that the guard is not a nuisance.
8. As a macOS user, I want to open a decrypted attachment in its default
   application, so that previewing a file works the way it does on Linux.
9. As a macOS user, I want the app to refuse to open a path that is neither a
   managed preview nor in my download directory, so that a stale path cannot
   make it open an arbitrary file.
10. As a macOS user, I want links in the app to open in my default browser, so
    that "open the web vault" does something.
11. As a macOS user, I want the Dependencies view to list only what macOS
    actually needs, so that I am not told to install `secret-tool`.
12. As a macOS user, I want the Diagnose view to name the macOS Keychain and the
    pasteboard, so that a green checkmark refers to the thing that is really
    being used.
13. As a macOS user, I want the Diagnose view to show a real memory figure, so
    that the number is not permanently zero.
14. As a macOS user, I want the "install missing packages" action to be absent
    rather than opening a terminal that cannot work, so that I am not led into a
    dead end.
15. As a Linux user, I want every one of the above to behave exactly as it does
    today, so that adding a host costs me nothing.
16. As an Omarchy user, I want the Polkit quick-unlock action to remain
    available where it works, so that macOS support does not remove a Linux
    feature.
17. As a macOS user, I want quick unlock to be hidden rather than broken, so
    that I am not offered a button that cannot work.
18. As a user on either host, I want the app to state which platform it is
    reporting on, so that a health check is not ambiguous.
19. As a maintainer, I want a local build and the release build to compile the
    same engine revision, so that "it works on my machine" means something.
20. As a maintainer, I want the build to fail loudly when the sibling checkout
    has drifted from the pin, so that the drift cannot go unnoticed again.
21. As a maintainer, I want the build to fail when the pinned engine has no
    macOS Keychain provider, so that a Linux-only engine cannot pass as a
    cross-platform one.
22. As a maintainer, I want the macOS-only code paths typechecked on every
    build, so that a branch only a Mac can reach is not left to rot.
23. As a maintainer, I want the platform branches covered by tests that run on
    Linux CI, so that I do not need a Mac to verify the logic.
24. As a maintainer, I want the README and the task runner to stop claiming the
    app ships Linux only, so that a new contributor is not misled.
25. As a maintainer, I want the glossary to describe the clipboard and the
    provisioning of credentials in platform-neutral terms, so that the domain
    vocabulary does not encode a Linux-only mechanism.
26. As a maintainer, I want a record of why the engine pin moved and what
    remains unverified on macOS, so that the next reader does not have to
    rediscover it.
27. As a macOS user, I want the packaged app to declare its minimum supported
    system version, so that installation on an unsupported release fails
    clearly instead of at runtime.
28. As a maintainer, I want the engine-side gaps (macOS CI, Keychain ACLs, the
    remaining `xdg-open`) filed against the engine repository, so that they are
    tracked where they can be fixed.

## Implementation Decisions

### 1. The engine pin moves to a revision that has the Keyring Provider

macOS credential persistence is not an app-side change. It requires the engine's
pluggable Keyring Provider architecture, in which `MacOsKeychainProvider` talks
to Security.framework directly and `SecretToolKeyringProvider` keeps the Linux
behaviour. The pin therefore moves to that revision, and nothing earlier will do.

The pin stays a 40-hex revision, not a branch or a tag: the release builds the
bundled daemon from it and the app compares every external daemon against it.

`Cargo.lock` is deliberately **not** treated as the pin. Under the local
`[patch]` Cargo records no `source` for the engine (a path override *is* the
package); CI's resolution needs a `source = "git+…?rev=<sha>"` line. One lock
entry cannot hold both shapes, and CI does not pass `--locked`, so it re-resolves
rather than comparing. Reproducibility comes from the immutable revision.

### 2. The pin is a contract between two toolchains, and it is enforced

Two different resolutions must agree:

- **local**: the `[patch]` in `.cargo/config.toml` points at a sibling checkout;
- **CI**: the patch is removed and Cargo fetches the `rev` in `Cargo.toml`.

Nothing in Cargo ties these together. The pin check therefore compares three
facts and fails on disagreement:

- the revision named in `Cargo.toml`;
- the sibling checkout's `HEAD`, when a sibling exists;
- the presence of the engine's macOS Keyring provider in that checkout.

The third check is the one specific to this work: a checkout without it builds
fine, stores nothing, and falls back to the Secret Service provider. A Linux-only
engine must not be able to pass as a cross-platform one.

With no sibling checkout — the CI shape — the script accepts the pin and lets
Cargo fetch it.

### 3. One new seam: `Host`

Platform differences become values, not conditional compilation:

```rust
pub(crate) enum Host { Linux, MacOs }

impl Host {
    pub(crate) fn current() -> Self;   // the only place cfg! is read
}
```

Rules for the seam:

- **No trait and no mock.** A host is data with two possible values; a trait
  would add a layer with nothing behind it.
- **Every platform difference is a `Host` parameter on a pure function.**
  Deciding which dependency rows exist, what a health row is called, which
  command opens a URL, whether an install action is offered, and how memory is
  read are all functions of `(Host, …)` returning plain values.
- **The single `cfg!` read is at `Host::current()`.** Branching with `cfg!`
  rather than `#[cfg]` elsewhere keeps both arms typechecked on every target,
  which matters because macOS cannot be compiled from this repository's CI.
- **No existing seam changes shape.** `PlatformEngine`, `DiagnosticsEngine`,
  `ClipboardEngine`, `AttachmentsEngine` and `DaemonSourceEngine` keep their
  methods; their `InProcess` implementations call the new pure functions.

This is the seam the tests are written against: a test can ask what macOS would
report without being on macOS.

### 4. The launcher is a host property

Opening a URL and opening a decrypted file use the same host-selected command:
`open` on macOS, `xdg-open` elsewhere. One helper, both call sites, so the two
cannot drift apart again.

### 5. Attachment opening is gated on the path the engine really writes

The existing guard only accepts a path under `$XDG_RUNTIME_DIR/omawarden` or the
configured download directory. That is not where previews are written: the
engine writes them under its own runtime root, in a subdirectory named after the
engine, one level deeper per credential slot, item and attachment. **No preview
path can pass the guard**, on any platform — this is a pre-existing defect that
macOS work surfaced, and it is fixed here.

The allow-list becomes the engine's actual preview root plus the download
directory, obtained from the engine rather than reconstructed from
`XDG_RUNTIME_DIR` with a `/tmp` fallback. Everything else is refused, and the
decision is a pure function of `(candidate, preview_root, download_dir)`.

### 6. The Clipboard Guard clears through the engine's provider

The clear stops being `wl-copy --clear` and becomes the engine clipboard
manager's own clear, which dispatches to the platform provider. The macOS
provider already declines to wipe a pasteboard another application has taken
over since the copy; that protection is exactly what the app-level timer needs,
and it is lost today on Linux too because the raw command bypasses it.

The timer's "am I still the newest copy" test becomes a pure function of the
generation counter rather than something a test has to sleep through.

### 7. Honest dependency and health surfaces

Both surfaces are computed from the host:

| Surface | Linux | macOS |
| --- | --- | --- |
| Required dependency rows | daemon, `secret-tool`, `wl-copy` | daemon |
| Optional row | `fido2-token` | `fido2-token`, marked unavailable: the engine looks for `/dev/hidraw`, which macOS lacks |
| Keyring health row | "Secret Service Keyring", names `secret-tool` | "macOS Keychain", names Security.framework |
| Clipboard health row | "Wayland Clipboard", names `wl-copy` | "Clipboard", names the pasteboard |
| Install action | offered | refused, so the interface hides it |
| Process RSS | `/proc/self/statm` | `ps`, in KiB |

The rows are *reported*, never guessed: the keyring and clipboard availability
values continue to come from the engine, which is the only thing that knows
which provider resolved. What changes is only the vocabulary around them.

The dependency page stays structurally as it is — same lists, same route — so
the change is in the data, not the layout.

### 8. Features without a macOS implementation are absent, not broken

Polkit quick unlock, screen-lock auto-lock, the SSH agent's peer introspection,
and FIDO2 remain Linux-only. No work is done on them here, and none is stubbed
with a fake success: the engine already reports `quick_unlock_ready` as false
when no system-authentication helper resolves, and the interface keys off that
value. The macOS replacements (Touch ID, the system lock state) are separate
work with separate decisions.

The one asymmetry worth noting: the Polkit policy file, the pacman scriptlet and
the AUR packaging remain, because the Linux release channel still needs them.

### 9. Packaging keeps the daemon where the resolution already looks

No change is needed to daemon source resolution. A macOS bundle places the app
executable in `Contents/MacOS/`, which is `current_exe().parent()` — the first
place the bundled-daemon lookup already probes. The daemon shipped in the bundle
is built for the bundle's own target, which is the same rule Linux follows.

This supersedes the sentence in ADR 0003 that limits the bundled daemon to
"Linux-only … an ELF for the app's target triple": the rule is *built for the
bundle's target*, and it happens to be an ELF only on Linux.

Producing and signing that bundle (Developer ID, notarization, a release
workflow matrix entry) is not part of this spec.

### 10. The manifest declares the floor

The bundle declares its minimum supported macOS version explicitly rather than
inheriting whatever the toolchain defaults to, so an unsupported system fails at
install time instead of at an FFI boundary.

### 11. Documentation follows the code

The README stops claiming the app is Linux-only and states the macOS
prerequisites (none beyond the platform frameworks); the task runner's comment
stops asserting that only the Linux runner is packaged; the glossary describes
the clipboard as the platform provider's surface rather than "the Wayland
clipboard", gains the Keyring Provider term, and describes the release bundle
without assuming Linux. One ADR records the decisions above and, importantly,
what remains unverified.

## Testing Decisions

**What a good test is here.** These are behavioural questions with a platform
parameter, so the tests assert the *value* a given host produces — which rows,
which label, which command name, openable or not, still-newest or superseded.
They do not assert that a particular branch was taken, and they never spawn
`pdialog`/`open`/`xdg-open` or touch a real clipboard or Keychain.

**Where the tests live.** Each pure function is tested beside its module, in the
existing `mod tests` blocks, following `src/diagnostics.rs` and
`src/daemon_source.rs` as prior art:

- **Host resolution** — `Host::current()` answers the host it was compiled for.
  This is the one assertion that differs per platform; everything else takes a
  `Host` by parameter.
- **Launcher selection** — the command name for each host.
- **Attachment openability** — a path inside the engine's preview root is
  accepted; a path in the download directory is accepted; a sibling directory
  that merely shares a prefix is refused; a relative path is refused; a path
  under the *old, wrong* runtime subdirectory is refused, which pins the defect
  that motivated the change.
- **Clipboard guard** — a stale generation does not clear; the newest does; a
  non-sensitive copy never schedules a clear; a zero TTL schedules nothing.
- **Dependency rows** — macOS lists no `secret-tool` or `wl-copy`; Linux lists
  both as required; the daemon row is present on both; the optional row is
  never required.
- **Health rows** — each host's names and detail strings, for available and
  unavailable, and that the row's `ok` flag is the engine's value verbatim
  rather than something re-derived.
- **Install action** — refused for macOS, offered for Linux.
- **RSS** — the parser accepts a real `ps`-shaped number and a `/proc`-shaped
  one, and an unparseable input yields zero rather than a panic.

**Pin check.** Exercised by running the script in three shapes: the repository
as-is (passes), a simulated drift between pin and sibling (fails, naming both
revisions), and no sibling at all (passes, CI shape). A check that has never
been seen to fail is not a check.

**Regression surface.** The existing 103 Rust tests and 319 headless tests must
stay green; the Linux dependency expectations they encode are the guard against
this work quietly changing Linux behaviour.

**What is not tested here, by necessity.** Anything that requires macOS: the
Keychain FFI, the pasteboard provider, bundle layout, code signing. Those are
verified on a Mac against the acceptance flow below, and the engine-side CI gap
is recorded rather than papered over.

**Acceptance flow (macOS, run by hand).** Fresh clone → `nsh run --target
macos` → sign in with a real account → quit → relaunch → the app is *locked*,
proving the refresh token came back from the Keychain → unlock → lock or log
out → the corresponding Keychain item is gone. Inspecting the item directly must
show no plaintext secret. The agent cannot run this here; the implementation
report must say so explicitly rather than implying the macOS path was verified.

## Out of Scope

- **Touch ID / system-authentication quick unlock.** Needs a decided substitute
  for Polkit, an entitlement story, and its own UX.
- **Screen-lock auto-lock on macOS.** The engine's lock detection is
  Omarchy/Hyprland-specific.
- **FIDO2 on macOS.** The engine shells out to `fido2-token`, which is a
  libfido2 CLI; macOS has no equivalent to shell out to, and device discovery
  additionally requires `/dev/hidraw`. Making it work needs IOKit's HID manager
  and is a separate piece of work. What is *not* out of scope is declining to
  offer it: the provider is marked unavailable on macOS so the second factor
  never dead-ends on an install that cannot help.
- **Code signing, notarization, and a macOS release workflow.** Ad-hoc signing
  is the current ceiling; distributing needs a Developer ID and a decision about
  where artifacts live.
- **Apple Silicon vs. Intel.** One architecture for now; a universal build
  doubles the CI work and the daemon's build step.
- **Dock icon vs. menu-bar-only presentation.** A product decision about
  `activationPolicy`, not a platform-support one.
- **Windows, web, iOS, Android.**
- **Moving credential writes into the daemon** so only one process touches the
  Keychain. That is an engine-side architectural change.
- **Replacing the engine's remaining Linux-shaped paths** (the SSH agent socket,
  the daemon socket's `/tmp` fallback, `~/Library` conventions). They degrade
  rather than fail, and changing them is a separate decision.

## Further Notes

- **The engine's macOS code has never been compiled by CI.** The engine's
  workflow runs `ubuntu-latest` only, so every `#[cfg(target_os = "macos")]`
  block — including the Security.framework FFI this work depends on — is
  unverified. Cross-compiling it from Linux is not an option without a macOS SDK
  and a cross toolchain. A `macos-latest` job in the engine repository is the
  only way to make the claim real, and it is filed separately, not assumed.

- **Ad-hoc signing and Keychain access control.** An ad-hoc signature's
  designated requirement is its code hash, so it changes on every rebuild; the
  default Keychain ACL trusts only the process that wrote the item; and both the
  app and the daemon write credentials. The predicted consequence is an
  authorization prompt after a rebuild. Stable signing removes it. The useful
  engine-side follow-up is to create items in the data-protection keychain with
  an access group, which survives re-signing in a way the file-based keychain's
  ACL does not. Until then the prompt is a known cost, and it belongs in the
  release notes rather than in a bug report.

- **Why the drift guard is not a `--locked` check.** Adding `--locked` would
  force a choice between the local patch shape and the CI git shape in a file
  that cannot hold both. Comparing the revision and the sibling's `HEAD` catches
  the same failure without that constraint.

- **The attachment defect predates this work.** It is worth stating plainly in
  the changelog: opening an attachment used to be refused on Linux too, because
  the guard named a directory the engine never writes to.

- **Linux copy that stays Linux.** The dependency page's install affordance, the
  Polkit policy, the AUR PKGBUILD checks and the Arch instructions are not
  deleted or generalised; they gain a platform condition, not a rewrite.
