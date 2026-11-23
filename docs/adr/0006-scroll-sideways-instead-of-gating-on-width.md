# 0006: Scroll sideways instead of gating on the window width

**Status**: Accepted
**Date**: 2026-11-23
**Deciders**: (this session)
**Supersedes**: [0002](0002-keep-the-app-level-minimum-window-gate.md), in part

## Context

ADR 0002 kept an opaque, full-window overlay for a window below 900 × 620. Its
reasoning for refusing `window.minSize` still holds: the primary target is
Omarchy, where Hyprland tiles windows and the compositor, not the user, decides
the size. A compositor that ignores a hint leaves the app with no way to explain
itself, so the app explains itself instead.

The width half of that floor turned out to be the wrong answer, though. A
narrow window does not make the interface unusable; it makes it wider than what
is on screen. Refusing to render means a user on a tiled desktop can be locked
out of their own vault with no recourse but to resize a window the compositor
owns. Height has no equivalent answer, because the panes are vertical scroll
views themselves: a short window genuinely cannot lay them out.

## Decision

Gate on height only, and scroll sideways for width.

- `MIN_WINDOW_HEIGHT` (620) stays a window floor, under `ShortWindowGate`, which
  says the window is too short rather than too small.
- `MIN_WINDOW_WIDTH` becomes `MIN_LAYOUT_WIDTH` (900) and stops being a window
  floor. It is a content width: `shellContentWidth(windowWidth)` returns the
  window's width or this floor, whichever is larger.
- The root view's first child is a horizontal `Scroll` holding one `View` of
  that width. Below the floor the content keeps the floor width and the shell
  scrolls; above it the content follows the window as it always did.
- Every modal, the toast and the short-window gate stay outside the scroll view,
  laid out against the window.
- `nsh.json` still sets no `window.minSize`.

## Consequences

- No window is ever turned away for being narrow. The panes keep the width they
  need instead of being squeezed, and the overflow is reachable.
- A plain wheel does not scroll a horizontal view sideways. The user reaches the
  right-hand pane with Shift + wheel, the scrollbar, a trackpad's sideways
  gesture, or the keyboard, since NSH reveals a view on focus (`ViewRef.reveal()`
  places it `"nearest"` along horizontal scroll views). This is a real cost and
  was accepted rather than papered over with a new shortcut.
- Dialogs have to live outside the scroll view or they would drift away from the
  user when the content moves. That placement is load-bearing, not stylistic.
- The content view carries an explicit width because a horizontal scroll view
  lays its child out as wide as the child asks. `minWidth` on the content is not
  a documented way to widen a scroll view's content.
- ADR 0002's height half stands. Its width half does not.

## References

- App: `GLOSSARY.md` — `Short Window Gate`, `Shell Content Width`
- App: `ARCHITECTURE.md` §5.2 (Shell Overlay and Sideways Scrolling), §5.4
- App: `docs/specs/shell_navigation_and_narrow_windows_spec.md`
- NSH scrolling: `docs/scrolling` — horizontal scroll views, `contentStyle`,
  the keyboard, `reveal`
