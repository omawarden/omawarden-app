> [!WARNING]
> **Early-stage experimental project — under active development.**
>
> `omawarden-app` is not production-ready. Its APIs, storage formats, packaging, and UI may change without notice, and it may contain security bugs. Do not use it as your only password manager or as the sole copy of any credential. Keep independent backups and review the code before trusting it with real secrets.

# omawarden-app

`omawarden-app` is the cross-platform [Native Shell (`nsh`)](https://github.com/longbridge/nsh) frontend for the Omawarden ecosystem. It is a Bitwarden/Vaultwarden desktop client written as a TSX UI backed by a thin Rust native module that links directly against the `omawarden` engine crate.

Linux (GTK 4) and macOS (AppKit) are supported hosts. The same TSX app is structured for the other `nsh` hosts (Windows, iOS, Android, web, GPUI).

## Role in the Omawarden ecosystem

| Component | Role |
| --- | --- |
| **`omawarden-cli`** | The Rust cryptographic engine, keyring bridge, SSH agent, and Unix-socket daemon. The engine crate lives in the sibling `omarchy-bitwarden` repository. |
| **`omawarden-app`** | This repository: the cross-platform `nsh` frontend. `OmawardenBridge` in `src/lib.rs` exposes the engine to the TSX UI through the `omawarden-app/native` native module. |
| **`omarchy-bitwarden-plugin`** | The thin Quickshell/Omarchy Shell wrapper that launches and integrates the app with the Omarchy desktop. |

`omawarden-app` does **not** shell out to the `omawarden` CLI for authentication or vault operations. The Rust crate is linked and executed in-process, while the daemon runs as a separate `omawarden` process that the app and the Omarchy Overlay share.

## Features

- **Vault browsing** for Bitwarden and Vaultwarden: a collapsible navigation sidebar beside the category tabs, fuzzy search, vaults, folders, and per-category tabs.
- **Live TOTP codes** with remaining-validity feedback.
- **Password generator** with strict length validation and entropy display.
- **EFF Diceware passphrase generator** with strict word-count validation.
- **SSH keys**: generate, import, preview, save to the vault or export to `~/.ssh`, plus SSH agent signing-approval prompts.
- **Polkit Quick Unlock** for re-unlocking a retained session with system authentication (Linux; macOS reports it as unavailable, so the action is hidden).
- **Clipboard guard** with sensitive-copy handling and automatic clearing after a configurable TTL, through the platform's clipboard provider.
- **WCAG 2.1 contrast-aware themes**: Tokyo Night Dark and Catppuccin Latte Light.

## Architecture

```text
TSX UI (App.tsx, components/, store/)
        │  typed calls
        ▼
OmawardenBridge  #[native_module("omawarden-app/native")]  (src/lib.rs)
        │  100% in-process
        ▼
omawarden Rust crate ── Unix socket ── omawarden daemon (separate process)
```

- The TSX layer never spawns child processes, parses CLI output, or builds daemon JSON envelopes.
- `OmawardenBridge` runs authentication, status checks, clipboard handling, generators, configuration, and health checks directly through the `omawarden` crate. Daemon startup is delegated to the engine (`omawarden::daemon::ensure_daemon_running()`), which launches the standalone `omawarden` binary so the vault session is not tied to the window.
- A deterministic in-memory mock mode (`set_mock_mode` / `configure_mock_state`) lets the headless `nsh test` suite exercise every view and modal without touching the real keyring, config, clipboard, or daemon socket.
- See [ARCHITECTURE.md](ARCHITECTURE.md) for the full architectural specification, security invariants, and acceptance criteria.

## Prerequisites

- **Rust** `1.99.1` — pinned by [`rust-toolchain.toml`](rust-toolchain.toml).
- **`nsh`** `0.6.1` — the Native Shell CLI.
- **`mise`** — recommended for running the project tasks.
- A sibling checkout of the engine at `../omarchy-bitwarden/omawarden` is used when present: `Cargo.toml` pins the engine by revision and `.cargo/config.toml` patches it to that checkout. Without the checkout, Cargo fetches the pinned revision.

On **Linux**, the native UI needs GTK 4 and WebKitGTK 6.0, and the engine's
features use `secret-tool` (libsecret) for the keyring and `wl-copy`
(wl-clipboard) for the Wayland clipboard, with `fido2-token` (libfido2)
optional for security keys.

On **macOS**, the same frameworks ship with the system: the build needs only
the Xcode command line tools (`xcode-select --install`), and the Keychain and
the pasteboard need no extra package. The bundle runs on **macOS 14** or later,
the floor `nsh.json` declares.

On Arch Linux:

```sh
sudo pacman -S --needed gtk4 webkitgtk-6.0 libsecret wl-clipboard
sudo pacman -S --needed libfido2   # optional, for FIDO2 security keys
```

### Daemon Source

The app launches a separate `omawarden` daemon and never hosts it. Settings →
Engine chooses which executable it starts when no daemon is answering:

- **Bundled** (default in the AppImage and the release tarball): the
  `omawarden` binary shipped beside `Omawarden`, built from the same engine
  revision the app pins. No separate daemon package is needed.
- **System**: a binary from `which -a omawarden`, typically
  `/usr/bin/omawarden` installed by `omawarden-bin`.
- **Custom**: an absolute path chosen in the file dialog.

`OMA_DAEMON_BIN` overrides the setting for one launch. A development build with
no bundled binary falls back to `../omarchy-bitwarden/omawarden/target/debug`,
then `target/release`, then `PATH`. A daemon that already answers is kept,
whichever source it came from; the setting only decides what to start when the
socket is silent, and it takes effect on the next launch.

| Channel | Daemon |
| --- | --- |
| AppImage | bundled, self-contained |
| release tarball | bundled beside `Omawarden` |
| AUR `omawarden-app-git-bin` | `depends=('omawarden-bin')`; the bundled copy in the shared tarball is not installed |

## Development commands

The repository ships [`mise.toml`](mise.toml) with the common workflows:

```sh
mise run check      # type-check the Rust crate and TSX UI
mise run test       # cargo tests + headless App.test.tsx suite
mise run run        # run in the native development host
mise run dev        # run with hot reload
mise run gpui       # preview in the GPUI development host (not packaged)
mise run build      # build the release bundle (no package)
mise run package    # package a release (TARGET defaults to linux)
mise run release    # check, test, then package
```

Extra arguments are forwarded, for example:

```sh
mise run run -- --window-size 1440x960
mise run package -- --icon /path/to/icon.png
OUT=dist mise run package
```

The app icon is declared in `nsh.json` (`"icon": "assets/icon.png"`), so packaging uses
`assets/icon.png` by default; `--icon` overrides it for a one-off package.

### Before pushing

[`scripts/check_ci.sh`](scripts/check_ci.sh) runs every check from
[`.github/workflows/ci.yml`](.github/workflows/ci.yml) locally, in the same order:
version consistency, the engine pin, the privacy check, the AUR PKGBUILD check,
`cargo fmt --all --check`, `nsh check`, then `nsh test`.

```sh
./scripts/check_ci.sh
```

It uses the `[patch]` in `.cargo/config.toml`, so it builds against the sibling
`omawarden` checkout rather than the git dependency CI resolves. A green run
means the push should pass CI.

The engine pin runs on every push, not just before a release. Enable the hook
once per clone:

```sh
mise run hooks        # or ./scripts/install_hooks.sh
```

It points `core.hooksPath` at [`.githooks/`](.githooks), whose `pre-push` runs
`scripts/check_engine_pin.sh` in strict mode. That check exists because local
builds patch the engine to the sibling checkout while CI fetches the pinned
revision, so a push is the moment the two can silently disagree. Locally the
check is looser on purpose: the sibling only has to *contain* the pin, because
working on an engine branch ahead of it is normal and the release still ships
the pin. A push and CI require exact equality.

### Raising the engine pin

```sh
mise run bump-engine <ref>        # revision, branch or tag in the sibling checkout
mise run bump-engine <ref> --no-sibling
```

The task resolves the ref to a full revision before writing, updates `Cargo.toml`,
and moves the sibling checkout unless it has uncommitted work. It deliberately
does not write the comment above the pin — it cannot know why a revision is
worth pinning — so it prints the block to edit and the rest is a human step.

### GPUI preview

NSH 0.6.1 packages Linux with GTK 4 only. GPUI is a development and embedding
backend (`nsh run --target gpui`), not a package target: `nsh package` has no
GPUI runner, so `mise run gpui` opens the app as GPUI apps that embed it draw
it but does not produce a release artifact. NSH ships only the host platform's
runtime, so it fetches the GPUI component on first use — add it ahead of time
with `nsh component add gpui`. A GPUI preview needs Vulkan, GTK 3,
WebKitGTK 4.1 and GStreamer, besides the GTK 4 packages above.

### Direct `nsh` and Cargo commands

```sh
nsh check
nsh test
nsh run
nsh dev
nsh run --target gpui
nsh build --release
nsh package --target linux
nsh package --target linux --run
nsh package --target macos     # on a Mac
nsh package --target macos --run

cargo check
cargo test
cargo build --release
```

## Packaging output

`mise run package` writes to `.nsh/out` by default. The packaged targets are
Linux (GTK 4) and macOS (AppKit); `TARGET=macos` selects the second.

```text
.nsh/out/Omawarden/
.nsh/out/Omawarden/Omawarden
.nsh/out/Omawarden/com.icyleaf.omawarden.desktop
.nsh/out/Omawarden/com.icyleaf.omawarden.png
.nsh/out/Omawarden.tar.gz
```

On a Mac the same command with `TARGET=macos` writes an ad hoc signed
`.nsh/out/Omawarden.app`, with the executable in `Contents/MacOS/` and the
bundled daemon beside it.

Run the packaged binary directly with:

```sh
./.nsh/out/Omawarden/Omawarden
open .nsh/out/Omawarden.app        # macOS
```

## Repository layout

```text
App.tsx              app entry and view routing
assets/icon.png      packaged app icon (1024×1024 PNG)
components/          TSX views, modals, and controls
store/appStore.ts    signals, actions, and bridge calls
theme/               Tokyo Night / Catppuccin palettes
src/lib.rs           OmawardenBridge native module and engine calls
App.test.tsx         deterministic headless UI tests
ARCHITECTURE.md      architecture, security, and acceptance criteria
Cargo.toml           Rust crate and build profiles
nsh.json             app metadata for nsh
mise.toml            development and packaging tasks
```
