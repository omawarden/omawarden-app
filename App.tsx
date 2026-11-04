import { effect, host, keymap, mount, setColorScheme, View } from "nsh";
import * as store from "./store/appStore";
import { ActionPaletteModal } from "./components/ActionPaletteModal";
import { AuthView } from "./components/AuthView";
import { CategoryTabBar } from "./components/CategoryTabBar";
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
    </View>
  );
}

store.bootApp();

const hasOpenModal = () =>
  store.activeModal() !== "none" || store.sshPrompt() !== null;

const canUseVaultShortcuts = () =>
  store.phase() === "unlocked" && !hasOpenModal();

keymap.bind({
  "mod+k": () => {
    if (canUseVaultShortcuts()) {
      store.openActionPalette();
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
  "mod+,": () => {
    store.openSettings();
  },
  up: () => {
    if (canUseVaultShortcuts()) {
      store.moveSelection(-1);
    }
  },
  down: () => {
    if (canUseVaultShortcuts()) {
      store.moveSelection(1);
    }
  },
  enter: () => {
    if (store.activateFocusedAction()) {
      return;
    }
    if (canUseVaultShortcuts()) {
      store.primaryCopy();
    }
  },
  escape: () => {
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
  },
});

// Linux/GTK's native Tab traversal only visits text fields, so the app moves
// its own focus between the action controls. The bindings stay out of the way
// while an input is being edited (the default already, made explicit here).
keymap.bind("tab", () => store.cycleAction(1), { when: "notEditing", repeat: true });
keymap.bind("shift+tab", () => store.cycleAction(-1), { when: "notEditing", repeat: true });
keymap.bind("space", () => store.activateFocusedAction(), { when: "notEditing" });

host.on("theme-update", (payload) => {
  store.applyHostTheme(payload);
});

mount(App);
