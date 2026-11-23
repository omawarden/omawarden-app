# Shell Navigation and Narrow Windows

## Problem Statement

A user who unlocks the vault gets two columns: an Item List and an inspector.
Everything else — the vault scope, the folder filter, the Trash, the account —
is behind a transient dropdown opened from the search row. The dropdown covers
the top of the workspace, mixes three unrelated lists in one panel, and leaves
only one line of text to say which filter is active.

At the same time the app refuses to show itself below 900 × 620. An opaque
overlay covers the whole window with "Window too small" and there is nothing the
user can do but resize. On a tiled desktop the compositor often decides the
window's size, so a user can be locked out of their own vault with no way to
scroll to the part they need.

## Solution

Give the workspace a Navigation Sidebar as standing furniture on the left: app
icon and name, the vaults (organizations included), the folders, the Trash, and
the signed-in account with a settings gear. It has exactly two states, expanded
and collapsed, and collapsed is pixel-for-pixel today's layout with no rail.

Replace the minimum-window gate with sideways scrolling. A window narrower than
the layout keeps the layout at its floor width and scrolls horizontally, so the
interface never turns the user away for being too narrow. Height keeps a floor,
because the panes are vertical scrolls themselves and there is no equivalent
answer for height.

## User Stories

1. As a person with several vaults, I want to see all my vaults at once in a
   sidebar, so that switching vaults is one click instead of opening a dropdown.
2. As an organization member, I want my organizations listed beside my personal
   vault, so that I can tell which vault a filter applies to.
3. As a person with many folders, I want the folder list in the sidebar, so that
   I do not have to open a panel to change folders.
4. As a person who uses the Trash, I want a Trash row that is always visible, so
   that restoring an item is not buried in a menu.
5. As a signed-in user, I want to see which account and server I am connected to,
   so that I do not act on the wrong vault.
6. As a signed-in user, I want a settings gear beside my account, so that
   settings is reachable from where account things live.
7. As a person who prefers a wide list, I want to collapse the sidebar, so that
   the list and the inspector get the whole window.
8. As a person who prefers the sidebar, I want it to stay expanded across
   restarts, so that I do not re-open it on every launch.
9. As a keyboard user, I want a shortcut that toggles the sidebar, so that I can
   change the layout without reaching for the mouse.
10. As a keyboard user, I want the sidebar's rows in the Tab ring, so that I can
    reach a vault or folder by keyboard alone.
11. As a person on a small window, I want the layout to fall back to collapsed
    instead of breaking, so that the app stays usable.
12. As a person on a small window, I want the toggle to explain why it is
    disabled, so that I understand why the sidebar will not open.
13. As a person who narrows the window, I want my expanded preference kept, so
    that widening it again restores what I chose.
14. As a person on a very narrow window, I want to scroll sideways, so that I can
    still reach the inspector instead of being blocked by an overlay.
15. As a person on a very short window, I want a clear explanation of the height
    floor, so that I know what to fix.
16. As a person resizing the window, I want the app to keep whatever I typed,
    so that a resize does not lose my work.
17. As a person with a dialog open, I want it to stay centred in what I can see,
    so that a narrow window does not push it off-screen.
18. As a person with a dialog open, I want the dialog to stay put while the page
    scrolls sideways, so that an overlay never moves away from me.
19. As a person who drags the divider, I want my width kept as the window
    changes, so that the layout does not fight me.
20. As a person who never drags the divider, I want the list width to follow the
    window, so that I get a sensible default for free.
21. As a person using a mouse without a horizontal wheel, I want to reach the
    right-hand pane by keyboard and by the scrollbar, so that sideways scrolling
    is not limited to a trackpad.
22. As a person who filters by vault and folder together, I want both rows
    highlighted, so that I can see exactly which intersection I am looking at.
23. As a person who opens the Trash, I want the vault and folder rows to dim
    rather than vanish, so that the sidebar does not jump while I am in it.
24. As a person whose vault has no folders, I want the sidebar to still show the
    Folders heading with a hint, so that the layout does not shift after a sync.
25. As a person with a long vault or folder name, I want it truncated to one line
    with a tooltip, so that row heights stay consistent.
26. As a person enlarging the text, I want the window's requirements to stay the
    same, so that a fitting window never becomes "too small" because of my text
    size.
27. As a person who has never opened the sidebar, I want it expanded on first
    launch, so that I discover the feature.
28. As a reader of the codebase, I want the item list's width helpers named after
    the item list, so that "sidebar" only ever means the Navigation Sidebar.

## Implementation Decisions

