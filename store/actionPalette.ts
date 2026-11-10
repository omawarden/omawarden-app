import { keymap, signal } from "nsh";
import type { IconName } from "../components/Icon";
import * as store from "./appStore";
import { focusSearch } from "./searchFocus";

export interface PaletteAction {
  id: string;
  label: string;
  hint: string;
  icon: IconName;
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
      icon: "key",
      shortcut: "↵",
      run: () => store.copyField("password"),
    });
    actions.push({
      id: "copy-username",
      label: "Copy Username",
      hint: "Copy the selected login username",
      icon: "user",
      shortcut: "Ctrl+U",
      keystroke: "mod+u",
      run: () => store.copyField("username"),
    });
    if (current.hasTotp) {
      actions.push({
        id: "copy-totp",
        label: "Copy TOTP",
        hint: "Copy the current one-time code",
        icon: "clock",
        shortcut: "Ctrl+↵",
        keystroke: "mod+enter",
        run: () => store.copyField("totp"),
      });
    }
    actions.push({
      id: "reveal-password",
      label: "Reveal Password",
      hint: "Toggle the password visibility",
      icon: "eye",
      shortcut: "Ctrl+T",
      keystroke: "mod+t",
      run: () => store.toggleReveal("password"),
    });
    if (current.hasPasswordHistory) {
      actions.push({
        id: "password-history",
        label: "View Password History",
        hint: "Browse previous passwords",
        icon: "history",
        shortcut: "Ctrl+H",
        keystroke: "mod+h",
        run: store.openPasswordHistory,
      });
    }
  }
  if (current.category === "sshKey") {
    const ssh = store.inspector()?.ssh;
    if (ssh && ssh.privateKey) {
      actions.push({
        id: "copy-private-key",
        label: "Copy Private Key",
        hint: "Copy the selected SSH private key",
        icon: "key",
        shortcut: "↵",
        run: () => store.copyField("private_key"),
      });
    }
    if (ssh && ssh.publicKey) {
      actions.push({
        id: "copy-public-key",
        label: "Copy Public Key",
        hint: "Copy the selected SSH public key",
        icon: "key",
        shortcut: "Ctrl+U",
        keystroke: "mod+u",
        run: () => store.copyField("public_key"),
      });
    }
    if (ssh && ssh.fingerprint) {
      actions.push({
        id: "copy-fingerprint",
        label: "Copy Fingerprint",
        hint: "Copy the key's SHA256 fingerprint",
        icon: "key",
        run: () => store.copyText(ssh.fingerprint, "fingerprint", false),
      });
    }
    actions.push({
      id: "export-ssh-key",
      label: "Export SSH Key",
      hint: "Write the key to ~/.ssh",
      icon: "terminal",
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
      hint: first.display || first.uri,
      icon: "external-link",
      shortcut: "Ctrl+O",
      keystroke: "mod+o",
      run: () => store.openUrl(first.uri),
    });
  }
  if (current.category === "login" || current.category === "secureNote") {
    actions.push({
      id: "edit-cipher",
      label: "Edit Item",
      hint: "Change the selected item's fields",
      icon: "pencil",
      shortcut: "Ctrl+E",
      keystroke: "mod+e",
      run: store.openCipherEdit,
    });
    actions.push({
      id: "delete-cipher",
      label: "Delete Item",
      hint: "Move the selected item to the trash",
      icon: "trash",
      shortcut: "Ctrl+D",
      keystroke: "mod+d",
      run: () => store.openCipherDelete(false),
    });
  }
  return actions;
}

/** Actions that operate on the whole vault. */
export function globalActions(): PaletteAction[] {
  return [
    {
      id: "search-vault",
      label: "Search Vault",
      hint: "Put the keyboard in the vault search box",
      icon: "search",
      shortcut: keymap.label("mod+f"),
      // Focus once the palette that asked for it has closed, so the closing
      // dialog cannot take the field's focus on its way out.
      run: () => setTimeout(() => focusSearch(true), 0),
    },
    {
      id: "go-to-item",
      label: "Go to Item",
      hint: "Jump to an item by name or id",
      icon: "search",
      shortcut: "Ctrl+P",
      keystroke: "mod+p",
      run: store.openCipherResolve,
    },
    {
      id: "sync",
      label: "Sync Vault",
      hint: "Synchronize with the Bitwarden server",
      icon: "refresh-cw",
      shortcut: "Ctrl+R",
      keystroke: "mod+r",
      run: store.sync,
    },
    {
      id: "generator",
      label: "Open Password Generator",
      hint: "Create a strong password or passphrase",
      icon: "key",
      shortcut: "Ctrl+G",
      keystroke: "mod+g",
      run: store.openGenerator,
    },
    {
      id: "create-login",
      label: "Create Login",
      hint: "Add a new login to the vault",
      icon: "key",
      shortcut: "Ctrl+N",
      keystroke: "mod+n",
      run: () => store.openCipherForm("login"),
    },
    {
      id: "create-secure-note",
      label: "Create Secure Note",
      hint: "Add a new secure note to the vault",
      icon: "file-text",
      run: () => store.openCipherForm("note"),
    },
    {
      id: "create-ssh-key",
      label: "Create SSH Key",
      hint: "Generate or import an SSH key",
      icon: "key",
      run: () => store.openSshKey("create"),
    },
    {
      id: "lock",
      label: "Lock Vault",
      hint: "Clear the session and lock the vault",
      icon: "lock",
      shortcut: "Ctrl+L",
      keystroke: "mod+l",
      run: () => store.lockOrLogout(false),
    },
    {
      id: "settings",
      label: "Open Settings",
      hint: "Manage configuration and diagnostics",
      icon: "settings",
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
