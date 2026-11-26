# 0007: Support macOS as a host, and make the engine pin a contract

**Status**: Accepted
**Date**: 2026-11-24
**Deciders**: (this session)
**Supersedes**: [0003](0003-daemon-source-bundling-and-trust.md), in part (the
"Linux-only … an ELF for the app's target triple" sentence)

## Context

The app was written for Linux all the way down, not only at packaging time. A
user who built it on macOS got four kinds of breakage:

1. **Credentials never persisted.** The pinned engine predated the pluggable
   Keyring Provider, so it had no macOS backend at all: the only provider it
   knew was `secret-tool`, which is not on macOS. Signing in appeared to work
   and nothing survived the process.
2. **Opening things used a binary macOS does not have.** Opening a URL, and
   opening a decrypted attachment, both shelled out to `xdg-open`.
3. **The Clipboard Guard silently never fired.** The clear was a hardcoded
   `wl-copy --clear`. The copy succeeded through the engine and the clear did
   nothing, so a sensitive value stayed on the pasteboard forever. That is a
   security regression, not a cosmetic one. On Linux the same command happened
   to be what the engine's provider runs, so nothing visible changed there; the
   defect was that the app owned a mechanism the engine owns, so a host without
   `wl-copy` could not clear at all.
4. **Working parts were reported as broken.** The dependency surface listed
   `secret-tool` and `wl-copy` as *required*, the Diagnose surface named them,
   and the process RSS was read from `/proc/self/statm`, which macOS does not
   have.

A fifth problem was not macOS-specific but blocked any honest verification:
**the engine pin was not enforced.** The local build patched `omawarden` to a
sibling checkout, while CI removed the patch and fetched the pinned revision.
Nothing compared the two, so a developer could develop against an engine the
release would never ship and every local check still passed, because the
symbols involved exist in both revisions.

## Decision

**macOS becomes a supported host alongside Linux, and the pin becomes a
contract that is enforced.**

- **Platform differences are data, not conditional compilation.** A `Host`
  value (`Linux` or `MacOs`) is passed to pure functions that decide the opener
  command, the dependency rows, the health-row vocabulary, whether an install
  action is offered, and how process memory is read. `Host::current()` reads
  the compiled target in one place, with `cfg!` rather than `#[cfg]`, so both
  arms are typechecked on every build. This repository's CI cannot compile for
  macOS, and a branch only a Mac can see is a branch that rots.
- **The engine moves to a revision with the pluggable Keyring Provider**, where
  `MacOsKeychainProvider` talks to Security.framework and
  `SecretToolKeyringProvider` keeps the Linux path. The pin stays a 40-hex
  revision: the release builds the bundled daemon from it and the app compares
  every external daemon against it.
- **The pin is a contract between two toolchains.** `scripts/check_engine_pin.sh`
  compares the revision in `Cargo.toml`, the sibling checkout's `HEAD` when one
  exists, and the presence of the engine's macOS Keychain provider, and fails
  on any disagreement. With no sibling it accepts the pin and leaves fetching
  to Cargo — the CI shape. *Amended below*: what "disagreement" means depends
  on who is asking.
- **Attachment opening is gated on where the engine really writes.** The
  allow-list is the engine's own preview root plus the download directory, and
  the accept/refuse decision is a pure function. The runtime directory comes
  from the engine; the `omarchy-bitwarden/scoped-attachments` subdirectory is
  repeated in the app because the engine does not export it, so it has to move
  with the engine's layout. The previous guard named `<runtime>/omawarden`,
  which the engine never writes to, so **no preview path could pass it on any
  platform**; that pre-existing defect is fixed here.
- **The Clipboard Guard clears through the engine's provider**, not an external
  command, so the platform decides how to clear and any takeover protection the
  provider has applies. On macOS the pasteboard provider compares its recorded
  change count and declines to wipe a selection another application took over;
  at the pinned revision the Linux providers still clear unconditionally, so
  that branch is unchanged. The "am I still newest" test is a pure function of
  a generation counter, so a test exercises both answers without sleeping.
- **Capabilities are reported, never assumed.** The keyring and clipboard
  availability values still come from the engine, which is the only thing that
  knows which provider resolved; only the vocabulary around them is per-host.
  A macOS install lists the daemon and the optional security-key row, and no
  `secret-tool` or `wl-copy`.
- **Kernel- and desktop-specific hooks stay Linux-only and are allowed to be
  absent.** Polkit quick unlock, screen-lock auto-lock, the SSH agent's peer
  introspection and FIDO2 keep their Linux implementations. None is stubbed
  with a fake success: the engine already reports `quick_unlock_ready` as false
  when no system-authentication helper resolves, and the interface hides the
  action. The Polkit policy, the pacman scriptlet and the AUR packaging remain,
  because the Linux release channel still needs them.
- **The bundle declares its floor.** `nsh.json` names
  `LSMinimumSystemVersion: "14.0"`, so an unsupported system fails at install
  time rather than at an FFI boundary.
