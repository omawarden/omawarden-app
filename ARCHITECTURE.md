# Omawarden App (`omawarden-app`) — Architecture & Implementation Specification

## 1. Overview & Repository Role

`omawarden-app` (`~/Development/linux/omawarden-app`, GitHub: `https://github.com/omawarden/omawarden-app`) is the standalone cross-platform Native Shell (`nsh` `0.3.0`) frontend for the `@omawarden` ecosystem:

1. **`omawarden-cli`** (currently located at `~/Development/linux/omarchy-bitwarden/omawarden`): The Rust cryptographic engine, keyring bridge, SSH agent, and Unix socket daemon.
2. **`omawarden-app`** (`~/Development/linux/omawarden-app`): This repository — a 100% **TSX + Tailwind + `nsh/base`** UI backed by a thin Rust native module (`#[native_module("omawarden-app/native")]`) that links directly against the `omawarden` crate (`path = "../omarchy-bitwarden/omawarden"`).
3. **`omarchy-bitwarden-plugin`**: Thin Quickshell/Omarchy Shell wrapper (to be slimmed down in a later phase; **DO NOT modify `~/Development/linux/omarchy-bitwarden` in this phase**).

### Toolchain Paths
- `nsh` binary: `~/.local/share/mise/installs/github-longbridge-nsh/latest/bin/nsh` (version `0.3.0`, installed via `mise`).
- Primary desktop target: Linux GTK 4 (`--target linux`), also compatible with GPUI and Web.
- Reference implementation for 1:1 behavioral parity: `~/Development/linux/omarchy-bitwarden/OmarchyBitwarden.qml` and `~/Development/linux/omarchy-bitwarden/components/*.qml`.

---

## 2. Architectural Seam: `omawarden-app/native` (`OmawardenBridge`)

Following deep-module design principles ("Design It Twice" Hybrid Design 3 + Design 2):
- **Callers (TSX UI & Store)** never spawn child processes (`process.spawn`), never parse raw CLI stdout/stderr, never construct Unix socket JSON envelopes, and never perform fuzzy scoring or card/URI string parsing in JS.
- **Rust Native Module (`src/lib.rs`)** exposes `#[native_module("omawarden-app/native")]` with `#[module] pub struct OmawardenBridge` and strongly-typed `#[derive(Clone, Debug, JsObject)]` DTOs and `#[derive(Clone, Copy, Debug, PartialEq, Eq, PropEnum)]` enums.
- **IMPORTANT `nsh` Rule**: Every `pub` struct, enum, variant, field, module, and method in `#[native_module]` **MUST have a `///` doc comment**, otherwise `nsh check` emits missing-documentation warnings when generating `.nsh/types/omawarden-app/native.d.ts`.

### 2.1 Execution Routing Inside `OmawardenBridge` (100% In-Process Rust Crate — Zero CLI Subcommands)
1. **In-Process Daemon Readiness (`ensure_app_daemon_running`)**:
   - **Why `omawarden::daemon::ensure_daemon_running()` must not be triggered blindly when no daemon is listening**: Inside `omawarden/src/daemon.rs`, `ensure_daemon_running()` checks `send_request(&json!({"action": "ping", "touch": false})).is_ok()`, and only if that fails does it fall back to `std::env::current_exe().arg("daemon")`. Inside an `nsh` host binary, `current_exe()` is the GUI host binary (`nsh-app-...-linux-host`), which would open a second window if `ping` failed.
   - **Architectural Fix (In-Process Daemon Thread)**:
     - `src/lib.rs` **MUST** provide `ensure_app_daemon_running()`:
       1. First send `omawarden::daemon::send_request(&json!({"action": "ping", "touch": false}))`. If `Ok`, return `true` immediately.
       2. Otherwise, spawn an **in-process background Rust thread** (`std::thread::Builder::new().name("omawarden-daemon".into()).spawn(...)`) that calls `omawarden::daemon::run_daemon_server(config.auto_lock_minutes.max(0) as u64)` (guarded by an `AtomicBool` so only one in-process daemon thread is ever spawned per process), and poll `send_request(&json!({"action": "ping", "touch": false}))` up to 40 times (25ms sleep) until the Unix socket is ready.
     - Because the Unix socket is guaranteed to be listening and answering `ping` **before** `AuthManager` or `attachment::get_attachment` is called, `omawarden::daemon::ensure_daemon_running()` inside the `omawarden` crate will always hit its early `if send_request(ping).is_ok() { return; }` fast path and **NEVER** invoke `std::env::current_exe()`!
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
   - `omawarden::attachment::{get_attachment, clear_preview_attachments}` (calling `ensure_app_daemon_running()` beforehand)
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

