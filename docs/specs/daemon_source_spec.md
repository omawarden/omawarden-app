# Omawarden App: Daemon Source Specification

> **Target Repository**: `omawarden/omawarden-app`
> **Status**: Ready for Implementation
> **Primary Goal**: Ship a daemon with the app, and let the user point at a
> different one without ever taking over a running daemon.

---

## Problem Statement

`nsh package` produces the GUI runner, the `nsh/` bundle, the desktop file and
the icon. It does not produce a daemon, and nothing else in the release does.
The daemon arrives from a separate package (`omawarden-bin`,
`/usr/bin/omawarden`). An AppImage or tar.gz user therefore gets an app whose
first action — start a vault session — fails, and the dependency page reports
`omawarden` as missing on a clean machine.

The app already links the `omawarden` crate for its data model and IPC types,
but hosting the daemon is forbidden: it must outlive the window and be shared
with the CLI and the overlay, and one `stop` would take the GUI down with it
(`ARCHITECTURE.md` §2.1). The only available answer is to ship the daemon as a
separate executable and launch it through the engine's existing strategy
mechanism.

See `docs/adr/0003-daemon-source-bundling-and-trust.md` for the decision and the
rejected alternatives.

## Solution

AppImage and tar.gz carry an `omawarden` daemon beside the app binary, built
from the engine revision the app pins. A `Daemon Source` setting in app-level
preferences chooses what to launch when no daemon answers: `bundled` (default),
a `system` binary picked from `which -a omawarden`, or a `custom` path. The
engine's `DaemonLaunchStrategy::Explicit` is the only launch mechanism; a
daemon that already answers is never displaced.

## Implementation Decisions

### 1. Pin the engine by revision, in `Cargo.toml`

```toml
# engine 0.12.0-dev
omawarden = { git = "https://github.com/icyleaf/omarchy-bitwarden.git", rev = "<40-hex>" }
```

The engine publishes no tag for the current development line — the newest tag
is `omawarden-0.4.0` while `omawarden/Cargo.toml` says `0.12.0-dev` — so a tag
pin is not available, and the dev channel's rolling `omawarden-dev` tag and
unchanging `omawarden-0.12.0-dev-<target>.tar.gz` asset name cannot identify a
commit.

`Cargo.lock` must not be used as the pin. The committed entry for `omawarden`
has no `source` line because it was written with the local `[patch]`, and CI
strips that patch before building; local patched builds would rewrite the entry
back to a path form. Reproducibility comes from the immutable `rev`, so no
`--locked` wiring is added.

`build.rs` reads `Cargo.toml` from `CARGO_MANIFEST_DIR`, extracts the `rev`, and
emits `cargo:rustc-env=ENGINE_REV=<sha>`. It panics when the pin is missing, so
the invariant cannot be lost silently. `ENGINE_REV` is the only thing the app
compares candidate commits against — the app version (0.5.x) and the engine
version (0.12.0-dev) do not share a numbering scheme.

### 2. Persist the choice in its own app-level file

A new module `src/daemon_source.rs`, peer of `ui_prefs.rs`, writes
`daemon.json` beside the engine's `config.json`
(`config_manager().config_path.with_file_name("daemon.json")`), atomically with
mode `0600`:

```json
{ "mode": "bundled", "path": null }
```

`mode` is `bundled` | `system` | `custom`; `path` is required for the last two
and ignored for `bundled`. The file is `#[serde(default)]` so a partial file
still loads and unknown keys are ignored, as `ui.json` does.

`ui.json` stays presentation-only. This setting decides which executable
receives vault credentials, so it gets its own file, its own seam
(`DaemonSourceEngine` with `InProcess` / `Mock`) and its own tests.

`MockState` gains `daemon_source: DaemonSource` and
`daemon_candidates: Vec<DaemonCandidateView>` so headless tests can script the
source list without touching the filesystem or `PATH`.

### 3. Resolution chain

A pure function in `daemon_source.rs`, testable without a process:

```rust
fn resolve(
    source: &DaemonSource,
    app_dir: &Path,            // current_exe().parent()
    env_bin: Option<&Path>,    // OMA_DAEMON_BIN, blank treated as unset
    dev_root: Option<&Path>,   // sibling checkout, honoured only for `bundled`
    which: impl Fn(&str) -> Option<PathBuf>,
) -> Result<Resolution, ResolveError>
```

Order, matching ADR 0003:

1. `OMA_DAEMON_BIN`, when set. Set but not a file is a hard error, as the
   engine already behaves.
2. The configured source. `system` / `custom` must be a file; when the path is
   gone the resolution fails with `ConfiguredMissing(path)` and nothing else is
   tried.
3. Development fallback, `bundled` only: `<dev_root>/omawarden/target/debug`,
   then `target/release`. A hit is recorded in `Resolution::note` so
   diagnostics can say the release artifact was not what ran.
4. `PATH`, again `bundled` only, with the same note.
5. `ResolveError::NotFound`, naming every probed path and the two ways out:
   install `omawarden-bin`, or pick a source in Settings.

