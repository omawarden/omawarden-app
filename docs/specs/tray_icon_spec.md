# Omawarden App: Tray Icon Specification

> **Target Repository**: `omawarden/omawarden-app`
> **Status**: Implemented
> **Primary Goal**: Keep the app reachable while the main window is closed,
> without making the tray a second owner of the vault session.

---

## Scope

The tray is a persistent, small presence in the desktop panel. It shows the
current vault state, offers the handful of actions that make sense away from the
main window, and is the way back into that window. It is not a second control
surface for the vault: every action it offers calls the same app path the window
would call.

Out of scope: colored title runs, launch-at-login, and any tray action that
starts, stops, locks or unlocks the daemon.

## State Model

The tray has three states. The state is derived from the app phase and the
pending SSH approval, never stored in the tray.

| State | Trigger | Meaning to the user |
| --- | --- | --- |
| `locked` | `dependencyCheck`, `login`, `twoFactor`, or `locked` | The vault is not readable. |
| `unlocked` | `unlocked`, with no pending SSH approval | The vault is readable. |
| `attention` | `unlocked`, with a pending SSH approval | The vault is readable and a signing request is waiting. |

An approval arriving or leaving moves the tray description between `unlocked`
and `attention` on the next update; no extra event is needed. The states are
carried by the tooltip and the menu, not by the icon.

## Icon and Tooltip

The icon is the app's own `assets/icon.png`, the same logo used on the login
screen, in every state. It is a recognizable presence in the panel rather than
a state indicator: using the asset keeps the tray consistent with the app and
avoids hand-drawn glyphs that drift from the logo.

The tooltip answers "what exactly is happening". It names the phase in words
(`checking dependencies`, `log in to unlock`, `vault locked`, `vault unlocked`)
or names the waiting SSH client and the number of further requests. The menu
adds the actionable part of the state: `Lock Vault` is enabled only when the
vault is unlocked, and `Log Out` only after sign-in.

The tray deliberately sets **no** `title` (colored text runs). Waybar and most
Linux panels show only the icon, so a run added for macOS would be invisible
where this app primarily runs; state must not depend on it.

## Menu

| Item | Enabled when | Action |
| --- | --- | --- |
| `Hide Omawarden` / `Show Omawarden` | always | Same toggle as a click on the icon. |
| `Lock Vault` | `unlocked` or `attention` | The app's own lock path. |
| `Log Out` | `locked`, `unlocked` or `attention` | The app's own logout path. |
| `Settings…` | always | Brings the window forward, then opens Settings. |
| `Quit` | always | The app's application-quit primitive. |

Before sign-in, `Lock Vault` and `Log Out` are disabled: there is no session to
act on. After locking, only `Log Out` stays available.

`Quit` uses an explicit handler rather than the platform's `quit` menu role, so
the app's exit path stays in charge. Exiting sends no lock, logout or daemon
`stop`: the daemon is a separate process and an answering daemon may be serving
another client.

## Close-to-Tray Semantics

The main window's close button is configured in the application manifest with
`closeOnPress: false`. It therefore reports a close press instead of closing
the window; the app hides the window in response. The process, the tray icon,
the vault session and the daemon all keep running. The window is still "open"
to the app, just not on screen.

A left click on the icon, or the `Show Omawarden` item, calls the one toggle:
hide a visible window, bring a hidden one forward with `focus()` so it also
takes the keyboard. The menu label follows the window's reported visibility,
so the two paths never disagree.

## Session Boundary

The tray is a view of state, not an owner of it. Hiding the window sends no
session request. Locking and logging out are explicit user actions that go
through the app's existing lock/logout path. The daemon's idle auto-lock remains
the authority on when a session ends; a background tray update never touches
its timer. Quit ends the GUI only.

## Linux and Hyprland

**Hyprland does not read XDG autostart `.desktop` entries.** Its autostart is
configured in `hyprland.conf` with `exec-once`. A future "launch at login"
switch must therefore say in the UI that it does not take effect under
Hyprland; otherwise it would be a switch that appears to do nothing. The switch
itself is deferred and is not part of this specification.

## Test Boundary

The mapping from app state to tooltip and menu is a pure builder and is
unit-tested, including all three states, the phase-to-enabled matrix and the
handler dispatch. Tests also assert that the icon is the app asset in every
state. Window actions have a small tested seam for show/hide. The tray wiring
itself is a no-op in headless `nsh test`: there is no desktop tray there to
assert against, so tests do not try to inspect a live icon.
