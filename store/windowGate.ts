import { windowSize } from "nsh";
import { windowTooSmall } from "../theme/layout";

// The one predicate the gate and every keyboard path read. It stays a
// function rather than a stored signal: window size is already reactive, so
// nothing about geometry needs to be cached.
export function windowBelowMinimum(): boolean {
  return windowTooSmall(windowSize());
}
