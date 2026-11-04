# Omawarden App: Frontend Feature Parity & Defect Remediation Specification

> **Target Repository**: `omawarden/omawarden-app`  
> **Status**: Ready for Implementation  
> **Primary Goal**: Achieve 100% functional, UX, and security parity with the reference QML implementation (`omarchy-bitwarden`), completely resolving all broken, stubbed, or missing functionality.

---

## 1. Overview & Architecture Boundary

The application is built with **NSH** (Rust backend plugin + TypeScript/React-like JSX frontend).  
All implementations must adhere to the project's architecture:
- Rust backend: `src/lib.rs` (native methods exposed via `OmawardenBridge`)
- Global store: `store/appStore.ts` (reactive signals, actions, and bridge invocations)
- UI components: `components/*.tsx` (accessible, keyboard-friendly UI using NSH components)
- Reference implementation: `../omarchy-bitwarden/` (`OmarchyBitwarden.qml`, `components/*.qml`, `components/*.js`)

The implementation is broken down into **three vertical phases (P0, P1, P2)** in strict execution order.

---

## 2. Phase P0: Core Reactive State & Form Lifecycles (Highest Priority)

### Ticket P0-1: Live TOTP Ticker, Countdown Bar & Auto-Refresh
**User Story**: As a user viewing an item with TOTP, I need to see the remaining seconds tick down in real time, see the progress bar shrink smoothly, have the color alert me when under 5s, and have the code automatically regenerate when it expires without manual intervention.

**Technical Requirements**:
1. In `store/appStore.ts`:
   - Add a global or inspector-scoped 1000ms timer (`setInterval`) that runs whenever an item with TOTP is selected.
   - Each tick: if `totp.remaining > 1`, decrement `remaining` by 1.
   - When `remaining <= 1`: automatically invoke `OmawardenBridge.refreshTotp(cipherId)` to fetch the next valid code and reset the period/TTL.
   - When the user deselects the item, switches view, or locks the vault: clear the interval.
2. In `components/ItemInspector.tsx`:
   - Live TTL display: render `${item().totp.remaining}s`.
   - Danger styling: when `remaining <= 5`, apply `palette().danger` to the remaining text and progress indicator bar.
   - Smooth progress bar: value calculated as `(remaining / period) * 100`.
   - Provide keyboard shortcut / direct action for `store.copyField("totp")`.
   - Keep the manual "Refresh" button as an immediate forced-refresh fallback.

### Ticket P0-2: Form Submission Lifecycle & Input Preservation
**User Story**: As a user submitting credentials or unlocking the vault, my input must NOT vanish upon clicking submit. I need to see a submitting/busy state, and if the operation fails, my entered text must remain intact so I do not have to retype everything.

**Technical Requirements**:
1. In `store/appStore.ts`:
   - Introduce an `isSubmitting` reactive signal tracking active authentication/unlock/sync actions.
2. In `components/AuthView.tsx`:
   - **Remove synchronous input clearing**:
     - Do NOT call `password.set("")` in `submitLogin()` synchronously before `store.authenticate()`.
     - Do NOT call `twoFactorCode.set("")` / `newDeviceOtp.set("")` in `TwoFactorForm.submit()`.
     - Do NOT call `unlockPassword.set("")` in `UnlockForm.unlock()`.
   - While `isSubmitting()` is true:
     - Disable inputs and submit buttons.
     - Show submitting text / spinner indicator (e.g. "Signing in…", "Unlocking…").
   - On submission failure (`next.error` present):
     - Keep user inputs (`email`, `password`, `unlockPassword`, OTP) completely preserved.
     - Display error banner with danger styling.
     - Focus remains on or returns to the input field.
   - On submission success (`next.phase === "unlocked"`):
     - Securely zero and clear all password/secret state variables.

### Ticket P0-3: Dynamic Category TabBar Counts Matching Search & Scope
**User Story**: When I type a search query or filter by Scope/Folder, the category count badges in the TabBar must reflect the matching item counts for that search/scope, rather than remaining stuck on the global total.

