import { Text, View } from "nsh";
import { Input } from "nsh/base";
import { signal } from "nsh";
import type { SshAgentPolicy, ThemeAppearance } from "omawarden-app/native";
import * as store from "../store/appStore";
import { tint } from "../theme/palette";
import { TabButton, inputStyle } from "./AuthView";
import { ActionButton, Chip, ModalShell, Panel, SectionTitle } from "./ui";

type SettingsTab = "general" | "security" | "diagnose" | "about";

const tab = signal<SettingsTab>("general");

const TABS: Array<{ id: SettingsTab; label: string; testID: string }> = [
  { id: "general", label: "General", testID: "settings-tab-general" },
  { id: "security", label: "Security", testID: "settings-tab-security" },
  { id: "diagnose", label: "Diagnose", testID: "settings-tab-diagnose" },
  { id: "about", label: "About", testID: "settings-tab-about" },
];

const SSH_POLICIES: Array<{ value: SshAgentPolicy; label: string; testID: string }> = [
  { value: "firstUse", label: "First Use", testID: "settings-policy-first-use" },
  { value: "always", label: "Always", testID: "settings-policy-always" },
  { value: "never", label: "Never", testID: "settings-policy-never" },
];

export function SettingsModal() {
  const palette = store.palette;
  const snapshot = store.settings;
  const draft = store.settingsDraft;

  return (
    <If
      when={snapshot()}
      else={
        <ModalShell title="Settings" testID="settings-modal">
          <Text style={{ color: palette().muted, fontSize: store.type().md }}>Loading settings…</Text>
        </ModalShell>
      }
    >
      {(current) => {
        const config = () => current().config;
        const diagnostics = () => current().diagnostics;
        return (
          <ModalShell
            title="Settings"
            testID="settings-modal"
            subtitle="Configuration, security, diagnostics, and release information."
            width={720}
          >
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
              <Each of={TABS} key="index">
                {(entry) => (
                  <TabButton
                    label={entry().label}
                    testID={entry().testID}
                    active={tab() === entry().id}
                    onPress={() => tab.set(entry().id)}
                  />
                )}
              </Each>
            </View>

            {tab() === "general" ? (
              <Panel testID="settings-general">
                <SectionTitle hint="Connection, display, and update preferences.">
                  General
                </SectionTitle>

                <DraftText
                  label="Server URL"
                  testID="settings-server-url"
                  value={draft().serverUrl ?? config().serverUrl}
                  onChange={(value) => store.updateSettingsDraft({ serverUrl: value })}
                  hint="Remote servers require https://; loopback may use http://."
                />
                <DraftText
                  label="Identity URL"
                  testID="settings-identity-url"
                  value={draft().identityUrl ?? config().identityUrl}
                  onChange={(value) => store.updateSettingsDraft({ identityUrl: value })}
                  hint="Leave empty to use the server's default identity endpoint."
                />
                <DraftText
                  label="Download Directory"
                  testID="settings-download-dir"
                  value={draft().downloadDir ?? config().downloadDir}
                  onChange={(value) => store.updateSettingsDraft({ downloadDir: value })}
                  browseTestID="settings-download-browse"
                  onBrowse={() => {
                    const path = store.chooseFolder("Select Download Directory");
                    if (path) {
                      store.updateSettingsDraft({ downloadDir: path });
                    }
                  }}
                />
                <DraftNumber
                  label="Max Attachment Size (MB)"
                  testID="settings-max-attachment"
                  value={draft().maxAttachmentSizeMb ?? config().maxAttachmentSizeMb}
                  onChange={(value) =>
                    store.updateSettingsDraft({ maxAttachmentSizeMb: value })
                  }
                />

                <DraftToggle
                  label="Remember Email"
                  testID="settings-remember-email"
                  checked={draft().rememberEmail ?? config().rememberEmail}
                  onChange={(value) => store.updateSettingsDraft({ rememberEmail: value })}
                />
                <DraftToggle
                  label="Show Website Icons"
                  testID="settings-show-website-icons"
                  checked={draft().showWebsiteIcons ?? config().showWebsiteIcons}
                  onChange={(value) => store.updateSettingsDraft({ showWebsiteIcons: value })}
                />
                <DraftToggle
                  label="Remember Last Search"
                  testID="settings-remember-last-search"
                  checked={draft().rememberLastSearch ?? config().rememberLastSearch}
                  onChange={(value) =>
                    store.updateSettingsDraft({ rememberLastSearch: value })
                  }
                />
                <DraftToggle
                  label="Check for Updates"
                  testID="settings-check-updates"
                  checked={draft().checkUpdates ?? config().checkUpdates}
                  onChange={(value) => store.updateSettingsDraft({ checkUpdates: value })}
                />

                <View style={{ gap: 6 }}>
                  <Text style={{ color: palette().muted, fontSize: store.type().base }}>
                    Theme Appearance
                  </Text>
                  <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                    <TabButton
                      label="Dark · Tokyo Night"
                      testID="settings-theme-dark"
                      active={store.theme() === "dark"}
                      onPress={() => store.setTheme("dark" as ThemeAppearance)}
                    />
                    <TabButton
                      label="Light · Catppuccin Latte"
                      testID="settings-theme-light"
                      active={store.theme() === "light"}
                      onPress={() => store.setTheme("light" as ThemeAppearance)}
                    />
                  </View>
                </View>

                <SaveRow />
              </Panel>
            ) : null}

            {tab() === "security" ? (
              <Panel testID="settings-security">
                <SectionTitle hint="Lock timing, clipboard, SSH agent, and client certificates.">
                  Security
                </SectionTitle>

                <DraftNumber
                  label="Auto-Lock Timeout (minutes)"
                  testID="settings-auto-lock"
                  value={draft().autoLockMinutes ?? config().autoLockMinutes}
                  onChange={(value) => store.updateSettingsDraft({ autoLockMinutes: value })}
                />
                <DraftNumber
                  label="Clipboard Clear Timeout (seconds)"
                  testID="settings-clipboard-timeout"
                  value={draft().clipboardClearSeconds ?? config().clipboardClearSeconds}
                  onChange={(value) =>
                    store.updateSettingsDraft({ clipboardClearSeconds: value })
                  }
                />

                <DraftToggle
                  label="Polkit Quick Unlock"
                  testID="settings-quick-unlock"
                  checked={draft().quickUnlock ?? config().quickUnlock}
                  onChange={(value) => store.updateSettingsDraft({ quickUnlock: value })}
                />
                <DraftToggle
                  label="SSH Agent"
                  testID="settings-ssh-agent"
                  checked={draft().sshAgentEnabled ?? config().sshAgentEnabled}
                  onChange={(value) => store.updateSettingsDraft({ sshAgentEnabled: value })}
                />

                <View style={{ gap: 6 }}>
                  <Text style={{ color: palette().muted, fontSize: store.type().base }}>
                    SSH Agent Confirmation
                  </Text>
                  <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                    <Each of={SSH_POLICIES} key="index">
                      {(policy) => (
                        <TabButton
                          label={policy().label}
                          testID={policy().testID}
                          active={
                            (draft().sshAgentConfirm ?? config().sshAgentConfirm) ===
                            policy().value
                          }
                          onPress={() =>
                            store.updateSettingsDraft({ sshAgentConfirm: policy().value })
                          }
                        />
                      )}
                    </Each>
                  </View>
                </View>

                <DraftText
                  label="Client Certificate Path"
                  testID="settings-client-cert"
                  value={draft().clientCertPath ?? config().clientCertPath}
                  onChange={(value) => store.updateSettingsDraft({ clientCertPath: value })}
                  hint="PEM client certificate for mutual TLS."
                  browseTestID="settings-client-cert-browse"
                  onBrowse={store.browseClientCert}
                />
                <DraftText
                  label="Client Key Path"
                  testID="settings-client-key"
                  value={draft().clientKeyPath ?? config().clientKeyPath}
                  onChange={(value) => store.updateSettingsDraft({ clientKeyPath: value })}
                  hint="PEM private key for mutual TLS."
                  browseTestID="settings-client-key-browse"
                  onBrowse={store.browseClientKey}
                />

                <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                  <ActionButton
                    label="Save Settings"
                    testID="settings-save"
                    tone="primary"
                    onPress={store.saveSettings}
                  />
                  <ActionButton
                    label="Lock Now"
                    testID="settings-lock-now"
                    onPress={() => store.lockOrLogout(false)}
                  />
                  <ActionButton
                    label="Log Out"
                    testID="settings-logout"
                    tone="danger"
                    onPress={() => store.lockOrLogout(true)}
                  />
                </View>
              </Panel>
            ) : null}

            {tab() === "diagnose" ? (
              <View style={{ gap: 12 }}>
                <Panel testID="settings-diagnose">
                  <SectionTitle hint="Sanitized engine health checks.">Diagnose</SectionTitle>
                  <Each of={store.health()?.checks ?? []} key="index">
                    {(check, index) => (
                      <View
                        testID={`health-check-${index()}`}
                        style={{
                          backgroundColor: tint(
                            check().ok ? palette().success : palette().danger,
                            palette().popups.background,
                            0.14,
                          ),
                          borderRadius: 8,
                          padding: 8,
                          gap: 2,
                        }}
                      >
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <Text
                            style={{
                              color: check().ok ? palette().success : palette().danger,
                              fontSize: store.type().base,
                              fontWeight: "bold",
                            }}
                          >
                            {check().ok ? "OK" : "FAIL"}
                          </Text>
                          <Text
                            style={{
                              color: palette().popups.text,
                              fontSize: store.type().base,
                              fontWeight: "bold",
                            }}
                          >
                            {check().name}
                          </Text>
                        </View>
                        <Text style={{ color: palette().muted, fontSize: store.type().sm }}>
                          {check().detail}
                        </Text>
                      </View>
                    )}
                  </Each>
                </Panel>

                <Panel testID="settings-diagnostic-logs">
                  <SectionTitle hint="Tokens, passwords, and private addresses are redacted.">
                    Sanitized Server &amp; Logs
                  </SectionTitle>
                  <Text
                    testID="diagnostic-server-url"
                    style={{ color: palette().popups.text, fontSize: store.type().base, userSelect: "text" }}
                  >
                    {diagnostics().serverUrlSanitized}
                  </Text>
                  <Each of={diagnostics().logs ?? []} key="index">
                    {(line) => (
                      <Text
                        style={{
                          color: palette().muted,
                          fontSize: store.type().sm,
                          fontFamily: "monospace",
                          userSelect: "text",
                        }}
                      >
                        {line()}
                      </Text>
                    )}
                  </Each>
                  <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                    <ActionButton
                      label="Refresh Health"
                      testID="refresh-health"
                      onPress={store.refreshHealth}
                    />
                    <ActionButton
                      label="Copy Diagnostic Report"
                      testID="copy-diagnostics"
                      onPress={store.copyDiagnosticReport}
                    />
                  </View>
                </Panel>
              </View>
            ) : null}

            {tab() === "about" ? (
              <View style={{ gap: 12 }}>
                <Panel testID="settings-about">
                  <SectionTitle hint="Version and build information.">About</SectionTitle>
                  <InfoRow
                    label="Application"
                    value={diagnostics().appVersion}
                    testID="about-app-version"
                  />
                  <InfoRow
                    label="Engine"
                    value={diagnostics().engineVersion}
                    testID="about-engine-version"
                  />
                  <InfoRow
                    label="Git Commit"
                    value={diagnostics().gitCommit}
                    testID="about-git-commit"
                  />
                  <InfoRow
                    label="Build Date"
                    value={diagnostics().buildDate}
                    testID="about-build-date"
                  />
                  <InfoRow
                    label="Memory (RSS)"
                    value={`${diagnostics().memoryRssMb.toFixed(1)} MiB`}
                    testID="about-memory"
                  />
                </Panel>

                <Panel testID="settings-updates">
                  <SectionTitle hint="Check for a newer engine or app release.">
                    Updates
                  </SectionTitle>
                  <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                    <ActionButton
                      label="Check for Updates"
                      testID="check-updates"
                      onPress={() => store.checkUpdates(true)}
                    />
                    <ActionButton
                      label="View Release Notes"
                      testID="view-release-notes"
                      onPress={() => {
                        store.checkUpdates(false);
                        store.openReleaseNotes();
                      }}
                    />
                  </View>
                  {store.updateStatus() ? (
                    <View style={{ gap: 2 }}>
                      <Text
                        testID="update-current-version"
                        style={{ color: palette().muted, fontSize: store.type().sm }}
                      >
                        Current: {store.updateStatus()?.currentVersion}
                      </Text>
                      <Text
                        testID="update-latest-version"
                        style={{ color: palette().popups.text, fontSize: store.type().base }}
                      >
                        {store.updateStatus()?.available
                          ? `Latest: ${store.updateStatus()?.latestVersion}`
                          : "You are running the latest version."}
                      </Text>
                    </View>
                  ) : null}

                  <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                    <Chip label="omawarden-app" color={palette().info} />
                    <Chip label="omawarden-cli" color={palette().purple} />
                  </View>

                  <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                    <ActionButton
                      label="App Repository"
                      testID="github-app"
                      onPress={() => store.openUrl("https://github.com/omawarden/omawarden-app")}
                    />
                    <ActionButton
                      label="Engine Repository"
                      testID="github-engine"
                      onPress={() =>
                        store.openUrl("https://github.com/omawarden/omawarden-cli")
                      }
                    />
                  </View>
                </Panel>
              </View>
            ) : null}
          </ModalShell>
        );
      }}
    </If>
  );
}

