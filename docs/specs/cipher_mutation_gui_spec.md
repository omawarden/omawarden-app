# Cipher Mutation in the GUI

## Problem Statement

The app is read-only for standard vault items. It can inspect, search, copy, and
generate TOTP codes for Login and Secure Note ciphers, and it can create SSH
keys, but it cannot create, edit, or delete a Login or a Secure Note. Anything
past inspection sends the user back to the `omawarden` CLI, and the upstream
issue that added those commands (`feat(vault): cipher mutation CLI commands`)
stopped at the terminal.

The CLI's own flow does not transfer as-is. It targets ciphers by name or UUID
on a command line, prompts for a hidden password, opens `$EDITOR` for multi-line
edits, and asks `[y/N]` before a delete. The app has none of those primitives:
it has a selection, a modal, and a form.

## Solution

Port the CLI's cipher mutation commands through `OmawardenBridge`, the app's
native module. Three bridge methods carry the same daemon actions, payloads, and
receipts the CLI uses:

- `mutateCipher(input, id?)` sends `cipher_create` (no `id`) or `cipher_update`
  (with `id`).
- `deleteCipher(id, permanent)` sends `cipher_delete`.
- `resolveCipherTarget(target)` sends `cipher_resolve`.

The UI adds an Inspector-embedded form for creating and editing, a Type Picker
for `Ctrl+N`, a delete confirmation, and a name/id resolver. Nothing spawns a
CLI subprocess; every mutation is one daemon round-trip.

## User Stories

The upstream issue is written for a terminal. Each story below is mapped to the
GUI affordance that covers it, with the difference called out where the GUI
replaces a terminal primitive rather than copying it.

1. Create a Login with name, username, and password: the Inspector Form reached
   from the `+` on the Logins tab, the palette's `Create Login`, or `Ctrl+N`
   followed by `L`/Enter in the Type Picker.
2. Create a Login without a password: the form's password field is optional;
   an empty password is sent as an empty string, and the item is created.
3. Press Enter at the password prompt to generate a 16-character password: the
   Password field's `Generate…` button (or `Ctrl+G`) opens the Password
   Generator in fill mode, whose default is a 20-character secret of every
   class; Enter puts it in the field. There is no terminal prompt, so the CLI's
   fixed length is replaced by the generator's rules.
4. Scripted `--generate-password` / `--generate-passphrase`: both are one
   generator, reached from the form (`Generate…` / `Ctrl+G` in fill mode) and
   from the vault (`Ctrl+G` as a loose dialog). It is no longer a fixed
   16-character button next to a separate configurable modal: the same option
   state feeds both paths.
5. Create a Secure Note with name and notes: the `+` on the Secure Notes tab,
   the palette's `Create Secure Note`, or `Ctrl+N` then `N`. An entry point that
   already knows the type skips the picker, and the form never offers a
   Login/Secure Note switch.
6. Edit a cipher by name: `Ctrl+P` / palette `Go to Item` resolves a name
   through `resolveCipherTarget`, selects the matching row, and the inspector's
   `Edit` button opens the multi-field Inspector Form in place.
7. Edit a cipher by UUID: the same resolver accepts an exact id, and selecting a
   row targets it by id without any name lookup.
8. Run `vault edit <target>` with no field flags to open `$EDITOR`: the
   inspector's header `Edit` button (or `Ctrl+E`) opens the Inspector Form,
   which carries name, username, password, every website URL, and notes
   together. Favoriting is not part of the form.
9. `$EDITOR` changes are parsed, encrypted, and uploaded on close: the form's
   `Save Changes` sends one `cipher_update`, and the daemon encrypts before it
   transmits.
10. Reject an edit when `revisionDate` changed elsewhere: the daemon enforces
    the check; the app renders the daemon's rejection in the form's error row
    and leaves the draft open so nothing is lost.
11. Soft-delete a cipher: the inspector's trash button opens a confirmation and
    sends `cipher_delete` with `permanent: false`.
12. Ask before deleting: the confirmation modal names the item and says the
    item can be restored from the trash.
13. Skip the prompt for scripts: not a GUI concern; the bridge's
    `deleteCipher` takes the decision directly, with no second prompt.
