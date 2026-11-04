import { computed, host, signal, untracked } from "nsh";
import {
  OmawardenBridge,
  type AppPhase,
  type AuthActionInput,
  type CopyOutcomeView,
  type DaemonTickView,
  type DependencyStatusView,
  type GeneratedSecretView,
  type HealthSnapshotView,
  type InspectorView,
  type ItemCategory,
  type PasswordGenInput,
  type PassphraseGenInput,
  type RevealStateInput,
  type SettingsSnapshotView,
  type SettingsUpdateInput,
  type SshKeyMode,
  type SshKeyPreviewView,
  type SshKeySaveInput,
  type ThemeAppearance,
  type UpdateStatusView,
  type VaultFilterInput,
  type VaultSnapshotView,
} from "omawarden-app/native";
import {
  mergePalette,
  paletteFor,
  type ThemePalette,
  type ThemePaletteOverrides,
} from "../theme/palette";

export type ModalKind =
  | "none"
  | "actionPalette"
  | "generator"
  | "sshKey"
  | "passwordHistory"
  | "settings"
  | "releaseNotes";

export type ToastKind = "success" | "error" | "info";

export interface ToastState {
  message: string;
  kind: ToastKind;
}

export interface MockParams {
  mock?: boolean;
  mockState?: Record<string, unknown>;
  payload?: Record<string, unknown>;
}

const EMPTY_COUNTS = {
  all: 0,
  logins: 0,
  cards: 0,
  identities: 0,
  secureNotes: 0,
  sshKeys: 0,
};

function emptySnapshot(phase: AppPhase): VaultSnapshotView {
  return {
    phase,
    email: "",
    serverUrl: "",
    identityUrl: null,
    quickUnlockReady: false,
    quickUnlockUsable: false,
    unlocked: phase === "unlocked",
    syncing: false,
    twoFactor: null,
    error: null,
    items: [],
    totalCount: 0,
    categoryCounts: { ...EMPTY_COUNTS },
    scopes: [],
    folders: [],
    activeScope: "all",
    activeFolder: null,
    search: "",
    category: "all",
    lastSync: null,
    selectedCipherId: null,
    sshPrompt: null,
    engineVersion: null,
  };
}

function defaultReveal(): RevealStateInput {
  return {
    revealPassword: false,
    revealCardNumber: false,
    revealCvv: false,
    revealPrivateKey: false,
    revealFields: [],
  };
}

// ---------------------------------------------------------------------------
// Signals
// ---------------------------------------------------------------------------

export const snapshot = signal<VaultSnapshotView>(emptySnapshot("login"));
export const dependencies = signal<DependencyStatusView | null>(null);
export const inspector = signal<InspectorView | null>(null);
export const settings = signal<SettingsSnapshotView | null>(null);
export const settingsDraft = signal<SettingsUpdateInput>({});
export const updateStatus = signal<UpdateStatusView | null>(null);
export const sshPreview = signal<SshKeyPreviewView | null>(null);
export const generatedSecret = signal<GeneratedSecretView | null>(null);
export const health = signal<HealthSnapshotView | null>(null);
export const attachmentPreview = signal<{
  filename: string;
  text: string;
  path: string;
  isImage: boolean;
} | null>(null);
export const toast = signal<ToastState | null>(null);
export const theme = signal<ThemeAppearance>("dark");
export const themeOverrides = signal<ThemePaletteOverrides>({});
export const activeModal = signal<ModalKind>("none");
export const reveal = signal<RevealStateInput>(defaultReveal());
export const selectedIndex = signal(0);
export const selectedProvider = signal(0);
export const focusedAction = signal<string | null>(null);

// The action controls on screen, in render order, and what pressing each
// does. Buttons register themselves so Tab can reach them on platforms whose
// native focus traversal only visits text fields (Linux/GTK).
interface ActionEntry {
  handler: () => void;
  layer: string;
}

const actionOrder: string[] = [];
const actionEntries = new Map<string, ActionEntry>();
export const category = signal<ItemCategory>("all");
export const scopeId = signal<string>("all");
export const folderId = signal<string | null>(null);
export const search = signal("");
export const scopeOpen = signal(false);
export const sshKeyMode = signal<SshKeyMode>("create");
export const palette = computed<ThemePalette>(() =>
  mergePalette(paletteFor(theme()), themeOverrides()),
);

