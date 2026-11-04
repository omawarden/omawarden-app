import { signal } from "nsh";
import * as store from "./appStore";

export interface PaletteAction {
  id: string;
  label: string;
  hint: string;
  icon: string;
  /** The badge shown at the right of the row. */
  shortcut?: string;
  /** The keystroke that runs the action directly while the palette is open. */
  keystroke?: string;
  run: () => void;
}

export const query = signal("");
export const selectedIndex = signal(0);

function matches(action: PaletteAction, search: string): boolean {
  return (
    !search ||
    action.label.toLowerCase().includes(search) ||
    action.hint.toLowerCase().includes(search)
  );
}

/** Actions that operate on the selected item, in the order the inspector shows them. */
export function contextActions(): PaletteAction[] {
  const actions: PaletteAction[] = [];
  const current = store.selectedCipher();
  if (!current) {
    return actions;
  }
  if (current.category === "login") {
    actions.push({
      id: "copy-password",
      label: "Copy Password",
      hint: "Copy the selected login password",
      icon: "\uf084",
      shortcut: "↵",
      run: () => store.copyField("password"),
    });
    actions.push({
      id: "copy-username",
      label: "Copy Username",
      hint: "Copy the selected login username",
      icon: "\uf007",
      shortcut: "Ctrl+U",
      keystroke: "mod+u",
      run: () => store.copyField("username"),
    });
    if (current.hasTotp) {
      actions.push({
        id: "copy-totp",
        label: "Copy TOTP",
        hint: "Copy the current one-time code",
        icon: "\uf017",
        shortcut: "Ctrl+↵",
        keystroke: "mod+enter",
        run: () => store.copyField("totp"),
      });
    }
    actions.push({
      id: "reveal-password",
      label: "Reveal Password",
      hint: "Toggle the password visibility",
      icon: "\uf06e",
      shortcut: "Ctrl+T",
      keystroke: "mod+t",
      run: () => store.toggleReveal("password"),
    });
    if (current.hasPasswordHistory) {
      actions.push({
        id: "password-history",
        label: "View Password History",
        hint: "Browse previous passwords",
        icon: "\uf1da",
        shortcut: "Ctrl+H",
        keystroke: "mod+h",
        run: store.openPasswordHistory,
      });
    }
  }
  if (current.category === "sshKey") {
    actions.push({
      id: "export-ssh-key",
      label: "Export SSH Key",
      hint: "Write the key to ~/.ssh",
      icon: "\uf084",
      shortcut: "Ctrl+E",
      keystroke: "mod+e",
      run: () => store.openSshKey("export"),
    });
  }
  const detail = store.inspector();
  if (detail && detail.uris.length > 0) {
    const first = detail.uris[0];
    actions.push({
      id: "open-url",
      label: "Open URL",
      hint: first.host || first.uri,
      icon: "\uf08e",
      shortcut: "Ctrl+O",
      keystroke: "mod+o",
      run: () => store.openUrl(first.uri),
    });
  }
  return actions;
}

/** Actions that operate on the whole vault. */
export function globalActions(): PaletteAction[] {
  return [
    {
      id: "sync",
      label: "Sync Vault",
      hint: "Synchronize with the Bitwarden server",
      icon: "\uf021",
      shortcut: "Ctrl+R",
      keystroke: "mod+r",
      run: store.sync,
    },
    {
      id: "generator",
      label: "Open Password Generator",
      hint: "Create a strong password or passphrase",
      icon: "\uf084",
      shortcut: "Ctrl+G",
      keystroke: "mod+g",
      run: store.openGenerator,
    },
    {
      id: "create-ssh-key",
      label: "Create SSH Key",
      hint: "Generate or import an SSH key",
      icon: "\uf084",
      run: () => store.openSshKey("create"),
    },
    {
      id: "lock",
      label: "Lock Vault",
      hint: "Clear the session and lock the vault",
      icon: "\uf023",
      shortcut: "Ctrl+L",
      keystroke: "mod+l",
      run: () => store.lockOrLogout(false),
    },
    {
      id: "settings",
      label: "Open Settings",
      hint: "Manage configuration and diagnostics",
      icon: "\uf013",
      shortcut: "Ctrl+,",
      keystroke: "mod+,",
      run: store.openSettings,
    },
  ];
}

export function filteredContext(): PaletteAction[] {
  const search = query().trim().toLowerCase();
  return contextActions().filter((action) => matches(action, search));
}

export function filteredGlobal(): PaletteAction[] {
  const search = query().trim().toLowerCase();
  return globalActions().filter((action) => matches(action, search));
}

export function visibleActions(): PaletteAction[] {
  return [...filteredContext(), ...filteredGlobal()];
}

export function setQuery(text: string): void {
  query.set(text);
  selectedIndex.set(0);
}

export function moveSelection(delta: number): void {
  const actions = visibleActions();
  if (actions.length === 0) {
    selectedIndex.set(0);
    return;
  }
  const next = (selectedIndex() + delta + actions.length) % actions.length;
  selectedIndex.set(next);
}

export function runAction(action: PaletteAction): void {
  query.set("");
  selectedIndex.set(0);
  action.run();
  if (store.activeModal() === "actionPalette") {
    store.closeModal();
  }
}

export function runSelected(): void {
  const actions = visibleActions();
  if (actions.length === 0) {
    return;
  }
  const index = Math.min(Math.max(selectedIndex(), 0), actions.length - 1);
  runAction(actions[index]);
}

/** Runs the action bound to `keystroke`, if the palette holds one. */
export function runShortcut(keystroke: string): boolean {
  const action = [...contextActions(), ...globalActions()].find(
    (entry) => entry.keystroke === keystroke,
  );
  if (!action) {
    return false;
  }
  runAction(action);
  return true;
}

export function reset(): void {
  query.set("");
  selectedIndex.set(0);
}

export function openPalette(): void {
  reset();
  store.openActionPalette();
}