**Technical Requirements**:
1. In `src/lib.rs` / `store/appStore.ts`:
   - Category counts must not be a static snapshot of all raw items.
   - Compute dynamic category counts based on current `active_scope`, `active_folder`, and `search` query:
     - `all`: total matching items
     - `logins`: logins matching current scope & search
     - `cards`: cards matching current scope & search
     - `identities`: identities matching current scope & search
     - `secure_notes`: notes matching current scope & search
     - `ssh_keys`: ssh keys matching current scope & search
2. In `components/CategoryTabBar.tsx`:
   - Bind badge counts to dynamic counts.
   - If count is 0, display 0 or fade out badge text according to QML reference design.

---

## 3. Phase P1: Favicons & Native Desktop File Dialogs

### Ticket P1-1: Website Favicon Resolution & Asynchronous Image Rendering
**User Story**: When "Show website icons" is enabled in settings, vault list items should display website favicons loaded asynchronously, falling back smoothly to category glyphs when unavailable.

**Technical Requirements**:
1. In `src/lib.rs`:
   - Ensure `CipherRowView` includes `uris: Vec<String>` or pre-resolved `icon_url: Option<String>` derived from the cipher's login URIs.
2. In `store/IconPolicy.ts` (port from `omarchy-bitwarden/components/IconPolicy.js`):
   - Check `isOfficialServer(serverUrl)`:
     - If official Bitwarden: `https://icons.bitwarden.net/{domain}/icon.png`
     - If self-hosted: `{serverUrl}/icons/{domain}/icon.png`
   - Filter out app schemes (`androidapp://`, `ssh://`, etc.) and extract root domain.
3. In `components/VaultItemList.tsx`:
   - Check `store.settings().show_website_icons`.
   - If enabled and an icon URL exists, render `<Image src={iconUrl} style={{ width: 20, height: 20, borderRadius: 4 }} />`.
   - Graceful fallback: If image fails to load or no URI exists, render `categoryGlyph(item.category)`.

### Ticket P1-2: Native File Chooser Integration via Rust Native Bridge
**User Story**: As a Linux desktop user, I should be able to click "Browse..." to pick certificate files, private keys, or choose a download folder via the native system file dialog (XDG Desktop Portal / Hyprland file picker) instead of typing paths by hand.

**Technical Requirements**:
1. In `Cargo.toml` & `src/lib.rs`:
   - Add `rfd = "0.15"` dependency (with default features supporting XDG Desktop Portal / Wayland).
   - Expose native bridge method:
     ```rust
     pub fn pick_file(title: Option<String>, filter_name: Option<String>, extensions: Option<Vec<String>>) -> Option<String>;
     pub fn pick_folder(title: Option<String>) -> Option<String>;
     pub fn save_file(title: Option<String>, default_name: Option<String>) -> Option<String>;
     ```
2. In `store/appStore.ts`:
   - Expose `pickFile(...)`, `pickFolder(...)`, `saveFile(...)` helpers.
3. In `components/SettingsModal.tsx`:
   - Add "Browse…" button next to `Client Certificate Path` (`*.crt`, `*.pem`).
   - Add "Browse…" button next to `Client Key Path` (`*.key`, `*.pem`).
   - Add "Browse…" button next to custom CLI binary path.
4. In `components/SshKeyModal.tsx`:
   - In "Import" mode, add "Browse Key File…" button that reads the selected file path and loads its contents into the PEM field.
   - In "Export" mode, support picking export directory (defaulting to `~/.ssh`).

### Ticket P1-3: mTLS Client Certificate Configuration in Login Flow
**User Story**: When logging into a self-hosted Bitwarden instance protected by mutual TLS, I need to configure client certificate and key directly in the login view with native file browsing.

