# 0004: Close to Tray, and Grant the Application Capability

**Status**: Accepted
**Date**: 2026-11-23
**Deciders**: (this session)

## Context

The app now keeps a tray icon so it can stay reachable while its window is not
on screen. That changes two things that were previously obvious.

First, the main window's close button used to end the app. A tray app needs the
button to dismiss the window instead: closing the GUI must leave the process,
the icon, the vault session and the daemon alone. Users who expect "close" to
quit will read the new behaviour as a bug unless it is deliberate and
documented.

Second, NSH gates the tray, `Application.quit()`, main-window control, global
shortcuts and launch-at-login behind `capabilities.application`. An app that
declares any capabilities gets only what it declares, and an undeclared
capability makes those calls do nothing. Adding the capability is a permanent
widening of the app's declared reach, not a runtime toggle.

## Decision

**Close presses hide the main window.** `nsh.json` sets
`window.closeOnPress: false`, so from the first frame the button only reports a
press. The app listens once and calls `hide()`. Quit is a separate menu item
that calls `Application.quit()`; the app never translates a window close into
an exit, a lock, a logout or a daemon `stop`.

**Grant `capabilities.application: true`, and nothing broader for this
feature.** The tray, the quit primitive and main-window focus become available;
`homeDir`, `statusBar`, `windows` and other capabilities are not granted. The
vault session stays owned by the daemon's idle auto-lock, and the daemon stays a
separate process that outlives the GUI (ADR 0003).

## Considered Options

- **Keep quitting on window close.** Rejected: it removes the tray with the
  window and defeats the reason for having one. It also makes "close" the only
  way to quit, so there is no explicit Quit action to tell apart from hiding.
- **Set `closeOnPress: false` only at runtime.** Rejected: the app would have at
  least one frame in which the close button still quits. Putting the policy in
  the manifest makes the semantics true from the first frame and keeps them in
  one inspectable place.
- **Grant no application capability and work around it.** Rejected: the tray,
  quit and window focus are all inert without it. There is no narrower grant
  for "just the tray".
- **Grant a broad capability set for future features.** Rejected: capabilities
  are part of the app's public sandbox contract. Each one should be added when
  a feature needs it, not speculatively.

## Consequences

- Closing the window is not quitting. The tray menu's `Quit` is the single
  explicit exit path, and documentation must say so.
- The declared capability surface is permanently larger. The grant makes
  global-shortcut and launch-at-login calls available without another manifest
  edit. The app uses neither today; any future use needs the same review as any
  other privileged API.
- Hiding and quitting must not touch the session. A future change that adds a
  lock, logout or daemon `stop` to either path would move session ownership out
  of the daemon and break this decision.
- Launch-at-login is deliberately not built. Hyprland does not read XDG
  autostart entries; it starts applications through `exec-once` in its own
  configuration. When a switch is added, the UI must state that it has no
  effect under Hyprland.
- The behaviour change is user-visible and irreversible by preference: there
  is no setting to make the close button quit again.

## References

- App: `docs/specs/tray_icon_spec.md` (states, menu, close semantics, session
  boundary, Hyprland limitation)
- App: `GLOSSARY.md` — `Tray Icon`, `Close to Tray`, `Tray Attention State`
- App: `docs/adr/0003-daemon-source-bundling-and-trust.md` (the daemon is a
  separate process and an answering one is kept)
- App: `nsh.json` (`window.closeOnPress`, `capabilities.application`)
- App: `store/tray.ts`, `store/trayWiring.ts` (the pure builder and its single
  wiring)
- NSH: `https://nsh.dev/docs/sandbox-and-capabilities.md` — `application`
- NSH: `https://nsh.dev/modules/nsh-desktop.md` — tray, main window, quit
