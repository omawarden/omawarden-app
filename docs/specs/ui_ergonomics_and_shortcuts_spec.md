# Omawarden App: UI Ergonomics, Shortcuts & Layout Parity Specification

> **Target Repository**: `omawarden/omawarden-app`  
> **Status**: Ready for Implementation  
> **Primary Goal**: Complete 100% visual and keyboard ergonomics parity with `omarchy-bitwarden` (`OmarchyBitwarden.qml`, `ActionPaletteModal.qml`, `ItemInspector.qml`, `SearchHeader.qml`, `FooterBar.qml`), fixing 4 major UI/UX defects.

---

## 1. Defect Breakdown & Exact Design Requirements

### Defect 1: Action Palette has bulky "Run" buttons instead of Command Palette shortcuts
**Root Cause**: `components/ActionPaletteModal.tsx` renders an `<ActionButton label="Run" />` on every single row instead of functioning as a keyboard-centric Spotlight/Command palette.  
**Reference**: `omarchy-bitwarden/components/ActionPaletteModal.qml`  
**Requirements**:
1. **Remove all "Run" buttons** from `PaletteRow`.
2. Each row must be an interactive list item with:
   - Left glyph icon:
     - Copy Password: `\uf084`
     - Copy Username: `\uf007`
     - Copy TOTP: `\uf017`
     - Reveal Password: `\uf06e`
     - Password History: `\uf1da`
     - Open URL: `\uf08e`
     - Sync Vault: `\uf021`
     - Generate Password: `\uf084`
     - Create SSH Key: `\uf084`
     - Lock Vault: `\uf023`
     - Settings: `\uf013`
   - Middle text: Title (medium/bold font) + Hint (muted font).
   - Right shortcut badge: e.g. `Ctrl+U`, `Ctrl+↵`, `Ctrl+T`, `Ctrl+O`, `Ctrl+G`, `Ctrl+R`, `Ctrl+L`, `Ctrl+,`.
3. Navigation & Execution:
   - Full Up/Down arrow selection (`selectedIndex`), highlighted with accent background.
   - Pressing `Enter` runs the highlighted action and closes the modal.
   - Pressing a direct shortcut key while in the palette (e.g. `Ctrl+U`, `Ctrl+Enter`, `Ctrl+T`) immediately executes that action.

---

### Defect 2: Incomplete global shortcuts (`Ctrl+Enter` for TOTP) & Vague "Copied" toast
**Root Cause**:
1. `App.tsx` lacks `mod+enter` (copy TOTP), `mod+u` (copy username), `mod+t` (toggle reveal), and `mod+o` (open URL).
2. `src/lib.rs`'s `copy_cipher_field` returns a hardcoded `"Copied."` message without specifying what was copied or sensitive TTL.  
**Reference**: `OmarchyBitwarden.qml:1196-1202, 2122-2145`  
**Requirements**:
1. In `App.tsx`:
   - Bind `"mod+enter"` (and `"ctrl+enter"`): invoke `store.copyField("totp")`.
   - Bind `"mod+u"`: invoke `store.copyField("username")`.
   - Bind `"mod+t"`: invoke `store.toggleReveal("password")`.
   - Bind `"mod+o"`: invoke `store.openFirstUrl()`.
   - Ensure `enter` continues to perform primary copy (`store.primaryCopy()`).
2. In `src/lib.rs` / `store/appStore.ts`:
   - Replace generic `"Copied."` messages with precise labels:
     - Username: `"Copied username to clipboard."`
     - Password: `"Copied password to clipboard (clears in 30s)."`
     - TOTP: `"Copied TOTP code to clipboard (clears in 30s)."`
     - Card number: `"Copied card number to clipboard (clears in 30s)."`
     - Card CVV: `"Copied card security code to clipboard (clears in 30s)."`
     - Secure note: `"Copied secure note to clipboard (clears in 30s)."`
     - SSH private key: `"Copied private key to clipboard (clears in 30s)."`
     - SSH public key: `"Copied public key to clipboard."`
     - URL: `"Copied website URL to clipboard."`
     - Custom field: `"Copied {label} to clipboard."`

---

### Defect 3: Item actions use clumsy text buttons, and TOTP layout is inconsistent with QML
**Root Cause**: `components/ItemInspector.tsx` uses chunky text buttons (`[Copy]`, `[Reveal]`, `[Open]`, `[Preview]`, `[Download]`) and wraps TOTP in an alien colored card box, breaking visual harmony.  
**Reference**: `omarchy-bitwarden/components/ItemInspector.qml:786-840` & `GhostIconButton.qml`  
**Requirements**:
1. **Create `components/GhostIconButton.tsx`**:
   - A 22x22 compact button with rounded corners (radius 4), transparent background, and subtle hover background (`0.08` opacity).
   - Renders a centered glyph icon (`\uf0c5` copy, `\uf06e` reveal eye, `\uf070` hide eye, `\uf08e` external link, `\uf021` refresh, `\uf019` download).
   - Replaces all text buttons across `ItemInspector.tsx` (username copy, password reveal/copy, URI open/copy, custom field actions, attachment actions).
