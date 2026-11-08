# Omawarden App (`omawarden-app`) — Architecture & Implementation Specification

## 1. Overview & Repository Role

`omawarden-app` (`~/Development/linux/omawarden-app`, GitHub: `https://github.com/omawarden/omawarden-app`) is the standalone cross-platform Native Shell (`nsh` `0.4.0`) frontend for the `@omawarden` ecosystem:

1. **`omawarden-cli`** (currently located at `~/Development/linux/omarchy-bitwarden/omawarden`): The Rust cryptographic engine, keyring bridge, SSH agent, and Unix socket daemon.
2. **`omawarden-app`** (`~/Development/linux/omawarden-app`): This repository — a 100% **TSX + Tailwind + `nsh/base`** UI backed by a thin Rust native module (`#[native_module("omawarden-app/native")]`) that links directly against the `omawarden` crate (`path = "../omarchy-bitwarden/omawarden"`).
3. **`omarchy-bitwarden-plugin`**: Thin Quickshell/Omarchy Shell wrapper (to be slimmed down in a later phase; **DO NOT modify `~/Development/linux/omarchy-bitwarden` in this phase**).

### Toolchain Paths
- `nsh` binary: `~/.local/share/mise/installs/github-longbridge-nsh/latest/bin/nsh` (version `0.4.0`, installed via `mise`).
- Primary desktop target: Linux GTK 4 (`--target linux`). GPUI is a development and embedding backend (`nsh run --target gpui`), not a package target; the web build uses `--target web`.
- Reference implementation for 1:1 behavioral parity: `~/Development/linux/omarchy-bitwarden/OmarchyBitwarden.qml` and `~/Development/linux/omarchy-bitwarden/components/*.qml`.

---

## 2. Architectural Seam: `omawarden-app/native` (`OmawardenBridge`)

Following deep-module design principles ("Design It Twice" Hybrid Design 3 + Design 2):
- **Callers (TSX UI & Store)** never spawn child processes (`process.spawn`), never parse raw CLI stdout/stderr, never construct Unix socket JSON envelopes, and never perform fuzzy scoring or card/URI string parsing in JS.
- **Rust Native Module (`src/lib.rs`)** exposes `#[native_module("omawarden-app/native")]` with `#[module] pub struct OmawardenBridge` and strongly-typed `#[derive(Clone, Debug, JsObject)]` DTOs and `#[derive(Clone, Copy, Debug, PartialEq, Eq, PropEnum)]` enums.
- **IMPORTANT `nsh` Rule**: Every `pub` struct, enum, variant, field, module, and method in `#[native_module]` **MUST have a `///` doc comment**, otherwise `nsh check` emits missing-documentation warnings when generating `.nsh/types/omawarden-app/native.d.ts`.

### 2.1 Execution Routing Inside `OmawardenBridge` (In-Process Engine, Shared Daemon)
1. **Daemon Readiness (`ensure_app_daemon_running`)**:
   - The app never hosts the daemon. It delegates to `omawarden::daemon::ensure_daemon_running()`, which owns the launch strategy: the engine resolves the standalone `omawarden` executable (`OMA_DAEMON_BIN`, the running CLI binary, or `PATH`) and starts `omawarden daemon` as its own process.
   - **Why the app must not host the daemon**: a daemon hosted on a Rust thread inside the app runs in the GUI process, so a `stop` — from the Overlay, the CLI, or a config change that restarts it — takes the window down with it. A separate daemon lets the app, the Overlay, and the CLI share one vault session, and keeps that session alive when the window closes.
   - A daemon that already answers is kept, whichever build it comes from. The engine's protocol handshake (`protocol_version`, upstream ADR 0028) replaced the old `GIT_HASH` equality check, so a commit difference is no longer a reason to replace a daemon.
   - The app **MUST NOT** send `stop` to take the socket. The answering daemon may be serving the Overlay, and the engine denies `stop` to non-owners: an in-process daemon rejects all external stops, a standalone one requires explicit `admin: true`.
   - `ensure_app_daemon_running()` returns `Result<(), String>`, and callers surface a launch failure (`real_sync` reports it, `real_authenticate` lets the engine map it into the authentication error) instead of continuing against a missing daemon.
   - Regression test: `locked_daemon_from_another_build_is_kept` binds a socket that answers `ping` with a foreign `commit` and `unlocked: false`, then asserts the app leaves that daemon answering.
2. **100% In-Process Authentication (`omawarden::auth::AuthManager`)**:
   - **Prohibition on CLI Subcommands**: `src/lib.rs` **MUST NOT** spawn `Command::new("omawarden")` for authentication, status checks, or capability probing. Remove `run_omawarden_cli`, `cli_auth_args`, `cli_auth_payload`, `cli_supports_quick_unlock`, and `cli_failure_message`.
   - Before invoking `AuthManager::login_password`, `AuthManager::login_apikey`, `AuthManager::unlock`, or `AuthManager::quick_unlock`, call `ensure_app_daemon_running()`.
   - Execute authentication directly in-process via `auth_manager()`:
     - `AuthKind::Password` / `AuthKind::TwoFactor` / `AuthKind::NewDevice` -> `auth_manager().login_password(&email, &password, code_ref, provider, remember_email, otp_ref)`
     - `AuthKind::ApiKey` -> `auth_manager().login_apikey(&client_id, &client_secret)`
     - `AuthKind::Unlock` -> `auth_manager().unlock(&password)`
     - `AuthKind::QuickUnlock` -> `auth_manager().quick_unlock()`
   - Convert the returned `omawarden::auth::AuthResult` directly into `VaultSnapshotView` in-process.
   - In `real_snapshot()`, when the daemon is not yet unlocked or running, also query `auth_manager().get_status(false)` in-process so `locked` vs `login` state, `email`, `server_url`, and `quick_unlock` readiness are always accurate even before the daemon starts.
