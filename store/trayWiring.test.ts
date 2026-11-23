import { expect, test } from "nsh/test";
import { isAvailable } from "nsh/desktop";
import { installTray, toggleWindow, type TrayWindow } from "./trayWiring";

function fakeWindow(visible: boolean | null) {
  const calls: string[] = [];
  const win: TrayWindow = {
    state: () => (visible === null ? null : { visible }),
    hide: () => calls.push("hide"),
    focus: () => calls.push("focus"),
  };
  return { win, calls };
}

test("a visible window is hidden, a hidden one comes to the front", () => {
  const visible = fakeWindow(true);
  toggleWindow(visible.win);
  expect(visible.calls).toEqual(["hide"]);

  const hidden = fakeWindow(false);
  toggleWindow(hidden.win);
  expect(hidden.calls).toEqual(["focus"]);
});

test("a window whose state is not known yet comes to the front", () => {
  const unknown = fakeWindow(null);
  toggleWindow(unknown.win);
  expect(unknown.calls).toEqual(["focus"]);
});

test("installing the tray without a desktop does nothing", () => {
  expect(isAvailable).toBe(false);
  installTray();
  installTray();
});
