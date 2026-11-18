import { effect, host, keymap, mount, setColorScheme, View } from "nsh";
import * as store from "./store/appStore";
import * as palette from "./store/actionPalette";
import { blurSearch, focusSearch } from "./store/searchFocus";
import { windowBelowMinimum } from "./store/windowGate";
import { ActionPaletteModal } from "./components/ActionPaletteModal";
import { AuthView } from "./components/AuthView";
import { CategoryTabBar } from "./components/CategoryTabBar";
import { CipherDeleteModal } from "./components/CipherDeleteModal";
import { CipherResolveModal } from "./components/CipherResolveModal";
import { DependencyCheckView } from "./components/DependencyCheckView";
import { FooterBar } from "./components/FooterBar";
import { ItemInspector } from "./components/ItemInspector";
import { MasterPasswordModal } from "./components/MasterPasswordModal";
import { MinimumWindowGate } from "./components/MinimumWindowGate";
import { PasswordGeneratorModal } from "./components/PasswordGeneratorModal";
import { PasswordHistoryModal } from "./components/PasswordHistoryModal";
import { ReleaseNotesModal } from "./components/ReleaseNotesModal";
import { ScopeDropdown } from "./components/ScopeDropdown";
import { SearchHeader } from "./components/SearchHeader";
import { SettingsModal } from "./components/SettingsModal";
import { SshApprovalModal } from "./components/SshApprovalModal";
import { SshKeyModal } from "./components/SshKeyModal";
import { ToastAlert } from "./components/ToastAlert";
import { TypePickerModal } from "./components/TypePickerModal";
import { VaultItemList } from "./components/VaultItemList";

function VaultWorkspace() {
  return (
    <View
      testID="vault-workspace"
      style={{ flex: 1, backgroundColor: store.palette().menu.background }}
    >
      <SearchHeader />
      <If when={store.scopeOpen()}>
        <ScopeDropdown />
      </If>
      <CategoryTabBar />
      <View
        style={{
          flex: 1,
          flexDirection: "row",
          alignItems: "stretch",
          gap: 10,
          paddingHorizontal: 10,
          paddingVertical: 10,
        }}
      >
        <VaultItemList />
        <ItemInspector />
      </View>
      <FooterBar />
    </View>
  );
}

function App() {
  effect(() => {
    setColorScheme(store.theme() === "light" ? "light" : "dark");
  });

  return (
    <View
      testID="app-root"
      style={{
        flex: 1,
        backgroundColor: store.palette().menu.background,
      }}
    >
      <If when={store.phase() === "dependencyCheck"}>
        <DependencyCheckView />
      </If>
      <If when={store.phase() === "login"}>
        <AuthView mode="login" />
      </If>
      <If when={store.phase() === "twoFactor"}>
        <AuthView mode="twoFactor" />
      </If>
      <If when={store.phase() === "locked"}>
        <AuthView mode="locked" />
      </If>
      <If when={store.phase() === "unlocked"}>
        <VaultWorkspace />
      </If>

      <If when={store.activeModal() === "actionPalette"}>
        <ActionPaletteModal />
      </If>
      <If when={store.activeModal() === "typePicker"}>
        <TypePickerModal />
      </If>
      <If when={store.activeModal() === "cipherDelete"}>
        <CipherDeleteModal />
      </If>
      <If when={store.activeModal() === "cipherResolve"}>
        <CipherResolveModal />
      </If>
      <If when={store.activeModal() === "generator"}>
        <PasswordGeneratorModal />
      </If>
      <If when={store.activeModal() === "sshKey"}>
        <SshKeyModal />
      </If>
      <If when={store.activeModal() === "passwordHistory"}>
        <PasswordHistoryModal />
      </If>
      <If when={store.activeModal() === "settings"}>
        <SettingsModal />
      </If>
      <If when={store.activeModal() === "releaseNotes"}>
        <ReleaseNotesModal />
      </If>
      <If when={store.activeModal() === "reprompt"}>
        <MasterPasswordModal />
      </If>
      <If when={store.sshPrompt() !== null}>
        <SshApprovalModal />
      </If>

      <ToastAlert />
      <MinimumWindowGate />
    </View>
  );
}

