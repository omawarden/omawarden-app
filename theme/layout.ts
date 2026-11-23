// Single source of every layout size the shell depends on.
// Components must never hardcode a size: they read a constant or a function
// from this module, the same way they read a colour from the palette module.

import type { Size } from "nsh";

/** The narrowest the Item List ever renders. */
export const ITEM_LIST_MIN_WIDTH = 320;

/** The widest the Item List ever renders. */
export const ITEM_LIST_MAX_WIDTH = 560;

/** The share of the window the Item List asks for before clamping. */
export const ITEM_LIST_WIDTH_RATIO = 0.3;

/**
 * The Navigation Sidebar's width.
 *
 * A fixed column, deliberately not scaled by the text size: it is a width that
 * divides the window, not a length that makes room for text (contrast
 * `LABEL_GUTTER_WIDTH`). Long names truncate to one line with a tooltip
 * instead. Keeping it fixed is what makes `NAV_SIDEBAR_MIN_WINDOW_WIDTH` valid
 * at every text size.
 */
export const NAV_SIDEBAR_WIDTH = 240;

/**
 * The narrowest window that lays the workspace out with the sidebar expanded.
 *
 * Collapsed, `MIN_LAYOUT_WIDTH` gives the inspector 550 points:
 * `900 − 20 padding − 320 item list − 10 gap = 550`. Expanded pays for the
 * sidebar, a plain fixed column rather than a member of the resizable group, so
 * only the one handle between the list and the inspector is owed:
 * `240 sidebar + 20 padding + 320 list + 9 handle + 550 inspector = 1139`,
 * rounded up to 1140. Below it the workspace renders collapsed (ADR 0005).
 */
export const NAV_SIDEBAR_MIN_WINDOW_WIDTH = 1140;

/**
 * The narrowest width the shell lays out at without reflowing.
 *
 * It is a content width, not a window floor: a window narrower than this keeps
 * the content at this width and scrolls sideways, instead of turning the window
 * away (ADR 0006).
 */
export const MIN_LAYOUT_WIDTH = 900;

/** The shortest window the shell can lay out without clipping. */
export const MIN_WINDOW_HEIGHT = 620;

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
 * The Item List width for a window width: the preferred share of the window,
 * clamped to the list's range and rounded to whole points.
 *
 * It follows the window alone. Enlarging the text grows the rows' contents,
 * but a wider list would eat the detail pane and would also raise the window
 * size the shell needs, so the text size does not move it.
 */
export function itemListWidth(windowWidth: number): number {
  const preferred = windowWidth * ITEM_LIST_WIDTH_RATIO;
  const clamped = Math.min(ITEM_LIST_MAX_WIDTH, Math.max(ITEM_LIST_MIN_WIDTH, preferred));
  return Math.round(clamped);
}

/**
 * The content width the scrolling shell lays out at.
 *
 * A window wider than the floor fills it; a narrower one keeps the floor and
 * scrolls sideways, so the shell never reflows below the width its panes need.
 */
export function shellContentWidth(windowWidth: number): number {
  return Math.max(windowWidth, MIN_LAYOUT_WIDTH);
}

/**
 * The smallest height the shell can lay out.
 *
 * Width is no longer part of the floor: the shell scrolls sideways instead
 * (ADR 0006). Height has no such answer — the panes are vertical scrolls
 * themselves — so it stays a floor, and only a taller window clears it.
 */
export function minimumWindowHeight(): number {
  return MIN_WINDOW_HEIGHT;
}

/** Whether a window is too short for the shell to show without clipping. */
export function windowTooShort(size: Size): boolean {
  return size.height < MIN_WINDOW_HEIGHT;
}

/**
 * Whether a window is too narrow to lay the workspace out with the sidebar.
 *
 * Below this the sidebar renders collapsed whatever the preference says. The
 * preference itself is never rewritten: the layout falls back to what the app
 * has today and expands again when the window grows.
 */
export function sidebarForcedCollapsed(windowWidth: number): boolean {
  return windowWidth < NAV_SIDEBAR_MIN_WINDOW_WIDTH;
}