2. **Harmonize TOTP Layout**:
   - Remove the heavy colored card background (`backgroundColor: tint(...)`).
   - Integrate TOTP seamlessly into the inspector field sequence, separated by standard 1px dividers:
     - Top row: `TOTP Code` (muted text) and `${ttl}s` (muted, turning `danger` when `<= 5s`).
     - Main row: Formatted code in bold monospace accent font (e.g. `123 456`) on the left, and a `GhostIconButton` (`\uf0c5`, "Copy TOTP") on the right.
     - Bottom row: Sleek 3px progress bar (`remaining / period`), changing to `palette().danger` when `<= 5s`.

---

### Defect 4: Global action buttons (Generator, SSH, Sync, Lock, Settings) dumped in SearchHeader
**Root Cause**: `components/SearchHeader.tsx` crowded 5 large action buttons right next to the search bar, while `FooterBar.tsx` only had static non-clickable shortcut text.  
**Reference**: `omarchy-bitwarden/components/SearchHeader.qml` & `components/FooterBar.qml`  
**Requirements**:
1. **Clean up `components/SearchHeader.tsx`**:
   - Remove `Generator`, `New SSH Key`, `Sync`, `Lock`, and `Settings` buttons from the header.
   - `SearchHeader` must only contain:
     - Search input with search icon and clear 'x' button.
     - Match counter pill (`x / y`).
     - Vault scope dropdown / selector.
     - When active category is `sshKey`: small `+` (generate) and `⬇` (import) ghost icon buttons on the right of the tab bar.
2. **Move Actions to `components/FooterBar.tsx`**:
   - Replace the static text labels with sleek, clickable Ghost Buttons on the bottom left:
     - `[⚡ Actions  Ctrl+K]` -> `store.openActionPalette()`
     - `[🔑 Generate  Ctrl+G]` -> `store.openGenerator()`
     - `[↻ Sync  Ctrl+R]` -> `store.sync()`
     - `[🔒 Lock  Ctrl+L]` -> `store.lockOrLogout(false)`
     - `[⚙ Settings  Ctrl+,]` -> `store.openSettings()`
   - On the bottom right: keep Theme indicator, Engine version, Last sync time, and Update badge.

---

## 2. Verification Criteria
- `nsh check` and `bun run check` pass with zero errors.
- `nsh test` passes all tests.
- Verify in `nsh run`:
  - `SearchHeader` is clean with no redundant action buttons.
  - `FooterBar` has clickable ghost buttons with shortcut labels.
  - `Ctrl+Enter` copies TOTP and shows `"Copied TOTP code to clipboard (clears in 30s)."`.
  - Action Palette opens on `Ctrl+K`, displays shortcut badges without "Run" buttons, and navigates via arrow keys.
  - `ItemInspector` displays uniform 22x22 `GhostIconButton`s, and TOTP layout matches QML design.

---

### Defect 5: Clicking Sync locks the user out or freezes the entire UI
**Root Cause**:
1. **Cache wipe & false lock out**: In `src/lib.rs` (`sync_vault`), `clear_cached_vault()` was called unconditionally on the first line *before* sync finished. If the daemon took time or encountered any network/token error, `real_snapshot` saw `is_unlocked == false` or empty items, causing `snapshot.phase` to drop into `AppPhase::Locked`, kicking the user back to the "Vault Locked" screen!
2. **Main UI thread blocking**: `OmawardenBridge.syncVault()` was invoked synchronously on the UI event thread in `defer(...)`, causing a synchronous blocking `read_line()` on the daemon socket during long network calls, freezing the entire GUI window (rendering it completely unresponsive / locked up).
3. If an error occurred or `isSubmitting` was not cleared, all actions remained permanently disabled.

**Requirements**:
1. In `src/lib.rs` (`sync_vault`):
   - **DO NOT** clear `cached_vault` before sync succeeds! Preserve the existing in-memory cached vault items so the user's unlocked state and view are NEVER destroyed on sync failure or network delay.
   - Call `ensure_app_daemon_running()` to ensure daemon connectivity.
   - Only update/replace `cached_vault` *after* the sync response returns `ok: true`.
   - On error: return the current snapshot preserved with `AppPhase::Unlocked`, and set `snapshot.error = Some(err_msg)`, emitting a transient toast error rather than locking the vault!
2. In `store/appStore.ts` (`sync`):
   - Run sync asynchronously or protect the UI state: ensure `isSubmitting` is cleanly scoped to a local `isSyncing` signal (showing a subtle rotating indicator in the FooterBar), NOT a blanket lockout that freezes the whole UI.
   - Catch all errors so the UI never enters an unresponsive state.
