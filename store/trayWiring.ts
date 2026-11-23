import { effect } from "nsh";
import { Application, isAvailable, Tray, Window, type WindowRef } from "nsh/desktop";
import * as store from "./appStore";
import { buildTrayOptions, type TrayHandlers } from "./tray";

/** The part of a window the tray drives; a `WindowRef` is one. */
export interface TrayWindow {
  state(): { visible: boolean } | null;
  hide(): void;
  focus(): void;
}

/**
 * Shows the window when it is hidden, hides it when it is on screen. `focus`
 * rather than `show`: a window brought back from the tray should take the
 * keyboard, not just appear.
 */
export function toggleWindow(win: TrayWindow): void {
  if (win.state()?.visible) {
    win.hide();
  } else {
    win.focus();
  }
}

function mainWindow(): WindowRef | null {
  return Window.get("main");
}

const handlers: TrayHandlers = {
  onToggleWindow: () => {
    const win = mainWindow();
    if (win) {
      toggleWindow(win);
    }
  },
  onLockVault: () => store.lockOrLogout(false),
  onLogOut: () => store.lockOrLogout(true),
  onOpenSettings: () => {
    mainWindow()?.focus();
    store.openSettings();
  },
  onQuit: () => Application.quit(),
};

let installed = false;
let closeListenerInstalled = false;

/**
 * Puts the tray on screen and makes the main window's close button hide it.
 * Call once at module scope, never from a component: the effect follows the
 * app's signals and the window's state, so a re-render cannot add a second
 * listener or a second tray update.
 */
export function installTray(): void {
  if (installed || !isAvailable) {
    return;
  }
  installed = true;

  effect(() => {
    const win = mainWindow();
    if (win && !closeListenerInstalled) {
      // With `closeOnPress: false` in nsh.json the button only asks: hiding
      // keeps the process, the vault session and the tray alive.
      closeListenerInstalled = true;
      win.on("closePress", () => win.hide());
    }

    Tray.set(
      buildTrayOptions(
        {
          phase: store.phase(),
          sshPrompt: store.sshPrompt() ?? null,
          windowVisible: win?.state()?.visible ?? false,
          palette: store.palette(),
        },
        handlers,
      ),
    );
  });
}