function SaveRow() {
  const palette = store.palette;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
        borderTopWidth: 1,
        borderTopColor: palette().popups.border,
        paddingTop: 8,
      }}
    >
      <ActionButton
        label="Save Settings"
        testID="settings-save"
        tone="primary"
        onPress={store.saveSettings}
      />
      <Text style={{ color: palette().muted, fontSize: store.type().sm }}>
        Changes apply immediately after saving.
      </Text>
    </View>
  );
}

function DraftText(props: {
  label: string;
  testID: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  browseLabel?: string;
  browseTestID?: string;
  onBrowse?: () => void;
}) {
  const palette = store.palette;
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: palette().muted, fontSize: store.type().base }}>{props.label}</Text>
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
            label={props.browseLabel ?? "Browse…"}
            testID={props.browseTestID}
            onPress={props.onBrowse}
          />
        ) : null}
      </View>
      {props.hint ? (
        <Text style={{ color: palette().muted, fontSize: store.type().xs }}>{props.hint}</Text>
      ) : null}
    </View>
  );
}

function DraftNumber(props: {
  label: string;
  testID: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const palette = store.palette;
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: palette().muted, fontSize: store.type().base }}>{props.label}</Text>
      <Input
        testID={props.testID}
        value={String(props.value)}
        keyboardType="numeric"
        onChange={({ value }) => {
          const parsed = Number.parseInt(value, 10);
          if (Number.isFinite(parsed)) {
            props.onChange(parsed);
          }
        }}
        style={{ ...inputStyle(), width: store.lengths().wideInput }}
      />
    </View>
  );
}

function DraftToggle(props: {
  label: string;
  testID: string;
  checked: boolean;
  onChange: (value: boolean) => void;
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
      <Text style={{ color: palette().popups.text, fontSize: store.type().base }}>{props.label}</Text>
      <ActionButton
        label={props.checked ? "On" : "Off"}
        testID={props.testID}
        tone={props.checked ? "primary" : "secondary"}
        onPress={() => props.onChange(!props.checked)}
      />
    </View>
  );
}

function InfoRow(props: { label: string; value: string; testID?: string }) {
  const palette = store.palette;
  return (
    <View style={{ flexDirection: "row", gap: 8, paddingVertical: 2 }}>
      <View style={{ width: store.lengths().labelGutter }}>
        <Text style={{ color: palette().muted, fontSize: store.type().base }}>{props.label}</Text>
      </View>
      <Text
        testID={props.testID}
        style={{ flex: 1, color: palette().popups.text, fontSize: store.type().base, userSelect: "text" }}
      >
        {props.value || "—"}
      </Text>
    </View>
  );
}
