# Glossary

Domain terms used across `omawarden-app`, its Rust bridge, and the TSX store.

## VaultSnapshot

The complete, authoritative view of the vault returned by the Rust bridge on
**cold paths**: boot, login, unlock, lock/logout, and sync. It carries the
account identity, phase, quick-unlock state, category counts, scopes, folders,
the filtered `items`, and `allItems` (every row before filtering).

`VaultSnapshot` is expensive to produce: `real_snapshot()` asks the daemon for
`status` and `list`, and the daemon's status path re-reads the encrypted vault
file and queries the system keyring. It must never run on a click or keystroke.

## FilterProjection

The cheap, derived subset of a `VaultSnapshot` produced entirely in memory. In
the TSX store, `filteredItems()` recomputes from `rawItems` (the cached
`allItems`) plus the category, scope, folder, and search signals, using the same
subsequence fuzzy scorer as the Rust engine. `visibleItems()` then applies the
render window (`visibleLimit`).

Filtering a `FilterProjection` performs **zero IPC**, **zero keyring lookups**,
and **zero `snapshot.set()`** calls, so switching tabs or typing in the search
box only re-renders the list rows.

## In-Process Engine

The `omawarden` Rust crate linked directly into the `nsh` host binary and
reached through the `OmawardenBridge` native module. Authentication, generators,
health checks, clipboard handling, and vault reads execute in the app's own
process instead of spawning the `omawarden` CLI. Stateful vault operations still
talk to an in-process daemon over its Unix socket.

## Clipboard Guard

The sensitive-copy policy implemented by `clipboard_copy()` and the engine's
clipboard manager. Sensitive values (passwords, TOTP codes, card numbers, CVVs,
private keys) are written to the Wayland clipboard and cleared after the
configured TTL, unless a newer copy supersedes them. Non-sensitive values are
left in place.

## Quick Unlock

Re-unlocking a retained session with system authentication (Polkit) instead of
re-entering the master password. The engine reports `quick_unlock_ready`
(system auth is available) and `quick_unlock_usable` (the user configured it);
the app shows the quick-unlock action only when both hold.

## Cold path / Hot path

- **Cold path**: any operation that may read the vault from disk, contact the
  daemon, or touch the keyring (`boot`, `authenticate`, `sync`, `lock_or_logout`,
  `real_snapshot`).
- **Hot path**: per-interaction work such as category/scope/folder switches,
  search keystrokes, row selection, and inspector refreshes. Hot paths must be
  served from the in-memory `CachedVault` on the Rust side and from
  `FilterProjection` signals on the TSX side.
