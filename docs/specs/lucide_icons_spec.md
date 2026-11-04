# Omawarden App: Lucide Icons Migration Specification

> **Target Repository**: `omawarden/omawarden-app`  
> **Status**: Ready for Implementation  
> **Primary Goal**: Replace all FontAwesome / Unicode private-use glyphs (`\uf0c5`, `\uf084`, etc.) with Lucide vector SVG icons via a unified, theme-aware `<Icon />` component.

---

## 1. Problem Statement
The app currently attempts to render FontAwesome glyphs using unicode strings (e.g. `\uf0c5`, `\uf084`, `\uf007`). In NSH / Linux GTK desktop environments without FontAwesome installed, these render as missing character boxes (tofu / unprintable glyphs).

## 2. Architecture & Implementation Plan

### 2.1 Unified `<Icon />` Component (`components/Icon.tsx`)
Create a single, lightweight icon component:
```tsx
import { Image, type ColorValue } from "nsh";

export type IconName =
  | "copy"
  | "eye"
  | "eye-off"
  | "external-link"
  | "refresh-cw"
  | "key"
  | "user"
  | "clock"
  | "lock"
  | "settings"
  | "search"
  | "x"
  | "plus"
  | "terminal"
  | "credit-card"
  | "file-text"
  | "folder"
  | "zap"
  | "history"
  | "download"
  | "check"
  | "shield";

interface IconProps {
  name: IconName;
  size?: number;
  color?: ColorValue;
  style?: import("nsh").StyleProp<import("nsh").ImageStyle>;
  testID?: string;
}
```

### 2.2 SVG Path Engine
Store Lucide icon paths cleanly. Lucide icons are defined on a `24x24` viewBox with `stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"`.
Encode them into clean SVG data URIs:
```ts
function svgUri(innerSvg: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${innerSvg}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
```
And render using `<Image src={svgUri(...)} style={{ width: size, height: size, tintColor: color, ...style }} />`.  
Because NSH's `ImageStyle` supports `tintColor`, the white (`#FFFFFF`) stroke will be tinted cleanly to any theme color (`palette().muted`, `palette().accent`, `palette().danger`, etc.)!

### 2.3 Component Replacements
1. **`components/GhostIconButton.tsx`**:
   - Change `iconText: string` to `icon: IconName`.
   - Render `<Icon name={props.icon} size={props.size ?? 14} color={hovered() ? props.hoverColor : props.color} />`.
2. **`components/ItemInspector.tsx`**:
   - Copy actions: `copy`
   - Password reveal/hide: `eye` / `eye-off`
   - TOTP copy: `copy`
   - Attachment download: `download`
   - URL open: `external-link`
   - Refresh: `refresh-cw`
3. **`components/ActionPaletteModal.tsx`**:
   - Replace unicode glyph strings with corresponding `IconName`.
4. **`components/FooterBar.tsx`**:
   - Actions: `zap`
   - Generator: `key`
   - Sync: `refresh-cw`
   - Lock: `lock`
   - Settings: `settings`
5. **`components/SearchHeader.tsx`**:
   - Search: `search`
   - Clear input: `x`
   - Category SSH Key actions: `plus` (generate) and `download` (import)
6. **`components/VaultItemList.tsx`**:
   - Default category fallback icons: `key` (login), `credit-card` (card), `user` (identity), `file-text` (note), `terminal` (sshKey).

---

## 3. Verification Criteria
- `nsh check` and `bun run check` pass without type errors.
- `nsh test` passes.
- Live test via `nsh run`: every button and item displays a vector Lucide icon with proper size and tint color, with ZERO missing glyph boxes.
