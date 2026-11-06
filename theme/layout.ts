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

/** The gutter that keeps a field label clear of its value. */
export const LABEL_GUTTER_WIDTH = 132;

/** The gutter that keeps a generator control's label clear of its input. */
export const GENERATOR_LABEL_WIDTH = 130;

/** The wide field used for a long single-line setting. */
export const WIDE_INPUT_WIDTH = 160;

/** One cell of the one-time-code input. */
export const OTP_CELL_WIDTH = 40;

/** One cell of the one-time-code input. */
export const OTP_CELL_HEIGHT = 44;

/** The shortest a single-line input renders. */
export const INPUT_MIN_HEIGHT = 36;

/** The frame around the footer's sync spinner. */
export const SYNC_INDICATOR_SIZE = 14;

/** The website icon at the start of a vault row. */
export const VAULT_ICON_SIZE = 16;

/**
 * A length at `scale`, rounded to whole points and never below 1. Use it for
 * the widths that exist to make room for text, not for padding or gaps.
 */
export function scaleLength(points: number, scale: number): number {
  return Math.max(1, Math.round(points * scale));
}

/**
 * The vault list width for a window width: the preferred share of the window,
 * clamped to the sidebar's range and rounded to whole points.
 *
 * It follows the window alone. Enlarging the text grows the rows' contents,
 * but a wider sidebar would eat the detail pane and would also raise the
 * window size the shell needs, so the text size does not move it.
 */
export function sidebarWidth(windowWidth: number): number {
  const preferred = windowWidth * SIDEBAR_WIDTH_RATIO;
  const clamped = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, preferred));
  return Math.round(clamped);
}

/**
 * The smallest window the shell can lay out.
 *
 * It is a fixed floor: the text size changes how the shell fills a window,
 * never how large a window it needs, so 400% fits wherever 100% does.
 */
export function minimumWindowSize(): Size {
  return { width: MIN_WINDOW_WIDTH, height: MIN_WINDOW_HEIGHT };
}

/** Whether a window is too small for the shell to show without clipping. */
export function windowTooSmall(size: Size): boolean {
  const minimum = minimumWindowSize();
  return size.width < minimum.width || size.height < minimum.height;
}
