# Navigation Sidebar in the GUI

## Status

Implemented. The sidebar, its two layouts and its tests are in place; this
document records the layout and the decisions behind it.

## Problem Statement

The unlocked workspace is two columns: the item list (`VaultItemList`) and the
inspector (`ItemInspector`), with the search row and the category tabs above
them and the footer below. Everything that is not the list or the inspector is
reached through that furniture:

- the vault scope and the folder filter live behind a toggle
  (`SearchHeader`'s `Scope: …` button, which opens `ScopeDropdown`);
- the Trash is the last row of that same dropdown;
- settings is one of six footer buttons.

The scope dropdown is the odd one out. It is a transient panel covering the top
of the workspace, it holds three unrelated lists (vaults, folders, Trash), and
the only sign of the current filter once it closes is a single line of text on
the trigger. A vault and folder are not per-item actions; they are the axis the
whole workspace is read along, and they deserve standing furniture.

## Decision

The unlocked workspace gains a **Navigation Sidebar**: a third column on the
left, holding the vaults, the folders, the Trash, and the account, that is
either expanded or collapsed. Collapsed, the workspace is the layout the app has
today, pixel for pixel. Expanded, the sidebar takes the place of the scope
dropdown and the scope trigger.

The sidebar is a *fourth* region, not a restyle of the item list: the item list
keeps its own column inside the content area, beside the inspector.

## Layout

Expanded, the window is a row whose left column runs the full height between the
window's edges, and whose right column stacks the search row, the category tabs,
and the two content panes:

```
┌────────────┬─────────────────────────────┐
│ icon name  │ [▤]  search                  │  SearchHeader
│            ├─────────────────────────────┤
│ VAULTS     │ All Logins Cards Identities │  CategoryTabBar
│  All Vaults├──────────────┬──────────────┤
│  My Vault  │              │              │
│  Acme      │  item list   │  inspector   │
│ FOLDERS    │              │              │
│  All       │              │              │
│  Work      │              │              │
├────────────┤              │              │
│  Trash     │              │              │
├────────────┤              │              │
│ me@ex… ⚙   │              │              │
│            ├──────────────┴──────────────┤
│            │ Actions Generate Sync Lock  │  FooterBar
└────────────┴─────────────────────────────┘
```

The sidebar reaches the window's bottom-left corner on its own; `FooterBar`
occupies the bottom of the content column only, with all six buttons (including
`Settings`) as today. The sidebar gear is a second entrance to the same dialog;
neither is removed.

Collapsed, the row has one column and the window is exactly today's layout: the
search row and category tabs span the full width, the list and inspector are the
two panes, and the footer spans the bottom.

The sidebar is **full height** and the search row and category tabs stop at its
right edge. That is what makes the left column read as navigation rather than as
a card floating between two full-width bars. `FooterBar` spans only the content
area, so the sidebar's own foot is the bottom-left corner of the window; the
footer keeps every button it has today, `Settings` included.

## Sidebar Contents

Top to bottom, four bands: the head, the scrolling middle, the Trash, and the
account. Everything but the middle is fixed. The Trash sits between the scroll
and the account rather than inside either: it ends the list of places, so it
takes no rule of its own and reads as the list's last row, while the rule below
it separates the account, which alone is the column's foot. It stays put the way
the foot does and does not scroll away with a long folder list.

**Head** — the app icon (`assets/icon.png`, imported as an asset, 28pt scaled by
`scaleLength`) beside the word `Omawarden`. Neither is a control.

**Middle** — one `Scroll` (`flex: 1`), because the folder list has no bound,
holding two labelled groups:

- `VAULTS`: every `snapshot.scopes` entry in projection order — `All Vaults`
  (`shield`), `My Vault` (`user`), then one row per organization (`building`).
  Each row carries its count.
- `FOLDERS`: an `All Folders` reset row (`folderId === null`) followed by the
  folders the active vault holds (`folderOptions`), each with its count. The
  reset row's count is the active vault's own total (`scopeRowCount`).

A folder belongs to the vaults whose rows carry it, so the `FOLDERS` group
follows the selected vault: picking `Acme` lists Acme's folders only, and the
personal vault lists its own. A folder held only by the previous vault is
dropped when the vault changes, so the list cannot empty out under a row that
is no longer drawn. Both the sidebar and the collapsed dropdown read the same
live derivation, which keeps the two from disagreeing.

Both groups are always rendered, and the `FOLDERS` heading stays even when the
active vault holds none: the `All Folders` reset row is the group's fallback, so
an empty vault shows that row alone and never a "no folders" hint beside it. The
shape does not move when a sync or a vault change brings folders.

**Trash** — the Trash row (`trash` glyph, count from `trashCount()`) alone,
straight after the scrolling list and with no rule above it. It is the last place
rather than a view beside them: picking it leaves whatever vault and folder were
selected, so it reads as the list's end and not as another filter.

**Foot** — the account row, under a rule the Trash does not share: a circular
initial avatar, `snapshot.email` truncated to one line, and the server host in
small muted type. The account row is **not** clickable; the gear beside it opens
settings.

## Selection Rules

- Vault and folder are independent dimensions and may both be highlighted: a
  vault row selects `scopeId`, a folder row selects `folderId`, and the list
  shows their intersection, exactly as the current dropdown's columns do.
- Trash is a view, not a scope. While `vaultView() === "trash"` neither group's
  rows highlight, and both groups are drawn at reduced opacity to say that the
  filters do not apply. The folder rows stay clickable: picking one leaves the
  Trash through the store's existing `setFolder`, which calls `leaveTrash()`.
- Every row click goes through the store's existing entry points —
  `setScope`, `setFolder`, `openTrash` — so the Inspector Form's leave guard
  (`guardCipherFormLeave`) keeps working unchanged.

## Expanded vs Collapsed

One boolean, `sidebarCollapsed`, persisted in `ui.json` as part of
`UiPrefsView`. Its default is `false`: a fresh install and an upgrade both open
expanded.

There is no third state. Collapsed draws no rail, no icons-only strip and no
hover target: the only way back is the toggle.

**The toggle** is one button, at the left of the search row, carrying `panel-left`
(a new glyph in `components/Icon.tsx`). It is the only expand/collapse control;
the sidebar head has none. `Ctrl+\` toggles the same thing (`Ctrl+B` is favorite
and `Ctrl+,` is settings); the binding is written `"ctrl+\\"` in TSX, which NSH
accepts as a character key on the US layout just as it does `/` and `[`.

Collapsing never leaves the scope dropdown open behind it — `scopeOpen` is a
store signal that outlives the component, so both the toggle and `Ctrl+\` set it
to `false` through the same function.

The reverse needs the same clear, for a different reason: expanding unmounts the
trigger, so a dropdown left open would still be showing beside the sidebar with
no control to close it. `setSidebarCollapsed` therefore clears it in both
directions rather than only on the way in.

**Narrow windows.** Below `NAV_SIDEBAR_MIN_WINDOW_WIDTH` (1140) the workspace
renders collapsed regardless of the preference, and returns to the preference
when the window grows again. 1140 is where the detail pane still gets the 550
points it has today at the 900-point floor. Today's arithmetic is

```
900 − 20 (the container's 10pt padding, both sides) − 320 (item list) − 10 (gap) = 550
```

and expanded it has to pay for the sidebar — a plain fixed column, not a member
of the resizable group — and the one 9pt handle between the list and the
inspector:

```
240 (sidebar) + 20 (padding) + 320 (item list) + 9 (handle) + 550 (inspector) = 1139
```

1139 is the exact width; the constant rounds up to 1140 so the threshold is not
sitting on a fraction of a point at any device scale.

The preference itself is never rewritten by the window. While the window is
narrow and the preference is expanded, the toggle shows **disabled** with the
tooltip `Widen the window to show the sidebar`; its `disabledStyle` is the
app's existing 0.5 opacity. This is a deliberate divergence from
`GLOSSARY.md`'s Minimum Window Gate paragraph, which said the gate "does not
collapse the sidebar" — see ADR 0005.

## Geometry

`theme/layout.ts` owns every number. The existing `SIDEBAR_*` names already mean
the item list, so they are renamed and a new pair is added:

| Today | After | Value |
| --- | --- | --- |
| `SIDEBAR_MIN_WIDTH` | `ITEM_LIST_MIN_WIDTH` | 320 |
| `SIDEBAR_MAX_WIDTH` | `ITEM_LIST_MAX_WIDTH` | 560 |
| `SIDEBAR_WIDTH_RATIO` | `ITEM_LIST_WIDTH_RATIO` | 0.3 |
| `sidebarWidth(width)` | `itemListWidth(width)` | unchanged curve |
| — | `NAV_SIDEBAR_WIDTH` | 240 |
| — | `NAV_SIDEBAR_MIN_WINDOW_WIDTH` | 1140 |

`NAV_SIDEBAR_WIDTH` is a fixed 240, deliberately **not** scaled by the text
size: it is a column width, not a length that makes room for text (contrast
`LABEL_GUTTER_WIDTH`). Long vault, folder and account names truncate to one line
and carry a tooltip. This is the same rule the item list follows
(`itemListWidth` takes the window alone), and it is what keeps the 1140
threshold valid at every text size — GLOSSARY's Font Scale entry says a window
that fits at 100% fits at 400% too.

**Who owns the item list's width.** Expanded, the workspace is a row of two
columns: the sidebar, then a content column. The sidebar is a plain fixed
column of `NAV_SIDEBAR_WIDTH` — *not* a member of the group — because the search
row and the category tabs have to stop at its right edge, which a group member
could not do. The group therefore holds only the two content panes: the item
list (`size: itemListPanelSize()`, `minSize: 320`, `maxSize: 560`) and the
inspector (taking the rest). One handle, one boundary.

`ResizablePanelGroup` has no controlled `sizes` prop — sizes come back through
`onResize` — so the store keeps the item list's width in `itemListPanelWidth`:

- `null` means "follow the curve": `itemListPanelSize()` answers
  `itemListWidth(window)` and moves with the window;
- the first drag stores a number through `markItemListWidthTouched`, and from
  then on a window resize leaves the user's width alone (the panel still clamps
  it to 320–560).

Collapsed, neither the sidebar nor the group is rendered: the workspace goes
back to the plain row it has today, with `VaultItemList` reading
`itemListWidth(...)` directly. Only one path is ever live, so there is no second
geometry model.

The group draws no look of its own and the app supplies no `handleStyle`
divider: the columns keep their cards' borders and radii, and the handle is an
invisible 9pt band that shows the resize cursor on hover on Linux.

## Keyboard

The sidebar's rows are ordinary action controls (`actionID` + `useAction`), so
they join the app's Tab ring in render order and `Space`/`Enter` activate them,
like every other button.

The sidebar is declared before the content column, so it lays out on the left.
The Tab ring therefore starts in the search row — the sidebar toggle is the
first control the content column renders, ahead of the vault rows around it —
and the sidebar's own rows come after it. This is why `App.test.tsx`'s
`tab moves focus between action controls…` assertion changed its landing spot
while keeping its intent: Tab leaves the search field and reaches an actionable
control, and `Space` activates it.

`SearchHeader`'s scope trigger is a component of its own (`ScopeTrigger`) so its
action registers where it renders, after the toggle. Registered from
`SearchHeader`'s body it would have landed at the head of the ring, ahead of the
control drawn to its left.

The count formatter, the truncation and the empty hints are text, not controls;
they take no stops.

## testIDs

Stable contract, whatever the layout does:

| testID | Control |
| --- | --- |
| `nav-sidebar` | the sidebar column |
| `nav-sidebar-toggle` | the expand/collapse button in the search row |
| `nav-app-icon`, `nav-app-name` | the head's image and label |
| `nav-vault-<scopeId>` | a vault row (ids are `all`, `personal`, `org:<name>`) |
| `nav-folder-<folderId>`, `nav-folder-all` | a folder row, and the reset row |
| `nav-trash` | the Trash row |
| `nav-user` | the account row |
| `nav-settings` | the settings gear |

Row testIDs mirror the dropdown's existing convention verbatim: the raw option
id is appended after the prefix, colons and all, so an organization named `Acme`
is `nav-vault-org:Acme` just as its dropdown row is `scope-org:Acme` today, and
a folder is `nav-folder-folder:Work`. The reset row is the one fixed name,
`nav-folder-all`, matching `scope-folder-all`.

`category-*`, `scope-trigger`, `scope-*`, `footer-bar` and the rest keep their
current names, so existing selectors stay valid.

## Test Impact

- **Default view.** The three helpers at the top of `App.test.tsx` (`openMock`,
  `openMockWithClock`, `openMockAt`) inject
  `uiPrefs: { sidebarCollapsed: true }` through the `host.params.mockState`
  path that `src/lib.rs` already reads, so every existing case keeps running the
  collapsed layout and keeps its assertions. One case bypasses the helpers and
  calls `open` directly — the short-window gate at 800×600 — and it is
  unaffected. The "reload reads the preferences" case also calls `open` with no
  `mockState`, which is what it wants: the mock keeps the collapsed preference
  the first half left behind, so the case keeps testing only the theme and does
  not silently become the first expanded-layout case.
- **Widths.** The `openMockAt(900, 620, …)` cases are already below the 1140
  threshold, so they run collapsed and need nothing.
- **New coverage.** Expanded layout: the sidebar renders and lists vaults,
  folders, Trash and the account; an empty folder group keeps its heading and
  shows its hint; a vault row filters the list; a folder row filters it to the
  intersection while both keep their highlight; the folder group follows the
  selected vault and drops a folder the new vault does not hold; the Trash row
  clears both highlights and dims both groups, and a folder row still leaves the
  Trash; the toggle collapses and expands; `Ctrl+\` does the same; collapsing
  keeps the vault filter; a narrow window disables the toggle and renders
  collapsed with the preference untouched and restores it when the window grows;
  the preference survives a relaunch through `ui.json`.
- **Renames.** `theme/layout.test.ts` moves to the `ITEM_LIST_*` names, keeps
  every curve assertion of `itemListWidth`, and adds the two new constants.

## Documentation to Update

- `GLOSSARY.md`: new `Navigation Sidebar` and `Item List` entries; the Short
  Window Gate paragraph's "does not collapse the sidebar" sentence.
- `ARCHITECTURE.md` §5.1 (`VaultWorkspace`'s component list, the two
  collapsed-only markers on `ScopeDropdown` and the scope trigger) and §5.4 (the
  `theme/layout.ts` constant list, `NAV_SIDEBAR_*` and `sidebarForcedCollapsed`,
  the `itemListWidth` / `ResizablePanel` sentence, and the new threshold).
- `README.md` feature list: the sidebar beside the category tabs.
- `docs/specs/ui_ergonomics_and_shortcuts_spec.md` (`SearchHeader`'s contents
  gain the toggle and mark the scope selector collapsed-only),
  `docs/specs/frontend_feature_parity_spec.md` (P0-3 counts ride the sidebar's
  rows too), `docs/specs/trash_gui_spec.md` (the Trash's two entry points),
  `docs/specs/cipher_mutation_gui_spec.md` (the leave-guard's navigation targets
  name the sidebar's rows).
- `docs/adr/0005-navigation-sidebar-and-narrow-window-collapse.md`.

## Implementation Checklist

1. `theme/layout.ts` + `theme/layout.test.ts`: the renames, the two new
   constants, `sidebarForcedCollapsed(size)`.
2. `src/ui_prefs.rs`: `sidebar_collapsed` on `UiPrefsView`, `UiPrefsUpdateInput`
   and `PrefsFile` (serde key `sidebarCollapsed`, default `false`), the mock
   JSON path, and the round-trip test. Regenerate the `.nsh/types` declarations.
3. `store/appStore.ts`: `sidebarCollapsed()` / `setSidebarCollapsed()` /
   `toggleSidebar()`, `sidebarAllowed()`, `sidebarExpanded()` (the preference AND
   not forced), `sidebarToggleBlocked()`, the `itemListPanelWidth` signal and
   `itemListPanelSize()` / `markItemListWidthTouched()`, and the load/apply path
   in `applyUiPrefs`.
4. `components/Icon.tsx`: the `panel-left` glyph.
5. `components/NavSidebar.tsx`: the component, its rows, and their `actionID`s.
6. `components/SearchHeader.tsx`: the toggle at the far left; the scope trigger
   only while collapsed.
7. `App.tsx`: `VaultWorkspace`'s two layouts, the `ResizablePanelGroup`, the
   `Ctrl+\` binding, and `Esc` closing nothing extra (the dropdown is simply not
   mounted while expanded).
8. `App.test.tsx`: `uiPrefs: { sidebarCollapsed: true }` in the three helpers,
   the Tab landing-spot adjustment, and the new expanded-layout cases.
9. Docs listed above, then `scripts/check_privacy.py` and the Rust + headless
   test suites.

## Out of Scope

- No rail or icon-only collapsed state.
- No keyboard shortcut for jumping into the sidebar's groups.
- No collections group: the projection yields `all`, `personal` and
  organizations only, and `collection:` scopes are not produced today.
- No sidebar in the login, two-factor, locked, or dependency-check phases; it
  exists only in `VaultWorkspace`.
- No animation on expand/collapse. `ResizablePanelGroup` documents no
  hide/show transition and the app's style adds none.
