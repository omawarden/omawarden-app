import { windowSize } from "nsh";
import { windowTooShort } from "../theme/layout";

// The one predicate the short-window gate and every keyboard path read. It
// stays a function rather than a stored signal: window size is already
// reactive, so nothing about geometry needs to be cached.
//
// Width is not part of the question any more. A window too narrow for the
// shell keeps the shell at its floor width and scrolls sideways instead of
// turning the interface away (ADR 0006). Height has no such answer, because the
// panes are vertical scrolls themselves, so only a taller window clears it.
export function windowTooShortForShell(): boolean {
  return windowTooShort(windowSize());
}