**Technical Requirements**:
1. In `components/AuthView.tsx`:
   - Detect if server URL is not official Bitwarden cloud.
   - Provide an expandable "Mutual TLS (mTLS) Client Certificate" configuration card:
     - Enable mTLS checkbox.
     - Certificate path input + "Browse..." button (native file picker).
     - Private key path input + "Browse..." button (native file picker).
     - Security notes:提醒 0600 file permissions and server hostname origin matching.
   - Save mTLS settings to config when connecting.

---

## 4. Phase P2: Attachment Viewer, Card Formatter & Security Guardrails

### Ticket P2-1: Attachment Image Preview & External System Launcher
**User Story**: When previewing an image attachment, I want to see the actual image rendered on screen, and have a button to open the file in my system image viewer.

**Technical Requirements**:
1. In `components/ItemInspector.tsx`:
   - When `attachment.isImage` is true, render an `<Image src={"file://" + attachment.path} />` with aspect ratio fitting (max height ~320px).
   - Add "Open with system viewer" action calling `OmawardenBridge.launchUrl("file://" + attachment.path)`.
   - For text/code attachments, keep the scrollable monospace view with a "Copy content" button.
   - For download action: allow picking destination directory using `save_file` dialog.

### Ticket P2-2: Card Number Formatter & Issuer Brand Recognition
**User Story**: Credit card numbers should be formatted with standard spacing and brand recognition, with a toggleable CVV field.

**Technical Requirements**:
1. Create `store/CardFormatter.ts` (port from `omarchy-bitwarden/components/CardFormatter.js`):
   - Recognize card issuers: Visa, Mastercard, American Express, Discover, JCB, Diners Club, UnionPay.
   - Spacing formats:
     - Amex: 4-6-5 (`•••• •••••• •1234`)
     - Standard: 4-4-4-4 (`•••• •••• •••• 1234`)
2. In `components/ItemInspector.tsx` & `components/VaultItemList.tsx`:
   - Use `formatMaskedCardNumber` and `formatRevealedCardNumber`.
   - Add reveal toggle and copy button for CVV/CVC.

### Ticket P2-3: Master Password Re-prompt Security Enforcement
**User Story**: Items marked with "Master password re-prompt" (`reprompt == 1`) must require entering the master password before revealing sensitive fields or copying passwords/TOTPs.

**Technical Requirements**:
1. In `components/ItemInspector.tsx` & `store/appStore.ts`:
   - Check `item.reprompt === 1`.
   - If re-prompt is required and item is not yet temporarily unlocked:
     - Mask password, TOTP, and hidden custom fields.
     - Intercept click / copy with a lightweight "Confirm Master Password" modal dialog.
     - Upon valid password confirmation, grant access for the current inspection session.

### Ticket P2-4: Real Diagnostics & GitHub Releases Integration
**User Story**: Checking updates should query the real GitHub Releases API, and diagnostics reports should include real system RSS memory and stderr ring-buffer logs.

**Technical Requirements**:
1. In `src/lib.rs`:
   - `check_updates`: Query `https://api.github.com/repos/omawarden/omawarden-app/releases/latest` (or `omarchy-bitwarden`), compare version tags, return real update info.
   - `diagnostics`: Populate `git_commit` and `build_date` from compile-time envs (`env!("GIT_HASH")`), query current process RSS memory from `/proc/self/statm`, and include recent daemon stderr log lines.
2. In `components/ReleaseNotesModal.tsx` & `components/SettingsModal.tsx`:
   - Display real version comparison and changelog link.

---

## 5. Verification & Testing Standards

- **TypeScript Typecheck**: `bun run check` / `tsc --noEmit` must pass with zero errors.
- **Unit & Integration Tests**: Update and run `bun test` / `cargo test` covering:
  - TOTP live ticker and auto-refresh logic.
  - Form submitting state and error preservation.
  - Dynamic category count calculation.
  - IconPolicy domain resolution.
  - Card number formatting.
- **Manual Verification**: Run `nsh run` to verify live UI rendering, timer countdown, file pickers, and smooth interactions.