14. `--permanent`: the same confirmation gains a second warning row, its title
    changes to `Delete Permanently?`, and the confirm button says
    `Delete Permanently`.
15. Numbered selection for an ambiguous name: a partial name that matches more
    than one cipher fills the resolver's candidate list; picking a row selects
    that exact cipher.
16. Fail with an ambiguous-target error in non-interactive mode: the resolver
    never picks one of several matches. It lists them and keeps the modal open
    until the user chooses.
17. Pipe a JSON payload via `--from-json` or stdin: the GUI has no stdin. The
    bridge takes the same structured payload as a typed `CipherMutationInput`,
    which is the JSON body the CLI sends.
18. Fail closed when the server drops or errors: the daemon commits to the local
    cache only after the server acknowledges; the app reloads its snapshot from
    the vault after a successful receipt and shows the error otherwise, so a
    failed mutation leaves the row unchanged.
19. Reject organization-owned or collection-bound mutations: the daemon
    rejects them, and the app shows that rejection in the form's error row or
    the toast. The app does not pre-filter them out, so the message always comes
    from the daemon that owns the rule.

## Implementation Decisions

- The mutation seam is `src/cipher_mutation.rs`. A `CipherEngine` trait with an
  in-process adapter and a mock adapter keeps the payload building, receipt
  mapping, and target resolution testable without a daemon.
- `build_mutation_payload` is the single place that decides what a create or an
  update sends. A create always carries a trimmed, non-empty name; a note
  create rejects login-only fields instead of silently dropping them; an update
  omits `None` fields so "leave untouched" and "clear to an empty string" stay
  distinct.
- The receipt maps onto `CipherMutationOutcomeView` (`ok`, `outcome`, `id`,
  `name`, `revisionDate`, `error`). An update receipt has no `name`, so the app
  reloads the vault instead of trusting the receipt for the new title.
- `PROTOCOL_VERSION` is not bumped. The daemon actions already ship in the
  shared `omawarden` crate, and the GUI and the daemon are released together.
- The delete confirmation is a `ModalShell`, not a native `AlertDialog`, so the
  whole flow stays reachable from headless tests.
- The cipher form is the Inspector's third view, not a dialog: `CipherEditor`
  takes the pane while a draft is open, beside the item view and the empty
  state, so the list and the search stay visible. This supersedes the original
  "single multi-field modal" decision; `CipherFormModal` and its two `ModalKind`
  entries are retired.
- Editing is still one form and one `cipher_update`: there is no per-field
  inline editor, so a title change cannot be committed on its own and race a
  password change.
- A type the entry point already knows (the Logins or Secure Notes tab, the
  matching palette row) opens the form directly. `Ctrl+N` is the only entry that
  does not know, so it opens the Type Picker: `Login` is the default, `L` and
  `N` choose in one keystroke, the arrows move, Enter takes the highlight, and a
  second `Ctrl+N` toggles it. `Esc` closes the picker without a draft. This
  supersedes the original "the type comes from the affordance" decision for
  `Ctrl+N` only.
- Changes come from comparing the live draft with the snapshot taken when the
  form opened (`cipherFormChangedFields`), not from remembering touched keys. An
  edit sends the name plus only the differing fields, so saving a new title
  cannot blank the password the form never decrypted; clearing a field is a
  difference and clears it on the daemon; typing and undoing leaves no
  difference and no prompt. Blank website rows are ignored by the comparison.
- Website URLs are a list (`CipherMutationInput.uris`), matching the daemon's
  `login.uris`. A create sends every row, so a login can carry several URIs; a
  blank row is dropped. An update can only replace the first URL
  (`CipherUpdateDraft` has no `uris` field), so the edit form makes the first
  row editable and shows the rest read-only, and the daemon keeps them.
- A cancel on a clean draft closes at once. A changed draft shows an inline
  `Discard` / `Keep Editing` strip instead of a dialog over the panel, and `Esc`
  on that strip goes back to editing. `Ctrl+S` saves through the same validation
  as the Save button.
- The form owns the keyboard while it is open: the vault shortcuts, the list
  arrows, and the search stand down, and `Ctrl+S`, `Ctrl+G`, and `Esc` are bound
  with `when: "always"` so they reach the form through a focused field. Closing
  it returns the keyboard to the search and leaves the query alone.
