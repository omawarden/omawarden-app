import { effect, host, keymap, mount, Scroll, setColorScheme, View, windowSize } from "nsh";
import * as store from "./store/appStore";
import * as palette from "./store/actionPalette";
import { blurSearch, focusSearch } from "./store/searchFocus";
import { windowTooShortForShell } from "./store/shellScroll";
import { installTray } from "./store/trayWiring";
import { ActionPaletteModal } from "./components/ActionPaletteModal";
import { AuthView } from "./components/AuthView";
import { CategoryTabBar } from "./components/CategoryTabBar";
import { CipherDeleteModal } from "./components/CipherDeleteModal";
import { CipherResolveModal } from "./components/CipherResolveModal";
import { DependencyCheckView } from "./components/DependencyCheckView";
import { FooterBar } from "./components/FooterBar";
import { ItemInspector } from "./components/ItemInspector";
import { MasterPasswordModal } from "./components/MasterPasswordModal";
import { PasswordGeneratorModal } from "./components/PasswordGeneratorModal";
import { PasswordHistoryModal } from "./components/PasswordHistoryModal";
import { ReleaseNotesModal } from "./components/ReleaseNotesModal";
import { ScopeDropdown } from "./components/ScopeDropdown";
import { SearchHeader } from "./components/SearchHeader";
import { SettingsModal } from "./components/SettingsModal";
import { ShortWindowGate } from "./components/ShortWindowGate";
import { SshApprovalModal } from "./components/SshApprovalModal";
import { SshKeyModal } from "./components/SshKeyModal";
import { ToastAlert } from "./components/ToastAlert";
import { TypePickerModal } from "./components/TypePickerModal";
import { VaultItemList } from "./components/VaultItemList";
import { shellContentWidth } from "./theme/layout";

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
      {/* Width is no longer a floor the app enforces by refusing to render: a
          window narrower than the layout keeps the layout at its floor width
          and scrolls sideways. The child is given that width explicitly because
          a horizontal scroll view lays its content out as wide as the child
          asks, and a `minWidth` on the content is not a documented way to widen
          it. It fills the height so the panes' `flex: 1` has something to
          resolve against. */}
      <Scroll testID="shell-scroll" horizontal style={{ flex: 1 }}>
        <View
          testID="shell-content"
          style={{
            width: shellContentWidth(windowSize().width),
            height: "100%",
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
        </View>
      </Scroll>

      {/* Dialogs and the toast are overlays, not content: they are laid out
          against the window so a narrow window keeps the dialog in front of the
          user instead of somewhere inside the scrolled content. */}
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
      <ShortWindowGate />
    </View>
  );
}

store.bootApp();

const hasOpenModal = () =>
  store.activeModal() !== "none" || store.sshPrompt() !== null;

const canUseVaultShortcuts = () =>
  store.phase() === "unlocked" &&
  !hasOpenModal() &&
  !windowTooShortForShell() &&
  // The Inspector Form is not a dialog, but it owns the keyboard while it is
  // open: a global shortcut must not filter the list behind a typed secret.
  store.cipherForm() === null;

const paletteOpen = () => store.activeModal() === "actionPalette";

// Bindings that do not go through the shared vault guard still have to stand
// down while the short-window gate is up.
const whenWindowTallEnough = (run: () => void) => () => {
  if (!windowTooShortForShell()) {
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
  "mod+,": whenWindowTallEnough(() => {
    if (!paletteOpen()) {
      store.openSettings();
    }
  }),
  up: whenWindowTallEnough(() => {
    // The palette owns its own key bindings while it is open.
    if (paletteOpen()) {
      return;
    }
    if (canUseVaultShortcuts()) {
      store.moveSelection(-1);
    }
  }),
  down: whenWindowTallEnough(() => {
    if (paletteOpen()) {
      return;
    }
    if (canUseVaultShortcuts()) {
      store.moveSelection(1);
    }
  }),
  enter: whenWindowTallEnough(() => {
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
  escape: whenWindowTallEnough(() => {
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
// its own focus between the action controls and, while the Inspector Form is
// open, between its fields and buttons. The default binding is enough while no
// input is being edited; the vault search's focused case is covered by the
// `always` bindings below.
keymap.bind("tab", whenWindowTallEnough(() => store.cycleVaultFocus(1)), {
  when: "notEditing",
  repeat: true,
});
keymap.bind("shift+tab", whenWindowTallEnough(() => store.cycleVaultFocus(-1)), {
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
        store.cycleVaultFocus(1);
      },
      "shift+tab": () => {
        blurSearch();
        store.cycleVaultFocus(-1);
      },
    },
    { when: "always", repeat: true },
  );
  return () => {
    unbindKeys();
    unbindTabs();
  };
});

keymap.bind("space", whenWindowTallEnough(() => store.activateFocusedAction()), {
  when: "notEditing",
});

// The Inspector Form is not a dialog: it takes the keyboard from the vault
// (see `canUseVaultShortcuts`) and these keys reach it even while a field has
// the focus, which is where the user spends the whole form.
effect(() => {
  if (store.cipherForm() === null) {
    return;
  }
  if (windowTooShortForShell()) {
    return;
  }
  const unbindForm = keymap.bind(
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
  // Tab is the app's own ring here, as it is for the vault: `always`, so the
  // platform's traversal — which reaches text fields only — never takes the key
  // and strands the buttons.
  const unbindTabs = keymap.bind(
    {
      tab: () => store.cycleCipherFormFocus(1),
      "shift+tab": () => store.cycleCipherFormFocus(-1),
    },
    { when: "always", repeat: true },
  );
  return () => {
    unbindForm();
    unbindTabs();
  };
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

// The tray and the close button belong to the app, not to a render: installing
// once here keeps a re-render from adding a second listener.
installTray();

mount(App);
