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
talk to an in-process daemon over its Unix socket. It is the real adapter behind
every `Engine Adapter`; the other adapter is the Mock Engine.

## Engine Adapter

The trait each domain module (`diagnostics`, `settings`, `auth`, `vault`, `ssh`,
`clipboard`) exposes to the `OmawardenBridge` native module. Every trait has
exactly two adapters: `InProcess`, which calls the linked `omawarden` crate and
the in-process daemon, and `Mock`, which serves the headless UI tests from
process-wide state. `engine::<domain>()` picks one per call, so bridge methods
are one-line delegations and no method forks on mock mode. The seam is internal
to the Rust crate: the TSX side keeps calling the single `OmawardenBridge`
object.

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

## Type Scale

The named set of font sizes in `theme/typeScale.ts`: thirteen steps from `2xs`
(9 points) to `7xl` (28 points), and the single source of every text size in the
interface. Components read a step from `type()` rather than hardcoding a number,
so a new component cannot invent a fourteenth size.

The scale is the app factor only. `Text` applies the system text scale on top,
so `type()` must not multiply by the system factor again. `totalScale()` is the
separate factor (`fontScale() × appFontScale()`) for sizes that do not follow
the system setting themselves, such as icons and the fixed gutters that make
room for text.

## Minimum Window Gate

The opaque, full-window overlay shown when either dimension of the window is
below its floor (`MIN_WINDOW_WIDTH` 900 or `MIN_WINDOW_HEIGHT` 620). It states
the live current size, the required minimum, and a one-line instruction to
resize; it has no controls and no dismiss action, because only resizing clears
it.

The gate is an overlay, not a replacement. The workspace, every dialog and the
toast stay mounted underneath, so shrinking and restoring preserves form input,
open dialogs and scroll position. While it is up, every keyboard shortcut is
inert.

It does **not** resize the window or ask the window manager for a minimum size:
NSH 0.4.0 exposes no native minimum window size, so the app enforces its own
floor. It does not collapse the sidebar, reflow the workspace, or report an
error; the layout below the threshold is simply not shown.

## Dev Release

A rolling pre-release published on every push to `main` under the tag `dev`.
Carries a SemVer string formatted as `0.4.0-dev.<short-sha>` and produces
multi-architecture tarballs (`.tar.gz`) and standalone AppImages.

## Release Bundle

The complete distribution package produced by `nsh package --target linux` and
augmented with the Polkit authorization policy (`.policy`), install scriptlet,
desktop entry, and application icon. Distributable via GitHub Releases and
packaged for Arch Linux as `omawarden-app-dev-bin`.
