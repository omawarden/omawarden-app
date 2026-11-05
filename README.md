> [!WARNING]
> **Early-stage experimental project — under active development.**
>
> `omawarden-app` is not production-ready. Its APIs, storage formats, packaging, and UI may change without notice, and it may contain security bugs. Do not use it as your only password manager or as the sole copy of any credential. Keep independent backups and review the code before trusting it with real secrets.

# omawarden-app

`omawarden-app` is the cross-platform [Native Shell (`nsh`)](https://github.com/longbridge/nsh) frontend for the Omawarden ecosystem. It is a Bitwarden/Vaultwarden desktop client written as a TSX UI backed by a thin Rust native module that links directly against the `omawarden` engine crate.

The primary desktop target is Linux with GTK 4. The same TSX app is structured for the other `nsh` hosts (macOS, Windows, iOS, Android, web, GPUI).

## Role in the Omawarden ecosystem

| Component | Role |
| --- | --- |
| **`omawarden-cli`** | The Rust cryptographic engine, keyring bridge, SSH agent, and Unix-socket daemon. The engine crate lives in the sibling `omarchy-bitwarden` repository. |
| **`omawarden-app`** | This repository: the cross-platform `nsh` frontend. `OmawardenBridge` in `src/lib.rs` exposes the engine to the TSX UI through the `omawarden-app/native` native module. |
| **`omarchy-bitwarden-plugin`** | The thin Quickshell/Omarchy Shell wrapper that launches and integrates the app with the Omarchy desktop. |

`omawarden-app` does **not** shell out to the `omawarden` CLI for authentication or vault operations. The Rust crate is linked and executed in-process, so the app and the engine share one process and one daemon lifecycle.

## Features

- **Vault browsing** for Bitwarden and Vaultwarden: fuzzy search, scopes, folders, and category tabs.
- **Live TOTP codes** with remaining-validity feedback.
- **Password generator** with strict length validation and entropy display.
- **EFF Diceware passphrase generator** with strict word-count validation.
- **SSH keys**: generate, import, preview, save to the vault or export to `~/.ssh`, plus SSH agent signing-approval prompts.
- **Polkit Quick Unlock** for re-unlocking a retained session with system authentication.
- **Wayland clipboard guard** with sensitive-copy handling and automatic clearing after a configurable TTL.
- **WCAG 2.1 contrast-aware themes**: Tokyo Night Dark and Catppuccin Latte Light.

## Architecture

```text
TSX UI (App.tsx, components/, store/)
        │  typed calls
        ▼
OmawardenBridge  #[native_module("omawarden-app/native")]  (src/lib.rs)
        │  100% in-process
        ▼
omawarden Rust crate ── Unix socket ── in-process daemon
```

- The TSX layer never spawns child processes, parses CLI output, or builds daemon JSON envelopes.
- `OmawardenBridge` starts the daemon on a dedicated Rust thread when needed, then runs authentication, status checks, clipboard handling, generators, configuration, and health checks directly through the `omawarden` crate.
- A deterministic in-memory mock mode (`set_mock_mode` / `configure_mock_state`) lets the headless `nsh test` suite exercise every view and modal without touching the real keyring, config, clipboard, or daemon socket.
- See [ARCHITECTURE.md](ARCHITECTURE.md) for the full architectural specification, security invariants, and acceptance criteria.

## Prerequisites

- **Linux** (primary target) with GTK 4 and WebKitGTK 6.0.
- **Rust** `1.98.0` — pinned by [`rust-toolchain.toml`](rust-toolchain.toml).
- **`nsh`** `0.4.0` — the Native Shell CLI.
- **`mise`** — recommended for running the project tasks.
- A sibling checkout of the engine at `../omarchy-bitwarden/omawarden`, because `Cargo.toml` links it by path.
- Runtime tools used by engine features: `secret-tool` (libsecret) for the keyring, `wl-copy` (wl-clipboard) for the Wayland clipboard, and optionally `fido2-token` (libfido2) for security keys.

On Arch Linux:

```sh
sudo pacman -S --needed gtk4 webkitgtk-6.0 libsecret wl-clipboard
sudo pacman -S --needed libfido2   # optional, for FIDO2 security keys
```

## Development commands

The repository ships [`mise.toml`](mise.toml) with the common workflows:

```sh
mise run check      # type-check the Rust crate and TSX UI
mise run test       # cargo tests + headless App.test.tsx suite
mise run run        # run in the native development host
mise run dev        # run with hot reload
mise run build      # build the release bundle (no package)
mise run package    # package a release (Linux by default)
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

### Direct `nsh` and Cargo commands

```sh
nsh check
nsh test
nsh run
nsh dev
nsh build --release
nsh package --target linux
nsh package --target linux --run

cargo check
cargo test
cargo build --release
```

## Packaging output

`mise run package` writes to `.nsh/out` by default:

```text
.nsh/out/omawarden-app/
.nsh/out/omawarden-app/omawardenapp
.nsh/out/omawarden-app/com.icyleaf.omawarden.desktop
.nsh/out/omawarden-app/com.icyleaf.omawarden.png
.nsh/out/omawarden-app.tar.gz
```

Run the packaged binary directly with:

```sh
./.nsh/out/omawarden-app/omawardenapp
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
