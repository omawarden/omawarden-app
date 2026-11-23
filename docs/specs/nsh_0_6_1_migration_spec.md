# NSH 0.6.1 Migration Specification

This document specifies the migration of `omawarden-app` from Native Shell (NSH)
0.5.1 to NSH 0.6.1: the framework version, the app version, the local and CI
toolchain, the version literals in code and tests, the capability the app now
declares, and the repository documentation. It also records every 0.6.0
breaking change that was checked against the codebase and found **not** to
apply, and the capabilities the app deliberately still does not request.

---

## 1. Two versions, not one

| | Before | After | Where |
| --- | --- | --- | --- |
| **NSH Version** | 0.5.1 | **0.6.1** | `nsh` CLI pin, `nsh-core` / `nsh-base` |
| **App Version** | 0.5.0 | **0.6.0** | `Cargo.toml [package] version`, `nsh.json version` |

The two numbers are independent, as defined in `GLOSSARY.md`: the NSH Version
moves when the framework moves, the App Version when the app ships. They are
different here on purpose — the app is `0.6.0` on NSH `0.6.1`.

The app version moves because this upgrade is the notable change in the
release, and the artifact filenames, the rolling `dev` tag's SemVer string and
the AUR `pkgver` all follow it (`release-dev.yml`,
`packaging/generate-aur-pkgbuild.sh`).

### 1.1 Why 0.6.1 and not 0.6.0

0.6.1 is a patch release over 0.6.0: 27 commits, no change to the TSX or
`nsh.json` surface the app uses, and no Rust API change that reaches this
crate. The pin is 0.6.1 because it is the current release of the 0.6 line and
the version `nsh-core = "0.6.1"` resolves to; 0.6.0 would run the same code.

## 2. Objectives & Scope

1. **Framework**: `nsh-core` / `nsh-base` → `0.6.1`; the `nsh` CLI pinned in
   `mise.toml`, installed by both workflows and named by `scripts/check_ci.sh`
   → `0.6.1`; `Cargo.lock` re-resolved.
2. **App version**: `Cargo.toml` and `nsh.json` → `0.6.0`.
3. **Capabilities**: `"application": true` in `nsh.json` (§3.2).
4. **Version literals**: the mock/fixture strings that follow the app version.
5. **Documentation**: this spec, the NSH references in `README.md`,
   `ARCHITECTURE.md`, `GLOSSARY.md`, and the comment in
   `components/MinimumWindowGate.tsx`.
6. **Validation**: `nsh check`, `nsh test`, `cargo fmt --all --check`,
   `scripts/check_privacy.py`, `scripts/check_aur_pkgbuild.sh`.

**Out of scope**, recorded in §5: the tray icon and close-to-tray behaviour
(its own spec and ADR), opening the app at login, `homeDir`, `statusBar`, and
`window.minSize`.

## 3. File-level changes

### 3.1 Rust and manifest

- `Cargo.toml`:
  - `version = "0.6.0"`.
  - `nsh-core = "0.6.1"`, `nsh-base = "0.6.1"`.
  - The comment on `nsh-base` stays: it is declared but named nowhere in the
    crate's source, and stays pinned so the app builds against the same base the
    host resolves.
- `Cargo.lock`: re-resolved. Beyond the `nsh-*` crates moving to 0.6.1, the
  graph **shrinks**. 0.6.0 made NSH's updater, WebSocket, SVG and HTTP pieces
  optional features, and this app asks for none of them, so the lock loses the
  updater's and the WebSocket client's dependency trees — `nsh-updater`,
  `tar`, `zip`, `zopfli`, `tokio-tungstenite`, `tungstenite`,
  `rustls-platform-verifier` (and its Android half), `webpki-roots`,
  `webpki-root-certs` — together with the crates only they pulled in
  (`simd_cesu8`, `typed-path`, `nix`, `filetime`, `data-encoding`,
  `constant_time_eq`, `combine`) and the Android `jni` family. No package is
  added.