- `Generate…` (in the password field) and `Ctrl+G` open the Password Generator
  in fill mode: the primary action is `Use Password` (`Enter`), which writes the
  secret into the field and closes the dialog without copying it. The options
  live in `store/generatorOptions.ts` and are shared with the loose generator,
  so both modes generate under the same rules.
- Creating from the Trash switches the list back to the active vault first, so
  the saved row cannot land in a list that hides it.
- The target resolver reuses the CLI's precedence: exact id, then exact name,
  then a case-insensitive substring. Only the substring stage can report
  candidates, so an exact name never opens a menu.
- Selecting a resolved row clears the search, category, scope, and folder when
  one of them hides the item, so `Go to Item` reaches a cipher outside the
  current filter.
- The create, edit, and delete affordances are gated to Logins and Secure
  Notes, which is the CLI's supported scope; a Card, Identity, or SSH key
  reports "Only logins and secure notes can be changed." instead of opening a
  form the daemon would reject.
- `Ctrl+E` edits the selected Login or Secure Note and keeps exporting an SSH
  key, which is what the key previously did on its own.
- Favoriting is a star toggle in the inspector header, always visible: filled
  when the item is a favorite, outlined when it is not, and pressable in both
  states. The palette offers the same action as its `Favorite` / `Unfavorite`
  row; neither goes through the form. `Ctrl+B` runs it from the vault and from
  the open palette, and `Ctrl+V` stays paste in the search fields.
- Custom fields are read-only. The daemon's create and update drafts carry no
  custom-field slot, so the inspector labels the section read-only instead of
  offering an editor that could not save.
- Shortcuts: `Ctrl+N` opens the Type Picker, `Ctrl+S` saves the form, `Ctrl+D`
  opens the delete confirmation, `Ctrl+P` opens the resolver, and `Ctrl+B`
  toggles the favorite.

## Testing Decisions

- Rust unit tests in `src/cipher_mutation.rs` cover payload construction for
  logins, notes, and updates, the multi-URI create payload, the first-URL-only
  update, the required-name rule, the note/login field rejection, receipt and
  error mapping, and candidate mapping.
- Rust mock round-trips in `src/lib.rs` cover create → edit → delete against
  `MockState`, the bad-input rejection, and target resolution for an exact id,
  an exact name, a missing name, and an ambiguous substring.
- Headless tests in `App.test.tsx` cover creating a login and a note from their
  tabs, the required name, the entry-point-typed form hiding login fields,
  creating a login without a password, a create that stores several website
  URLs, an edit that only replaces the first URL, the Inspector Form as an
  in-place edit view, an edit that renames an item without touching its
  password, the dirty-draft strip (`Esc`, `Keep Editing`, `Discard`), `Ctrl+S`
  saving, `Ctrl+E` opening the edit form, the Type Picker's default, its `L` /
  `N` / arrow / second-`Ctrl+N` keys, and `Esc` closing it without a draft, the
  generator opening in fill mode from `Generate…` and `Ctrl+G`, `Enter` filling
  the password field, the fill never copying to the clipboard while the loose
  dialog still does, the open form keeping the vault shortcuts and the search
  query to itself, the delete confirmation and its permanent warning, the
  palette rows, `Ctrl+N` / `Ctrl+D` / `Ctrl+B`, the favorite star toggle, the
  read-only custom-fields label, the resolver's exact-match, candidate-list, and
  not-found paths, and the category gate that keeps Cards and Identities
  read-only.

## Out of Scope

- `$EDITOR`-style multi-line editing. The platform has no editor hand-off, so
  the Inspector Form replaces it.
- Card, Identity, custom-field, and SSH-key mutation.
- Organization-owned and collection-assigned cipher writes; the daemon's
  rejection is surfaced as-is.
- Offline mutation queuing and a raw JSON/stdin entry point.
- Re-encryption, rotation, and revision history for edited items.

## Further Notes

The CLI remains the scriptable surface. The app reuses the daemon actions it
already trusts rather than inventing a second write path, so a mutation that
works in one works in the other, and a rule added to the daemon applies to both.