### Layout and geometry

- The workspace becomes a row: the Navigation Sidebar column, then a content
  column that stacks the search row, the category tabs, the two panes and the
  footer. The sidebar is full height; the search row, tabs and footer stop at
  its right edge, so the left column reads as navigation.
- The sidebar's width is a fixed constant and is **not** scaled by the text
  size. A column width is not a length that makes room for text, unlike the
  label gutters. Long names truncate to one line with a tooltip. This is what
  keeps the threshold valid at every text size.
- Renames in `theme/layout.ts`: the existing `SIDEBAR_*` constants and
  `sidebarWidth()` already mean the Item List, so they become `ITEM_LIST_MIN_WIDTH`
  (320), `ITEM_LIST_MAX_WIDTH` (560), `ITEM_LIST_WIDTH_RATIO` (0.3) and
  `itemListWidth(width)`. New: `NAV_SIDEBAR_WIDTH` (240).
- `MIN_WINDOW_WIDTH` becomes `MIN_LAYOUT_WIDTH` (900) and stops being a window
  floor. `MIN_WINDOW_HEIGHT` (620) stays a floor. New predicates:
  `sidebarForcedCollapsed(width)`, `shellContentWidth(width)`,
  `minimumWindowHeight()`, `windowTooShort(size)`.

### Expanded vs collapsed

- One boolean, `sidebarCollapsed`, defaulting to `false`, persisted in `ui.json`
  through the app's existing Rust preferences bridge (not NSH `Storage`, which is
  async).