3. **In-Process Clipboard Guard (`clipboard_copy`)**:
   - `omawarden::clipboard::ClipboardManager::copy_with_expiry` spawns `std::env::current_exe().arg("clipboard-holder")` when `clear_seconds > 0`.
   - To avoid spawning the NSH GUI binary as `clipboard-holder`, `clipboard_copy(text, sensitive)` in `src/lib.rs` **MUST**:
     1. Call `ClipboardManager::default().copy(text, sensitive, 0)` (which sets the Wayland clipboard via `wl-copy` without spawning `current_exe()`).
     2. If `sensitive && config.clipboard_clear_seconds > 0`, increment a global `AtomicU64` generation counter and spawn an in-process Rust timer thread (`std::thread::spawn`) that sleeps for `clipboard_clear_seconds` and clears the clipboard (`Command::new("wl-copy").arg("--clear")`) if the generation counter has not changed.
4. **Stateful Vault & SSH Agent Operations**: Talk to the Unix socket daemon (`omawarden::daemon::send_request`) using the existing IPC actions (`ping`, `status`, `unlock`, `quick_unlock`, `wipe_quick_unlock`, `set_quick_unlock`, `lock`, `sync`, `list`, `search`, `ssh_key_create`, `get_item`, `get_ssh_key`, `get_attachment_key`, `totp`, `ssh_agent_apply`, `ssh_agent_status`, `ssh_agent_pending`, `ssh_agent_reply`).
   - Background status/ping polls **MUST** pass `"touch": false` so daemon idle auto-lock is never reset by background UI timers.
5. **Stateless Operations**: Call `omawarden` Rust library functions directly in-process:
   - `omawarden::generator::{generate_password, generate_passphrase, PasswordOptions, PassphraseOptions}`
   - `omawarden::config::{ConfigManager, ConfigUpdateOptions}`
   - `omawarden::totp::generate_totp`
   - `omawarden::health::check_system_health`
   - `omawarden::ssh::{generate_keypair, parse_private_key, write_keypair_files_named, SshAlgorithm}`
   - `omawarden::attachment::{get_attachment, clean_previews}` (calling `ensure_app_daemon_running()` beforehand)
6. **Deterministic Headless Test / Mock Mode**:
   - `OmawardenBridge` **MUST** include an in-memory mock/test mode (`set_mock_mode(enabled: bool)`) so `nsh test` (`App.test.tsx`) can deterministically test every view state (`dependency_check`, `login`, `two_factor`, `unlock`, `search`, `ssh_approval`) and every modal without touching the host user's real keyring, filesystem config, or live daemon socket.

### 2.2 Required `OmawardenBridge` Methods (`src/lib.rs`)

