import { effect, host, keymap, mount, setColorScheme, View } from "nsh";
import * as store from "./store/appStore";
import * as palette from "./store/actionPalette";
import { blurSearch, focusSearch } from "./store/searchFocus";
import { windowBelowMinimum } from "./store/windowGate";
import { ActionPaletteModal } from "./components/ActionPaletteModal";
import { AuthView } from "./components/AuthView";
import { CategoryTabBar } from "./components/CategoryTabBar";
import { CipherDeleteModal } from "./components/CipherDeleteModal";
import { CipherFormModal } from "./components/CipherFormModal";
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
      <If when={store.activeModal() === "cipherForm"}>
        <CipherFormModal />
      </If>
      <If when={store.activeModal() === "cipherEdit"}>
        <CipherFormModal />
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
  store.phase() === "unlocked" && !hasOpenModal() && !windowBelowMinimum();

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
    if (canUseVaultShortcuts()) {
      store.openCipherForm("login");
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
      "mod+v": () => store.toggleFavorite(),
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

host.on("theme-update", (payload) => {
  store.applyHostTheme(payload);
});

mount(App);