- There is no third state: no rail, no icon-only strip, no hover target.
- The only control is one toggle at the left of the search row; the sidebar's
  head has none. `Ctrl+\` does the same.
- Collapsing also closes the scope dropdown, whose open/closed signal outlives
  the component; a dropdown left open behind a hidden sidebar would still answer
  `Esc`.
- Below `NAV_SIDEBAR_MIN_WINDOW_WIDTH` (1140) the workspace renders collapsed
  whatever the preference says, and returns to the preference when the window
  grows. The stored preference is never rewritten by a resize. While forced, the
  toggle is disabled with the tooltip "Widen the window to show the sidebar".
  The arithmetic, from the 900-wide layout's 550-point inspector:
  `900 − 20 padding − 320 list − 10 gap = 550`, then
  `240 sidebar + 20 padding + 320 list + 9 handle + 550 inspector = 1139`,
  rounded up to 1140.

### Who owns the Item List's width

- Expanded, a `ResizablePanelGroup` holds exactly two panels — the Item List and
  the inspector — so there is one draggable boundary and the sidebar stays a
  plain fixed column. The list panel is 320–560 wide.
- The group has no controlled `sizes` prop, so the store keeps
  `itemListPanelWidth: number | null` (`null` = follow the curve) and a computed
  `itemListPanelSize`. The first completed drag stores the reported width; from
  then on a window resize leaves the user's width alone.
- Collapsed, the group is not rendered at all: the panes are the plain row the
  app has always drawn, with the list reading `itemListWidth(window)`.

### Sidebar contents and selection rules

- Head: the app icon (28pt) and `Omawarden`. Neither is a control.
- Middle, scrolling: a `VAULTS` group (every scope in projection order —
  `All Vaults` with a shield, `My Vault` with a person, one row per organization
  with a building) and a `FOLDERS` group (`All Folders` reset row, then every
  folder). Both groups always render; an empty group keeps its heading and shows
  a muted one-line hint.
- Foot, fixed: the Trash row, then the account row (initial avatar, email, server
  host) with the settings gear on the right. The account row is not clickable.
- Vault and folder are independent dimensions and may both highlight; the list
  shows their intersection.
- The Trash is a view, not a scope. While it is open neither group highlights and
  both draw at reduced opacity; folder rows stay clickable and leave the Trash
  through the store's existing entry point.
- Every row goes through the store's existing `setScope` / `setFolder` /
  `openTrash`, so the Inspector Form's leave guard keeps working unchanged.

### Replacing the minimum-window gate

- Delete `components/MinimumWindowGate.tsx` and `store/windowGate.ts`, the
  `whenWindowFits` wrappers and every `windowBelowMinimum()` check in
  `App.tsx`, `ActionPaletteModal`, `TypePickerModal` and `SearchHeader`. Those
  checks existed only because an overlay covered the interface; with the gate
  reduced to a height check they are kept but renamed to the height question
  (`whenWindowTallEnough`, `windowTooShortForShell()`), because the overlay still
  covers the interface when it is too short.
- `nsh.json` sets no `window.minSize`, before or after.
- A new `ShortWindowGate` shows "Window too short", the live height, the minimum
  height and a one-line instruction. It has no controls; only a taller window
  clears it. It stays an overlay, so the views beneath keep their state.
- The root becomes a column: a horizontal `Scroll` holding a content view whose
  width is `shellContentWidth(windowSize().width)` — the window's width, or the
  900-point floor, whichever is larger. The content keeps that width and scrolls
  sideways, so the shell never reflows below what its panes need.
- Modals, the toast and the short-window gate stay **outside** the scroll, laid
  out against the window, so a dialog is centred in what the user can see and
  does not drift when the content scrolls.
- The documented way to give a horizontal `Scroll` a wide content is a child of
  fixed width; `minWidth` on the content is not documented to be honoured.
  Implementation must therefore use the fixed-width child, not `minWidth`.
- Known usability cost, accepted: a plain wheel does not scroll a horizontal
  scroll view sideways. The user reaches the right-hand pane with Shift+wheel,
  the scrollbar, a trackpad's sideways gesture, or the keyboard — NSH scrolls a
  focused view into view inside the scroll views around it. No extra shortcut is
  added in this change.

### Naming

- `store/shellScroll.ts` owns `windowTooShortForShell()`, the one predicate the
  gate and every keyboard path read.

## Testing Decisions

Tests assert external behaviour: what renders, what the user can press, what
`ui.json` round-trips, what a pure function returns. No test reaches into a
component's internals or asserts a private signal.

Four existing seams, no new ones:

1. **`theme/layout.test.ts`** — pure functions. `itemListWidth` keeps every curve
   and clamping assertion under its new name; adds the two constants,
   `sidebarForcedCollapsed` at both sides of 1140, `shellContentWidth` at and
   below the floor, and `windowTooShort` proving width no longer participates and
   height does at 619/620/621.
2. **`App.test.tsx`** — headless end to end, the highest seam and where most new
   coverage belongs. The three helpers inject `uiPrefs: { sidebarCollapsed: true }`
   so all existing cases keep running the collapsed layout and keep their
   assertions; so must the one case that calls `open` directly to test preference
   reload. New cases: the sidebar lists vaults, folders and the Trash; a vault row
   filters the list; a folder row filters it; both highlight together; the Trash
   row clears both highlights; the toggle collapses and expands; `Ctrl+\` does the
   same; collapsing restores the full-width search row; a narrow window disables
   the toggle and renders collapsed with the preference untouched; the preference
   survives a relaunch; a too-narrow window keeps the content at the floor width
   instead of gating.
3. **`src/ui_prefs.rs`** — the `ui.json` round trip: a missing file and a missing
   key both fall back to expanded, a written value reads back, a malformed file
   falls back, and the file stays private (`0600`). Prior art: the existing
   `fontScale` round-trip and clamping cases.
4. **`src/lib.rs`** — the mock bridge's `get_ui_prefs` / `update_ui_prefs` carry
   the new field through `mockState.uiPrefs`, as `theme` and `fontScale` already
   do.

Rewriting the gate's cases: the component is deleted, so its testIDs go with it
rather than being silently reused. The replacement asserts the same intent — the
keyboard is inert while the overlay is up, dialogs and form input stay mounted,
and clearing happens by resizing — under the height gate. A 800 × 600 window
still trips it, because 600 is below the 620 height floor.

## Out of Scope

- No rail or icon-only collapsed state.
- No keyboard shortcut for jumping between the sidebar's groups.
- No collections group: the projection yields `all`, `personal` and organizations
  only.
- No sidebar in the login, two-factor, locked or dependency-check phases.
- No animation on expand/collapse.
- No new horizontal-scrolling shortcut; the existing means are relied on first,
  and a shortcut may be added later if they prove insufficient.
- No two-axis scrolling: height keeps a floor.
- No `window.minSize` in `nsh.json`.

## Further Notes

- The detailed design, layout diagram and testID contract live in
  `docs/specs/navigation_sidebar_spec.md`; the decisions and rejected options in
  `docs/adr/0005-navigation-sidebar-and-narrow-window-collapse.md`. This change
  supersedes ADR 0002.
- `ResizablePanelGroup` gives no controlled `sizes` and no documented hide/show
  transition, which is why the collapsed state unmounts the group rather than
  hiding a panel, and why the user's dragged width has to be remembered by the
  store.
- The sidebar must be declared before the content column to draw on the left,
  which makes its rows the Tab ring's first stop. The existing Tab test changes
  its landing spot while keeping its intent.
