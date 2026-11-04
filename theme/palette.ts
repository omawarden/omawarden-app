// Single source of every hex color literal used by the app.
// Components must never hardcode a color: they read a role from this module.

export interface SurfacePalette {
  background: string;
  text: string;
  border: string;
  selectedBackground: string;
  selectedText: string;
}

export interface ThemePalette {
  menu: SurfacePalette;
  popups: SurfacePalette;
  muted: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  purple: string;
}

export interface ThemePaletteOverrides {
  menu?: Partial<SurfacePalette>;
  popups?: Partial<SurfacePalette>;
  muted?: string;
  success?: string;
  warning?: string;
  danger?: string;
  info?: string;
  purple?: string;
}

export type Appearance = "dark" | "light";

const DARK_INK = "#090d16";
const LIGHT_INK = "#ffffff";

const DARK_SURFACES: Omit<ThemePalette, "success" | "warning" | "danger" | "info" | "purple"> = {
  menu: {
    background: "#1a1b26",
    text: "#c0caf5",
    border: "#292e42",
    selectedBackground: "#283457",
    selectedText: "#7aa2f7",
  },
  popups: {
    background: "#16161e",
    text: "#c0caf5",
    border: "#292e42",
    selectedBackground: "#283457",
    selectedText: "#7aa2f7",
  },
  muted: "#565f89",
};

const LIGHT_SURFACES: Omit<ThemePalette, "success" | "warning" | "danger" | "info" | "purple"> = {
  menu: {
    background: "#eff1f5",
    text: "#4c4f69",
    border: "#ccd0da",
    selectedBackground: "#dce0e8",
    selectedText: "#1e66f5",
  },
  popups: {
    background: "#e6e9ef",
    text: "#4c4f69",
    border: "#ccd0da",
    selectedBackground: "#dce0e8",
    selectedText: "#1e66f5",
  },
  muted: "#8c8fa1",
};

const SEMANTIC_DARK = {
  success: "#10b981",
  warning: "#f59e0b",
  danger: "#ef4444",
  info: "#3b82f6",
  purple: "#a855f7",
};

const SEMANTIC_LIGHT = {
  success: "#059669",
  warning: "#d97706",
  danger: "#dc2626",
  info: "#2563eb",
  purple: "#7c3aed",
};

function parseHex(hex: string): [number, number, number] {
  const clean = hex.trim().replace(/^#/, "");
  const expanded =
    clean.length === 3
      ? clean
          .split("")
          .map((character) => character + character)
          .join("")
      : clean.slice(0, 6);
  const value = Number.parseInt(expanded, 16);
  if (!Number.isFinite(value)) {
    return [0, 0, 0];
  }
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function channelToLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

function toHex(red: number, green: number, blue: number): string {
  const part = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  return `#${part(red)}${part(green)}${part(blue)}`;
}

/** WCAG 2.1 relative luminance of a hex color. */
export function relativeLuminance(hex: string): number {
  const [red, green, blue] = parseHex(hex);
  return (
    0.2126 * channelToLinear(red) +
    0.7152 * channelToLinear(green) +
    0.0722 * channelToLinear(blue)
  );
}

/** WCAG 2.1 contrast ratio between two hex colors (1 to 21). */
export function contrastRatio(hex1: string, hex2: string): number {
  const first = relativeLuminance(hex1);
  const second = relativeLuminance(hex2);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Whether a surface color is light enough to need dark ink. */
export function isLightSurface(hex: string): boolean {
  return relativeLuminance(hex) > 0.4;
}

function betterContrast(candidates: string[], background: string): string {
  let best = candidates[0];
  let bestRatio = contrastRatio(best, background);
  for (const candidate of candidates.slice(1)) {
    const ratio = contrastRatio(candidate, background);
    if (ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
  }
  return best;
}

/** Picks the dark or light ink with the higher contrast against a solid background. */
export function textOn(bgHex: string): string {
  return betterContrast([DARK_INK, LIGHT_INK], bgHex);
}

/** Blends `accentHex` over `bgHex` at `alpha`. */
export function tint(accentHex: string, bgHex: string, alpha = 0.15): string {
  const [ar, ag, ab] = parseHex(accentHex);
  const [br, bg, bb] = parseHex(bgHex);
  const amount = Math.max(0, Math.min(1, alpha));
  return toHex(
    ar * amount + br * (1 - amount),
    ag * amount + bg * (1 - amount),
    ab * amount + bb * (1 - amount),
  );
}

/** Readable text over a tinted chip, preferring at least 4.5:1 contrast. */
export function textOnTint(accentHex: string, bgHex: string, alpha = 0.15): string {
  const background = tint(accentHex, bgHex, alpha);
  const candidates = [accentHex, DARK_INK, LIGHT_INK];
  for (const candidate of candidates) {
    if (contrastRatio(candidate, background) >= 4.5) {
      return candidate;
    }
  }
  return betterContrast(candidates, background);
}

/** Readable body text inside a tinted alert banner. */
export function labelOnTint(
  accentHex: string,
  surfaceFgHex: string,
  bgHex: string,
  alpha = 0.15,
): string {
  const background = tint(accentHex, bgHex, alpha);
  const candidates = [surfaceFgHex, accentHex, DARK_INK, LIGHT_INK];
  for (const candidate of candidates) {
    if (contrastRatio(candidate, background) >= 4.5) {
      return candidate;
    }
  }
  return betterContrast(candidates, background);
}

function semanticFor(menuBackground: string) {
  return isLightSurface(menuBackground) ? SEMANTIC_LIGHT : SEMANTIC_DARK;
}

/** The palette preset for an appearance. */
export function paletteFor(appearance: Appearance): ThemePalette {
  const surfaces = appearance === "light" ? LIGHT_SURFACES : DARK_SURFACES;
  return {
    ...surfaces,
    ...semanticFor(surfaces.menu.background),
  };
}

/** Merges live host theme overrides over a preset. */
export function mergePalette(
  base: ThemePalette,
  overrides?: ThemePaletteOverrides,
): ThemePalette {
  if (!overrides) {
    return base;
  }
  const merged: ThemePalette = {
    ...base,
    menu: { ...base.menu, ...(overrides.menu ?? {}) },
    popups: { ...base.popups, ...(overrides.popups ?? {}) },
  };
  if (overrides.muted !== undefined) merged.muted = overrides.muted;
  if (overrides.success !== undefined) merged.success = overrides.success;
  if (overrides.warning !== undefined) merged.warning = overrides.warning;
  if (overrides.danger !== undefined) merged.danger = overrides.danger;
  if (overrides.info !== undefined) merged.info = overrides.info;
  if (overrides.purple !== undefined) merged.purple = overrides.purple;
  return merged;
}

/** The strength label for an entropy in bits. */
export function strengthLabel(entropy: number): string {
  if (entropy < 40) return "Weak";
  if (entropy < 60) return "Fair";
  if (entropy < 80) return "Good";
  if (entropy < 100) return "Strong";
  return "Very Strong";
}

/** The semantic color for an entropy in bits. */
export function strengthColor(entropy: number, appearance: Appearance = "dark"): string {
  const palette = paletteFor(appearance);
  if (entropy < 40) return palette.danger;
  if (entropy < 60) return palette.warning;
  if (entropy < 80) return palette.info;
  if (entropy < 100) return palette.success;
  return palette.purple;
}
