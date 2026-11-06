// Single source of every layout size the shell depends on.
// Components must never hardcode a size: they read a constant or a function
// from this module, the same way they read a colour from the palette module.

import type { Size } from "nsh";

/** The narrowest the vault list ever renders. */
export const SIDEBAR_MIN_WIDTH = 320;

/** The widest the vault list ever renders. */
export const SIDEBAR_MAX_WIDTH = 560;

/** The share of the window the vault list asks for before clamping. */
export const SIDEBAR_WIDTH_RATIO = 0.3;

/** The narrowest window the shell can lay out without clipping. */
export const MIN_WINDOW_WIDTH = 900;

/** The shortest window the shell can lay out without clipping. */
export const MIN_WINDOW_HEIGHT = 620;

/** The widest the detail pane's content column grows. */
export const DETAIL_CONTENT_MAX_WIDTH = 900;

/** The widest the empty detail state's reading column grows. */
export const EMPTY_STATE_MAX_WIDTH = 420;

/**
 * The vault list width for a window width: the preferred share of the window,
 * clamped to the sidebar's range and rounded to whole points.
 *
 * `fontScale` is the future type-scale feature's one place to multiply. It is
 * 1 today, and it multiplies the clamped base, so a larger scale grows the
 * whole sidebar proportionally instead of moving where the clamps sit.
 */
export function sidebarWidth(windowWidth: number, fontScale = 1): number {
  const preferred = windowWidth * SIDEBAR_WIDTH_RATIO;
  const clamped = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, preferred));
  return Math.round(clamped * fontScale);
}

/** Whether a window is too small for the shell to show without clipping. */
export function windowTooSmall(size: Size): boolean {
  return size.width < MIN_WINDOW_WIDTH || size.height < MIN_WINDOW_HEIGHT;
}
