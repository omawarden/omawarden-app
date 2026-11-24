# Engine follow-up: stop opening files through a fixed freedesktop command

**Repository**: `icyleaf/omarchy-bitwarden`
**Issue**: icyleaf/omarchy-bitwarden#434
**Affects**: `src/attachment.rs`

## Symptom

On macOS, an attachment opened by the engine itself does nothing, because every
one of the engine's own openers is the literal string `xdg-open`, which macOS
does not have.

`omawarden-app` now opens the paths it hands to the system through a host-aware
launcher of its own (`open` on macOS, `xdg-open` elsewhere), and it uses that for
`openAttachmentPath`. But `omawarden::attachment::get_attachment(..., open_file,
..., notify)` still shells out on its own, so an engine-side open picks the
Linux command and the two can disagree.

## Where it is

Three call sites, all hardcoded:

- `src/attachment.rs:87` — the `notify-send` action callback for `open=Open
  File`, running `xdg-open <file>`.
- `src/attachment.rs:90` — the same callback for `folder=Open Folder`, running
  `xdg-open <parent>`.
- `src/attachment.rs:1055` — `get_attachment` when `open_file` is true, running
  `xdg-open <dest_path>` and reporting `action: "view"`.

The whole `notify` branch is also `notify-send`-shaped, which is a freedesktop
tool; on macOS that branch would need `osascript`/`NSUserNotification` or to be
skipped in favour of the caller's own UI.

## What to change

Make the opener a function of the target OS inside the engine — `open` on macOS,
`xdg-open` elsewhere — or, better, return the path and let the caller open it.
The app already prefers the second shape wherever it can and only needs the first
for the paths it cannot see.

The `notify` path needs the same treatment or an explicit "not supported on this
host" answer, so a caller is not left believing a notification was shown.

## Note for the app side

The app's attachment gate names the engine's real preview root,
`<runtime>/omarchy-bitwarden/scoped-attachments/<slot>/<item>/<attachment>`,
where the runtime directory comes from `get_runtime_dir()` and the
`omarchy-bitwarden/scoped-attachments` segment is repeated in the app because the
engine's own `preview_root()` is private. If that layout moves, the app's
allow-list has to move with it. A shared accessor would remove that coupling;
it is a separate ask but the same kind of fix.