Boot wiring in `src/lib.rs::ensure_app_daemon_running`:
`ensure_daemon_running_with_strategy(&DaemonLaunchStrategy::Explicit(path))`.

`set_daemon_launch_strategy` is called too, but **only when `OMA_DAEMON_BIN` is
unset**: `daemon_launch_strategy()` reads the process-global value before the
environment variable, so setting it unconditionally would silently beat the
variable the operator set.

A daemon that already answers still wins. `DaemonClient::ensure_running` pings
first and only resolves a binary when the socket is silent, so `Explicit` never
displaces the overlay's or the CLI's daemon, and the app still never sends
`stop`.

### 4. Listing and validating candidates

`list_daemon_candidates()` builds, every time the Engine tab opens (no watcher):

- the `bundled` entry first, present or absent, with its parsed `-V`;
- `which::which_all("omawarden")`, deduplicated by `canonicalize()`;
- the configured `custom` path when it is not already in the list.

Each entry carries `path`, `kind` (`bundled` | `path` | `custom`), `version`,
`commit`, `matchesPinned`, `selectable`.

`-V` is `omawarden <version> (<commit> <date>)` (`omawarden/src/main.rs:205`),
parsed with a `regex` (already a dependency). A candidate whose `-V` cannot be
parsed is listed but not selectable. `matchesPinned` compares against
`ENGINE_REV` by prefix in either direction, minimum seven characters, because
`git rev-parse --short` may abbreviate longer than seven.

`-V` is run with stdin null and a bounded wait: `spawn()`, poll `try_wait()`
every 10 ms for 1000 ms, `kill()` and mark unparseable on timeout. A candidate
on `PATH` is not trusted to be well behaved, and the settings dialog must not
hang on it.

The bundled entry is validated against `ENGINE_REV` too. It should always
match; a mismatch means a stale or replaced file in the package directory, and
it is shown as a warning and logged once at boot rather than refused.

### 5. Bridge surface

In `src/lib.rs` (`OmawardenBridge`), following the `ui_prefs` naming:

```rust
pub fn get_daemon_source() -> DaemonSourceView
pub fn set_daemon_source(input: DaemonSourceUpdateInput) -> DaemonSourceView
pub fn list_daemon_candidates() -> Vec<DaemonCandidateView>
pub fn pick_daemon_binary() -> Option<String>
```

`DaemonSourceView` carries `mode`, `configuredPath`, `resolvedPath`,
`resolvedVersion`, `resolvedCommit`, `note`, and `problem` (the resolution error,
when there is one). `set_daemon_source` rejects a `system` / `custom` path that
is not a file with the resolver's own message, and never starts or stops
anything.

`pick_daemon_binary` uses `platform::pick_file` with no extension filter.

The running daemon's version and commit come from the existing `ping`, not from
the source, so Settings can show "Running" and "Next launch" as separate lines.

### 6. Diagnostics means "engine available"

`src/diagnostics.rs::real_dependencies` replaces the `package_status("omawarden", …)`
row with one derived from the resolution: installed when the chain resolves,
version from that binary's `-V`, description naming the source. The install
button therefore appears only when the whole chain is empty, and the
`omawarden-bin` hint is the action offered then.

`DependencyStatusView` gains a `daemonSource` field (additive for TS) so the
page can show `Daemon Source: Bundled → <path> (<version> <commit>)` and any
fallback note.

The mock dependency check reports the same shape from `MockState`.

### 7. Settings UI

`components/SettingsModal.tsx` gains a sixth tab, `engine`, between `security`
and `diagnose` (`SettingsTab` union and `TAB_ENTRIES`).

```
Engine
Which daemon this app starts when none is running.

( ) Bundled             /usr/bin/… 0.12.0-dev 29584b9
( ) /usr/bin/omawarden  0.12.0-dev 29584b9     [matches engine]
( ) /usr/local/bin/omawarden  0.11.0 8d88483   [different build]
( ) Custom…             [Other…]

Running daemon: 0.12.0-dev (29584b9)
Changes apply the next time no daemon is running.
```

Selecting applies immediately, like the theme, with no `SaveRow`. Test ids:
`daemon-source-bundled`, `daemon-source-candidate-<n>`, `daemon-source-custom`,
`daemon-source-pick`, `daemon-source-running`, `daemon-source-warning`.

An external selection that does not match `ENGINE_REV` shows the warning before
it is stored: "This binary will receive your vault credentials. The app does not
supervise or stop it." The bundled entry is disabled, with an explanation, when
the file is absent.

### 8. Store

`store/appStore.ts` gains `daemonSource` and `daemonCandidates` signals,
`loadDaemonSource()`, `refreshDaemonCandidates()`, `selectDaemonSource(mode,
path?)` and `pickDaemonBinary()`. `loadDaemonSource()` joins the boot path next
to `loadSettings()` (~line 837). A rejected selection notifies and leaves the
previous state untouched.