export const selectedCipher = computed(() => {
  const items = snapshot().items;
  if (items.length === 0) {
    return null;
  }
  const index = Math.max(0, Math.min(items.length - 1, selectedIndex()));
  return items[index] ?? null;
});

export const activeScopeName = computed(() => {
  const active = snapshot().activeScope;
  const match = snapshot().scopes.find((scope) => scope.id === active);
  return match ? match.name : "All Vaults";
});

export const activeFolderName = computed(() => {
  const active = snapshot().activeFolder;
  if (!active) {
    return "All Folders";
  }
  const match = snapshot().folders.find((folder) => folder.id === active);
  return match ? match.name : active;
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

let toastSerial = 0;

export function notify(message: string, kind: ToastKind = "info"): void {
  if (!message) {
    return;
  }
  toastSerial += 1;
  const serial = toastSerial;
  toast.set({ message, kind });
  setTimeout(() => {
    if (toastSerial === serial) {
      toast.set(null);
    }
  }, 4000);
}

export function dismissToast(): void {
  toastSerial += 1;
  toast.set(null);
}

// Bridge calls that touch the network or the disk block the app's thread. Run
// them after a frame so the "working" notification is painted first and the
// user sees the press acknowledged immediately instead of after the wait.
const DEFER_MS = 50;

function defer(work: () => void): void {
  setTimeout(work, DEFER_MS);
}

// ---------------------------------------------------------------------------
// Keyboard focus for action controls
// ---------------------------------------------------------------------------

// The topmost surface whose controls Tab may reach: a modal or the SSH prompt
// covers the workspace, and the controls behind it must not take focus.
function currentLayer(): string {
  if (snapshot().sshPrompt) {
    return "ssh";
  }
  const modal = activeModal();
  return modal === "none" ? "base" : `modal:${modal}`;
}

export function registerAction(id: string, handler: () => void): void {
  if (!actionOrder.includes(id)) {
    actionOrder.push(id);
  }
  actionEntries.set(id, { handler, layer: untracked(() => currentLayer()) });
}

export function unregisterAction(id: string): void {
  const index = actionOrder.indexOf(id);
  if (index >= 0) {
    actionOrder.splice(index, 1);
  }
  actionEntries.delete(id);
  if (focusedAction() === id) {
    focusedAction.set(null);
  }
}

export function cycleAction(delta: number): void {
  const layer = currentLayer();
  const focusable = actionOrder.filter((id) => actionEntries.get(id)?.layer === layer);
  if (focusable.length === 0) {
    return;
  }
  const current = focusedAction();
  const index = current ? focusable.indexOf(current) : -1;
  const next =
    index < 0
      ? delta > 0
        ? 0
        : focusable.length - 1
      : (index + delta + focusable.length) % focusable.length;
  focusedAction.set(focusable[next]);
}

export function activateFocusedAction(): boolean {
  const id = focusedAction();
  if (!id) {
    return false;
  }
  const entry = actionEntries.get(id);
  if (!entry || entry.layer !== currentLayer()) {
    focusedAction.set(null);
    return false;
  }
  entry.handler();
  return true;
}

export function clearActionFocus(): void {
  focusedAction.set(null);
}

// ---------------------------------------------------------------------------
// Snapshot application
// ---------------------------------------------------------------------------

function applySnapshot(next: VaultSnapshotView): void {
  const previousLayer = currentLayer();
  snapshot.set(next);
  search.set(next.search);
  category.set(next.category);
  scopeId.set(next.activeScope);
  folderId.set(next.activeFolder ?? null);
  if (next.twoFactor) {
    selectedProvider.set(next.twoFactor.selectedProvider);
  }
  if (next.error) {
    notify(next.error, "error");
  }
  if (currentLayer() !== previousLayer) {
    clearActionFocus();
  }
}

function currentFilter(): VaultFilterInput {
  return {
    search: search(),
    category: category(),
    scopeId: scopeId(),
    folderId: folderId(),
  };
}

function selectFirstIfNeeded(): void {
  if (snapshot().phase !== "unlocked" || snapshot().items.length === 0) {
    inspector.set(null);
    return;
  }
  if (selectedIndex() >= snapshot().items.length) {
    selectedIndex.set(0);
  }
}

// ---------------------------------------------------------------------------
// Boot and lifecycle
// ---------------------------------------------------------------------------

let booted = false;

export function bootApp(): void {
  if (booted) {
    return;
  }
  booted = true;
  const params = host.params as MockParams;
  if (params.mock === true) {
    OmawardenBridge.setMockMode(true);
    if (params.mockState && typeof params.mockState === "object") {
      OmawardenBridge.configureMockState(JSON.stringify(params.mockState));
    }
  }
  const payload =
    params.payload && typeof params.payload === "object"
      ? JSON.stringify(params.payload)
      : null;
  const next = OmawardenBridge.boot(payload);
  applySnapshot(next);
  if (next.phase === "dependencyCheck") {
    dependencies.set(OmawardenBridge.checkDependencies());
  }
  if (next.phase === "unlocked") {
    selectFirstIfNeeded();
  }
  if (params.mockState) {
    const mockTheme = params.mockState.theme;
    if (mockTheme === "light" || mockTheme === "dark") {
      theme.set(mockTheme);
    }
  }
}

/** Applies a live theme injected by the embedding Omarchy Shell. */
export function applyHostTheme(payload: unknown): void {
  if (!payload || typeof payload !== "object") {
    return;
  }
  const data = payload as {
    appearance?: string;
    theme?: string;
    menu?: ThemePaletteOverrides["menu"];
    popups?: ThemePaletteOverrides["popups"];
    muted?: string;
    success?: string;
    warning?: string;
    danger?: string;
    info?: string;
    purple?: string;
  };
  const appearance = data.appearance ?? data.theme;
  if (appearance === "light" || appearance === "dark") {
    theme.set(appearance);
  }
  themeOverrides.set({
    menu: data.menu,
    popups: data.popups,
    muted: data.muted,
    success: data.success,
    warning: data.warning,
    danger: data.danger,
    info: data.info,
    purple: data.purple,
  });
}

export function setTheme(next: ThemeAppearance): void {
  theme.set(next);
  settingsDraft.update((draft) => ({ ...draft, theme: next }));
  if (settings()) {
    const result = OmawardenBridge.updateSettings({ theme: next });
    settings.set(result);
  }
}

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export function refreshDependencies(): void {
  const next = OmawardenBridge.checkDependencies();
  dependencies.set(next);
}

export function installMissingDependencies(): void {
  const missing = dependencies()?.missingPackages ?? [];
  if (missing.length === 0) {
    notify("All required dependencies are already installed.", "success");
    return;
  }
  notify("Launching the package installer…", "info");
  defer(() => {
    const ok = OmawardenBridge.installMissingDependencies(missing);
    if (ok) {
      notify("Installing missing packages in a floating terminal.", "success");
    } else {
      notify("Could not launch the package installer.", "error");
    }
  });
}

export function continueFromDependencies(): void {
  const next = OmawardenBridge.boot(null);
  applySnapshot(next);
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

function authProgressMessage(kind: AuthActionInput["kind"]): string {
  switch (kind) {
    case "twoFactor":
    case "newDevice":
      return "Verifying…";
    case "unlock":
    case "quickUnlock":
      return "Unlocking…";
    default:
      return "Signing in…";
  }
}

export function authenticate(input: AuthActionInput): void {
  notify(authProgressMessage(input.kind), "info");
  defer(() => {
    const next = OmawardenBridge.authenticate(input);
    applySnapshot(next);
    if (next.error) {
      return;
    }
    dismissToast();
    if (next.phase === "unlocked") {
      inspector.set(null);
      selectedIndex.set(0);
      loadSettings();
    }
  });
}

export function sendTwoFactorEmail(email: string, password: string): void {
  notify("Sending verification email…", "info");
  defer(() => {
    const outcome = OmawardenBridge.sendTwoFactorEmail(email, password);
    notify(outcome.message, outcome.ok ? "success" : "error");
  });
}

export function lockOrLogout(logout: boolean): void {
  notify(logout ? "Logging out…" : "Locking vault…", "info");
  defer(() => {
    const next = OmawardenBridge.lockOrLogout(logout);
    applySnapshot(next);
    inspector.set(null);
    selectedIndex.set(0);
    activeModal.set("none");
    clearActionFocus();
    notify(logout ? "Logged out." : "Vault locked.", "info");
  });
}

// ---------------------------------------------------------------------------
// Vault
// ---------------------------------------------------------------------------

export function query(): void {
  const next = OmawardenBridge.queryVault(currentFilter());
  applySnapshot(next);
  selectFirstIfNeeded();
}

export function sync(): void {
  notify("Syncing vault…", "info");
  defer(() => {
    const next = OmawardenBridge.syncVault(currentFilter());
    applySnapshot(next);
    notify(next.error ? "Sync failed." : "Vault synchronized.", next.error ? "error" : "success");
  });
}

export function setSearch(text: string): void {
  search.set(text);
  query();
}

export function setCategory(next: ItemCategory): void {
  category.set(next);
  query();
}

export function setScope(next: string): void {
  scopeId.set(next);
  scopeOpen.set(false);
  query();
}

export function setFolder(next: string | null): void {
  folderId.set(next);
  scopeOpen.set(false);
  query();
}

export function toggleScope(): void {
  scopeOpen.update((open) => !open);
}

export function selectCipher(index: number): void {
  selectedIndex.set(index);
  reveal.set(defaultReveal());
  refreshInspector();
}

export function moveSelection(delta: number): void {
  const items = snapshot().items;
  if (items.length === 0) {
    return;
  }
  if (!inspector()) {
    selectCipher(0);
    return;
  }
  const next = Math.max(0, Math.min(items.length - 1, selectedIndex() + delta));
  if (next !== selectedIndex()) {
    selectCipher(next);
  }
}

export function refreshInspector(): void {
  const cipher = selectedCipher();
  if (!cipher) {
    inspector.set(null);
    return;
  }
  inspector.set(OmawardenBridge.inspectCipher(cipher.id, reveal()));
}

export function toggleReveal(field: "password" | "cardNumber" | "cvv" | "privateKey"): void {
  const current = reveal();
  const next: RevealStateInput = { ...current, revealFields: [...current.revealFields] };
  if (field === "password") next.revealPassword = !current.revealPassword;
  if (field === "cardNumber") next.revealCardNumber = !current.revealCardNumber;
  if (field === "cvv") next.revealCvv = !current.revealCvv;
  if (field === "privateKey") next.revealPrivateKey = !current.revealPrivateKey;
  reveal.set(next);
  refreshInspector();
}

export function toggleRevealField(index: number): void {
  const current = reveal();
  const fields = current.revealFields.includes(index)
    ? current.revealFields.filter((entry) => entry !== index)
    : [...current.revealFields, index];
  reveal.set({ ...current, revealFields: fields });
  refreshInspector();
}

export function refreshTotp(): void {
  const cipher = selectedCipher();
  if (!cipher) {
    return;
  }
  const totp = OmawardenBridge.refreshTotp(cipher.id);
  const current = inspector();
  if (current) {
    inspector.set({ ...current, totp });
  }
}

export function copyField(field: string, customIndex?: number): void {
  const cipher = selectedCipher();
  if (!cipher) {
    notify("Select an item first.", "error");
    return;
  }
  const outcome: CopyOutcomeView = OmawardenBridge.copyCipherField(
    cipher.id,
    field,
    customIndex ?? null,
  );
  notify(outcome.message, outcome.ok ? "success" : "error");
}

export function copyText(text: string, label: string, sensitive: boolean): void {
  if (!text) {
    notify("Nothing to copy.", "error");
    return;
  }
  const outcome = OmawardenBridge.copyText(text, label, sensitive);
  notify(outcome.message, outcome.ok ? "success" : "error");
}

export function primaryCopy(): void {
  const cipher = selectedCipher();
  if (!cipher) {
    return;
  }
  switch (cipher.category) {
    case "login":
      copyField("password");
      break;
    case "card":
      copyField("card_number");
      break;
    case "identity":
      copyField("username");
      break;
    case "sshKey":
      copyField("public_key");
      break;
    case "secureNote":
      copyField("notes");
      break;
    default:
      break;
  }
}

export function openUrl(rawUrl: string): void {
  const ok = OmawardenBridge.launchUrl(rawUrl);
  if (!ok) {
    notify("This URL is not safe to open.", "error");
  }
}

export function openAttachment(cipherId: string, attachmentId: string, mode: string): void {
  const outcome = OmawardenBridge.openAttachment(cipherId, attachmentId, mode);
  if (!outcome.ok) {
    notify(outcome.error ?? "Could not open the attachment.", "error");
    return;
  }
  if (mode === "preview") {
    attachmentPreview.set({
      filename: outcome.filename ?? "Attachment",
      text: outcome.textContent ?? "",
      path: outcome.path ?? "",
      isImage: outcome.isImage,
    });
  }
  notify(
    mode === "preview" ? `Preview ready: ${outcome.filename ?? ""}` : "Attachment downloaded.",
    "success",
  );
}

export function closeAttachmentPreview(): void {
  attachmentPreview.set(null);
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

export function generatePassword(input: PasswordGenInput): void {
  generatedSecret.set(OmawardenBridge.generatePassword(input));
}

export function generatePassphrase(input: PassphraseGenInput): void {
  generatedSecret.set(OmawardenBridge.generatePassphrase(input));
}

// ---------------------------------------------------------------------------
// SSH
// ---------------------------------------------------------------------------

export function previewSshKey(
  mode: string,
  algorithm: string,
  comment: string,
  privateKeyPem: string,
): void {
  sshPreview.set(OmawardenBridge.previewSshKey(mode, algorithm, comment, privateKeyPem));
}

export function saveSshKey(input: SshKeySaveInput): void {
  notify("Saving SSH key…", "info");
  defer(() => {
    const outcome = OmawardenBridge.saveSshKey(input, currentFilter());
    notify(outcome.message, outcome.ok ? "success" : "error");
    if (outcome.ok) {
      sshPreview.set(null);
      activeModal.set("none");
      clearActionFocus();
    }
  });
}

export function resolveSshPrompt(promptId: number, approve: boolean): void {
  const tick: DaemonTickView = OmawardenBridge.resolveSshPrompt(promptId, approve);
  snapshot.update((previous) => ({
    ...previous,
    sshPrompt: tick.sshPrompt ?? null,
  }));
  notify(approve ? "SSH request approved." : "SSH request denied.", approve ? "success" : "info");
}

// ---------------------------------------------------------------------------
// Settings and diagnostics
// ---------------------------------------------------------------------------

export function loadSettings(): void {
  const next = OmawardenBridge.getSettings();
  settings.set(next);
  health.set(next.health);
  settingsDraft.set({ ...next.config });
  theme.set(next.config.theme);
  if (next.error) {
    notify(next.error, "error");
  }
}

export function updateSettingsDraft(patch: Partial<SettingsUpdateInput>): void {
  settingsDraft.update((draft) => ({ ...draft, ...patch }));
}

export function saveSettings(): void {
  notify("Saving settings…", "info");
  defer(() => {
    const result = OmawardenBridge.updateSettings(settingsDraft());
    settings.set(result);
    health.set(result.health);
    theme.set(result.config.theme);
    if (result.error) {
      notify(result.error, "error");
    } else {
      notify("Settings saved.", "success");
    }
  });
}

export function refreshHealth(): void {
  const next = OmawardenBridge.refreshHealth();
  health.set(next);
  const current = settings();
  if (current) {
    settings.set({ ...current, health: next });
  }
}

export function checkUpdates(force: boolean): void {
  notify("Checking for updates…", "info");
  defer(() => {
    const next = OmawardenBridge.checkUpdates(force);
    updateStatus.set(next);
    notify(
      next.available
        ? `Version ${next.latestVersion ?? "new"} is available.`
        : "You are on the latest version.",
      "info",
    );
  });
}

export function copyDiagnosticReport(): void {
  const current = settings();
  if (!current) {
    return;
  }
  const lines = [
    `Omawarden ${current.diagnostics.appVersion}`,
    `Engine ${current.diagnostics.engineVersion}`,
    `Server ${current.diagnostics.serverUrlSanitized}`,
    ...current.diagnostics.logs,
  ];
  copyText(lines.join("\n"), "diagnostic report", false);
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------

export function openModal(kind: ModalKind): void {
  activeModal.set(kind);
  scopeOpen.set(false);
  clearActionFocus();
}

export function closeModal(): void {
  activeModal.set("none");
  clearActionFocus();
}

export function openGenerator(): void {
  generatedSecret.set(
    OmawardenBridge.generatePassword({
      length: 20,
      uppercase: true,
      lowercase: true,
      numbers: true,
      special: true,
      avoidAmbiguous: false,
      minNumbers: 1,
      minSpecial: 1,
    }),
  );
  openModal("generator");
}

export function openSettings(): void {
  loadSettings();
  openModal("settings");
}

export function openSshKey(mode: SshKeyMode): void {
  sshKeyMode.set(mode);
  sshPreview.set(null);
  openModal("sshKey");
}

export function openPasswordHistory(): void {
  openModal("passwordHistory");
}

export function openReleaseNotes(): void {
  openModal("releaseNotes");
}

export function openActionPalette(): void {
  openModal("actionPalette");
}
