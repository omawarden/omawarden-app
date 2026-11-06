import { windowSize } from "nsh";
import { totalScale } from "./appStore";
import { windowTooSmall } from "../theme/layout";

// The one predicate the gate and every keyboard path read. It stays a
// function rather than a stored signal: window size and the text factor are
// already reactive, so nothing about geometry needs to be cached.
export function windowBelowMinimum(): boolean {
  return windowTooSmall(windowSize(), totalScale());
}

// True when the window fits at 100% but not at the current text factor, so
// lowering the text size is what clears the gate. A window too small even at
// 100% needs a resize, not a reset.
export function textSizeBlocksWindow(): boolean {
  const size = windowSize();
  return !windowTooSmall(size, 1) && windowTooSmall(size, totalScale());
}