- **The daemon stays where the resolution already looks.** A macOS bundle puts
  the executable in `Contents/MacOS/`, which is `current_exe().parent()` — the
  first place the bundled-daemon lookup probes. The rule is *built for the
  bundle's target*; an ELF is merely what that yields on Linux. This supersedes
  ADR 0003's "Linux-only … an ELF" sentence without changing its decision to
  bundle the daemon and let the user pick another.

## Consequences

- A macOS user can sign in, quit, relaunch, and find the app locked, because
  the refresh token came back from the Keychain; logging out removes the app's
  Keychain items. Copying a password removes it from the pasteboard after the
  TTL, and copying a non-sensitive field leaves it in place.
- Linux behaviour is unchanged: the same dependency rows, the same keyring and
  clipboard names, the same install action, the same URL validation and
  detached spawn. The existing tests encode that and are the guard.
- The platform branches are covered by tests that run on Linux CI. The macOS
  branch is asserted by asking what `Host::MacOs` produces, not by compiling on
  a Mac.
- `Cargo.lock` is deliberately not treated as the pin. Under the local patch
  Cargo records no `source` for the engine, while CI's resolution needs a
  `source = "git+…?rev=<sha>"` line; one lock entry cannot hold both shapes, and
  CI does not pass `--locked`. Reproducibility comes from the immutable
  revision, so a `--locked` check would force a choice that cannot be made.

## What has been settled since

- **The pin is a floor locally and an exact revision where it is published.**
  The paragraph above said any disagreement fails, and that was too strong in
  one direction and too weak in another. The pin still denotes **one exact
  commit** — a version floor was rejected, because a version string cannot stop
  credentials reaching a specific binary, and a second comparison input would
  make "matches" the union of an exact test and an approximate one. What
  changes is only the **local** test: the sibling checkout must *contain* the
  pin (`git merge-base --is-ancestor <pin> HEAD`), not equal it. Working on a
  branch ahead of the pin is the normal way to develop against an unreleased
  engine, and the release still ships the pin, so every symbol the local build
  uses exists there too. A push and CI keep exact equality
  (`ENGINE_PIN_STRICT=1`, implied by `CI`), because those build the pin itself.
  Anchoring on ancestry rather than on a branch name is what makes it strict:
  an engine on an unrelated line of history fails even locally, which is the
  case the earlier "any disagreement" sentence was really aimed at.
- **A mismatch is graded by version, never decided by it.** The app cannot test
  ancestry — `commit_matches()` compares SHA prefixes and `probe_version()`
  reads one line of `-V` — so a four-state `newer`/`older`/`diverged` model was
  proposed and withdrawn. Version instead grades a message's severity: greater
  is a neutral note, lesser a warning, and equal-with-a-different-commit a
  warning, that last case being the only one that catches a sibling branch
  reporting the same version with different code. The engine's own `-dev`
  marker is not treated as a safe signal. This is why raising the pin is a
  tooling problem rather than a comparison one.
- **Raising the pin is one command, and its silent parts are named.**
  `mise run bump-engine <ref>` (`scripts/bump_engine.sh`) resolves the ref to a
  full 40-character revision *before* writing, rewrites only the `rev`, and
  moves the sibling checkout unless it has uncommitted work or `--no-sibling`
  says otherwise. It never writes the comment above the pin: the reason a
  revision is worth pinning is the one thing a script cannot know, so it prints
  what to replace instead of inventing it. A ref that does not resolve fails
  loudly and leaves the manifest untouched.
- **The sibling checkout is not the script's to move when someone else is using
  it.** The engine checkout is shared with the engine repository's own work, so
  `bump-engine` refuses to switch it out from under uncommitted changes and says
  how to finish the move by hand. A bump that cannot move it still succeeds
  when the new pin is an ancestor of where the sibling already is, because local
  builds then contain it.

- **This repository has a macOS job of its own.** `.github/workflows/ci.yml`
  gained a `macos-latest` job (`Test & Verify (macos-arm64)`) that runs the same
  gates as Linux: version consistency, the pin check, the privacy check,
  formatting, `nsh check`, and `nsh test`. The suite covers `cargo test` through
  the runner's own configuration, so there is no separate step. What it buys is
  the one thing no Linux run can do — this app's Rust compiled for a real macOS
  target, and the whole suite passing in a process whose `cfg!(target_os)` is
  macOS. What it does *not* do is written into the job itself: no Keychain round
  trip, no signed bundle, no `--target macos`, so `open({ platform })` remains a
  weaker claim than "a macOS window behaves".
- **The pin check could pass without running, and that is fixed.** In CI the
  pinned engine's source arrives only with the dependency, so the script has
  nothing to inspect until `cargo fetch` has run; the "no checkout" path then
  returned success *before* the macOS Keychain provider check, which is the
  script's whole reason to exist. It now also accepts Cargo's own checkout as a
  source of truth, both jobs fetch before the check, and under `CI` an
  uninspectable pin is a failure rather than a warning — a warning was what let
  the build print a green tick over a check that never happened. Locally it
  stays a warning, because a missing sibling checkout is a missing convenience.
  All three paths were exercised by hand.