---

## 5. Full UI View & Modal Architecture (`App.tsx`, `store/appStore.ts`, `components/*.tsx`)

### 5.1 Core View States (`effectiveView`)
1. **`components/DependencyCheckView.tsx`**:
   - Displays required packages (`omawarden`, `libsecret`, `wl-clipboard`) and optional packages (`libfido2`).
   - Shows per-package installation status (`installed` / `missing` / `checking`), version info, one-click `"Install Missing Packages"` button (`OmawardenBridge.installMissingDependencies`), and `"Re-check"` button.
2. **`components/AuthView.tsx`**:
   - **Login Mode**:
     - Switchable tabs between **Master Password** (`email` + `password` + `rememberEmail` checkbox) and **API Key** (`client_id` + `client_secret`).
     - Server URL indicator with quick link to Settings (`Ctrl+,`).
   - **Two-Factor / New Device OTP Mode**:
     - Supports Authenticator App (`0`), Email (`1`, with `"Resend Email"` button), YubiKey OTP (`3`), and FIDO2 WebAuthn Security Key (`7`, showing `fido2Status` and retry button), plus New Device Verification OTP.
   - **Locked / Unlock Mode**:
     - Shows logged-in account email and server URL.
     - Master Password input + `"Unlock Vault"` button.
     - **Polkit Quick Unlock (`ADR-0025`)**: When `quickUnlockReady` is true, renders prominent `"Quick Unlock (System Auth)"` button (`OmawardenBridge.authenticate({ kind: "quick_unlock", ... })`).
     - `"Log Out"` button with confirmation.
3. **`VaultWorkspace` (when `unlocked`)**:
   - **`components/SearchHeader.tsx`**:
     - Search input with instant fuzzy filtering, item count badge, `"Scope"` selector trigger, `"Generator"` button (`Ctrl+G`), `"New SSH Key"` button, `"Sync"` button (`Ctrl+R`), `"Lock"` button (`Ctrl+L`), and `"Settings"` button (`Ctrl+,`).
   - **`components/ScopeDropdown.tsx`**:
     - Filter by Vault Scope (`All Vaults`, `My Vault (Personal)`, or specific `Organizations` & `Collections`) and `Folders`, with live item counts per scope/folder.
   - **`components/CategoryTabBar.tsx`**:
     - Tabs for `All`, `Logins`, `Cards`, `Identities`, `Secure Notes`, `SSH Keys` with live category counts.
   - **`components/VaultItemList.tsx`**:
     - Keyboard-navigable (`Up`/`Down`/`Enter`) list of matching `CipherRowView` items showing category icon, title, subtitle (username / masked card / identity name / SSH key type), favorite star, attachment count badge, and organization badge.
   - **`components/ItemInspector.tsx` & `components/EmptyInspector.tsx`**:
     - Displays full details of the selected cipher:
       - **Login**: Username (copy), Password (reveal toggle, copy, Password History button if history exists, dynamic wrapping with highlighted digits), Live TOTP widget (code formatted `123 456`, countdown TTL badge + progress bar, copy), Website URIs (hostname display, copy URL, launch URL in browser).
       - **Card**: Cardholder name, Brand badge, Card number (masked `•••• •••• •••• 1234` vs spaced 4-digit groups when revealed, copy), Expiration (`MM / YYYY`, copy), CVV/Security Code (reveal toggle, copy).
       - **Identity**: Title/Full Name, Username, Company, Email, Phone, SSN/Passport/License numbers, Address fields (each with copy button).
       - **Secure Note**: Multi-line selectable/copyable note body.
       - **SSH Key**: Key type badge, Fingerprint (copy), Public Key (copy), Private Key (reveal toggle, copy, Export to `~/.ssh/` via `SshKeyModal`).
       - **Custom Fields**: Text, Hidden (reveal toggle), Boolean, Linked fields with copy action.
       - **Attachments**: Filename, human-readable size, Preview button (inline image/text preview modal/panel) and Download button.
       - **Metadata**: Folder, Organization, Created/Updated timestamps.
   - **`components/FooterBar.tsx`**:
     - Keyboard shortcut hints (`↑↓ Navigate`, `⏎ Primary Copy`, `Ctrl+K Actions`, `Ctrl+G Generator`, `Ctrl+R Sync`, `Ctrl+L Lock`, `Ctrl+, Settings`), engine version, and update notification badge (opens `ReleaseNotesModal`).
   - **`components/ToastAlert.tsx`**:
     - Status and error toast notifications with semantic contrast styling.

