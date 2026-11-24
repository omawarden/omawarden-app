# 0003: Bundle the daemon, and let the user pick a different one

**Status**: Accepted
**Date**: 2026-11-19
**Deciders**: (this session)

## Context

The app links the `omawarden` crate in-process for its data model and IPC types,
but it must never host the daemon: the daemon is a separate process that outlives
the window and is shared with the CLI and the Omarchy overlay. Hosting it would
let one `stop` take the GUI down and would split a vault session between two
sockets (`ARCHITECTURE.md` §2.1, `GLOSSARY.md` — `In-Process Engine`).

Nothing ships a daemon today. `nsh package` produces the GUI runner, the `nsh/`
bundle, the desktop file and the icon; the daemon comes from a separate package
(`omawarden-bin`, `/usr/bin/omawarden`). AppImage and tar.gz users therefore get
an app that cannot start a vault session until they find and install the CLI
themselves, and the dependency page reports `omawarden` as missing on a fresh
install.

`pylon` (`laser`) faced the same cold start and solved it by compiling its daemon
into the UI process (`laser/docs/adr/0005-managed-daemon-lifecycle-in-ui.md`).
That option is closed here. What remains is to ship the daemon as a **separate
executable inside the app's own release**, which re-opens the external-binary
management pylon's ADR lists as its reason to avoid the split: which binary, at
which version, and who trusts it.

## Decision

**Ship a bundled daemon and make it the default source.** AppImage and tar.gz
carry an `omawarden` daemon executable beside the app binary, built from the same
engine revision the app pins, so the packaged app is self-contained and its
daemon matches the engine linked into the GUI.

**Do not bundle in AUR.** `omawarden-app-git-bin` and the source package declare
`depends=('omawarden-bin')` and drop the bundled copy at install time. The
polkit action belongs to `omawarden-bin`, and a second daemon of a different
version on the same machine is a bug waiting to happen.

**A `Daemon Source` setting chooses the launcher**, stored in app-level
preferences (beside `ui.json`), not in the engine's `config.json`: only the app
needs it, and the CLI does not need a setting that tells it what to start
itself.

**Resolution is a chain**, used only when nothing answers the socket:
`OMA_DAEMON_BIN` → the configured source (`bundled` path, or the selected
`system`/custom path) → development fallback (sibling checkout's
`target/debug`, then `target/release`) → `PATH` → an actionable error. A
configured `system` path that fails to launch is a hard failure with no silent
substitution. A missing bundled binary may fall through to the remaining steps,
and the fallback is recorded in diagnostics.

**A daemon that already answers is kept.** Source selection decides what to
launch when the socket is silent; it never displaces a daemon the app did not
start, and the app never sends `stop` to take the socket. Changing the source
affects the next launch, not the running process, and the settings page says so
instead of offering a stop button.

**External binaries are a trust decision, not a convenience.** The settings list
comes from `which -a omawarden`, deduplicated by real path, each entry showing
its full path and the version and commit parsed from `-V`. A candidate whose
`-V` cannot be parsed is listed but not selectable. A candidate whose
version/commit differs from the app's pinned engine is selectable with an
explicit warning that the binary will receive vault credentials. The daemon
protocol handshake stays the final compatibility gate; a handshake failure is
reported, never papered over by silently launching a different binary. The
bundled binary is checked against the pinned engine revision so a stale or
replaced file in the package directory is visible.

**No daemon controller.** No status badge, PID, start/stop/restart controls, log
drawer or crash supervision. Those belong to a supervised child process, which
is the semantics this app deliberately does not have.

## Consequences

- Built for the bundle's target: the bundled binary is an ELF on Linux and a
  Mach-O executable in a macOS bundle's `Contents/MacOS/`, both beside the app
  binary, which is where the resolution probes first. (ADR 0007 supersedes the
  earlier "Linux-only" wording without changing this decision: other NSH hosts
  without a release channel of their own keep the existing `OMA_DAEMON_BIN` /
  `PATH` resolution.)
- The app's release contract now includes an engine revision, not just an app
  version. Bumping the engine is a deliberate edit that moves the linked crate,
  the bundled daemon and the `-V` comparison together.
- Release artifacts grow by one binary per target, and the AppImage builder must
  install it where the app resolves it: beside the runner.
- The dependency page means "engine available", not "`omawarden` in `PATH`". The
  install hint for `omawarden-bin` appears only when the whole chain is empty.
- The app is now responsible for a judgement it did not make before: launching
  a binary the user pointed at. The warning, the persistence of the chosen path
  and the refusal to fall back are what keep that honest.
- `omawarden --version` becomes part of the UI contract, since the source list
  parses it.

## References

- App: `ARCHITECTURE.md` §2.1 (the daemon is never hosted in-process)
- App: `GLOSSARY.md` — `In-Process Engine`, `Daemon Source`, `Bundled Daemon`,
  `System Daemon`
- App: `docs/adr/0001-logging-diagnostics-boundary.md` (client-only daemon
  relationship)
- App: `src/lib.rs` (`ensure_app_daemon_running`), `src/diagnostics.rs`
  (dependency check)
- Engine: `omawarden/src/daemon/client.rs` (`DaemonLaunchStrategy`, detached
  spawn), `omawarden/src/main.rs` (`-V` format)
- Precedent: `laser/docs/adr/0005-managed-daemon-lifecycle-in-ui.md` and
  `icyleaf/pylon#8` — the in-process answer that this repository cannot take
