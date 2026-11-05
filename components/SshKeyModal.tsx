import { Text, View } from "nsh";
import { Input } from "nsh/base";
import { signal } from "nsh";
import type { SshKeyMode } from "omawarden-app/native";
import * as store from "../store/appStore";
import { tint } from "../theme/palette";
import { TabButton, inputStyle } from "./AuthView";
import { ActionButton, Chip, FieldRow, ModalShell, Panel, SectionTitle } from "./ui";

const ALGORITHMS = ["ed25519", "rsa-2048", "rsa-4096", "ecdsa-p256", "ecdsa-p384"];

const algorithm = signal("ed25519");
const comment = signal("omawarden");
const name = signal("New SSH Key");
const filename = signal("id_ed25519");
const importedPem = signal("");
const saveToVault = signal(true);
const exportToSsh = signal(false);
const exportDir = signal("~/.ssh");
const revealPrivate = signal(false);

const MODE_LABELS: Array<{ mode: SshKeyMode; label: string; testID: string }> = [
  { mode: "create", label: "Create", testID: "ssh-mode-create" },
  { mode: "import", label: "Import", testID: "ssh-mode-import" },
  { mode: "export", label: "Export", testID: "ssh-mode-export" },
];

export function SshKeyModal() {
  const palette = store.palette;
  const mode = store.sshKeyMode;
  const preview = store.sshPreview;
  const item = store.inspector;
  const sshItem = () => item()?.ssh ?? null;

  const switchMode = (next: SshKeyMode) => {
    store.sshKeyMode.set(next);
    store.sshPreview.set(null);
    revealPrivate.set(false);
    if (next === "export" && sshItem()) {
      algorithm.set(sshItem()!.keyType.toLowerCase());
      name.set(item()?.title ?? name());
      comment.set(item()?.title ?? comment());
    }
  };

  const generatePreview = () => {
    store.previewSshKey(mode(), algorithm(), comment(), importedPem());
  };

  const save = () => {
    store.saveSshKey({
      mode: mode(),
      algorithm: algorithm(),
      comment: comment(),
      privateKeyPem: importedPem(),
      name: name(),
      filename: filename(),
      saveToVault: mode() === "export" ? false : saveToVault(),
      exportToSsh: mode() === "export" ? true : exportToSsh(),
      exportDir: exportDir(),
    });
  };

  const browseImport = () => {
    const pem = store.browseSshImport();
    if (pem) {
      importedPem.set(pem);
    } else {
      store.notify("Could not read that private key file.", "error");
    }
  };

  const browseExportDir = () => {
    const path = store.chooseFolder("Select SSH Export Directory");
    if (path) {
      exportDir.set(path);
    }
  };

  return (
    <ModalShell
      title="SSH Key"
      testID="ssh-key-modal"
      subtitle="Generate, import, or export an SSH key."
      width={640}
    >
      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
        <Each of={MODE_LABELS} key="index">
          {(entry) => (
            <TabButton
              label={entry().label}
              testID={entry().testID}
              active={mode() === entry().mode}
              onPress={() => switchMode(entry().mode)}
            />
          )}
        </Each>
      </View>

      {mode() === "export" ? (
        <Panel testID="ssh-export-panel">
          <SectionTitle hint="Write the selected SSH key to a file under ~/.ssh.">
            Export SSH Key
          </SectionTitle>
          {sshItem() ? (
            <View style={{ gap: 4 }}>
              <FieldRow label="Item" value={item()?.title ?? ""} />
              <FieldRow label="Key Type" value={sshItem()!.keyType} />
              <FieldRow label="Fingerprint" value={sshItem()!.fingerprint} mono />
              <FieldRow label="Public Key" value={sshItem()!.publicKey} mono />
            </View>
          ) : (
            <Text testID="ssh-export-empty" style={{ color: palette().warning, fontSize: 12 }}>
              Select an SSH key item in the vault before exporting.
            </Text>
          )}

          <SettingInput
            label="Filename"
            testID="ssh-filename"
            value={filename()}
            onChange={(value: string) => filename.set(value)}
            hint="Private key path: ~/.ssh/&lt;filename&gt;"
          />
          <SettingInput
            label="Destination Directory"
            testID="ssh-export-dir"
            value={exportDir()}
            onChange={(value: string) => exportDir.set(value)}
            hint="Where the private and public key files are written."
            browseTestID="ssh-export-dir-browse"
            onBrowse={browseExportDir}
          />
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <ActionButton
              label="Export Key"
              testID="ssh-export-save"
              tone="primary"
              disabled={!sshItem()}
              onPress={save}
            />
          </View>
        </Panel>
      ) : (
        <Panel testID="ssh-create-panel">
          <SectionTitle hint="Keys are generated locally; the private key never leaves this machine.">
            {mode() === "import" ? "Import SSH Key" : "Generate SSH Key"}
          </SectionTitle>

          {mode() === "create" ? (
            <View style={{ gap: 4 }}>
              <Text style={{ color: palette().muted, fontSize: 12 }}>Algorithm</Text>
              <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                <Each of={ALGORITHMS} key="index">
                  {(entry) => (
                    <TabButton
                      label={entry()}
                      testID={`ssh-algorithm-${entry()}`}
                      active={algorithm() === entry()}
                      onPress={() => {
                        algorithm.set(entry());
                        store.sshPreview.set(null);
                      }}
                    />
                  )}
                </Each>
              </View>
            </View>
          ) : (
            <View style={{ gap: 4 }}>
              <Text style={{ color: palette().muted, fontSize: 12 }}>
                OpenSSH Private Key
              </Text>
              <Input
                testID="ssh-private-key-input"
                value={importedPem()}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                onChange={({ value }) => importedPem.set(value)}
                style={{ ...inputStyle(), minHeight: 110, fontFamily: "monospace" }}
              />
              <ActionButton
                label="Browse Key File…"
                testID="ssh-import-browse"
                onPress={browseImport}
              />
            </View>
          )}

          <SettingInput
            label="Item Name"
            testID="ssh-name"
            value={name()}
            onChange={(value: string) => name.set(value)}
            hint="The vault item name used when saving."
          />
          <SettingInput
            label="Comment"
            testID="ssh-comment"
            value={comment()}
            onChange={(value: string) => comment.set(value)}
            hint="Added to the public key as its trailing comment."
          />
          <SettingInput
            label="Filename"
            testID="ssh-filename"
            value={filename()}
            onChange={(value: string) => filename.set(value)}
            hint="Private key path when exporting: ~/.ssh/&lt;filename&gt;"
          />
          {exportToSsh() ? (
            <SettingInput
              label="Destination Directory"
              testID="ssh-export-dir"
              value={exportDir()}
              onChange={(value: string) => exportDir.set(value)}
              hint="Where the private and public key files are written."
              browseTestID="ssh-export-dir-browse"
              onBrowse={browseExportDir}
            />
          ) : null}

          <ToggleRow
            label="Save to Vault"
            testID="ssh-save-vault"
            checked={saveToVault()}
            onChange={(value: boolean) => saveToVault.set(value)}
          />
          <ToggleRow
            label="Export to ~/.ssh"
            testID="ssh-export-toggle"
            checked={exportToSsh()}
            onChange={(value: boolean) => exportToSsh.set(value)}
          />

          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <ActionButton label="Preview Key" testID="ssh-preview" onPress={generatePreview} />
            <ActionButton
              label={saveToVault() ? "Save SSH Key" : "Export SSH Key"}
              testID="ssh-save"
              tone="primary"
              disabled={mode() === "import" && importedPem().trim().length === 0}
              onPress={save}
            />
          </View>
        </Panel>
      )}

      {preview() ? (
        <Panel testID="ssh-key-preview">
          <View
            style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}
          >
            <Chip label={preview()!.algorithm || algorithm()} color={palette().purple} />
            <Chip label={preview()!.mode} color={palette().info} />
            {preview()!.ok ? (
              <Chip label="Ready" color={palette().success} />
            ) : (
              <Chip label="Failed" color={palette().danger} />
            )}
          </View>
          {preview()!.ok ? (
            <View style={{ gap: 4 }}>
              <FieldRow
                label="Fingerprint"
                value={preview()!.fingerprint}
                mono
                copyTestID="ssh-copy-fingerprint"
                onCopy={() => store.copyText(preview()!.fingerprint, "fingerprint", false)}
              />
              <FieldRow
                label="Public Key"
                value={preview()!.publicKey}
                mono
                copyTestID="ssh-copy-public-key"
                onCopy={() => store.copyText(preview()!.publicKey, "public key", false)}
              />
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ color: palette().muted, fontSize: 12, width: 132 }}>
                  Private Key
                </Text>
                <Text
                  testID="ssh-private-key-preview"
                  style={{
                    userSelect: "text",
                    numberOfLines: 3,
                    flex: 1,
                    color: palette().popups.text,
                    fontSize: 11,
                    fontFamily: "monospace",
                  }}
                >
                  {revealPrivate()
                    ? preview()!.privateKey
                    : "••••••••••••••••••••••••••••••••"}
                </Text>
                <ActionButton
                  label={revealPrivate() ? "Hide" : "Reveal"}
                  testID="ssh-reveal-private"
                  onPress={() => revealPrivate.set(!revealPrivate())}
                />
              </View>
            </View>
          ) : (
            <Text style={{ color: palette().danger, fontSize: 12 }}>
              {preview()!.error ?? "Could not prepare the SSH key."}
            </Text>
          )}
        </Panel>
      ) : null}

      <View
        style={{
          backgroundColor: tint(palette().info, palette().popups.background, 0.12),
          borderRadius: 8,
          padding: 10,
        }}
      >
        <Text style={{ color: palette().muted, fontSize: 11 }}>
          Private keys are written with 0600 permissions and are never displayed unless you
          reveal them here.
        </Text>
      </View>
    </ModalShell>
  );
}

function SettingInput(props: {
  label: string;
  testID: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  browseTestID?: string;
  onBrowse?: () => void;
}) {
  const palette = store.palette;
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: palette().muted, fontSize: 12 }}>{props.label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Input
          testID={props.testID}
          value={props.value}
          autoCapitalize="none"
          autoCorrect={false}
          onChange={({ value }) => props.onChange(value)}
          style={{ ...inputStyle(), flex: 1 }}
        />
        {props.onBrowse ? (
          <ActionButton
            label="Browse…"
            testID={props.browseTestID}
            onPress={props.onBrowse}
          />
        ) : null}
      </View>
      {props.hint ? (
        <Text style={{ color: palette().muted, fontSize: 10 }}>{props.hint}</Text>
      ) : null}
    </View>
  );
}

function ToggleRow(props: {
  label: string;
  testID: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const palette = store.palette;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
      }}
    >
      <Text style={{ color: palette().popups.text, fontSize: 12 }}>{props.label}</Text>
      <ActionButton
        label={props.checked ? "On" : "Off"}
        testID={props.testID}
        tone={props.checked ? "primary" : "secondary"}
        onPress={() => props.onChange(!props.checked)}
      />
    </View>
  );
}
