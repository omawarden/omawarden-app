# Engine follow-up: open files through the host's opener, not a fixed xdg-open

**Repository**: `icyleaf/omarchy-bitwarden`
**Issue**: icyleaf/omarchy-bitwarden#434
**Affects**: `src/attachment.rs`

## Symptom

The engine's own attachment opener is the literal string `xdg-open`, which macOS
does not have. So `omawarden attachment download --open` does nothing on macOS,
and the `notify` action branch cannot show a usable notification either.

`omawarden-app` does not hit this today. Its only attachment entry point is
preview, and both of its `get_attachment` calls pass `open_file = false` and
`notify = false`; the one "open with system viewer" action goes through the
app's own host-aware launcher (`open` on macOS, `xdg-open` elsewhere) on the
path the engine returned. The desktop app is therefore unaffected, and this
issue is about the engine's own copy of the mechanism — which is exactly the
kind of duplicate that drifts, and which the CLI user does hit.

## Where it is

Three call sites, all hardcoded:

- `src/attachment.rs:87` — the `notify-send` action callback for
  `open=Open File`, running `xdg-open <file>`.
- `src/attachment.rs:90` — the same callback for `folder=Open Folder`, running
  `xdg-open <parent>`.
- `src/attachment.rs:1055` — `get_attachment` when `open_file` is true, running
  `xdg-open <dest_path>` and reporting `action: "view"`.

The `notify` branch is additionally `notify-send`-shaped, a freedesktop tool; on
macOS it would need `osascript`/`NSUserNotification`, or to be skipped in favour
of the caller's own UI. The engine CLI passes `notify = true`
(`src/main.rs:4235`), so that branch is reachable.

## What to change

Make the opener a function of the target OS inside the engine — `open` on macOS,
`xdg-open` elsewhere — or, better, return the path and let the caller open it.
`omawarden-app` already prefers the second shape and only needs the first for
paths it cannot see.

The `notify` path needs the same treatment or an explicit "not supported on this
host" answer, so a caller is not left believing a notification was shown.

## Related coupling

`omawarden-app`'s attachment allow-list names the engine's real preview root,
`<runtime>/omarchy-bitwarden/scoped-attachments/<slot>/<item>/<attachment>`. The
runtime directory comes from `get_runtime_dir()`, but the
`omarchy-bitwarden/scoped-attachments` segment is repeated in the app because the
engine's own `preview_root()` is private. If that layout moves, the app's
allow-list has to move with it. A shared accessor would remove that coupling —
a separate ask, noted here because it is the same module and the same kind of
fix, not an addition to this issue's scope.
