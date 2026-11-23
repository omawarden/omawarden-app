import appIcon from "../assets/icon.png";
import type { MenuItem, TrayOptions } from "nsh/desktop";
import type { AppPhase, SshPromptView } from "omawarden-app/native";

/**
 * Everything the tray shows, as plain values. The builder reads nothing else:
 * the wiring (not this module) owns the signals and the window.
 */
export interface TrayContext {
  phase: AppPhase;
  /** The pending SSH approval, when one is waiting. */
  sshPrompt: SshPromptView | null;
  /** Whether the main window is on screen, which the Show/Hide item follows. */
  windowVisible: boolean;
}

/** The app paths a tray item runs. The builder only calls them. */
export interface TrayHandlers {
  onToggleWindow: () => void;
  onLockVault: () => void;
  onLogOut: () => void;
  onOpenSettings: () => void;
  onQuit: () => void;
}

/** What the current phase means to the tray, derived once. */
interface TrayStatus {
  /** The vault is unlocked, so Lock Vault can run. */
  unlocked: boolean;
  /** The user is past the login step, so Log Out can run. */
  signedIn: boolean;
  tooltip: string;
}

function statusFor(phase: AppPhase, sshPrompt: SshPromptView | null): TrayStatus {
  switch (phase) {
    case "dependencyCheck":
      return {
        unlocked: false,
        signedIn: false,
        tooltip: "Omawarden — checking dependencies",
      };
    case "login":
    case "twoFactor":
      return {
        unlocked: false,
        signedIn: false,
        tooltip: "Omawarden — log in to unlock",
      };
    case "locked":
      return {
        unlocked: false,
        signedIn: true,
        tooltip: "Omawarden — vault locked",
      };
    case "unlocked": {
      if (sshPrompt) {
        const more = sshPrompt.remaining > 0 ? ` (+${sshPrompt.remaining} more)` : "";
        const client = sshPrompt.client.trim() || "an app";
        return {
          unlocked: true,
          signedIn: true,
          tooltip: `Omawarden — SSH approval waiting: ${client}${more}`,
        };
      }
      return {
        unlocked: true,
        signedIn: true,
        tooltip: "Omawarden — vault unlocked",
      };
    }
  }
}

/**
 * The tray description for the current app state. It is a pure function: the
 * same context and handlers always produce the same options, and nothing here
 * reads a signal, touches the window, or performs IO. The icon is the app's
 * asset in every state; the tooltip and the menu carry the state.
 */
export function buildTrayOptions(context: TrayContext, handlers: TrayHandlers): TrayOptions {
  const status = statusFor(context.phase, context.sshPrompt);
  const menu: MenuItem[] = [
    {
      label: context.windowVisible ? "Hide Omawarden" : "Show Omawarden",
      onSelect: handlers.onToggleWindow,
    },
    { type: "separator" },
    {
      label: "Lock Vault",
      disabled: !status.unlocked,
      onSelect: handlers.onLockVault,
    },
    {
      label: "Log Out",
      disabled: !status.signedIn,
      onSelect: handlers.onLogOut,
    },
    { type: "separator" },
    {
      label: "Settings…",
      onSelect: handlers.onOpenSettings,
    },
    { type: "separator" },
    {
      // No `role: "quit"`: that quits without running the app's own handler,
      // and Quit is the app's path, not the platform's.
      label: "Quit",
      onSelect: handlers.onQuit,
    },
  ];

  return {
    icon: appIcon,
    tooltip: status.tooltip,
    // The icon's primary click is the same toggle as the Show/Hide item.
    onClick: handlers.onToggleWindow,
    menu,
  };
}
