// Single source of every text size the interface uses.
// Components read a step from this ladder rather than hardcoding a number,
// the same way they read a colour from the palette module.

import { scaleLength } from "./layout";

/** The thirteen named steps of the type scale, from smallest to largest. */
export type TypeStep =
  | "2xs"
  | "xs"
  | "sm"
  | "base"
  | "md"
  | "lg"
  | "xl"
  | "2xl"
  | "3xl"
  | "4xl"
  | "5xl"
  | "6xl"
  | "7xl";

/** A font size in points for every step of the scale. */
export type TypeScale = Record<TypeStep, number>;

/** The base ladder, in points, before any font scale is applied. */
export const TYPE_SCALE: TypeScale = {
  "2xs": 9,
  xs: 10,
  sm: 11,
  base: 12,
  md: 13,
  lg: 14,
  xl: 15,
  "2xl": 16,
  "3xl": 17,
  "4xl": 18,
  "5xl": 20,
  "6xl": 24,
  "7xl": 28,
};

/**
 * The type scale at `factor`, rounded to whole points and never below 1.
 *
 * The result is pure so it can be tested without a window; the reactive
 * `type()` accessor in the store applies the app's own factor here.
 */
export function scaleType(factor: number): TypeScale {
  const scale = (points: number) => scaleLength(points, factor);
  return {
    "2xs": scale(TYPE_SCALE["2xs"]),
    xs: scale(TYPE_SCALE.xs),
    sm: scale(TYPE_SCALE.sm),
    base: scale(TYPE_SCALE.base),
    md: scale(TYPE_SCALE.md),
    lg: scale(TYPE_SCALE.lg),
    xl: scale(TYPE_SCALE.xl),
    "2xl": scale(TYPE_SCALE["2xl"]),
    "3xl": scale(TYPE_SCALE["3xl"]),
    "4xl": scale(TYPE_SCALE["4xl"]),
    "5xl": scale(TYPE_SCALE["5xl"]),
    "6xl": scale(TYPE_SCALE["6xl"]),
    "7xl": scale(TYPE_SCALE["7xl"]),
  };
}

/**
 * The note body's leading as a multiple of the `md` step: 19 points at 13.
 * The ladder has no 19-point step, so the leading follows the text it sets.
 */
const NOTE_LINE_HEIGHT_RATIO = 19 / TYPE_SCALE.md;

/** The note body's leading at a scaled ladder, rounded and floored at 1. */
export function noteLineHeight(scale: TypeScale): number {
  return Math.max(1, Math.round(scale.md * NOTE_LINE_HEIGHT_RATIO));
}
