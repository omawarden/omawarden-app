import { Text, View } from "nsh";
import { Input } from "nsh/base";
import { signal } from "nsh";
import * as store from "../store/appStore";
import { inputStyle } from "./AuthView";
import { ActionButton, ModalShell, SectionTitle } from "./ui";

interface PaletteAction {
  id: string;
  label: string;
  hint: string;
  run: () => void;
}

const query = signal("");

const GLOBAL_ACTIONS: PaletteAction[] = [
  {
    id: "sync",
    label: "Sync Vault",
    hint: "Synchronize with the Bitwarden server",
    run: () => store.sync(),
  },
  {
    id: "generator",
    label: "Open Password Generator",
    hint: "Create a strong password or passphrase",
    run: store.openGenerator,
  },
  {
    id: "create-ssh-key",
    label: "Create SSH Key",
    hint: "Generate or import an SSH key",
    run: () => store.openSshKey("create"),
  },
  {
    id: "lock",
    label: "Lock Vault",
    hint: "Clear the session and lock the vault",
    run: () => store.lockOrLogout(false),
  },
  {
    id: "settings",
    label: "Open Settings",
    hint: "Manage configuration and diagnostics",
    run: store.openSettings,
  },
];

function matches(action: PaletteAction, search: string): boolean {
  return (
    !search ||
    action.label.toLowerCase().includes(search) ||
    action.hint.toLowerCase().includes(search)
  );
}

export function ActionPaletteModal() {
  const palette = store.palette;
  const cipher = store.selectedCipher;
  const detail = store.inspector;

  const contextActions = (): PaletteAction[] => {
    const actions: PaletteAction[] = [];
    const current = cipher();
    if (current) {
      if (current.category === "login") {
        actions.push({
          id: "copy-password",
          label: "Copy Password",
          hint: "Copy the selected login password",
          run: () => store.copyField("password"),
        });
        actions.push({
          id: "copy-username",
          label: "Copy Username",
          hint: "Copy the selected login username",
          run: () => store.copyField("username"),
        });
        if (current.hasTotp) {
          actions.push({
            id: "copy-totp",
            label: "Copy TOTP",
            hint: "Copy the current one-time code",
            run: () => store.copyField("totp"),
          });
        }
        actions.push({
          id: "reveal-password",
          label: "Reveal Password",
          hint: "Toggle the password visibility",
          run: () => store.toggleReveal("password"),
        });
        if (current.hasPasswordHistory) {
          actions.push({
            id: "password-history",
            label: "View Password History",
            hint: "Browse previous passwords",
            run: store.openPasswordHistory,
          });
        }
      }
      if (current.category === "sshKey") {
        actions.push({
          id: "export-ssh-key",
          label: "Export SSH Key",
          hint: "Write the key to ~/.ssh",
          run: () => store.openSshKey("export"),
        });
      }
      const currentDetail = detail();
      if (currentDetail && currentDetail.uris.length > 0) {
        const first = currentDetail.uris[0];
        actions.push({
          id: "open-url",
          label: "Open URL",
          hint: first.host || first.uri,
          run: () => store.openUrl(first.uri),
        });
      }
    }
    return actions;
  };

  const search = () => query().trim().toLowerCase();
  const visibleContext = () => contextActions().filter((action) => matches(action, search()));
  const visibleGlobal = () => GLOBAL_ACTIONS.filter((action) => matches(action, search()));
  const empty = () => visibleContext().length === 0 && visibleGlobal().length === 0;

  const run = (action: PaletteAction) => {
    query.set("");
    action.run();
    if (store.activeModal() === "actionPalette") {
      store.closeModal();
    }
  };

  return (
    <ModalShell
      title="Action Palette"
      testID="action-palette-modal"
      subtitle="Run a command for the selected item or the whole vault."
      width={560}
    >
      <Input
        testID="action-palette-search"
        value={query()}
        placeholder="Search actions…"
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        onChange={(text: string) => query.set(text)}
        style={inputStyle()}
      />

      <If when={contextActions().length > 0}>
        <SectionTitle hint={cipher()?.title}>Selected Item</SectionTitle>
      </If>
      <Each of={visibleContext()} key="index">
        {(action) => <PaletteRow action={action()} onRun={() => run(action())} />}
      </Each>

      <SectionTitle hint="Vault-wide commands">Global</SectionTitle>
      <Each of={visibleGlobal()} key="index">
        {(action) => <PaletteRow action={action()} onRun={() => run(action())} />}
      </Each>

      {empty() ? (
        <Text testID="action-palette-empty" style={{ color: palette().muted, fontSize: 12 }}>
          No actions match “{query()}”.
        </Text>
      ) : null}

      <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
        <ActionButton
          label="Close"
          testID="action-palette-close"
          onPress={() => {
            query.set("");
            store.closeModal();
          }}
        />
      </View>
    </ModalShell>
  );
}

function PaletteRow(props: { action: PaletteAction; onRun: () => void }) {
  const palette = store.palette;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        borderBottomWidth: 1,
        borderBottomColor: palette().popups.border,
        paddingBottom: 6,
      }}
    >
      <View style={{ flex: 1, minWidth: 200, gap: 1 }}>
        <Text style={{ color: palette().popups.text, fontSize: 13, fontWeight: "bold" }}>
          {props.action.label}
        </Text>
        <Text style={{ color: palette().muted, fontSize: 11 }}>{props.action.hint}</Text>
      </View>
      <ActionButton label="Run" testID={`action-${props.action.id}`} onPress={props.onRun} />
    </View>
  );
}