The app's own update check is not NSH's updater: it reads the release feed
itself, so losing `nsh-updater` changes nothing.

### 3.2 `nsh.json` and the capabilities gate

```json
"capabilities": {
  "application": true,
  "host": true,
  "network": { "hosts": ["*"] }
}
```

0.6.0 closed a sandbox escape in embedded apps (NSH PR #1499): an app that
declares `capabilities` no longer reaches application-level desktop primitives
— the main window's commands, the application menu, the tray, global
shortcuts, quit/restart, launch at login — unless `application` is granted.
`omawarden-app` declares capabilities, so without the grant every later call to
hide a window, set a tray icon, or quit would be dropped or rejected.

The grant is inert in this change: nothing in the tree sets a tray, calls a
window command or quits the app yet. It is declared here rather than with the
tray work because the tray work lands on this branch and is what calls it, and
a sandbox decision recorded in two specs is how the two drift apart.

`host` and `network.hosts` are unchanged. `nsh.json` still declares no
`window` block: the app's window behaviour is the default until the tray work
adds one.

### 3.3 Version literals in code and tests

The running app version is `env!("CARGO_PKG_VERSION")`, so bumping
`Cargo.toml` changes the app version **at runtime**, and fixtures that hardcode
the old value go stale or fail:

- `src/diagnostics.rs` — `mock_updates()`: the mock release's `version`,
  `title`, and `url` literals.
- `src/lib.rs` — `mock_ssh_prompt_and_update`: the `latest_version` assertion
  that reads that mock.
- `App.test.tsx` — the `appVersion` fixtures and the assertions
  `App Version: …`, `Latest: …`, `Omawarden …`, `v…`, and `Engine …`. The
  `Engine` expectation comes from the mock settings' `engine_version`, which is
  `env!("CARGO_PKG_VERSION")` in mock mode.

### 3.4 Local toolchain and CI

- `mise.toml`: `"github:longbridge/nsh" = "0.6.1"`, and the GPUI task's comment
  now says 0.6.1.
- `.github/workflows/ci.yml`: the install step downloads `install.sh` for
  `v0.6.1` with `NSH_VERSION=v0.6.1`.
- `.github/workflows/release-dev.yml`: the same for both matrix legs. The single
  step for x86_64 and aarch64 stays: 0.6.1 publishes both archives.
- `rust-toolchain.toml` is unchanged: the pin is 1.99.1.

### 3.5 Scripts, packaging, and docs

- `scripts/check_ci.sh`: the "Install NSH …" message names 0.6.1.
- `packaging/build-appimage.sh`: the usage example's filename becomes
  `omawarden-app-0.6.0-dev-x86_64-unknown-linux-gnu.AppImage` — version examples
  are current-state, so they move with the app version.
- `README.md`: the `nsh` prerequisite and the GPUI note.
- `ARCHITECTURE.md`: the `nsh` version in §1 and in the toolchain paths.
- `GLOSSARY.md`: `Minimum Window Gate` now says 0.6.1 offers `window.minSize`;
  `NSH Version`'s example becomes "NSH `0.5.1` carried `omawarden-app` `0.5.0`,
  and NSH `0.6.1` carries `0.6.0`", so the two versions stay visibly
  independent; `App Version` no longer claims the two "were only briefly the
  same number", which stopped being true.
- `components/MinimumWindowGate.tsx`: the comment's version reference.
- Historical documents are left alone: `docs/PERFORMANCE.md`'s measured rows,
  `docs/adr/0002-…`'s "to NSH 0.5.1 adds one", and the older `docs/specs/*`
  files are records of what was true when they were written, not statements
  about the current tree.

## 4. Verified unaffected

0.6.0's breaking changes were checked one by one against the tree. These do not
apply, and no code change was needed:

| 0.6.0 change | Why it does not apply |
| --- | --- |
| Capabilities: `application` and `homeDir` grants | `application` is now granted (§3.2). `homeDir` is not needed: the TSX side never imports `os`, `fs`, `process` or `nsh/storage`; paths are read in Rust. |
| Input `maxLength` counts characters | The app sets no `maxLength` on any input. |
| WebView downloads use event handles; Linux needs WebKitGTK 2.42 | The app shows no web view. |
| iOS `Clipboard.readText()` rejects when the paste is refused | Clipboard access is Rust-side (Wayland), and the app targets Linux desktop. |
| `AlertDialogOptions::show` returns a named type | The app shows no NSH alert dialog; its dialogs are its own views. |
| `ContextMenu` listeners take `ContextMenuEvents` | No `ContextMenu` in the tree. |
| `Transition` is `#[non_exhaustive]` and gains `spring` | The one animation (`components/FooterBar.tsx`) is a motion, not a `Transition`; no Rust `Transition` either. |
| `ModalConfig` / `ModalProp` are no longer `Copy` | Platform-facing types; the app never names them. |
| `RichEditorEvent` gains `CompositionChange` | No rich editor. |
| DataTable `selectOnModifierPress={false}` also leaves cell and title selection alone | No `DataTable`; lists are the app's own rows. |
| Dev server answers 403 to hosts reaching it by a rebound name | Only affects `nsh run`/`nsh dev` accessed through another hostname; local development connects to the printed address. |
| GPUI embedding needs GPUI Fast 0.1.14+ / GPUI Kit 0.9.1+ | The app is not embedded in a GPUI host. |
| Platform-facing additions (`Command::Share`, `clipboard_images`, `TextBackground` padding, macOS `handoff`) | None are used. |
| Rust API surface (`nsh_core::prelude::*` only) | The crate imports the prelude and nothing else: `Registry`, `#[native_module]`, `#[module]`, `JsObject`, `PropEnum`, `#[prop]`. |

`nsh check` and `nsh test` behave as before. `nsh test` reports **287 tests:
287 passed** on 0.6.1.

### 4.1 The status bar warning is still there, and still not ours

`nsh test` prints, before most tests:

```
warn the status bar is not granted: add `"statusBar": true` to capabilities in nsh.json
```

Every app's bootstrap pushes its `nsh.json` `statusBar` default to the engine,
and the engine denies it when `capabilities.statusBar` is false. The app never
touches the status bar, and 0.4.0's `nsh-js` pushed the same command from the
same place, so the line predates the 0.5 upgrade. Granting
`"statusBar": true` would silence it by handing the app an API it never calls —
unlike `application`, which the tray work on this branch does call. It is not a
`nsh check` diagnostic: `nsh check` reports none.

## 5. Deliberately not adopted

### 5.1 `homeDir`

Not granted. The TSX side never reads the home directory; the Rust side uses
the engine's own configuration paths. Granting it would widen the sandbox for
nothing.

### 5.2 `statusBar`

See §4.1.

### 5.3 Opening the app at login

0.6.0 added `Application.setLaunchAtLogin` / `launchAtLogin()`. A tray app is
the natural place to use it, and the tray work will need it eventually, but it
is not part of a framework upgrade: it needs a settings row, persistence,
documentation and tests. It is deferred to its own change.

When it does land, the UI must say that the switch cannot govern Hyprland:
Hyprland does not read XDG autostart, so an app's startup entry there is
configuration (`exec-once` in `hyprland.conf`, which Omarchy manages as
configuration), not something `setLaunchAtLogin` can turn on or off. Without
that note the switch is a control that silently does nothing on the primary
target.

### 5.4 `window.minSize`

See ADR 0002. The app keeps its own minimum-window gate.

## 6. Validation

Run from the repository root, with `nsh` 0.6.1 on `PATH`:

```sh
nsh check                        # no diagnostics
nsh test                         # cargo tests + headless App.test.tsx, all pass
cargo fmt --all --check
python3 scripts/check_privacy.py
bash scripts/check_aur_pkgbuild.sh
./scripts/check_ci.sh            # the same checks as CI, in CI's order
```

The CI itself (`.github/workflows/ci.yml`) installs `nsh` 0.6.1 and runs the
same sequence, so a green `check_ci.sh` means the push should pass.
