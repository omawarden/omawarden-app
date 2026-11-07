# Omawarden App: Vault Search Focus Specification

> **Target Repository**: `omawarden/omawarden-app`
> **Status**: Ready for Implementation
> **Primary Goal**: Put the keyboard in the vault search box on request (`Ctrl+F`) and on unlock, without losing the vault's keyboard navigation.

---

## Problem Statement

The vault search box can only be reached with the pointer. The interface binds eleven shortcuts, but none of them moves the keyboard into the search field: a keyboard user who wants to narrow the vault has to click. Worse, nothing holds the keyboard focus when the vault unlocks, so typing goes nowhere until the user clicks something first.

The plugin (`omarchy-bitwarden`) puts the keyboard in its search field whenever the vault is shown (`SearchHeader.qml`'s `focusSearch`, called from `restoreSearchFocus` and `onVisibleChanged`). The app has no equivalent, and it has no `Ctrl+F` either.

## Solution

`Ctrl+F` focuses the vault search and selects the query already there, so the first keystroke replaces it while the filtered results stay put until then. It answers only while the vault is usable — unlocked, no dialog, window at or above its minimum. The command palette gains a `Search Vault` row carrying the `Ctrl+F` badge, so the shortcut is discoverable beside every other one.

Unlocking (and showing the vault) also puts the keyboard in the search field. Because NSH hands every non-character key to a focused text input by default, that requires an explicit keyboard contract: the vault's arrows, copy keys and Tab keep working while the field holds focus, the search field handles Enter itself, and the minimum-window gate takes the keyboard away while it covers the app.

## User Stories

1. As a keyboard user, I want `Ctrl+F` to put the caret in the vault search box, so that I can filter without reaching for the mouse.
2. As a keyboard user with a query already typed, I want `Ctrl+F` to select that query, so that typing replaces it instead of appending to it.
3. As a keyboard user, I want the filtered results to stay as they are until I type, so that pressing `Ctrl+F` does not clear the list under me.
4. As a keyboard user, I want `Ctrl+F` to do nothing while a dialog covers the vault, so that it cannot steal focus from the dialog I am using.
5. As a keyboard user, I want `Ctrl+F` to do nothing while the window is below its minimum, so that the gate keeps the keyboard inert.
6. As a user who has never heard of the shortcut, I want `Search Vault` in the command palette with a `Ctrl+F` badge, so that I can discover it the same way as every other shortcut.
7. As a user who runs `Search Vault` from the palette, I want the palette to close and the caret to land in the search box, so that I can keep typing without another click.
8. As a user who unlocks the vault, I want the keyboard already in the search box, so that I can start narrowing immediately.
9. As a user who unlocks and presses `Down`, I want the vault selection to move, so that the auto-focus does not cost me the existing arrow navigation.
10. As a user who unlocks and presses `Enter`, I want the selected item's primary field copied, so that the auto-focus does not cost me the existing copy flow.
11. As a user who unlocks and presses `Ctrl+Enter`, I want the TOTP copied, so that the TOTP shortcut survives the focused field.
12. As a user who unlocks and presses `Tab`, I want to leave the search box and enter the action ring, so that the auto-focus does not trap me in the field.
13. As a user whose window is below the minimum, I want typing to go nowhere while the gate is up, so that the gate really is inert.
14. As a user who resizes back above the minimum, I want the keyboard back in the search box, so that the gate's exit restores the vault's home position.
15. As a maintainer, I want one focus holder for the search field, so that the shortcut, the palette and the auto-focus cannot drift apart.
16. As a maintainer, I want the new behaviour covered at the app seam, so that the ref plumbing is not tested instead of the behaviour.

## Implementation Decisions

### One focus holder

A small module owns the search field's native ref: a setter the `<Input ref>` callback installs, `focusSearch(selectAll)` (clears any action focus, focuses the field, and selects the whole query when asked) and `blurSearch()`. The shortcut, the palette row and the auto-focus all call it; nothing else keeps a reference to the field.

The holder is module-level, not a signal, because component bodies run once and the ref is a native handle rather than state. A stale handle between the workspace unmounting and mounting again is harmless: every caller is behind the vault guard, and the next mount overwrites it.

### The shortcut

`mod+f` only. Linux's `mod` is Control, so a second `ctrl+f` binding would be the same keystroke; Apple gets Command-F from the same binding. It uses the existing `canUseVaultShortcuts()` guard, which already excludes the action palette (a dialog), every other modal, the locked and login phases, and the minimum-window gate. It focuses and selects the whole query.

The badge comes from `keymap.label("mod+f")` so it reads `Ctrl+F` on Linux and the Apple spelling on macOS. The palette row carries the badge but **not** a `keystroke`: pressing `Ctrl+F` inside the palette must stay inert, and a palette keystroke would run the row from there.

### The palette row

`Search Vault` joins the global actions, above `Sync Vault`: label `Search Vault`, hint about putting the keyboard in the search box, the `search` glyph, the `Ctrl+F` badge. Its `run` closes the palette (the palette's runner does that) and then focuses the field after the current frame, so the closing dialog cannot blur the field on its way out. It selects the query like the shortcut does.

### Auto-focus

The search header focuses the field when it mounts — that is the unlock and the show — and follows the gate: when `windowBelowMinimum()` turns true it blurs the field, and when it turns false it focuses again. The effect compares the predicate's value with the previous one, so a resize that does not cross the floor does not steal focus back from an action the user tabbed to.

It does not select anything on mount: a restored "remember last search" query keeps its text and gets the caret at the end, as the plugin's `focusSearch(true)` does.

An open dialog blurs the field too: the dialog's fields are what the user is typing into, and Escape has to reach the dialog rather than the search behind it. Closing a dialog does not give the focus back — only the palette's `Search Vault` row asks for it.

### The keyboard contract

NSH's default binding fires only when the focused input does not use the keystroke itself, and `edits_text()` counts every non-character key — Up, Down, Enter, Escape — as the input's own. With the search field focused, every non-character vault shortcut would therefore go dark. The contract keeps them alive:

- **Up / Down** bind with `when: "always"` and keep their existing guards, so arrows move the selection while the field is focused.
- **Ctrl+Enter / Ctrl+Enter on Apple** (the TOTP pair) bind with `when: "always"`; they are already guarded, and no form submits on them.
- **Enter** stays on the default binding (so the login and settings forms keep their own Return). The search field sets `submitBehavior="submit"` and its `onSubmit` calls the primary copy, which is exactly what the global Enter does for a selected item; keeping the focus means the caret stays in the field.
- **Tab / Shift+Tab** bind with `when: "always"`, blur the search field first, then cycle the action ring. Blurring matters twice: it is what makes `Space` (still `notEditing`) able to activate the focused action, and it keeps the field from being a focus trap.
- **Escape** is untouched. While the field is focused it is the input's, exactly as it is today.

The palette's own `always` bindings are newer and keep winning while it is open.

## Testing Decisions

Two seams. The user-visible behaviour lives in the app-level suite in `App.test.tsx`. The one thing that host cannot observe is the input's selection — it ignores `Command::SetSelection` — so `store/searchFocus.test.ts` hands the holder a fake `InputRef` and asserts the calls it forwards: focus, select-all at the query's length, plain focus, and blur.

The app-level suite observes focus the way a user does:

- **Focus** — press a plain letter with no other input on screen and read which field's value changed. A letter with no focus goes nowhere.
- **Select-all** — not observable at this seam; the fake ref above covers it.
- **The guard** — open the action palette, press `Ctrl+F`, type a letter, and assert it landed in the palette's filter and not in the vault search.
- **The palette row** — open the palette, assert the label and badge, filter to it, run it, assert the palette closed and typing now reaches the vault search.
- **Auto-focus** — unlock a locked mock and assert a typed letter reached the search field.
- **The gate** — shrink below the minimum, assert a typed letter goes nowhere, grow back above it, and assert it reaches the search again.

The existing keyboard tests are the regression net for the contract: the arrow/Enter copy test, the Tab/Space test, and the minimum-window gate test must pass unchanged. Prior art: the existing "action palette …", "keyboard shortcuts …" and "minimum window gate …" tests.

## Out of Scope

- **Escape inside the search field.** The plugin clears the query, then resets the scopes; today NSH's input swallows Escape there. Changing that pulls in scope resets and a second Escape model, and belongs in its own ticket.
- **Restoring focus after any dialog closes.** The palette row restores it because it asked for it; closing Settings or the generator does not.
- **Selecting the query on auto-focus.** Only `Ctrl+F` selects; unlock leaves the caret at the end.
- **A second `ctrl+f` binding** next to `mod+f`.
- **Focusing the search on plain typing** or any other "type anywhere to search" behaviour.

## Further Notes

Facts gathered while designing this:

- `nsh-core`'s `KeyBinding::new` resolves `When::Auto` to `!keystroke.edits_text()`, and `edits_text()` returns true for every non-`Char` key (function keys excepted) plus every printable character without a modifier. So a focused `<Input>` shadows Up, Down, Enter and Escape by default.
- `<Input>` accepts `ref`, whose `InputRef` extends `ViewRef` with `focus()`, `blur()` and `setSelection(start, end?)`.
- `<Input>`'s `submitBehavior` defaults to `"blurAndSubmit"`; `"submit"` keeps the focus and reports `onSubmit`. `components/AuthView.tsx` already uses that pair.
- `keymap.bind` in object form applies one options object to every keystroke; `when: "always"` therefore needs separate `keymap.bind(keystroke, handler, options)` calls.
- `keymap.label("mod+f")` yields `Ctrl+F` on Linux and the Apple spelling on macOS; the platform reserves Control+Q, Alt+F4 and F11 on Linux, not Control+F.
- The plugin has no `Ctrl+F`: `SearchHeader.qml` focuses its field on `onVisibleChanged` and after scope changes, and `OmarchyBitwarden.qml`'s `restoreSearchFocus` re-focuses it when the panel opens or a modal closes.
- The action palette already binds its own keys with `when: "always"` and is newer than the shell bindings, so it keeps winning while open.
