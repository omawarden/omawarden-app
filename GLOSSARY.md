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

## Minimum Window Gate

The opaque, full-window overlay shown when either dimension of the window is
below its floor. The floor is a fixed `MIN_WINDOW_WIDTH` 900 by
`MIN_WINDOW_HEIGHT` 620: it does not follow the text size, so enlarging the
text never makes a fitting window "too small". It states the live current size,
the required minimum, and a one-line instruction to resize.

It has no controls and no dismiss action, because only resizing clears it.

The gate is an overlay, not a replacement. The workspace, every dialog and the
toast stay mounted underneath, so shrinking and restoring preserves form input,
open dialogs and scroll position.

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
