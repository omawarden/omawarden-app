import { effect, host, keymap, mount, setColorScheme, View } from "nsh";
import * as store from "./store/appStore";
import { ActionPaletteModal } from "./components/ActionPaletteModal";
import { AuthView } from "./components/AuthView";
import { CategoryTabBar } from "./components/CategoryTabBar";
import { DependencyCheckView } from "./components/DependencyCheckView";
import { FooterBar } from "./components/FooterBar";
import { ItemInspector } from "./components/ItemInspector";
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
      {store.scopeOpen() ? <ScopeDropdown /> : null}
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
      {store.snapshot().phase === "dependencyCheck" ? <DependencyCheckView /> : null}
      {store.snapshot().phase === "login" ? <AuthView mode="login" /> : null}
      {store.snapshot().phase === "twoFactor" ? <AuthView mode="twoFactor" /> : null}
      {store.snapshot().phase === "locked" ? <AuthView mode="locked" /> : null}
      {store.snapshot().phase === "unlocked" ? <VaultWorkspace /> : null}

      {store.activeModal() === "actionPalette" ? <ActionPaletteModal /> : null}
      {store.activeModal() === "generator" ? <PasswordGeneratorModal /> : null}
      {store.activeModal() === "sshKey" ? <SshKeyModal /> : null}
      {store.activeModal() === "passwordHistory" ? <PasswordHistoryModal /> : null}
      {store.activeModal() === "settings" ? <SettingsModal /> : null}
      {store.activeModal() === "releaseNotes" ? <ReleaseNotesModal /> : null}
      {store.snapshot().sshPrompt ? <SshApprovalModal /> : null}

      <ToastAlert />
    </View>
  );
}

store.bootApp();

const hasOpenModal = () =>
  store.activeModal() !== "none" || store.snapshot().sshPrompt !== null;

const canUseVaultShortcuts = () =>
  store.snapshot().phase === "unlocked" && !hasOpenModal();

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
    if (canUseVaultShortcuts()) {
      store.primaryCopy();
    }
  },
  escape: () => {
    if (store.activeModal() !== "none") {
      store.closeModal();
    }
  },
});

host.on("theme-update", (payload) => {
  store.applyHostTheme(payload);
});

mount(App);
