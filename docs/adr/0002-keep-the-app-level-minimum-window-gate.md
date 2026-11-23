# 0002: Keep the app-level minimum-window gate on NSH 0.5

**Status**: Superseded by [0006](0006-scroll-sideways-instead-of-gating-on-width.md)
**Date**: 2026-11-17
**Deciders**: (this session)

> Kept for the record. ADR 0006 splits this decision in two: the height floor
> and its overlay stand, and the width floor became sideways scrolling.

## Context

`MinimumWindowGate` (`components/MinimumWindowGate.tsx`, `store/windowGate.ts`,
`theme/layout.ts`) is an opaque, full-window overlay shown when either dimension
of the window falls below the app's floor (900 × 620). It states the live size,
the required minimum, and a one-line instruction, and it has no dismiss action:
only resizing clears it.

The gate exists because NSH 0.4.0 had no native minimum window size. The upgrade
to NSH 0.5.1 adds one — `window.minSize` in `nsh.json`, and `minSize`/`maxSize`
on a window, both `{ width, height }` in points — so the reason the gate was
written no longer holds.

## Decision

Keep the gate, and do not declare `window.minSize`.

The primary desktop target is Omarchy, where windows are tiled by Hyprland: the
compositor sizes the window, not the user, so a size hint may be ignored. Where
a hint *is* honored, a native floor would make the gate unreachable and its
headless test vacuous; where it is ignored, the app would sit cramped with no
explanation. The gate is the explanation, and it holds either way.

## Consequences

- The floor stays one app-owned constant (`MIN_WINDOW_WIDTH` / `MIN_WINDOW_HEIGHT`
  in `theme/layout.ts`) that no window configuration can contradict.
- The gate is live code with a live test. It must not be "cleaned up" later as a
  workaround for a gap that no longer exists.
- If the app ever targets a platform whose compositor honors size hints and wants
  no overlay, revisit: set `window.minSize` and delete the gate in the same change.

## References

- App: `GLOSSARY.md` — `Minimum Window Gate`
- App: `docs/specs/nsh_0_5_1_migration_spec.md`
- NSH 0.5 `window.minSize` / `minSize`: `modules_nsh-desktop.md` (windows)
