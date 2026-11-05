# NSH 0.4.0 Migration Specification

This document specifies the migration of `omawarden-app` from Native Shell (NSH) 0.3.0 to NSH 0.4.0, including framework dependencies, agent instructions, CSS styling modernization, event handler refactoring, and native `OtpInput` adoption.

---

## 1. Objectives & Scope

1. **Agent Instructions**: Add `AGENTS.md` at repo root directing all agents to `https://nsh.dev/llms.txt` as the canonical coding standard for Native Shell.
2. **Framework & Version Bump**:
   - `Cargo.toml`: `nsh-core = "0.4.0"`, `nsh-base = "0.4.0"`.
   - Bump version to `0.4.0` in both `Cargo.toml` and `nsh.json`.
   - Update `.github/workflows/ci.yml` and `.github/workflows/release-dev.yml` to use `nsh` `v0.4.0`.
3. **Style Modernization (CSS Unified Props)**:
   - `<Image resizeMode="contain" />` $\to$ `<Image style={{ objectFit: "contain" }} />`.
   - `<View pointerEvents="..." />` $\to$ `<View style={{ pointerEvents: "..." }} />`.
   - `<Canvas pointerEvents="..." />` $\to$ `<Canvas style={{ pointerEvents: "..." }} />`.
4. **Event Handler Signature Refactoring**:
   - `<Input onChange={(text) => ...}>` $\to$ `<Input onChange={({ value }) => ...}>`.
   - `<Checkbox onChange={(checked) => ...}>` $\to$ `<Checkbox onChange={({ checked }) => ...}>`.
   - `keymap.bind(..., (keystroke) => ...)` $\to$ `keymap.bind(..., ({ keystroke }) => ...)`.
5. **Component Upgrades**:
   - In `AuthView.tsx`: Replace plain text inputs for two-factor authentication and new device verification with NSH 0.4.0 native `<OtpInput length={6} value={...} onChange={({ value }) => ...} />`.
6. **Validation**:
   - `nsh check` passes with 0 errors.
   - `nsh test` passes all 72 tests.

---

## 2. File Level Changes

### 2.1 AGENTS.md
Create `/home/icyleaf/Development/linux/omawarden-app/AGENTS.md`:
```markdown
# Agent Instructions for Omawarden App

All coding agents working on this codebase must adhere strictly to Native Shell (NSH) design principles and architectural conventions.

## Canonical Standard

Before implementing or modifying any UI component, interaction, layout, or native binding, you **MUST ALWAYS** consult:

- **[https://nsh.dev/llms.txt](https://nsh.dev/llms.txt)**: The authoritative single source of truth for all Native Shell (NSH) development specifications, component APIs, styling rules, and platform constraints.
```

### 2.2 Cargo.toml & nsh.json
- `Cargo.toml`:
  - `version = "0.4.0"`
  - `nsh-core = "0.4.0"`
  - `nsh-base = "0.4.0"`
- `nsh.json`:
  - `"version": "0.4.0"`

### 2.3 .github/workflows/ci.yml & release-dev.yml
- Update `v0.3.0` to `v0.4.0` in curl downloads and git clone tags.

### 2.4 TSX Components
- `components/Icon.tsx`: Move `pointerEvents="none"` to `style={{ pointerEvents: "none", ... }}`.
- `components/ToastAlert.tsx`: Move `pointerEvents="box-none"` to `style={{ pointerEvents: "box-none", ... }}`.
- `components/VaultItemList.tsx`: Move `resizeMode="contain"` to `style={{ objectFit: "contain", ... }}`.
- `components/ItemInspector.tsx`: Move `resizeMode="contain"` to `style={{ objectFit: "contain", ... }}`.
- `components/AuthView.tsx`:
  - Input `onChange={({ value }) => ...}`.
  - Checkbox `onChange={({ checked }) => ...}`.
  - Adopt `<OtpInput>` for 2FA.
- `components/SearchHeader.tsx`: `<Input onChange={({ value }) => store.setSearch(value)} />`.
- `components/SettingsModal.tsx`: `<Input onChange={({ value }) => ...}>` and `<Checkbox onChange={({ checked }) => ...}>`.
- `components/SshKeyModal.tsx`: `<Input onChange={({ value }) => ...}>`.
- `components/PasswordGeneratorModal.tsx`: `<Input onChange={({ value }) => ...}>` and `<Checkbox onChange={({ checked }) => ...}>`.
- `components/ActionPaletteModal.tsx`: `<Input onChange={({ value }) => paletteActions.setQuery(value)} />`.
- `components/MasterPasswordModal.tsx`: `<Input onChange={({ value }) => secret.set(value)} />`.
- `App.tsx`: `keymap.bind` listeners accept `{ keystroke }`.
- `App.test.tsx`: Update any mock or direct event invocations if necessary.