store.bootApp();

const hasOpenModal = () =>
  store.activeModal() !== "none" || store.sshPrompt() !== null;

const canUseVaultShortcuts = () =>
  store.phase() === "unlocked" &&
  !hasOpenModal() &&
  !windowBelowMinimum() &&
  // The Inspector Form is not a dialog, but it owns the keyboard while it is
  // open: a global shortcut must not filter the list behind a typed secret.
  store.cipherForm() === null;

const paletteOpen = () => store.activeModal() === "actionPalette";

// Bindings that do not go through the shared vault guard still have to stand
// down while the minimum window gate is up.
const whenWindowFits = (run: () => void) => () => {
  if (!windowBelowMinimum()) {
    run();
  }
};

keymap.bind({
  "mod+k": () => {
    if (canUseVaultShortcuts()) {
      palette.openPalette();
    }
  },
  "mod+f": () => {
    if (canUseVaultShortcuts()) {
      focusSearch(true);
    }
  },
  "mod+enter": () => {
    if (canUseVaultShortcuts()) {
      store.copyField("totp");
    }
  },
  "ctrl+enter": () => {
    if (canUseVaultShortcuts()) {
      store.copyField("totp");
    }
  },
  "mod+u": () => {
    if (canUseVaultShortcuts()) {
      if (store.selectedCipher()?.category === "sshKey") {
        store.copyField("public_key");
      } else {
        store.copyField("username");
      }
    }
  },
  "mod+t": () => {
    if (canUseVaultShortcuts()) {
      store.toggleReveal("password");
    }
  },
  "mod+o": () => {
    if (canUseVaultShortcuts()) {
      store.openFirstUrl();
    }
  },
  "mod+h": () => {
    if (canUseVaultShortcuts()) {
      store.openPasswordHistory();
    }
  },
  "mod+e": () => {
    if (!canUseVaultShortcuts()) {
      return;
    }
    const category = store.selectedCipher()?.category;
    if (category === "sshKey") {
      store.openSshKey("export");
    } else if (category === "login" || category === "secureNote") {
      store.openCipherEdit();
    }
  },
  "mod+p": () => {
    if (canUseVaultShortcuts()) {
      store.openCipherResolve();
    }
  },
  "mod+n": () => {
    // The picker is the same shortcut's second step, so pressing it again
    // toggles the choice instead of reopening a dialog that is already up.
    if (store.activeModal() === "typePicker") {
      store.cycleTypePicker();
      return;
    }
    if (canUseVaultShortcuts()) {
      store.openTypePicker();
    }
  },
  "mod+d": () => {
    if (canUseVaultShortcuts()) {
      store.openCipherDelete(false);
    }
  },
  "mod+g": () => {
    if (canUseVaultShortcuts()) {
      store.openGenerator();
    }
  },
  "mod+r": () => {
    if (canUseVaultShortcuts()) {
      store.sync();
    }
  },
  "mod+l": () => {
    if (canUseVaultShortcuts()) {
      store.lockOrLogout(false);
    }
  },
  "mod+,": whenWindowFits(() => {
    if (!paletteOpen()) {
      store.openSettings();
    }
  }),
  up: whenWindowFits(() => {
    // The palette owns its own key bindings while it is open.
    if (paletteOpen()) {
      return;
    }
    if (canUseVaultShortcuts()) {
      store.moveSelection(-1);
    }
  }),
  down: whenWindowFits(() => {
    if (paletteOpen()) {
      return;
    }
    if (canUseVaultShortcuts()) {
      store.moveSelection(1);
    }
  }),
  enter: whenWindowFits(() => {
    if (paletteOpen()) {
      return;
    }
    if (store.activateFocusedAction()) {
      return;
    }
    if (canUseVaultShortcuts()) {
      store.primaryCopy();
    }
  }),
  escape: whenWindowFits(() => {
    // The open Inspector Form owns Esc through its own binding below; this
    // handler must not also toggle the scope or clear a focus behind it.
    if (store.cipherForm() !== null) {
      return;
    }
    if (store.scopeOpen()) {
      store.toggleScope();
      return;
    }
    if (store.focusedAction()) {
      store.clearActionFocus();
      return;
    }
    if (store.activeModal() !== "none") {
      store.closeModal();
    }
  }),
});

