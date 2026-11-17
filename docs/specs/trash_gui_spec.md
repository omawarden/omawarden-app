# Trash in the GUI

## Status

The browse view, Restore, and Permanent Delete are built (#38–#41). The Trash
inspector's action row holds `Restore` and `Delete Permanently`.

`Details` (#43) is built: the Trash inspector is a read-only view of the
cipher's own fields, rendered from the detail map the Trash list read fills. The
Trash offers no edit, copy or favourite action.

## Problem Statement

Deleting a Login or a Secure Note in the GUI is a reversible soft delete: the
daemon stamps `deleted_at` on the cipher, and the cipher disappears from the
active vault. Before this work the GUI had no way to see that cipher again. The
only way back was the CLI's Trash commands, and the app had no list, no
inspector, and no indication that anything had been deleted at all.

The Trash is server-side state, not a filter of the active vault. The daemon's
active `list` excludes deleted ciphers and `list` with `{"trash": true}` returns
only them. Its per-item reads (`get_item`, `find_item`, `totp`,
`get_attachment_key`) are active-only, so a trashed cipher cannot be fetched one
at a time. The list reply is the only channel that carries one: it is the same
full-detail `VaultItem` the active list uses, and `vault list --trash` prints it
verbatim. The first three slices projected those items into rows and discarded
the items themselves, which is why they could only show row metadata. `Details`
revisits that choice.

## Model

`store/appStore.ts` keeps a `vaultView: "active" | "trash"` signal next to the
existing filter signals. Trash is deliberately not an `ItemCategory`: the
category tabs keep meaning login, card, identity, secure note and SSH key inside
it. The two views have separate row sources:

- `rawItems` holds the active rows from `snapshot.allItems`.
- `trashItems` holds the loaded Trash rows, or `null` before the first open.

`viewRows()` picks the rows of the current view. `filteredItems()` narrows them:
the active view applies scope, folder, search and the fuzzy scorer; the Trash
applies only search and category, because the Trash is server-wide. Trash rows
arrive sorted by deletion time descending and keep that order under filtering.

`openTrash()` switches the view, resets the selection and loads the list on the
first open of the session. `closeTrash()`, `setScope()` and `setFolder()` return
to the active view. Lock and logout clear `trashItems` and reset the view, so a
new session starts with a fresh lazy load.

A restore changes both views: the Trash row disappears at once through
`reloadTrash()`, while the active rows are only marked stale with
`activeRowsStale`. `leaveTrash()` — shared by every way back to the active vault,
including the name resolver — re-reads them once on the return, so the restored
cipher is there without a second request from inside the Trash. Lock and logout
clear the flag along with the loaded rows.

## Entry Point and Loading

`components/ScopeDropdown.tsx` adds a `Trash` row below the organization rows,
after a divider. It uses the same `ScopeRow` styling and `scope-trash` test id.
The row shows no count until the list has been loaded, and `trashCount()` then
reports the number of Trash rows. It is the only row marked active while the
Trash is open.

The load is user-initiated. `loadTrash()` calls
`OmawardenBridge.queryTrash(trashFilter())` once and stores `allItems` in
`trashItems`. Exactly one request is made on the first open; re-opening the
Trash reuses the loaded list. Boot, unlock, the daemon lock tick, and search or
category changes in the active vault issue no Trash request. A search or a
category change inside the Trash filters `trashItems` locally. An explicit sync
performed while the Trash is open reloads the list.

## IPC

`OmawardenBridge.queryTrash(filter)` delegates to `VaultEngine::query_trash`
through the same adapter seam as `query_vault`:

- `InProcess` sends `{"action": "list", "trash": true, "touch": false}` through
  the shared daemon socket and projects the reply with `row_from_item`, the
  same row builder the active list uses. It borrows `CachedVault` for the
  unlocked account context but never writes the deleted rows into it, so the
  cache stays active-only.
- `Mock` selects items whose `deleted_at` is set and projects the same fields.
  `mockTrashQueries()` counts the reads for the headless tests.

Both adapters clear the scope and folder in the filter they project with, and
sort the rows with `projection::sort_trash`: newest deletion first, then title.
`CipherRowView.deletedAt` carries the timestamp on a Trashed row and is absent
(not `null`) on an active one.

`query_trash` also keeps the reply's `VaultItem`s in a Trash-owned map beside the
rows, so the inspector can render a trashed cipher's fields without a second
request (#43). That map is never written into `CachedVault`, which stays
active-only, and it lives and dies with `trashItems`: lock and logout clear both,
`leaveTrash()` clears neither.

`OmawardenBridge.restoreCipher(id)` delegates to `CipherEngine::restore`.
`InProcess` sends `{"action": "cipher_restore", "id": id}` through the shared
daemon socket and maps the reply with the same `map_mutation_response` /
`log_rejection` pair as create, edit and delete, so the daemon's `name` reaches
the toast and its `error` reaches the user verbatim. `Mock` clears
`MockItem.deleted_at` for a trashed id and refuses an id that is not trashed;
the seeded `trashMutationError` stands in for a daemon rejection in the
headless tests.

## List

`components/VaultItemList.tsx` renders `store.filteredItems()` in either view.
In the Trash:

- the header reads `Trash` and its count reflects the filtered Trash rows
- rows show a category glyph, the title, and the subtitle derived as in the
  active list; no favicon is fetched
- the only badge is the formatted deletion date
- favorite stars, attachment, TOTP and organization badges are not drawn
- the empty state distinguishes an empty Trash (`The Trash is empty.`) from a
  search with no matches (`No trashed items match this search.`)

The search pill in `SearchHeader` counts `viewRows()` rather than `rawItems()`,
and the trigger reads `Scope: Trash`. The trigger stays enabled because the
dropdown is the way back to the active vault. In the Trash the folder column
and the scope-filter hint are hidden, and picking one of the scope rows leaves
the Trash rather than narrowing it. No stale active scope or folder is applied
to the Trash rows.

## Inspector

`components/ItemInspector.tsx` has a Trash branch that renders the selected row
instead of an `InspectorView` from the engine. Today it shows the title,
category, deletion time, and folder and organization when present; #43 replaces
that with the read-only field set described under `Details`. The store's
`refreshInspector()` short-circuits in the Trash, so no per-item daemon read ever
runs for a deleted cipher. Write and extract entry points (edit, favorite,
delete, open URL, copy, SSH export) stay guarded by `trashBlocksItemActions()`,
and the action palette returns no context actions in the Trash. `Restore` is a
Trash-specific mutation reachable only from this view and guarded by
`vaultView() === "trash"`. Global actions such as sync, lock and settings remain
available.

`Restore` in the action row calls `restoreCipher()` with the selected row's id,
with no confirmation. It stays disabled while a restore is in flight
(`isRestoring`), so a double press cannot fire twice. On success the store
re-reads the Trash, clamps the selection to the rows that remain, stays in the
Trash and toasts `Restored "name".`; the active vault is refreshed only when
the user returns to it. On failure the daemon's error is shown as-is and the
list is untouched. The action is reachable only from this view.

## Details

Built in #43.

The Trash inspector shows the same field set as the active inspector, read-only:
username, password, TOTP, notes, URIs, card, identity, SSH, custom fields, and
the attachment list. It renders from the Trash detail map rather than a per-item
daemon read, and it never offers a write or extract action.

Masking is identical to the active inspector: the password, the card number, the
CVV and the SSH private key are masked by default; notes, the username, custom
fields, URIs, the card brand and the expiry are plain.

`Reveal` is allowed and stays read-only. It is gated by the cipher's own
`reprompt`, so the Trash row carries the real value instead of the `0` the first
slices passed: a trashed item with `reprompt = 1` asks for the master password
before showing anything, exactly as an active one does. `Copy` stays out of
scope — every copy entry point keeps going through `trashBlocksItemActions()`,
so a revealed value can be read but not extracted. Password history is not
shown: it is a forensic surface, not identification.

The live TOTP code is shown, with the same ticker the active inspector uses,
running only while a Trash row is selected. The code is computed locally from the
in-memory seed through the existing `totp_view()`. The daemon's `totp` action
resolves through the active-only `find_item`, so the Trash never calls it.

Attachments are listed with their filename and size and cannot be downloaded;
SSH keys show the key type, fingerprint and public key and cannot be exported.
Both are upstream refusals rather than gaps to work around: `get_attachment_key`
returns nothing for a cipher whose `deletedDate` is set, and `get_ssh_key`
resolves through `find_item`. The inspector therefore shows no button that is
guaranteed to fail.

### Why not a trash-aware `get_item`

`get_item`, `get_ssh_key`, `totp` and `get_attachment_key` all resolve through
`find_item` → `get_items()` → `get_items_by_state(false)`. Adding a `trash`
parameter would push a state flag into the one read every other feature depends
on, and it would turn row selection into a daemon request — the cold-path budget
this spec spends its length protecting.

`cipher_resolve` already accepts `{"trash": true}`, but it answers with
`{id, name, type, organization_id}` by design, and the `cipher_restore` and
`cipher_delete_trash` receipts carry only `{id, name}`.

The list reply is the only full-detail channel that already exists. It is what
`vault list --trash` prints, it is what the app already receives on every Trash
load, and it is what the plugin's overlay reads. Reusing it costs nothing and
adds no new IPC surface: the change is in what the app keeps, not in what it
asks for.

## Permanent Delete

`Delete Permanently` in the Trash inspector opens `CipherDeleteModal` in its
third mode (title `Permanently Delete?`, body `This cannot be undone.`,
confirm `Delete Permanently`), reachable only from the Trash. The active
vault's delete stays soft only; `openCipherDelete(true)` is guarded and
unreachable from it. Confirming calls `deleteTrashCipher`, re-reads the Trash
with `reloadTrash()`, clamps the selection, and stays in the Trash. Cancelling
leaves the row in place and sends no request. Daemon errors surface as-is.

## Tests

`App.test.tsx` seeds the mock bridge with active and trashed items and covers:
the dropdown entry and its divider, the count after load, the newest-first
order, the absence of trashed rows from the active list, the read-only
inspector, local search and category filtering, the hidden folder controls,
the `deletedAt` key on the row DTO, the two empty states, the cold-path request
count, and the reload on sync. The Restore tests cover the row disappearing,
the `Restored "name".` toast, the view and the clamped selection staying in the
Trash, the restored cipher reappearing in the active list on the way back, a
seeded daemon rejection leaving the row in place, and the action being absent
from the active inspector. The Permanent Delete tests cover the `Delete
Permanently` button opening the modal with `Permanently Delete?`, `This cannot
be undone.`, `Delete Permanently`; confirming purges the row and keeps the Trash
open; cancelling leaves the row and sends no request; the active vault's delete
stays soft with `The item can be restored from the trash.` copy; a seeded
daemon rejection leaves the row in place. Rust tests in `src/lib.rs` and
`src/projection.rs` cover the adapters and the sort; `src/cipher_mutation.rs`
covers the `cipher_restore` and `cipher_delete_trash` payloads, their receipts
and errors, and `src/lib.rs` covers the mock adapters' success, their rejection
of an id that is not trashed, and the seeded error.

`Details` (#43) adds its own coverage: the read-only field set, masking parity
with the active inspector, reveal behind `reprompt`, copy staying blocked, the
live TOTP ticker without a second Trash read, and the absent download and export
actions. `src/lib.rs` and `src/inspector.rs` cover the detail map into the
inspector, the absence of a read before the Trash is loaded, and the map being
dropped by a purge and a lock.

## Out of Scope

- Bulk `Empty Trash`.
- A version gate for the daemon's Trash actions.
- Translating or wrapping daemon errors.
- Editing, copying, or favouriting a cipher while it is in the Trash. Viewing and
  revealing are in scope (`Details`); extracting a value is not.
- Downloading an attachment or exporting an SSH key from the Trash.
