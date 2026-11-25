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
  to Cargo — the CI shape.
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

- **The engine's macOS code is compiled and tested by CI.** The engine's
  workflow gained a blocking `backend-macos` job on `macos-latest` that runs
  clippy and the whole test suite after provisioning an ephemeral unlocked
  Keychain. It has run green on the engine's `develop` at the revision this
  repository pins (`57f8679`: 394 tests plus every integration suite), so the
  `#[cfg(target_os = "macos")]` blocks — including the Security.framework FFI
  this work depends on — are exercised on a real target rather than argued
  about. Filed as
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

- **This repository has no macOS job of its own.** The engine's job covers the
  engine; nothing in this repository's CI compiles its Rust or runs its `nsh`
  suite on macOS. Every macOS result below was obtained by hand on one machine.
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

## See also

- `docs/specs/macos_support_spec.md` — the specification this ADR records
- `docs/upstream/` — the four engine-side requests this repository filed
  against `icyleaf/omarchy-bitwarden`, mirrored here with the details. Three are
  closed: a macOS CI job (#432), a host-aware opener (#434), and SSH peer
  introspection off Linux (#435). Keychain items that survive a re-signed
  binary (#433) is still open.
- [0003](0003-daemon-source-bundling-and-trust.md) — the bundled daemon, whose
  "Linux-only" sentence this supersedes in part
- [0001](0001-logging-diagnostics-boundary.md) — the diagnostics boundary the
  Diagnose rows sit behind
