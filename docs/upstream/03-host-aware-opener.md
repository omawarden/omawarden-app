# Engine follow-up: stop opening files through a fixed freedesktop command

**Repository**: `icyleaf/omarchy-bitwarden`
**Affects**: `src/attachment.rs`, wherever an attachment is handed to the desktop

## Symptom

On macOS, "open attachment" does nothing. The engine's attachment path hands the
decrypted file to `xdg-open`, which macOS does not have.

`omawarden-app` now has a host-aware opener of its own and uses it for the paths
it opens directly, but an engine call that opens the file itself still picks the
Linux command, so the two can disagree.

## What to change

Make the opener a function of the target OS inside the engine — `open` on macOS,
`xdg-open` elsewhere — or return the path and let the caller open it. The app
already prefers the second shape wherever it can; the first is enough for the
paths it cannot see.

## Note

The app's attachment gate names the engine's real preview root
(`<runtime>/omarchy-bitwarden/scoped-attachments/<slot>/<item>/<attachment>`).
If that layout moves, the app's allow-list has to move with it, so a shared
accessor would be better than the app reconstructing the path.