- **The macOS job's first run found a defect Linux had been hiding.** Nineteen
  headless tests failed on the runner and passed on Linux and on a real Mac.
  The cause is not the platform: the store defers bridge calls that touch the
  network or the disk so the press paints first, and a test step resolves on a
  fixed quiet window that does not cover a timer. On fast hardware the timer won
  every time. Raising the deferral to three seconds on Linux reproduced 52
  failures, so the tests had always been passing on luck. They now wait for the
  settled view, the closed modal, or the preference write they assert on, while
  the one case whose subject *is* the loading transition keeps observing it. The
  guard is the exaggerated delay, not a slow runner.
- **The engine's macOS code is compiled and tested by CI.** The engine's
  workflow gained a blocking `backend-macos` job on `macos-latest` that runs
  clippy and the whole test suite after provisioning an ephemeral unlocked
  Keychain. It has run green on the engine's `develop` at `57f8679` (394 tests
  plus every integration suite), the revision this repository pinned when the
  clause was written, and the `#[cfg(target_os = "macos")]` blocks — including
  the Security.framework FFI this work depends on — are exercised on a real
  target rather than argued about. Filed as
  [icyleaf/omarchy-bitwarden#432](https://github.com/icyleaf/omarchy-bitwarden/issues/432),
  drafted in `docs/upstream/01-macos-ci-job.md`.
- **The Rust half is surveyed and the defects it hid are fixed.** A pass over
  all 21 modules found every remaining Linux-only mechanism behind a
  `Host` gate with a tested macOS arm, so no capability loss was findable by
  looking for Linux paths — and the two real defects were not paths at all.
  FIDO2 was offered on macOS and could never work (the engine needs
  `/dev/hidraw`), so the second factor dead-ended on an install that changes
  nothing; providers now derive availability from `Host`, and the Diagnose row
  declares itself unsupported rather than missing. The `~/Downloads` allow-list
  arm was dead on both hosts because the engine's default keeps its `~`.
  Whether other keystrokes are reserved is now guarded by opening the app on
  both platforms in the suite.
- **The two engine-side Linux-only mechanisms are gone.**
  `attachment::get_attachment` no longer shells out to `xdg-open`; the engine
  hands opening back to the host, which is why both call sites here take its
  new seven-argument shape. And SSH peer introspection identifies the requester
  off Linux, so the approval card names a real command and the `first-use`
  policy can remember an approval. Filed as
  [#434](https://github.com/icyleaf/omarchy-bitwarden/issues/434) and
  [#435](https://github.com/icyleaf/omarchy-bitwarden/issues/435), both closed
  and merged into the engine's `develop`.

## What remains unverified

- **Keychain access control under ad-hoc signing.** An ad-hoc signature's
  designated requirement is its code hash, so it changes on every rebuild; the
  default Keychain ACL trusts only the process that wrote the item; and both the
  app and the daemon write credentials. The predicted consequence is an
  authorization prompt after a rebuild. Stable signing removes it, and the
  engine-side follow-up — items in the data-protection keychain with an access
  group — is filed as
  [icyleaf/omarchy-bitwarden#433](https://github.com/icyleaf/omarchy-bitwarden/issues/433)
  and drafted in `docs/upstream/02-keychain-access-group.md`.
- **The acceptance flow must be run by hand on a Mac.** Fresh clone →
  `nsh run --target macos` → sign in → quit → relaunch (the app must be
  *locked*) → unlock → log out → the Keychain item is gone, and inspecting it
  shows no plaintext secret. It has not been run. What has been run on a Mac is
  the automated half — `cargo check --all-targets`, `nsh check` and the full
  `nsh test` suite, green and repeatedly — which says nothing about a real
  sign-in against a real server or about the Keychain surviving a relaunch.
  Nothing in this repository's CI can run the manual flow, and this record says
  so rather than implying it passed.
- **What a packaged macOS bundle needs.** `nsh package --target macos` has never
  been run, so bundle layout, the daemon's place inside it, the `Info.plist`, and
  whether the artifact launches at all are unknown. The bundled-daemon argument
  is from source — the lookup probes `current_exe().parent()`, which is where a
  bundle puts the executable — and has never been checked against an artifact.
  The macOS job does not close this: it never packages.
- **macOS Tab focus traversal.** The app moves focus itself on the premise that
  the platform's native traversal visits only text fields. On macOS the
  documentation says Tab visits fields *and* pressable views. Either the premise
  is stale or macOS double-steps; it was never measured, so nothing was decided.

## See also

- `docs/specs/macos_support_spec.md` — the specification that made macOS a
  supported host
- `docs/specs/macos_adaptation_spec.md` — the second specification: what
  *finished adapting* means, now that the app runs
- `docs/upstream/` — the four engine-side requests this repository filed
  against `icyleaf/omarchy-bitwarden`, mirrored here with the details. Three are
  closed: a macOS CI job (#432), a host-aware opener (#434), and SSH peer
  introspection off Linux (#435). Keychain items that survive a re-signed
  binary (#433) is still open.
- [0003](0003-daemon-source-bundling-and-trust.md) — the bundled daemon, whose
  "Linux-only" sentence this supersedes in part
- [0001](0001-logging-diagnostics-boundary.md) — the diagnostics boundary the
  Diagnose rows sit behind