### 5.2 All 7 Modals
1. **`components/ActionPaletteModal.tsx` (`Ctrl+K`)**:
   - Searchable command palette listing context-aware actions for the selected cipher (Copy Password, Copy Username, Copy TOTP, Open URL, Reveal Password, Export SSH Key, View Password History) plus global actions (Sync Vault, Open Password Generator, Create SSH Key, Lock Vault, Open Settings).
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
   - 4 Tabs:
     - **General**: Server URL, Identity URL, Remember Email toggle, Show Website Icons toggle, Remember Last Search toggle, Check for Updates toggle, Download Directory, Max Attachment Size (MB), Theme Appearance (Dark Tokyo Night / Light Catppuccin Latte).
     - **Security**: Auto-Lock Timeout (minutes), Clipboard Clear Timeout (seconds), Polkit Quick Unlock toggle (`quick_unlock`), SSH Agent toggle (`ssh_agent_enabled`), SSH Agent Confirmation Policy (`first-use`, `always`, `never`), Client mTLS Certificate & Key paths, Lock Now & Log Out actions.
     - **Diagnose**: Engine Health check cards (Engine Installed, Server Reachable, Secret Service Keyring, Wayland Clipboard, Memory Locked `mlock`), Sanitized Server URL, Sanitized Log Viewer with `"Copy Diagnostic Report"` button (`Refresh` button).
     - **About**: App & Engine version, Git commit hash, Build date, Update check button (`checkUpdates(true)`), View Release Notes button, GitHub repository links.
7. **`components/ReleaseNotesModal.tsx`**:
   - Displays latest release version, title, markdown release notes (`<TextView markdown={...} />`), and link to release page.

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
2. Zero `Command::new("omawarden")` calls in `src/lib.rs` — all authentication (`login_password`, `login_apikey`, `unlock`, `quick_unlock`, `get_status`) and daemon startup (`run_daemon_server`) must execute in-process via the `omawarden` Rust crate.
3. Run `~/.local/share/mise/installs/github-longbridge-nsh/latest/bin/nsh check` — must complete with **0 errors and 0 warnings**.
4. Run `cargo test` — unit tests in `src/lib.rs` must pass 100%.
5. Run `~/.local/share/mise/installs/github-longbridge-nsh/latest/bin/nsh test` — headless UI tests in `App.test.tsx` must pass 100%.
6. Verify `nsh run --window-size 1440x960` resident memory (`RSS` in `ps` / `/proc/<pid>/smaps_rollup`) drops from ~434 MB to well under 200 MB (target ~110–150 MB) and no `amdvlkpro64.so` is loaded in `/proc/<pid>/maps`.