`components/DependencyCheckView.tsx` shows the resolved source line under the
`omawarden` row.

### 9. Packaging and release

`packaging/build-appimage.sh`: when `$PKG_DIR/omawarden` is executable, install
it to `$APPDIR/usr/bin/omawarden`. `AppRun` already prepends `$APPDIR/usr/bin`
to `PATH`, and the app resolves the file as a sibling of the runner anyway.

`.github/workflows/release-dev.yml`, a new step between "Package native Linux
app" and "Bundle release tarball":

1. read `rev` from `Cargo.toml`;
2. `git clone --filter=blob:none …/omarchy-bitwarden.git engine` and
   `git -C engine checkout <rev>`;
3. `cargo build --release --bin omawarden --manifest-path engine/omawarden/Cargo.toml`;
4. `install -m755` the binary to `$PKG_DIR/omawarden`;
5. fail the job unless `"$PKG_DIR/omawarden" -V` contains the short rev.

Both jobs build natively — `ubuntu-24.04` for x86_64 and `ubuntu-24.04-arm` for
aarch64 — so the engine needs no `cross` toolchain here. `Swatinem/rust-cache`
gets both workspaces in its `workspaces` input. The existing copy step then
moves the binary into `dist/<PKG_NAME>/`, so the tar.gz carries it beside
`Omawarden`.

`packaging/generate-aur-pkgbuild.sh` adds `depends=('omawarden-bin')`.
`package()` already installs explicit paths only, so the bundled file in the
shared tarball is not installed; a comment records that this is deliberate
(polkit ownership, and one daemon version per machine).

`scripts/check_aur_pkgbuild.sh` asserts the new dependency and that no
`/usr/lib/omawarden-app/omawarden` install line appears.
`scripts/check_ci.sh` gains "Check the engine pin": the dependency line names a
40-hex `rev`, not a branch or tag.

### 10. Documentation

- `README.md`: prerequisites per channel (AppImage / tar.gz self-contained; AUR
  pulls `omawarden-bin`), the `Daemon Source` paragraph, and the development
  fallback (`OMA_DAEMON_BIN`, then the sibling checkout's `target/`).
- `GLOSSARY.md`: the `Daemon Source` entry mentions `custom` explicitly.
- `ARCHITECTURE.md` §2.1: one sentence that the app may launch a daemon it
  ships or one the user points at, and never supervises or stops it.

## Testing Decisions

Rust unit tests, in `daemon_source.rs` unless noted:

- the resolution matrix: env wins; bundled present; bundled missing → debug →
  release → `PATH` → error; `system` path missing is a hard error with no
  fallback; `custom` likewise; blank `OMA_DAEMON_BIN` is unset.
- `-V` parsing: full line, missing commit, garbage, trailing whitespace.
- `daemon.json`: round trip, `0600`, malformed file returns the default,
  unknown keys ignored.
- `set_daemon_source` rejects a missing file and leaves the stored value alone.
- candidate de-duplication by canonical path; `matchesPinned` prefix logic.
- `build.rs` pin extraction, exercised indirectly by the compile-time constant.
- the existing test that a running daemon is kept (`src/lib.rs`, ~1907) stays
  untouched: it is the proof that `Explicit` is consulted only on a silent
  socket.

`App.test.tsx`:

- the Engine tab lists bundled plus the mock candidates, and marks the one with
  a different commit;
- an unparseable candidate renders disabled;
- selecting a candidate stores it through `setDaemonSource` and toasts;
- the dependency page shows the source line and hides the install button when a
  source resolves.

Release smoke: `build-appimage.sh` against a fake package directory with and
without `omawarden`, asserting `AppDir/usr/bin/omawarden` appears only in the
first case; then `scripts/check_ci.sh`.

## Out of Scope

- A daemon controller: status badge, PID, start/stop/restart, log drawer,
  crash detection. Those need a supervised child process, which this app
  deliberately does not have.
- Automating engine pin bumps or adding a dependabot entry for the git
  dependency.
- macOS, Windows, web and mobile packaging.
- Downloading a prebuilt engine artifact instead of building from the pinned
  revision.
- Any change to the engine's protocol or to how `stop` behaves.

## Further Notes

- The ordering trap in `daemon_launch_strategy()` (process-global before
  environment) is the easiest thing to get wrong here; the boot code must set
  the global only when `OMA_DAEMON_BIN` is unset.
- Version strings are not comparable across the two repositories. Only the
  pinned revision is.
- `omawarden --version` is now part of the UI contract, because the source list
  parses it. Changing that format in the engine breaks the list, so the parser
  treats an unparseable line as "listed but not selectable" rather than
  guessing.
- On AppImage, `current_exe()` is `$APPDIR/usr/bin/Omawarden`, so the sibling
  lookup finds the bundled daemon even though the AppRun `PATH` would also find
  it. Explicit beats `PATH` order, which keeps the bundle in charge of its own
  daemon.
