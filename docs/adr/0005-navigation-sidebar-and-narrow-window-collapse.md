# 0005: A navigation sidebar, and collapsing it on narrow windows

**Status**: Accepted
**Date**: 2026-11-23
**Deciders**: (this session)

## Context

The unlocked workspace is two columns — the item list and the inspector — with
the vault scope, the folder filter and the Trash behind a transient dropdown
opened from the search row. `docs/specs/navigation_sidebar_spec.md` gives the
sidebar that replaces it standing furniture on the left.

Two consequences needed deciding rather than assuming.

**Window floor versus the third column.** `MIN_LAYOUT_WIDTH` is 900, and
`GLOSSARY.md` used to say the gate "does not collapse the sidebar, reflow the
workspace, or report an error" — written when the item list was the only
sidebar. A 240-point navigation column beside a 320-point item list leaves the
inspector ~300 points at that floor, which is not a usable detail pane.

**Who owns the item list's width.** `theme/layout.ts` computed it as a pure
function of the window (`sidebarWidth`), and no signal stored geometry.

## Decision

The sidebar has exactly two states, expanded and collapsed, held in
`UiPrefsView.sidebarCollapsed` and **defaulting to expanded**. Collapsed is the
layout the app has today, with no rail.

Below `NAV_SIDEBAR_MIN_WINDOW_WIDTH` (1140 — the width at which the inspector
still has the 550 points it has at the 900 floor today) the workspace renders
collapsed whatever the preference says, and expands again when the window
grows. The preference is never rewritten by the geometry; the toggle is shown
disabled rather than hidden, with a tooltip naming the reason.

Expanded, the workspace is a row of two columns: the sidebar, and a content
column stacking the search row, the tabs, the panes and the footer. The sidebar
is a **plain fixed column**, not a member of the group. That is what makes the
search row and the category tabs stop at its right edge — inside a group the
sidebar could only span it, not sit beside it — and it keeps the group's single
handle where it belongs.

The two content panes come from `ResizablePanelGroup` (`nsh/base`), which gives
a draggable splitter and per-panel `minSize`/`maxSize` on Linux as well as
elsewhere. The group holds only the item list and the inspector, so there is
exactly one handle and no second one beside the sidebar. The group also offers
`visible` for hiding a panel, but that is not what the collapse uses: collapsed,
neither the sidebar nor the group is rendered at all and the workspace returns
to the plain row it has today, so only one geometry model is ever live.

Because the group exposes no controlled `sizes` prop, the store tracks the item
list's width in a signal: it follows `itemListWidth(window)` until the user first
drags, and the user's width wins afterwards.

## Consequences

- `GLOSSARY.md`'s gate paragraph and the `Minimum Window Gate` entry gain the
  collapse: a narrow window may now render the workspace collapsed. The gate
  still never resizes the window nor asks the compositor for a minimum, so
  ADR 0002 stands unamended.
- A window between 900 and 1140 wide renders collapsed. That is the price of
  keeping the inspector usable at the floor; raising the floor instead would
  have made small and tiled windows hit the gate far more often.
- `theme/layout.ts`'s `SIDEBAR_*` names mean the item list throughout, so they
  are renamed to `ITEM_LIST_*` and `sidebarWidth` to `itemListWidth`. The
  sidebar takes `NAV_SIDEBAR_*`.
- The item list's width is no longer purely a function of the window: it is a
  panel size that starts at the function's value and then belongs to the user.
  `itemListWidth` keeps its curve and its tests as the initial value.
- `NAV_SIDEBAR_WIDTH` is fixed at 240 and does not follow the text size, for the
  same reason `itemListWidth` does not: a column width is not a length that
  makes room for text. Long names truncate with a tooltip, and a window that
  fits at 100% still fits at 400%, so the 1140 threshold stays true.
- The sidebar is declared before the content column, so it is drawn on the left
  and its rows join the Tab ring before the search field. Tab's first stop is
  therefore the search row's own sidebar toggle, not the vault rows: the toggle
  is the first control the content column renders. One existing Tab test changes
  its landing spot, not its intent.
- `SearchHeader`'s scope trigger is a component of its own (`ScopeTrigger`) for
  the same reason, inverted: a `useAction` in `SearchHeader`'s body would run
  before any of its children and put the trigger at the head of the ring, ahead
  of the toggle drawn to its left.
- The collapsed layout still renders `VaultItemList` directly, so the two
  layouts do not share a geometry model and neither can drift from the other's
  assumptions.

## Considered Options

- **Raise `MIN_WINDOW_WIDTH` to 1140.** Would keep three columns everywhere, but
  makes the gate more frequent on the Omarchy/Hyprland tiling target where the
  compositor, not the user, sizes the window.
- **Default collapsed.** Would have kept every existing test untouched, but a
  new capability that no one sees is not shipped. The test suite is instead
  pinned to the collapsed layout through the mock's `uiPrefs`.
- **A plain `View` row, no splitter.** Simpler and test-free, but the platform
  already offers fixed, draggable and hideable panels; hand-rolling a full-window
  layout on top of that would have been the deliberate deviation, not this.
- **The sidebar as a `fixed` panel inside the group.** Rejected: a `fixed`
  panel is still draggable, so it would not stay 240 wide, and a third panel
  adds a second handle — 9 more points — which breaks the 1140 arithmetic. It
  would also prevent the search row and the tabs from stopping at the sidebar's
  edge.
- **`SplitView`.** Rejected: it requires `NavStack` per column and has no
  draggable splitter.

## References

- App: `docs/specs/navigation_sidebar_spec.md`
- App: `GLOSSARY.md` — `Navigation Sidebar`, `Item List`, `Short Window Gate`
- ADR 0002 — the app-level minimum-window gate
- NSH `ResizablePanelGroup` / `ResizablePanel`: `nsh/base`