// Linux/GTK's native Tab traversal only visits text fields, so the app moves
// its own focus between the action controls. The default binding is enough
// while no input is being edited; the vault search's focused case is covered
// by the `always` bindings below.
keymap.bind("tab", whenWindowFits(() => store.cycleAction(1)), {
  when: "notEditing",
  repeat: true,
});
keymap.bind("shift+tab", whenWindowFits(() => store.cycleAction(-1)), {
  when: "notEditing",
  repeat: true,
});

// The vault search field holds the keyboard while the vault is shown, and NSH
// hands every non-character key to a focused input by default. These bindings
// ask for the key anyway, and exist only while the vault is usable, so a
// dialog — which takes the keyboard out of the search — keeps it for its own
// fields.
effect(() => {
  if (!canUseVaultShortcuts()) {
    return;
  }
  const unbindKeys = keymap.bind(
    {
      "mod+enter": () => store.copyField("totp"),
      "ctrl+enter": () => store.copyField("totp"),
      // Favorite is Ctrl+B, not Ctrl+V: the latter has to stay paste inside
      // the search field (and the palette's own search), or the shortcut steals
      // the key and fires a mutation instead of pasting.
      "mod+b": () => store.toggleFavorite(),
      up: () => {
        // The palette owns its own key bindings while it is open.
        if (paletteOpen()) {
          return;
        }
        store.moveSelection(-1);
      },
      down: () => {
        if (paletteOpen()) {
          return;
        }
        store.moveSelection(1);
      },
    },
    { when: "always" },
  );
  // Linux/GTK's native Tab traversal only visits text fields, so the app moves
  // its own focus between the action controls. Tab leaves the search field
  // first: the field must not be a focus trap, and Space (still `notEditing`)
  // can only activate the focused action once the input has let go.
  const unbindTabs = keymap.bind(
    {
      tab: () => {
        blurSearch();
        store.cycleAction(1);
      },
      "shift+tab": () => {
        blurSearch();
        store.cycleAction(-1);
      },
    },
    { when: "always", repeat: true },
  );
  return () => {
    unbindKeys();
    unbindTabs();
  };
});

keymap.bind("space", whenWindowFits(() => store.activateFocusedAction()), {
  when: "notEditing",
});

// The Inspector Form is not a dialog: it takes the keyboard from the vault
// (see `canUseVaultShortcuts`) and these three keys reach it even while a
// field has the focus, which is where the user spends the whole form.
effect(() => {
  if (store.cipherForm() === null) {
    return;
  }
  if (windowBelowMinimum()) {
    return;
  }
  return keymap.bind(
    {
      "mod+s": () => {
        if (store.activeModal() === "none") {
          store.submitCipherFormDraft();
        }
      },
      "mod+g": () => {
        if (store.activeModal() === "none") {
          store.openGeneratorFill();
        }
      },
      escape: () => {
        // A dialog opened over the form (the generator) closes first; the
        // form's own cancel only runs once nothing is above it.
        if (store.activeModal() !== "none") {
          store.closeModal();
          return;
        }
        store.cancelCipherForm();
      },
    },
    { when: "always" },
  );
});

// A form that closes hands the keyboard back to the search. The query stays as
// it was: Ctrl+F is the shortcut that selects it for replacing.
let formWasOpen = false;
effect(() => {
  const open = store.cipherForm() !== null;
  if (formWasOpen && !open) {
    focusSearch();
  }
  formWasOpen = open;
});

host.on("theme-update", (payload) => {
  store.applyHostTheme(payload);
});

mount(App);
