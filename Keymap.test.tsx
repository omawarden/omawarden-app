import { expect, open, test } from "nsh/test";

/**
 * Every host's keymap accepts the app's whole binding table.
 *
 * `keymap.bind` checks *every* keystroke in an object before making any of them:
 * one reserved key returns an error and the entire object is discarded, so the
 * failure is not "this shortcut stopped working" but "everything bound beside it
 * went dark". That is what a `mod+h` binding did on macOS — Command+H is kept
 * for hiding the app — and it took the command palette, search, lock and the
 * arrow keys with it.
 *
 * Which keystrokes are reserved depends on the host, so both are opened here.
 * A Linux pass is not redundant: that set is `Ctrl+Q`/`Alt+F4`/`F11`, and an
 * app that binds `mod+q` as "quit" would repeat the defect on the other side.
 *
 * The assertions are deliberately thin. Nothing here checks a view — this file
 * exists for the one thing a behavioural case cannot show: that the app *loads*
 * under a host whose reserved list differs from the one it was written on. A
 * throw during module evaluation fails the `open()` call itself.
 */
for (const platform of ["macos", "linux"] as const) {
  test(`the keymap binds under ${platform}`, async () => {
    const app = await open("./App.tsx", {
      width: 1440,
      height: 960,
      platform,
      host: {
        params: {
          mock: true,
          mockState: { phase: "locked", host: platform === "macos" ? "macos" : "linux" },
        },
      },
    });

    // Reaching here means `App.tsx` finished evaluating, so every `keymap.bind`
    // call in it returned a binding rather than an error.
    expect(app.texts().length).toBeGreaterThan(0);
  });
}
