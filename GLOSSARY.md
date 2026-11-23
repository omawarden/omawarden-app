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

## Trash

The server-side state of soft-deleted ciphers: still stored, still encrypted,
but hidden from the active vault. A cipher is in the Trash exactly when its
`deleted_at` timestamp is set; the daemon's active `list` excludes those items,
and a `list` sent with `{"trash": true}` returns only them.
`CipherRowView.deletedAt` carries the timestamp on a trashed row and is absent
on an active one.

Trash is a vault state, not an `ItemCategory`: the category tabs keep meaning
login, card, identity, note and SSH key inside it. The app models it as a
separate view rather than a filter, so no active-vault path can reach a trashed
cipher by accident. A trashed cipher is inspectable read-only from the Trash,
with a live TOTP code, but it is not editable and not copyable.

## Soft Delete

The reversible delete. Deleting an item from the active vault stamps
`deleted_at` on the server and moves the cipher into the Trash; it stays
restorable and the write syncs like any other mutation. Soft delete is the
only delete the active vault offers.

## Permanent Delete

The irreversible delete: the cipher leaves the Trash and the server. It is not
a stronger Soft Delete that the active vault can reach — the active vault never
offers it. It applies only to a cipher already in the Trash, behind a
confirmation that says it cannot be undone.

## Restore

Bringing a cipher back from the Trash: the daemon clears `deleted_at` and the
active vault sees the cipher again. In the GUI it is one press from the Trash
inspector, with no confirmation, and it leaves the user in the Trash. A failed
restore reports the daemon's error and changes nothing. Restore is the inverse
of a Soft Delete, not a third kind of delete; the active vault never offers it.

## Inspector Form

The create/edit view that takes the Inspector pane's place while a Login or a
Secure Note is being written. It is the third state of that pane, beside the
item view and the empty state, so the list and the search stay where they are
instead of being covered by a dialog. A draft is a snapshot of the fields as
the form opened plus the live edits; "unsaved changes" means the two differ.
The form owns the keyboard while it is open: vault shortcuts and the search
stand down, and closing it hands the keyboard back to the search. Tab walks its
fields and then its own buttons as one ring, and a move that would leave the
form — a list row, a category tab, a scope, a folder, the Trash — asks first
when the draft has changed.

## Type Picker

The `Ctrl+N` step that asks which kind of item to create, because that shortcut
is the only create entry point that does not already know. It offers Login and
Secure Note and hands the answer to the Inspector Form. The `+` buttons and the
palette's create rows name their type themselves, so they skip it.

## In-Process Engine

The `omawarden` Rust crate linked directly into the `nsh` host binary and
reached through the `OmawardenBridge` native module. Authentication, generators,
health checks, clipboard handling, and vault reads execute in the app's own
process instead of spawning the `omawarden` CLI. Stateful vault operations talk
to the shared `omawarden` daemon over its Unix socket; that daemon runs as its
own process, not on a thread inside the app. It is the real adapter behind
every `Engine Adapter`; the other adapter is the Mock Engine.

## Engine Adapter

The trait each domain module (`diagnostics`, `settings`, `auth`, `vault`, `ssh`,
`clipboard`) exposes to the `OmawardenBridge` native module. Every trait has
exactly two adapters: `InProcess`, which calls the linked `omawarden` crate and
the shared daemon over its Unix socket, and `Mock`, which serves the headless UI
tests from process-wide state. `engine::<domain>()` picks one per call, so bridge methods
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

## Login Step

Which half of the login `components/AuthView.tsx` shows: `credentials` or
`secondFactor`. It is the screen's own signal (`loginStep` in `store/appStore.ts`),
not an `AppPhase`: the engine's phase stays the truth about the session, and the
step only decides what is rendered. `applySnapshot` derives it — an outstanding
challenge means `secondFactor`, every other phase `credentials` — so a successful
sign-in, a lock, a logout or a boot all return it to `credentials`. Back from the
second factor sets it to `credentials` without calling the engine.

This two-step login is a deliberate divergence from the plugin, which keeps the
first factor's fields visible under the two-factor block.

## Login Credentials

The first factor the credentials step collects: an email and master password,
or an API Key's client ID and client secret. They stay in the store while the
second factor is shown — the engine needs the password again to verify a code or
resend a verification email — but the second step does not render them, and Back
restores them untouched. `clearAuthSecrets()` is what removes them, only after a
successful sign-in.

## Second Factor

The extra verification a server demands after the first factor is accepted,
covering both two-factor authentication (Authenticator App, Email, YubiKey OTP,
FIDO2 security key) and the new-device email verification. It is the login's
second step, so it hides the Login Credentials and the server's edit control; it
keeps the logo, title, read-only server address, error banner, method tabs (when
the server offers more than one) and the code or security-key card, with the
primary action and Back on one row.

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

## Font Scale

The user's text-size factor, set by the Text size slider in Settings ›
Appearance: 100% to 400% in 10% steps, stored as `fontScale` in the UI
preferences file. The **app factor** is what the setting holds; the **total
factor** is the app factor multiplied by the system text scale
(`totalScale()`), and it is what the icon sizes and the fixed gutters follow.
The two are separate so the app's setting multiplies the system accessibility
setting instead of replacing it.

`Font Scale` is not the **Type Scale**: the type scale is the fixed ladder of
thirteen named sizes, and the font scale is the factor applied to it. Text is
scaled by the app factor only (the system factor applies on top through
`Text`), while everything that cannot read the system setting itself uses the
total factor.

The font scale changes how much room the content wants inside a window, never
how large a window the shell requires: a window that fits at 100% fits at 400%
too.