```rust
#[native_module("omawarden-app/native")]
pub mod native {
    use nsh_core::prelude::*;
    // ... all DTO structs with #[derive(Clone, Debug, JsObject)] and /// doc comments ...

    /// Native bridge connecting the Omawarden NSH frontend to the omawarden Rust engine and daemon.
    #[module]
    pub struct OmawardenBridge;

    #[module]
    impl OmawardenBridge {
        /// Enable or disable deterministic in-memory mock mode for headless UI tests.
        pub fn set_mock_mode(enabled: bool) -> bool;

        /// Seed mock state (phase, quick_unlock_ready, dependencies_missing, ssh_prompt, etc.) for tests.
        pub fn configure_mock_state(state_json: String) -> VaultSnapshotView;

        /// Initialize the app or handle an external summon payload (e.g. `{"view":"ssh-approval","id":1}`).
        pub fn boot(payload_json: Option<String>) -> VaultSnapshotView;

        /// Re-check system dependencies (omawarden, libsecret/secret-tool, wl-clipboard/wl-copy, libfido2).
        pub fn check_dependencies() -> DependencyStatusView;

        /// Launch floating terminal to install missing system packages.
        pub fn install_missing_dependencies(packages: Vec<String>) -> bool;

        /// Authenticate or unlock the vault (password login, API key login, 2FA, Device OTP, master password unlock, Polkit quick unlock).
        pub fn authenticate(input: AuthActionInput) -> VaultSnapshotView;

        /// Send two-factor verification email.
        pub fn send_two_factor_email(email: String, password: String) -> ActionOutcomeView;

        /// Lock or log out of the current vault session, purging sensitive state and preview files.
        pub fn lock_or_logout(logout: bool) -> VaultSnapshotView;

        /// Query, fuzzy-score, and filter the unlocked vault by search text, scope, folder, and category.
        pub fn query_vault(filter: VaultFilterInput) -> VaultSnapshotView;

        /// Synchronize the vault with the Bitwarden server and return the updated snapshot.
        pub fn sync_vault(filter: VaultFilterInput) -> VaultSnapshotView;

        /// Inspect a specific cipher item, computing masked/revealed fields, TOTP state, and available actions.
        pub fn inspect_cipher(cipher_id: String, reveal: RevealStateInput) -> InspectorView;

        /// Compute live TOTP code and remaining TTL for a cipher item.
        pub fn refresh_totp(cipher_id: String) -> TotpLiveView;

        /// Copy a specific field of a cipher item to the Wayland clipboard with Clipboard Guard TTL.
        pub fn copy_cipher_field(cipher_id: String, field: String, custom_index: Option<u32>) -> CopyOutcomeView;

        /// Copy arbitrary text to the clipboard with optional sensitivity flag.
        pub fn copy_text(text: String, label: String, sensitive: bool) -> CopyOutcomeView;

        /// Preview or download an encrypted attachment (`0600` permissions in `$XDG_RUNTIME_DIR`).
        pub fn open_attachment(cipher_id: String, attachment_id: String, mode: String) -> AttachmentOutcomeView;

        /// Clean up temporary decrypted attachment previews.
        pub fn clean_attachment_previews(cipher_id: Option<String>) -> bool;

        /// Generate a random password with strict range validation (5..=128) and entropy calculation.
        pub fn generate_password(input: PasswordGenInput) -> GeneratedSecretView;

        /// Generate an EFF Diceware passphrase with strict word count validation (3..=20) and entropy calculation.
        pub fn generate_passphrase(input: PassphraseGenInput) -> GeneratedSecretView;

        /// Generate or import an SSH keypair without saving yet (for live preview in SshKeyModal).
        pub fn preview_ssh_key(mode: String, algorithm: String, comment: String, private_key_pem: String) -> SshKeyPreviewView;

        /// Save a generated or imported SSH key to the Bitwarden vault or export it to `~/.ssh`.
        pub fn save_ssh_key(input: SshKeySaveInput, filter: VaultFilterInput) -> SshKeySaveOutcomeView;

        /// Poll background daemon status (`touch: false`), pending SSH approval prompts, and active TOTP.
        pub fn poll_daemon_tick(active_cipher_id: Option<String>) -> DaemonTickView;

        /// Approve or deny a pending SSH agent signing request.
        pub fn resolve_ssh_prompt(prompt_id: u64, approve: bool) -> DaemonTickView;

        /// Load current configuration, health status, and diagnostic logs.
        pub fn get_settings() -> SettingsSnapshotView;

        /// Update configuration settings (validating URL scheme security and refreshing daemon state).
        pub fn update_settings(input: SettingsUpdateInput) -> SettingsSnapshotView;

        /// Load the interface preferences (theme and text size).
        pub fn get_ui_prefs() -> UiPrefsView;

        /// Update the interface preferences and return the stored snapshot.
        pub fn update_ui_prefs(input: UiPrefsUpdateInput) -> UiPrefsView;

        /// Run system health diagnostics.
        pub fn refresh_health() -> HealthSnapshotView;

        /// Check for engine/plugin updates.
        pub fn check_updates(force: bool) -> UpdateStatusView;

        /// Safely open an `http://` or `https://` URL via `xdg-open` (rejecting all other schemes).
        pub fn launch_url(raw_url: String) -> bool;
    }
}
```

### 2.3 Cold Path vs Hot Path (`VaultSnapshot` vs `FilterProjection`)

- **`VaultSnapshotView` is the cold-path contract.** It is produced by
  `real_snapshot()` after `boot`, `authenticate`, `sync`, and `lock_or_logout`,
  and includes `all_items` (every `CipherRowView` before filtering) alongside
  the filtered `items`, counts, scopes, and folders. Producing it may read the
  encrypted vault and the system keyring.
- **`CachedVault` is the hot-path source of truth.** `real_snapshot()` stores
  the unlocked account fields, `VaultItem`s, and rows in a process-global
  `OnceLock<Mutex<Option<CachedVault>>>`. `query_vault`, `inspect_cipher`,
  `refresh_totp`, and `copy_cipher_field` serve cache hits directly and fall
  back to the daemon only on a miss. `lock_or_logout`, `sync_vault`,
  `save_ssh_key`, and a locked `poll_daemon_tick` clear the cache.
- **`FilterProjection` is the TSX hot path.** `store/appStore.ts` keeps
  `rawItems` (from `snapshot.allItems`), fine-grained `category`, `scopeId`,
  `folderId`, and `search` signals, and derives `filteredItems()` with the same
  pure-TS subsequence scorer as the Rust engine. `query()`, `setSearch()`,
  `setCategory()`, `setScope()`, and `setFolder()` never call
  `OmawardenBridge.queryVault` and never call `snapshot.set()`.
- **`<If>` preserves mounted views.** Top-level phase and modal switches use
  `<If when={…}>` instead of bare JSX ternaries, which compile to unmemoized
  reactive effects that destroy and recreate their subtree. With `<If>`, the
  `<VaultWorkspace />` widget tree (header, tabs, rows, inspector, footer) stays
  mounted while filters change; only the row bindings update.
- **Build and GPU settings stay outside the UI.** `.cargo/config.toml` pins the
  size-optimized profiles for every `.nsh/rust/*` workspace root, and
  `configure_linux_renderer()` pins GTK/wgpu to one Mesa Vulkan ICD and one EGL
  vendor library. Both are described in Section 6.

---

## 3. Security & Domain Invariants (Mandatory)

1. **No Silent Input Clamping (`docs/agents/contracts.md` & `security.md`)**:
   - Password generator length MUST be strictly validated in `5..=128`. Values outside this range (or non-numeric) must return an explicit, actionable error (`"Password length must be between 5 and 128 characters. Use 14 or more characters for a strong password."`) and NEVER be silently clamped.
   - Passphrase generator word count MUST be strictly validated in `3..=20`. Values outside this range must return `"Passphrase word count must be between 3 and 20 words."` and NEVER be silently clamped.
2. **No Plaintext Secret Leakage**:
   - Clipboard copies of passwords, TOTPs, CVVs, private keys, and hidden custom fields MUST pass `sensitive = true` (`wl-copy --sensitive` + Clipboard Guard auto-clear after `clipboard_clear_seconds`).
   - Diagnostic logs and server URLs in Diagnose tab must redact tokens, passwords, and private IPs (`sanitize_log` / `sanitize_server_url`).
3. **Strict URL Scheme Validation**:
   - `launch_url` must parse with `url::Url::parse` and only allow `http` or `https` schemes.
   - `server_url` / `identity_url` only allow `http://` on loopback (`localhost`, `127.0.0.1`, `[::1]`); remote hosts require `https://`.
4. **Idle Auto-Lock Integrity**:
   - `poll_daemon_tick` MUST query the daemon with `"touch": false` so background polling never resets the idle inactivity timer.

---

## 4. Theme & WCAG 2.1 Contrast System (ADR 0026)

Create `theme/palette.ts`:
- **Single Source of Hex Colors**: All hex color literals MUST live exclusively in `theme/palette.ts`. Component files (`App.tsx`, `components/*.tsx`) must have **zero hardcoded `#RRGGBB` literals**.
- **Surface Roles**:
  - `menu`: `{ background, text, border, selectedBackground, selectedText }`
  - `popups`: `{ background, text, border, selectedBackground, selectedText }`
  - `muted`: string
- **Presets**:
  - **Dark (`Tokyo Night`)**:
    - `menu`: `{ background: "#1a1b26", text: "#c0caf5", border: "#292e42", selectedBackground: "#283457", selectedText: "#7aa2f7" }`
    - `popups`: `{ background: "#16161e", text: "#c0caf5", border: "#292e42", selectedBackground: "#283457", selectedText: "#7aa2f7" }`
    - `muted`: "#565f89"
  - **Light (`Catppuccin Latte`)**:
    - `menu`: `{ background: "#eff1f5", text: "#4c4f69", border: "#ccd0da", selectedBackground: "#dce0e8", selectedText: "#1e66f5" }`
    - `popups`: `{ background: "#e6e9ef", text: "#4c4f69", border: "#ccd0da", selectedBackground: "#dce0e8", selectedText: "#1e66f5" }`
    - `muted`: "#8c8fa1"
- **Semantic Status Palette & WCAG 2.1 Contrast Helpers**:
  - Semantic tokens (dark / light adaptive based on surface luminance `isLightSurface(menu.background)`):
    - `success` (`#10b981` / `#059669`), `warning` (`#f59e0b` / `#d97706`), `danger` (`#ef4444` / `#dc2626`), `info` (`#3b82f6` / `#2563eb`), `purple` (`#a855f7` / `#7c3aed`)
  - Contrast functions:
    - `relativeLuminance(hex)` & `contrastRatio(hex1, hex2)` (WCAG 2.1 formula)
    - `textOn(bgHex)`: picks dark ink (`#090d16`) or light ink (`#ffffff`) with higher contrast ratio against solid badge/button `bgHex`
    - `tint(accentHex, bgHex, alpha)`: blends `accentHex` over `bgHex` at `alpha` (default `0.15`)
    - `textOnTint(accentHex, bgHex, alpha)`: returns readable text color over a tinted chip/banner meeting >= 4.5:1 contrast
    - `labelOnTint(accentHex, surfaceFgHex, bgHex, alpha)`: returns readable body text color inside tinted alert banners
    - `strengthColor(entropy)` & `strengthLabel(entropy)`: `<40` Weak (`danger`), `<60` Fair (`warning`), `<80` Good (`info`), `<100` Strong (`success`), `>=100` Very Strong (`purple`)
- **Live Host Theme Updates**:
  - Listen to `host.on("theme-update", (payload) => ...)` so Omarchy Shell can inject live theme colors at runtime, plus provide a toggle/selector in Settings or header for testing Dark vs Light mode.

### 4.1 UI Preferences File (`$XDG_CONFIG_HOME/omawarden/ui.json`)

The theme and the app's text size factor are presentation preferences, so they
live beside the engine's `config.json` in their own file rather than in the
engine's `Config`. The daemon and the CLI must never gain a presentation field.

- **Path**: `$XDG_CONFIG_HOME/omawarden/ui.json`, falling back to
  `~/.config/omawarden/ui.json`. It is derived from the engine's config path
  (so it also follows `OMAWARDEN_CONFIG_DIR`), which keeps it in the same
  directory as `config.json` so both can be inspected or backed up together.
- **Content**: `{"theme": "dark" | "light", "fontScale": 1.0}`. Unknown keys
  are ignored. A missing, unreadable or malformed file yields the defaults
  (`dark`, `1.0`) rather than an error.
- **Writes**: atomic (a temporary file in the same directory, then rename) with
  mode `0600`, through `omawarden::fs_util::atomic_write_str`, the same helper
  the engine uses for `config.json`.
- **Clamping**: `fontScale` is clamped to `1.0..=4.0` on the way in, both when
  read from disk and when updated.
- **Bridge**: `get_ui_prefs()` / `update_ui_prefs(patch)` over
  `UiPrefsView { theme, font_scale }` and
  `UiPrefsUpdateInput { theme, font_scale }`. `src/ui_prefs.rs` owns the
  `UiPrefsEngine` seam with an `InProcess` adapter over the file and a `Mock`
  adapter over the process-wide mock state; `configure_mock_state` seeds it
  with a top-level `uiPrefs` object.
- **Theme persistence**: `theme` is not part of `SettingsView` /
  `SettingsUpdateInput`. `store/appStore.ts` loads it through `loadUiPrefs()`
  at startup and writes it through `setTheme()` → `updateUiPrefs({ theme })`,
  which fixes the real-mode bug where the theme never survived a restart.
- **Text size**: the Settings › Appearance slider (100–400 in 10% steps) sets
  `fontScale` immediately through `store.setAppFontScale()`, so the interface
  re-renders while it is dragged. The `updateUiPrefs({ fontScale })` write is
  debounced by 300 ms with `setTimeout`/`clearTimeout`;
  `store.flushAppFontScale()` writes at once on `onChangeEnd`. The response of
  a debounced write is not applied back to the signal, because it can describe
  an older value. The factor changes how much room the content wants, never the
  size of window the shell requires.

---

## 5. Full UI View & Modal Architecture (`App.tsx`, `store/appStore.ts`, `components/*.tsx`)

### 5.1 Core View States (`effectiveView`)
1. **`components/DependencyCheckView.tsx`** — the plugin's prerequisite gate, on the app's primitives:
   - Header: accent `terminal` glyph (the icon set has no wrench), `System Dependencies Required`, a `Prerequisite Setup` badge, and the Arch/AUR explanation.
   - One card per package (`omawarden`, `libsecret`, `wl-clipboard`, `libfido2`): background and border tinted by state (green installed, red missing required, warning missing optional), a state dot, the name, a `Required`/`Optional` tag, the version when known, the description, and a `✓ Ready` / `✗ Missing` pill.
   - `↻ Recheck` beside one full-width install button whose label carries the state and the missing names (`⚡ Install Missing Packages (libsecret)`, or `✓ All Dependencies Installed` and disabled). It calls `OmawardenBridge.installMissingDependencies`; the floating-terminal note sits underneath.
   - There is no `Continue`: a missing required package is not something the screen lets you click past. The engine minimum-version check is not ported — the app ships its own engine.
2. **`components/AuthView.tsx`** — login, two-factor and lock share one flat, centred column (`maxWidth: 360`) and one header shape: the app's logo (login) or a `lock` glyph (locked), the action's title (`Log In to Bitwarden`, `Vault is Locked`), and a subtitle. The engine error banner sits between the header and the form.
   - **Login Step** — logging in takes two steps. This is a deliberate divergence from the plugin, which keeps the first factor's fields visible under the two-factor block:
     - **Credentials** (`loginStep === "credentials"`): the server row with its `Server`/`Close` chip and the inline `SERVER & mTLS CLIENT CERTIFICATE` panel (server URL, the official-server note or the mTLS toggle plus certificate and key paths with browse buttons and the `0600`/`0400` note, then `Save & Apply` and `Reset to Official`; `Save & Apply` writes URL + paths in one `updateSettings` call, a blank URL falls back to official, unused certificates are cleared, and `Reset to Official` writes `https://vault.bitwarden.com`, clears both paths and closes). Then the centred method tabs between **Master Password** (`Email:` + `Master Password:` + `Remember email`) and **API Key** (`Client ID:` + `Client Secret:`), and a full-width `Log In`.
     - **Second Factor** (`loginStep === "secondFactor"`): only the second factor. The server address stays as plain text, but its chip and panel are gone, and no first-factor control is rendered — the email and password stay in the store because the engine needs them again to verify, and Back restores them untouched. The primary action fills the row on the left; `Back` sits on its right, at the same height, and is disabled while a verification is in flight.
     - `loginStep` is the screen's own signal; `AppPhase` stays the engine's truth. `applySnapshot` puts the step on `secondFactor` while a challenge is outstanding and on `credentials` otherwise, so success, lock, logout and boot all reset it. Back changes only the local step and the transient state the second step owned (code, resend state, provider, security-key status, auth error) without telling the engine, which has no way to cancel a challenge and holds no session until the first factor is accepted.
     - Focus follows the step: the code field takes the keyboard when the second factor appears, and Back returns it to the password field.
   - **Second Factor Mode**:
     - Driven by the engine's `twoFactor` phase; the step decides whether the credentials or the challenge is on screen, under the shared header and column.
     - Supports Authenticator App (`0`), Email (`1`, with `"Resend Email"` button), YubiKey OTP (`3`), and FIDO2 WebAuthn Security Key (`7`, showing `fido2Status` and retry button), plus New Device Verification OTP (same step, no provider tabs).
     - The banner reads the store's `authError`, so a failed code's message is cleared with the step rather than following the user back to the credentials.
   - **Locked / Unlock Mode**:
     - Subtitle `Logged in as <email>`; the server URL is not repeated here.
     - Master Password input, then **Polkit Quick Unlock (`ADR-0025`)** above `Unlock Vault` when `quickUnlockReady` is true (`OmawardenBridge.authenticate({ kind: "quickUnlock", ... })`), so the cheaper path is reached first.
     - A right-aligned `Log out from account` text button that expands in place into `Confirm Log Out` / `Cancel`.
3. **`VaultWorkspace` (when `unlocked`)**:
   - **`components/SearchHeader.tsx`**:
     - Search input with instant fuzzy filtering, a match counter pill (`visible / total`), a clear button, and the `"Scope"` selector trigger. Global actions live in the footer.
     - `Ctrl+F` puts the keyboard in the search box and selects the query already there, so the first keystroke replaces it while the filtered list stays put. It answers only while the vault is usable — unlocked, no dialog, window at or above its minimum — and the command palette carries the same row as `Search Vault`.
     - The field is the vault's home position for the keyboard: unlocking or showing the vault focuses it, and the minimum-window gate or an open dialog blurs it, so a dialog's own fields and Escape get the keyboard. Closing a dialog does not give the focus back; only the palette's `Search Vault` asks for it.
     - While the field holds the keyboard, NSH would hand every non-character key to it, so the vault's arrows and `Ctrl+Enter` are re-bound with `when: "always"` while the vault is usable. `Enter` submits through the field's own `onSubmit` (the primary copy, caret kept), and Tab blurs the field before moving the action ring so `Space` can activate the focused action. Escape stays the input's.
   - **`components/ScopeDropdown.tsx`**:
     - Filter by Vault Scope (`All Vaults`, `My Vault (Personal)`, or specific `Organizations` & `Collections`) and `Folders`, with live item counts per scope/folder.
   - **`components/CategoryTabBar.tsx`**:
     - Tabs for `All`, `Logins`, `Cards`, `Identities`, `Secure Notes`, `SSH Keys` with live category counts. On the SSH Keys tab, compact ghost actions create (`+`) or import an SSH key.
   - **`components/VaultItemList.tsx`**:
     - Keyboard-navigable (`Up`/`Down`/`Enter`) list of matching `CipherRowView` items showing category icon, title, subtitle (username / masked card / identity name / SSH key type), favorite star, attachment count badge, and organization badge.
   - **`components/ItemInspector.tsx` & `components/EmptyInspector.tsx`**:
     - Displays full details of the selected cipher, ported from the plugin's `ItemInspector.qml`: one scroll body that fills the pane, opened by the item's favicon or category glyph, its name with favorite/organization/folder badges and its category label, followed by one 6-point card per section (10 points of padding, 8-point gap) whose fields are a muted caption label above a medium-weight value, separated by 1pt rules.
       - **Login**: Username (ghost copy), Password (ghost reveal toggle + copy, monospace once revealed), TOTP block (`TOTP Code` label + TTL, accent monospace code, ghost copy, 3px progress bar that turns danger at 5s; the code rolls over on its own when the period ends), Website URIs (hostname display, ghost copy, ghost launch in browser).
       - **Card**: Cardholder name, Brand, Card number (masked `•••• •••• •••• 1234` vs spaced 4-digit groups when revealed, ghost reveal/copy), Expiration (`MM / YYYY`, ghost copy), CVV/Security Code (ghost reveal/copy).
       - **Identity**: Title/Full Name, Username, Company, Email, Phone, SSN/Passport/License numbers, Address fields (each with a ghost copy action).
       - **Secure Note**: Multi-line selectable/copyable note body with a ghost copy action.
       - **SSH Key**: Key type, Private Key (ghost reveal/copy, ghost export to `~/.ssh/` via `SshKeyModal`), Public Key (ghost copy), Fingerprint (ghost copy).
       - **Custom Fields**: Text, Hidden (ghost reveal toggle), Boolean, Linked fields with a ghost copy action.
       - **Attachments**: Filename, human-readable size, ghost preview (inline image/text preview panel) and ghost download actions.
       - **Metadata**: Created/Updated timestamps on the reader's clock and the Password History entry point.
     - Field-level actions use the shared 22x22 `components/GhostIconButton.tsx`; chunky text buttons are reserved for panel-level actions.
   - **`components/FooterBar.tsx`**:
     - Clickable ghost actions with shortcut badges: `Actions` (`Ctrl+K`), `Generate` (`Ctrl+G`), `Sync` (`Ctrl+R`), `Lock` (`Ctrl+L`), `Settings` (`Ctrl+,`).
     - A subtle rotating sync indicator appears beside `Sync` while a sync is in flight.
     - Theme indicator, engine version, last sync time (on the reader's clock), and update notification badge (opens `ReleaseNotesModal`) on the right.
   - **`components/ToastAlert.tsx`**:
     - Status and error toast notifications with semantic contrast styling.

### 5.2 Shell Overlay

- **`components/MinimumWindowGate.tsx`**:
  - A full-bleed, opaque overlay mounted last in the root view, above the workspace, every modal and the toast. It reads the reactive window size through `store/windowGate.ts` and `theme/layout.ts`, shows the current size and the fixed minimum (`minimumWindowSize()`, `MIN_WINDOW_WIDTH` × `MIN_WINDOW_HEIGHT`), and clears when the window is resized back above it.
  - The floor does not follow the text size: enlarging the text changes how much room the content wants, never how large a window the shell requires, so a window that fits at 100% also fits at 400%.
  - It has no controls. Only a resize clears it, and every keyboard path stands down while it is up.
  - It is an overlay rather than a replacement: the views beneath stay mounted, so a shrink-and-restore cycle preserves form input, modal state and scroll position. The vault shortcuts, the settings shortcut and the tab/space bindings stand down while it is up, and the vault search gives up the keyboard so typing goes nowhere until the window grows back.

### 5.3 All 7 Modals

Every dialog is built on `components/ui.tsx`'s `ModalShell`: a centred card capped at 92% of the window height, with the body in a `Scroll` that has `flexShrink: 1`. The shrink is what bounds the body: NSH defaults `flexShrink` to 0, so a body left at `flexGrow: 0` sizes itself to its content, reports no scroll range, and strands every row below the window's bottom edge. Modals taller than the window (Settings at the 900 × 620 floor) must scroll.

The card keeps the width it asks for, and the header wraps to fit it: the title column takes `flex: 1` with `minWidth: 0`, so the subtitle wraps instead of demanding its single-line width, and the Close control is `flexShrink: 0`. Both are load-bearing at large text sizes, where NSH's default of not shrinking would let the text column grow past the card and push Close out beyond the card's clipped edge.

1. **`components/ActionPaletteModal.tsx` (`Ctrl+K`)**:
   - Searchable, keyboard-first command palette (`↑`/`↓` move, `Enter` runs, direct shortcut keystrokes run the matching action) with no per-row "Run" buttons. Each row shows a leading glyph, the label and hint, and a right-aligned shortcut badge.
   - Lists context-aware actions for the selected cipher (Copy Password, Copy Username, Copy TOTP, Open URL, Reveal Password, Export SSH Key, View Password History) plus global actions (Search Vault, Sync Vault, Open Password Generator, Create SSH Key, Lock Vault, Open Settings). `Search Vault` carries the `Ctrl+F` badge but no keystroke of its own: the palette's own key handling owns `Ctrl+F` while it is open, and the row focuses the vault search (selecting its query) once the palette has closed.
   - Action metadata, filtering, selection, and shortcut dispatch live in `store/actionPalette.ts`; the color palette stays in `theme/palette.ts`.
2. **`components/PasswordGeneratorModal.tsx` (`Ctrl+G`)**:
   - Mode tabs: **Password** vs **Passphrase**.
   - Dynamic wrapping secret preview container with digit highlighting and entropy strength badge (`bits` + Weak/Fair/Good/Strong/Very Strong).
   - Password controls: Length input (`5..=128`, explicit validation error if out of bounds — NO silent clamping!), Uppercase, Lowercase, Numbers, Special, Avoid Ambiguous toggles, Min Numbers & Min Special steppers.
   - Passphrase controls: Word count input (`3..=20`, explicit validation error if out of bounds — NO silent clamping!), Separator input, Capitalize toggle.
   - Regenerate and Copy & Close buttons.
3. **`components/SshKeyModal.tsx`**:
   - Supports `"create"` (Generate new `ed25519`, `rsa-2048`, `rsa-4096`, `ecdsa-p256`, `ecdsa-p384` or Import existing OpenSSH private key into vault) and `"export"` (Write selected SSH key item to `~/.ssh/<filename>` with `0600`/`0644` permissions).
4. **`components/SshApprovalModal.tsx`**:
   - Displays pending SSH agent signing request (`title`, `action`, `key_name`, `fingerprint`, `client`, `command`, `forwarded` warning badge, `remembered` policy note, remaining queue count) with **Approve** and **Deny** buttons. Also supports standalone `ssh-approval` summon mode.
5. **`components/PasswordHistoryModal.tsx`**:
   - Lists previous passwords and change timestamps for the active Login item with individual copy buttons.
6. **`components/SettingsModal.tsx` (`Ctrl+,`)**:
   - 5 Tabs:
     - **General**: Server URL, Identity URL, Remember Email toggle, Show Website Icons toggle, Remember Last Search toggle, Check for Updates toggle, Download Directory, Max Attachment Size (MB).
     - **Appearance**: Theme Appearance (Dark Tokyo Night / Light Catppuccin Latte, persisted through the UI preferences bridge rather than the engine config) and Text size (a slider from 100% to 400% in 10% steps with a live percentage readout, persisted through the same preferences bridge). The display preferences live on their own tab so the connection form stays a form.
     - **Security**: Auto-Lock Timeout (minutes), Clipboard Clear Timeout (seconds), Polkit Quick Unlock toggle (`quick_unlock`), SSH Agent toggle (`ssh_agent_enabled`), SSH Agent Confirmation Policy (`first-use`, `always`, `never`), Client mTLS Certificate & Key paths, Lock Now & Log Out actions.
     - **Diagnose**: Engine Health check cards (Engine Installed, Server Reachable, Secret Service Keyring, Wayland Clipboard, Memory Locked `mlock`), Sanitized Server URL, Sanitized Log Viewer with `"Copy Diagnostic Report"` button (`Refresh` button).
     - **About**: App & Engine version, Git commit hash, Build date, Update check button (`checkUpdates(true)`), View Release Notes button, GitHub repository links.
7. **`components/ReleaseNotesModal.tsx`**:
   - Displays latest release version, title, publication time on the reader's clock, markdown release notes (`<TextView markdown={...} />`), and link to release page.

### 5.4 Shell Layout Sizes (`theme/layout.ts`)

- **`theme/layout.ts`** is the single source of every layout size the shell derives from the window: `SIDEBAR_MIN_WIDTH` (320), `SIDEBAR_MAX_WIDTH` (560), `SIDEBAR_WIDTH_RATIO` (0.3), `MIN_WINDOW_WIDTH` (900), `MIN_WINDOW_HEIGHT` (620) and `EMPTY_STATE_MAX_WIDTH` (420), plus the pure functions `sidebarWidth(windowWidth)`, `minimumWindowSize()` and `windowTooSmall(size)`.
- The minimum is a fixed floor. `minimumWindowSize()` returns the two base minimums and `windowTooSmall()` compares against them, so the predicate and the gate's displayed minimum can never disagree. Neither takes a scale: the text size must not raise the window size the shell needs.
- It also owns the lengths that exist to make room for text: `LABEL_GUTTER_WIDTH` (132), `GENERATOR_LABEL_WIDTH` (130), `WIDE_INPUT_WIDTH` (160), `OTP_CELL_WIDTH` (40), `OTP_CELL_HEIGHT` (44), `INPUT_MIN_HEIGHT` (36), and the pure `scaleLength(points, scale)` helper. `SYNC_INDICATOR_SIZE` (14) and `VAULT_ICON_SIZE` (16) keep the two visual icon sizes in the same module.
- **`theme/typeScale.ts`** is the single source of every text size: `TypeStep` (thirteen names), `TypeScale`, the base `TYPE_SCALE` ladder from `2xs` (9) to `7xl` (28), and the pure `scaleType(factor)`.
- `store/appStore.ts` exposes the reactive accessors beside `palette()`: `appFontScale` (the factor loaded from `ui.json` and set by the Text size slider), `totalScale()` (`fontScale() × appFontScale()`), `type()` (the ladder at the app factor, since `Text` applies the system factor itself) and `lengths()` (the six text-room lengths at `totalScale()`).
- `components/Icon.tsx` keeps its `size` prop as the 100% value and multiplies it by `totalScale()` internally, so icon call sites stay unchanged. `GhostIconButton`'s 22-point hit area is a touch target and does not scale.
- `components/VaultItemList.tsx` reads `sidebarWidth(windowSize().width)` at the point of use; the list follows the window alone, so the text size cannot widen it past the 3:7 split and push the detail pane out; no geometry signal is stored.
- `components/ItemInspector.tsx` lets its scroll body fill the pane: the sections are the cards, so a capped content column would leave a wide pane half empty. Section cards are 6-point rounded frames with 10 points of padding and an 8-point gap, and each field is a muted caption label above a medium-weight value with a 1pt rule between visible rows, matching the plugin's `ItemInspector.qml`. The item's icon, name, badges and category live at the top of the scroll body rather than in a header bar. Every spec list is built inside an `Each` binding, never in the component body, so a reveal toggle or a TOTP tick rebuilds the rows.
- `components/EmptyInspector.tsx` caps its two-line empty-state column at `EMPTY_STATE_MAX_WIDTH` and centres it.
- `store/windowGate.ts` exposes `windowBelowMinimum()`, the one predicate the gate and every keyboard path read. It passes the window size alone; the text size is not part of the question.
- `store/searchFocus.ts` owns the vault search field's native ref and the only three ways anything moves the keyboard into or out of it: `setSearchField` (the `<Input ref>` callback), `focusSearch(selectAll)` (drops any action focus, focuses the field, and selects the whole query when asked) and `blurSearch()`. The `Ctrl+F` binding, the palette's `Search Vault` row and `SearchHeader`'s auto-focus all call it, so they cannot drift apart. The ref is a module value rather than a signal: it is a native handle, and the next mount overwrites it.
- `store/DateTime.ts` is the single source of every timestamp the interface shows. The engine hands out ISO-8601 instants in UTC, and `formatLocalDateTime(value)` renders them as `YYYY-MM-DD HH:mm GMT+X` on the reader's clock, with `gmtOffset(date)` spelling the zone (`GMT+8`, `GMT-5`, `GMT+5:30`). No value formats as `""`, and a string that is not a timestamp comes back unchanged. The item's Created/Updated rows, the footer's sync time, a password history entry's change date and a release's publication time all go through it; the About tab's build date is a build identifier rather than a moment, so it stays as the engine writes it.

---

## 6. Runtime Memory Footprint Optimization (< 150 MB RSS Target)

Profiling `nsh run --window-size 1440x960` on Linux with GTK4 + dual AMD Vulkan drivers (`amdvlkpro64.so` + `libvulkan_radeon.so`) showed ~434 MB RSS when unconfigured. To bring resident memory down to ~110–140 MB RSS:

1. **Pin Linux to One Lightweight GPU Driver (`configure_linux_renderer`)**:
   - On hybrid AMD + NVIDIA systems with several ICDs installed (`amd_pro_icd64.json`, `nvidia_icd.json`, `radeon_icd.json`, `10_nvidia.json`, `50_mesa.json`), GTK4 and `wgpu` can enumerate both Vulkan and EGL across every driver. That loads `amdvlkpro64.so`, `libnvidia-gpucomp.so`, `libnvidia-eglcore.so`, `libvulkan_radeon.so`, `libgallium.so`, `libLLVM.so`, plus large anonymous GPU heaps.
   - `configure_linux_renderer()` in `src/lib.rs` runs from a `#[used] #[unsafe(link_section = ".init_array")]` constructor before `gtk::init()` and again at the top of `OmawardenBridge::boot()`. It respects any value the user already set and otherwise applies:
     - `GSK_RENDERER=ngl`
     - `WGPU_BACKEND=vulkan` (no simultaneous GL/EGL backend)
     - `WGPU_POWER_PREFERENCE=low_power`
     - `VK_DRIVER_FILES` **and** `VK_ICD_FILENAMES` set to the first existing Mesa ICD in this order: `radeon_icd.x86_64.json`, `radeon_icd.json`, `intel_icd.x86_64.json`, `intel_icd.json` under `/usr/share/vulkan/icd.d/`
     - `__EGL_VENDOR_LIBRARY_FILENAMES=/usr/share/glvnd/egl_vendor.d/50_mesa.json` when that file exists
   - Pinning the ICD stops Vulkan from `dlopen`ing the proprietary AMD PRO and NVIDIA stacks; pinning the EGL vendor file stops `libEGL` from loading `10_nvidia.json`.
2. **Size-Optimized Profiles via `.cargo/config.toml`**:
   - `nsh dev` / `nsh run` invoke Cargo against `.nsh/rust/Cargo.toml` and `.nsh/rust/gpui/Cargo.toml` as workspace roots, which can cause Cargo to ignore `[profile.dev]` in this repository's `Cargo.toml`. The unoptimized host binary then reaches ~1.5 GB on disk.
   - `.cargo/config.toml` applies the profiles regardless of the workspace root:
     ```toml
     [profile.dev]
     opt-level = "s"
     debug = 0
     strip = "debuginfo"

     [profile.dev.package."*"]
     opt-level = "s"
     debug = 0

     [profile.release]
     opt-level = "s"
     lto = "thin"
     strip = "symbols"
     codegen-units = 1
     ```
   - This shrinks the debug host binary and the release runner, and reduces mapped executable RSS.
3. **Windowed / Capped Vault List Rendering (`components/VaultItemList.tsx`)**:
   - Avoid mounting hundreds or thousands of GTK `<Button>` row subtrees simultaneously in `<Each of={store.visibleItems()}>`.
   - Render a windowed slice (`visibleLimit` defaults to `80`, resets to `80` when filters change, and grows automatically when keyboard navigation approaches the end) with a `Show more (… remaining)` button at the bottom of the scroll list.
   - `<Each … key="index">` keeps row slots in place across category switches, and the row action id is `cipher-row-slot-${index}` so the registered action stays valid when a slot's item changes.
4. **Hot-Path FilterProjection Without Snapshot or Widget Churn**:
   - Category, scope, folder, and search changes update only `filteredItems()`, which filters the cached `rawItems` in memory. They perform no daemon IPC, no keyring lookups, and no `snapshot.set()`.
   - Phase and modal branches use `<If when={…}>` rather than bare JSX ternaries, so the `<VaultWorkspace />` subtree stays mounted across filter changes and inner badge views update in place instead of being recreated.

---

## 7. Verification & Acceptance Criteria

1. Initialize git repository in `~/Development/linux/omawarden-app` (`git init`, `git remote add origin https://github.com/omawarden/omawarden-app.git`). Do **NOT** push to remote.
2. Zero `Command::new("omawarden")` calls in `src/lib.rs` — daemon startup is delegated to `omawarden::daemon::ensure_daemon_running()` (the engine resolves and launches the executable), and all authentication (`login_password`, `login_apikey`, `unlock`, `quick_unlock`, `get_status`) executes in-process via the `omawarden` Rust crate.
3. Run `~/.local/share/mise/installs/github-longbridge-nsh/latest/bin/nsh check` — must complete with **0 errors and 0 warnings**.
4. Run `cargo test` — unit tests in `src/lib.rs` must pass 100%.
5. Run `~/.local/share/mise/installs/github-longbridge-nsh/latest/bin/nsh test` — headless UI tests in `App.test.tsx` must pass 100%.
6. Verify `nsh run --window-size 1440x960` resident memory (`RSS` in `ps` / `/proc/<pid>/smaps_rollup`) drops from ~434 MB to well under 200 MB (target ~110–150 MB) and no `amdvlkpro64.so` is loaded in `/proc/<pid>/maps`.
