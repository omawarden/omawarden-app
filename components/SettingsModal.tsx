import { Text, View } from "nsh";
import { Input, Slider } from "nsh/base";
import { signal } from "nsh";
import type {
  DaemonCandidateView,
  DaemonSourceMode,
  SshAgentPolicy,
  ThemeAppearance,
} from "omawarden-app/native";
import * as store from "../store/appStore";
import { tint } from "../theme/palette";
import { TabButton, inputStyle } from "./AuthView";
import { ActionButton, Chip, ModalShell, Panel, SectionTitle } from "./ui";
import {
  parseLogLine,
  isProblemLine,
  logLevelColor,
  stableLogTestId,
  type ParsedLogLine,
} from "../store/diagnosticReport";

type SettingsTab =
  | "general"
  | "appearance"
  | "security"
  | "engine"
  | "diagnose"
  | "logs"
  | "about";
type LogFilter = "all" | "errors" | "info";

const tab = signal<SettingsTab>("general");
const logFilter = signal<LogFilter>("all");
/** A mismatched external binary the user pressed, pending confirmation. */
const enginePending = signal<{ path: string; mode: DaemonSourceMode } | null>(null);

const TABS: Array<{ id: SettingsTab; label: string; testID: string }> = [
  { id: "general", label: "General", testID: "settings-tab-general" },
  { id: "appearance", label: "Appearance", testID: "settings-tab-appearance" },
  { id: "security", label: "Security", testID: "settings-tab-security" },
  { id: "engine", label: "Engine", testID: "settings-tab-engine" },
  { id: "diagnose", label: "Diagnose", testID: "settings-tab-diagnose" },
  { id: "logs", label: "Logs", testID: "settings-tab-logs" },
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
        const percent = () => Math.round(store.appFontScale() * 100);
        const logLines = () => (diagnostics().logs ?? []).map(parseLogLine);
        const logCounts = () => {
          const lines = logLines();
          return {
            all: lines.length,
            problems: lines.filter(isProblemLine).length,
            info: lines.filter((line) => line.level === "INFO").length,
          };
        };
        const visibleLogs = () => {
          const lines = logLines();
          if (logFilter() === "errors") {
            return lines.filter(isProblemLine);
          }
          if (logFilter() === "info") {
            return lines.filter((line) => line.level === "INFO");
          }
          return lines;
        };
        return (
          <ModalShell
            title="Settings"
            testID="settings-modal"
            subtitle="Configuration, appearance, security, diagnostics, and release information."
            width={720}
          >
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
              <Each of={TABS} key="index">
                {(entry) => (
                  <TabButton
                    label={entry().label}
                    testID={entry().testID}
                    active={tab() === entry().id}
                    onPress={() => {
                      tab.set(entry().id);
                      // The list is a snapshot of PATH and the app directory;
                      // reopening the tab is what picks up a new package.
                      if (entry().id === "engine") {
                        store.refreshDaemonCandidates();
                      }
                    }}
                  />
                )}
              </Each>
            </View>

            {tab() === "general" ? (
              <Panel testID="settings-general">
                <SectionTitle hint="Connection and update preferences.">
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

                <SaveRow />
              </Panel>
            ) : null}

            {tab() === "appearance" ? (
              <Panel testID="settings-appearance">
                <SectionTitle hint="Theme and text size.">Appearance</SectionTitle>

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

                <View style={{ gap: 6 }}>
                  <Text style={{ color: palette().muted, fontSize: store.type().base }}>
                    Text size
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                    <Slider
                      testID="settings-text-size"
                      style={{ flex: 1 }}
                      min={100}
                      max={400}
                      step={10}
                      value={percent()}
                      accessibilityLabel="Text size"
                      onChange={({ value }) => {
                        const next = Array.isArray(value) ? value[1] : value;
                        store.setAppFontScale(next / 100);
                      }}
                      onChangeEnd={() => store.flushAppFontScale()}
                      focusWithinStyle={{
                        borderRadius: 6,
                        backgroundColor: tint(
                          palette().popups.selectedText,
                          palette().popups.background,
                          0.1,
                        ),
                      }}
                      trackStyle={{ height: 20, justifyContent: "center" }}
                      indicatorStyle={{
                        height: 4,
                        borderRadius: 999,
                        backgroundColor: palette().popups.border,
                      }}
                      rangeStyle={{
                        height: 4,
                        borderRadius: 999,
                        backgroundColor: palette().popups.selectedText,
                      }}
                      thumbStyle={{
                        width: 14,
                        height: 14,
                        borderRadius: 999,
                        backgroundColor: palette().popups.selectedText,
                      }}
                    />
                    <Text
                      testID="settings-text-size-value"
                      style={{
                        minWidth: 48,
                        textAlign: "right",
                        color: palette().popups.text,
                        fontSize: store.type().base,
                      }}
                    >
                      {`${percent()}%`}
                    </Text>
                  </View>
                  <Text style={{ color: palette().muted, fontSize: store.type().xs }}>
                    Applies immediately and is saved with the rest of the interface
                    preferences.
                  </Text>
                </View>
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

            {tab() === "engine" ? <EnginePanel /> : null}

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
              </View>
            ) : null}

            {tab() === "logs" ? (
              <View style={{ gap: 12 }}>
                <Panel testID="settings-diagnostic-logs">
                  <SectionTitle hint="Tokens, passwords, and private addresses are redacted.">
                    Sanitized Server & Logs
                  </SectionTitle>
                  <Text
                    testID="diagnostic-server-url"
                    style={{ color: palette().popups.text, fontSize: store.type().base, userSelect: "text" }}
                  >
                    {diagnostics().serverUrlSanitized}
                  </Text>

                  <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                    <ActionButton
                      label={`All (${logCounts().all})`}
                      testID="log-filter-all"
                      tone={logFilter() === "all" ? "primary" : "secondary"}
                      onPress={() => logFilter.set("all")}
                    />
                    <ActionButton
                      label={`Errors & Warnings (${logCounts().problems})`}
                      testID="log-filter-errors"
                      tone={logFilter() === "errors" ? "primary" : "secondary"}
                      onPress={() => logFilter.set("errors")}
                    />
                    <ActionButton
                      label={`Info (${logCounts().info})`}
                      testID="log-filter-info"
                      tone={logFilter() === "info" ? "primary" : "secondary"}
                      onPress={() => logFilter.set("info")}
                    />
                  </View>

                  {visibleLogs().length === 0 ? (
                    <Text
                      testID="log-viewer-empty"
                      style={{ color: palette().muted, fontSize: store.type().sm }}
                    >
                      {logLines().length === 0
                        ? "No logs recorded yet"
                        : "No lines match this filter"}
                    </Text>
                  ) : (
                    <Each of={visibleLogs()} key="index">
                      {(line, index) => {
                          const testIdSuffix = stableLogTestId(line());
                          return (
                            <View
                              testID={`log-line-${testIdSuffix}`}
                              style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}
                            >
                              <Text
                                testID={`log-level-badge-${testIdSuffix}`}
                                style={{
                                  color: logLevelColor(line().level, palette()),
                                  fontSize: store.type().sm,
                                  fontWeight: "bold",
                                  fontFamily: "monospace",
                                }}
                              >
                                {line().level}
                              </Text>
                              <Text
                                style={{
                                  color: palette().muted,
                                  fontSize: store.type().sm,
                                  fontFamily: "monospace",
                                  userSelect: "text",
                                }}
                              >
                                {line().timestamp}
                              </Text>
                              <Text
                                style={{
                                  color: palette().muted,
                                  fontSize: store.type().sm,
                                  fontFamily: "monospace",
                                  userSelect: "text",
                                }}
                              >
                                [{line().source}]
                              </Text>
                              <Text
                                style={{
                                  color: palette().popups.text,
                                  fontSize: store.type().sm,
                                  fontFamily: "monospace",
                                  userSelect: "text",
                                }}
                              >
                                {line().message}
                              </Text>
                            </View>
                          );
                        }}
                      </Each>
                  )}

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

/** The first seven characters of a commit, as the engine prints it. */
function shortCommit(commit: string): string {
  return commit.slice(0, 7);
}

/**
 * The Engine tab: which executable the app starts when no daemon answers.
 *
 * The choice is stored as soon as it is made, because it is an execution
 * decision rather than a draft. An external binary that was not built from the
 * pinned revision asks for a second press: it will hold the vault session, and
 * the app does not supervise it.
 */
function EnginePanel() {
  const palette = store.palette;
  const source = store.daemonSource;
  const candidates = store.daemonCandidates;

  const bundled = () => candidates().find((candidate) => candidate.kind === "bundled");
  const external = () => candidates().filter((candidate) => candidate.kind !== "bundled");
  const mode = () => source()?.mode ?? "bundled";
  const customPath = () => (mode() === "custom" ? (source()?.configuredPath ?? null) : null);

  const choose = (candidate: DaemonCandidateView) => {
    if (!candidate.selectable) {
      return;
    }
    enginePending.set(null);
    if (candidate.kind === "bundled") {
      store.selectDaemonSource("bundled", null);
      return;
    }
    const nextMode: DaemonSourceMode = candidate.kind === "custom" ? "custom" : "system";
    if (!candidate.matchesPinned) {
      enginePending.set({ path: candidate.path, mode: nextMode });
      return;
    }
    store.selectDaemonSource(nextMode, candidate.path);
  };

  const chooseCustom = () => {
    const path = customPath();
    if (!path) {
      return;
    }
    const known = candidates().find((candidate) => candidate.path === path);
    if (known) {
      choose({ ...known, kind: "custom" });
      return;
    }
    store.selectDaemonSource("custom", path);
  };

  const pick = () => {
    const path = store.pickDaemonBinary();
    if (!path) {
      return;
    }
    enginePending.set(null);
    store.selectDaemonSource("custom", path);
    store.refreshDaemonCandidates();
  };

  const candidateLabel = (candidate: DaemonCandidateView, active: boolean) => {
    const parts = [active ? "●" : "○", candidate.path];
    if (candidate.version) {
      parts.push(candidate.version);
    }
    if (candidate.commit) {
      parts.push(shortCommit(candidate.commit));
    }
    if (!candidate.selectable) {
      parts.push("· not selectable");
    } else if (!candidate.matchesPinned) {
      parts.push("· different build");
    } else {
      parts.push("· matches engine");
    }
    return parts.join(" ");
  };

  const bundledLabel = () => {
    const entry = bundled();
    if (!entry) {
      return "○ Bundled daemon · not shipped with this build";
    }
    return candidateLabel(entry, mode() === "bundled");
  };

  const runningText = () => {
    const version = source()?.runningVersion;
    if (!version) {
      return "Running daemon: none. The selected source starts one on demand.";
    }
    const commit = source()?.runningCommit;
    return `Running daemon: ${version}${commit ? ` (${shortCommit(commit)})` : ""}`;
  };

  return (
    <Panel testID="settings-engine">
      <SectionTitle hint="Which daemon this app starts when none is running.">
        Engine
      </SectionTitle>

      <ActionButton
        label={bundledLabel()}
        testID="daemon-source-bundled"
        tone={mode() === "bundled" ? "primary" : "secondary"}
        disabled={!bundled()}
        onPress={() => {
          const entry = bundled();
          if (entry) {
            choose(entry);
          }
        }}
      />
      {!bundled() ? (
        <Text
          testID="daemon-source-bundled-missing"
          style={{ color: palette().muted, fontSize: store.type().sm }}
        >
          This build did not ship a daemon. Install omawarden-bin or choose a binary.
        </Text>
      ) : null}

      <Each of={external()} key="index">
        {(candidate, index) => (
          <ActionButton
            label={candidateLabel(candidate(), candidate().path === source()?.resolvedPath)}
            testID={`daemon-source-candidate-${index()}`}
            tone={candidate().path === source()?.resolvedPath ? "primary" : "secondary"}
            disabled={!candidate().selectable}
            onPress={() => choose(candidate())}
          />
        )}
      </Each>

      <ActionButton
        label={
          customPath()
            ? `○ Custom · ${customPath()}`
            : mode() === "custom"
              ? "○ Custom · not configured"
              : "○ Custom…"
        }
        testID="daemon-source-custom"
        tone={mode() === "custom" ? "primary" : "secondary"}
        disabled={!customPath()}
        onPress={chooseCustom}
      />
      <ActionButton label="Choose Binary…" testID="daemon-source-pick" onPress={pick} />

      {enginePending() ? (
        <View
          testID="daemon-source-warning"
          style={{
            backgroundColor: tint(palette().warning, palette().popups.background, 0.14),
            borderColor: tint(palette().warning, palette().popups.background, 0.4),
            borderWidth: 1,
            borderRadius: 8,
            padding: 8,
            gap: 6,
          }}
        >
          <Text style={{ color: palette().popups.text, fontSize: store.type().base }}>
            This binary will receive your vault credentials. The app does not supervise or stop
            it.
          </Text>
          <Text style={{ color: palette().muted, fontSize: store.type().sm }}>
            {enginePending()?.path}
          </Text>
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <ActionButton
              label="Use This Binary"
              testID="daemon-source-use-anyway"
              tone="danger"
              onPress={() => {
                const pending = enginePending();
                enginePending.set(null);
                if (pending) {
                  store.selectDaemonSource(pending.mode, pending.path);
                }
              }}
            />
            <ActionButton
              label="Cancel"
              testID="daemon-source-cancel"
              onPress={() => enginePending.set(null)}
            />
          </View>
        </View>
      ) : null}

      <Text
        testID="daemon-source-running"
        style={{ color: palette().popups.text, fontSize: store.type().base }}
      >
        {runningText()}
      </Text>
      <Text style={{ color: palette().muted, fontSize: store.type().sm }}>
        Changes apply the next time no daemon is running. Pinned engine revision:{" "}
        {source()?.pinnedRev ? shortCommit(source()!.pinnedRev) : "unknown"}.
      </Text>
      {source()?.note ? (
        <Text style={{ color: palette().warning, fontSize: store.type().sm }}>
          {source()?.note}
        </Text>
      ) : null}
      {source()?.problem ? (
        <Text style={{ color: palette().danger, fontSize: store.type().sm }}>
          {source()?.problem}
        </Text>
      ) : null}
    </Panel>
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