## Short Window Gate

The opaque, full-window overlay shown when the window is too short. Only height
takes part: the floor is a fixed `MIN_WINDOW_HEIGHT` 620, and it does not follow
the text size, so enlarging the text never makes a fitting window "too short".
It states the required minimum height and a one-line instruction to resize.

Width does not reach the gate. A window narrower than the layout keeps the shell
at its floor width (900 points) and scrolls sideways, so the user is never
turned away for being narrow. The interface is reachable with Shift + wheel, the
scrollbar, a trackpad's sideways gesture, or the keyboard, which reveals what it
focuses (ADR 0006).

It has no controls and no dismiss action, because only resizing clears it. It
does **not** resize the window or ask the window manager for a minimum size:
NSH offers `window.minSize` in `nsh.json`, and the app deliberately does not use
it, because a tiling compositor sizes the window rather than the user.

The gate is an overlay, not a replacement. The workspace, every dialog and the
toast stay mounted underneath, so shrinking and restoring preserves form input,
open dialogs and scroll position. Dialogs and the toast sit outside the shell's
scroll view, so they stay centred in what the user can see and do not drift when
the content scrolls.

## Shell Content Width

The width the shell lays its content out at: the window's width, or the
`MIN_LAYOUT_WIDTH` 900 floor, whichever is larger. A window narrower than the
floor scrolls the overflow rather than squeezing the panes below what they need.

_Avoid_: Minimum Window Width, Layout Floor (for the window)

## Tray Icon

The app's small, persistent representative in the desktop panel. It shows the
vault's current state at a glance and stays available while the main window is
hidden, so the window can always be brought back.

_Avoid_: Menu Bar Icon, Notification Area

## Close to Tray

Dismissing the main window without ending the app. The vault session and the
daemon keep running, and the `Tray Icon` remains the way back.

## Tray Attention State

The condition in which the vault is unlocked while an SSH signing request is
waiting for approval. The tray names the waiting client in its tooltip and
leaves the vault actions enabled; the icon itself is the app logo in every
state.

## App Version

The version of `omawarden-app` itself: `version` in `Cargo.toml` and in
`nsh.json`, which the two must agree on. It is what `env!("CARGO_PKG_VERSION")`
reports as the running app's version, what the `Dev Release` SemVer is built
from, and what names the release artifacts and the AUR `pkgver`.

It is **not** the `NSH Version`. The app version moves when the app ships and
the NSH version when the framework it runs on moves; the two are independent,
so an app release that changes nothing in the framework moves only the
`App Version`.

## NSH Version

The version of Native Shell the app is built on and run by: the `nsh` CLI
pinned in `mise.toml` and installed by CI, moved together with the `nsh-core`
and `nsh-base` crates in `Cargo.toml`. It is deliberately independent of the
`App Version`: NSH `0.5.1` carried `omawarden-app` `0.5.0`, and NSH `0.6.1`
carries `0.6.0`.

## Dev Release

A rolling pre-release published on every push to `main` under the tag `dev`.
Carries a SemVer string formatted as `<App Version>-dev.<short-sha>` and
produces multi-architecture tarballs (`.tar.gz`) and standalone AppImages.

## Release Bundle

The complete distribution package produced by `nsh package --target linux` and
augmented with the Polkit authorization policy (`.policy`), install scriptlet,
desktop entry, and application icon. Distributable via GitHub Releases and
packaged for Arch Linux as `omawarden-app-git-bin`.

## Log Pipeline

The in-process event source that feeds the `Log Viewer`. It records
state transitions and failures only — authentication success/failure,
unlock/lock, vault sync start/end, cipher write rejections — not per-action
INFO events. Levels are `error`, `warn`, `info` (no `debug` or `trace`).
Entries are sanitized by the engine's `sanitize_log_message` before entering
the bounded in-memory ring. The pipeline does **not** receive the daemon's
structured stderr; that boundary is recorded in ADR 0001.

## Log Viewer

The bounded, in-memory log ring displayed in the Logs tab. It holds a
fixed number of recent entries (implementation detail), each carrying a
timestamp, a level badge, the sanitized source prefix, and the message.
The viewer supports live filtering by level. It is not persisted to disk,
not streamed to journald, and not sent over the network. A `Refresh` action
re-reads the ring; `Copy Diagnostic Report` includes its current contents.
The Diagnose tab holds the engine health checks only; the viewer moved to
its own Logs tab.

## Diagnostic Report

A user-triggered, one-shot snapshot copied to the clipboard. It contains:
app version, engine version, git commit, build date, sanitized server URL,
health check results, process RSS, and the current `Log Viewer` contents.
It **explicitly excludes** the daemon's stderr logs and any absolute paths
or local filenames. The report header states the collection scope so a
GitHub issue reader knows what is and is not included.

## Daemon Source

The app-level setting that chooses which daemon executable to launch when no
daemon is answering the shared Unix socket. The default is `bundled`, the
daemon shipped beside the app binary; `system` picks a binary from
`which -a omawarden`; `custom` is a path the user chose in the file dialog.
A daemon that is already answering is always kept regardless of the source,
and the app never sends `stop` to take the socket.

## Bundled Daemon

The daemon executable shipped inside an `omawarden-app` release, placed beside
the app binary in the app's private directory. It is the default `Daemon
Source` and is built from the same engine commit the app links.

## System Daemon

The daemon executable installed by the OS package (e.g. `omawarden-bin` at
`/usr/bin/omawarden`) or otherwise found on `PATH`. It is the alternative
`Daemon Source` the user may select from the list of `omawarden` candidates.
