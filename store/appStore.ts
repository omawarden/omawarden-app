import { computed, fontScale, host, signal, untracked } from "nsh";
import {
  OmawardenBridge,
  type AppPhase,
  type AuthActionInput,
  type CategoryCountsView,
  type CipherRowView,
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
  type UiPrefsView,
  type UpdateStatusView,
  type VaultFilterInput,
  type VaultSnapshotView,
} from "omawarden-app/native";
import {
  GENERATOR_LABEL_WIDTH,
  INPUT_MIN_HEIGHT,
  LABEL_GUTTER_WIDTH,
  OTP_CELL_HEIGHT,
  OTP_CELL_WIDTH,
  WIDE_INPUT_WIDTH,
  scaleLength,
} from "../theme/layout";
import {
  mergePalette,
  paletteFor,
  type ThemePalette,
  type ThemePaletteOverrides,
} from "../theme/palette";
import { scaleType, type TypeScale } from "../theme/typeScale";
import { clearAuthSecrets } from "./authForm";

export type ModalKind =
  | "none"
  | "actionPalette"
  | "generator"
  | "sshKey"
  | "passwordHistory"
  | "settings"
  | "releaseNotes"
  | "reprompt";

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
    allItems: [],
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
export const rawItems = signal<CipherRowView[]>([]);
export const phase = computed<AppPhase>(() => snapshot().phase);
export const sshPrompt = computed(() => snapshot().sshPrompt);
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
  dataUrl: string;
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
export const isSubmitting = signal(false);
/** Whether a vault sync is in flight (kept separate from auth submission). */
export const isSyncing = signal(false);
/** The cipher whose master-password re-prompt grant is active. */
export const repromptCipherId = signal<string | null>(null);
export const repromptError = signal<string | null>(null);

// Vault rows are GTK widget subtrees, so mounting every item at once makes a
// large vault expensive. Render a window and grow it as the user asks or moves
// the selection toward the end of the window.
export const DEFAULT_VISIBLE_LIMIT = 80;
export const visibleLimit = signal(DEFAULT_VISIBLE_LIMIT);

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

/**
 * The app's own text-size factor, from the Text size setting. It multiplies on
 * top of the system factor; `Text` applies the system factor itself, so the
 * type ladder reads this one only.
 */
export const appFontScale = signal(1);

/** The factor for sizes that do not follow the system text scale themselves. */
export const totalScale = computed(() => fontScale() * appFontScale());

/** The type ladder at the app factor; `Text` applies the system factor on top. */
export const type = computed<TypeScale>(() => scaleType(appFontScale()));

/** The fixed lengths that make room for text, at the total factor. */
export const lengths = computed(() => ({
  labelGutter: scaleLength(LABEL_GUTTER_WIDTH, totalScale()),
  generatorLabel: scaleLength(GENERATOR_LABEL_WIDTH, totalScale()),
  wideInput: scaleLength(WIDE_INPUT_WIDTH, totalScale()),
  otpCellWidth: scaleLength(OTP_CELL_WIDTH, totalScale()),
  otpCellHeight: scaleLength(OTP_CELL_HEIGHT, totalScale()),
  inputMinHeight: scaleLength(INPUT_MIN_HEIGHT, totalScale()),
}));

function isSubsequence(pattern: string, text: string): boolean {
  if (!pattern) return true;
  let pIdx = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === pattern[pIdx]) {
      pIdx += 1;
      if (pIdx === pattern.length) return true;
    }
  }
  return false;
}

function fuzzyScore(pattern: string, text: string): number | null {
  if (!pattern) return 0;
  const pat = pattern.toLowerCase();
  const txt = text.toLowerCase();
  if (!isSubsequence(pat, txt)) return null;
  if (txt === pat) return 1000;
  if (txt.startsWith(pat)) return 800 - Math.min(txt.length, 100);
  const idx = txt.indexOf(pat);
  if (idx >= 0) return 600 - Math.min(idx, 100);
  return 300 - Math.min(txt.length, 200);
}

function filterRows(
  rows: CipherRowView[],
  cat: ItemCategory,
  activeScope: string,
  activeFolder: string | null,
  queryText: string,
): CipherRowView[] {
  const scored: Array<{ score: number; row: CipherRowView }> = [];
  for (const row of rows) {
    if (cat !== "all" && row.category !== cat) continue;
    if (activeScope === "personal") {
      if (row.organization !== null) continue;
    } else if (activeScope !== "all" && activeScope !== "") {
      if (activeScope.startsWith("org:")) {
        const orgName = activeScope.slice(4);
        if (row.organization !== orgName) continue;
      }
    }
    if (activeFolder !== null) {
      const folderName = activeFolder.startsWith("folder:")
        ? activeFolder.slice(7)
        : activeFolder;
      if (row.folder !== folderName) continue;
    }
    const haystack = `${row.title} ${row.subtitle} ${row.organization ?? ""} ${row.folder ?? ""}`;
    const score = fuzzyScore(queryText, haystack);
    if (score !== null) {
      scored.push({ score, row });
    }
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.row.favorite !== b.row.favorite) return a.row.favorite ? -1 : 1;
    return a.row.title.toLowerCase().localeCompare(b.row.title.toLowerCase());
  });
  return scored.map((entry) => entry.row);
}

export const filteredItems = computed<CipherRowView[]>(() =>
  filterRows(rawItems(), category(), scopeId(), folderId(), search()),
);

/** Category badges for the current search, scope, and folder. */
export const categoryCounts = computed<CategoryCountsView>(() => {
  const counts: CategoryCountsView = {
    all: 0,
    logins: 0,
    cards: 0,
    identities: 0,
    secureNotes: 0,
    sshKeys: 0,
  };
  const rows = filterRows(rawItems(), "all", scopeId(), folderId(), search());
  for (const row of rows) {
    counts.all += 1;
    switch (row.category) {
      case "login":
        counts.logins += 1;
        break;
      case "card":
        counts.cards += 1;
        break;
      case "identity":
        counts.identities += 1;
        break;
      case "secureNote":
        counts.secureNotes += 1;
        break;
      case "sshKey":
        counts.sshKeys += 1;
        break;
      default:
        break;
    }
  }
  return counts;
});

/** Whether the selected item needs the master password again. */
export const repromptRequired = computed<boolean>(() => {
  const item = inspector();
  return Boolean(item && item.reprompt === 1 && repromptCipherId() !== item.id);
});

export const visibleItems = computed<CipherRowView[]>(() => {
  const items = filteredItems();
  const limit = Math.max(0, visibleLimit());
  return items.slice(0, limit);
});

export const selectedCipher = computed<CipherRowView | null>(() => {
  const items = filteredItems();
  if (items.length === 0) {
    return null;
  }
  const index = Math.max(0, Math.min(items.length - 1, selectedIndex()));
  return items[index] ?? null;
});

export const activeScopeName = computed(() => {
  const active = scopeId();
  const match = snapshot().scopes.find((scope) => scope.id === active);
  return match ? match.name : "All Vaults";
});

export const activeFolderName = computed(() => {
  const active = folderId();
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

let lastFilterKey = "";

function filterKey(next: VaultSnapshotView): string {
  return JSON.stringify([
    next.phase,
    next.search,
    next.category,
    next.activeScope,
    next.activeFolder,
  ]);
}

function resetVisibleLimit(): void {
  visibleLimit.set(DEFAULT_VISIBLE_LIMIT);
}

function expandVisibleLimitForSelection(index: number): void {
  const threshold = Math.max(0, visibleLimit() - 10);
  if (index < threshold) {
    return;
  }
  const target = Math.min(filteredItems().length, index + 10);
  visibleLimit.update((limit) => Math.max(limit, target));
}

/** Reveals the next page of vault rows. */
export function showMoreItems(): void {
  visibleLimit.update((limit) =>
    Math.min(filteredItems().length, limit + DEFAULT_VISIBLE_LIMIT),
  );
}

function applySnapshot(next: VaultSnapshotView): void {
  const nextFilterKey = filterKey(next);
  if (nextFilterKey !== lastFilterKey) {
    lastFilterKey = nextFilterKey;
    resetVisibleLimit();
  }
  const previousLayer = currentLayer();
  snapshot.set(next);
  rawItems.set(next.allItems ?? next.items);
  search.set(next.search);
  category.set(next.category);
  scopeId.set(next.activeScope);
  folderId.set(next.activeFolder ?? null);
  if (next.phase !== "unlocked") {
    stopTotpTicker();
    inspector.set(null);
    repromptCipherId.set(null);
    repromptError.set(null);
  }
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
  const items = filteredItems();
  if (phase() !== "unlocked" || items.length === 0) {
    inspector.set(null);
    return;
  }
  if (selectedIndex() >= items.length) {
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
  loadUiPrefs();
  if (next.phase !== "dependencyCheck") {
    loadSettings();
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
  defer(() => {
    // Only the theme comes back here: a text-size write may still be pending,
    // and its response would carry the older factor.
    const prefs = OmawardenBridge.updateUiPrefs({ theme: next });
    theme.set(prefs.theme);
  });
}

// A drag reports a new value on every step, so the disk write waits for the
// slider to settle. `flushAppFontScale` writes at once when the change ends.
const FONT_SCALE_WRITE_MS = 300;
const MIN_APP_FONT_SCALE = 1;
const MAX_APP_FONT_SCALE = 4;
let fontScaleTimer: ReturnType<typeof setTimeout> | null = null;

function cancelFontScaleWrite(): void {
  if (fontScaleTimer !== null) {
    clearTimeout(fontScaleTimer);
    fontScaleTimer = null;
  }
}

/** Sets the app's text-size factor, writing it after the slider settles. */
export function setAppFontScale(next: number): void {
  const clamped = Number.isFinite(next)
    ? Math.min(MAX_APP_FONT_SCALE, Math.max(MIN_APP_FONT_SCALE, next))
    : MIN_APP_FONT_SCALE;
  appFontScale.set(clamped);
  cancelFontScaleWrite();
  fontScaleTimer = setTimeout(() => {
    fontScaleTimer = null;
    OmawardenBridge.updateUiPrefs({ fontScale: clamped });
  }, FONT_SCALE_WRITE_MS);
}

/** Writes the pending text-size factor now, if the slider has not settled. */
export function flushAppFontScale(): void {
  if (fontScaleTimer === null) {
    return;
  }
  cancelFontScaleWrite();
  OmawardenBridge.updateUiPrefs({ fontScale: appFontScale() });
}

/** Applies a preferences snapshot to the signals the UI reads. */
function applyUiPrefs(prefs: UiPrefsView): void {
  theme.set(prefs.theme);
  appFontScale.set(prefs.fontScale);
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
  if (isSubmitting()) {
    return;
  }
  isSubmitting.set(true);
  notify(authProgressMessage(input.kind), "info");
  defer(() => {
    try {
      const next = OmawardenBridge.authenticate(input);
      applySnapshot(next);
      if (next.error) {
        return;
      }
      dismissToast();
      if (next.phase === "unlocked") {
        clearAuthSecrets();
        inspector.set(null);
        selectedIndex.set(0);
        loadSettings();
      }
    } finally {
      isSubmitting.set(false);
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
  resetVisibleLimit();
  selectFirstIfNeeded();
  if (inspector() !== null) {
    refreshInspector();
  }
}

export function sync(): void {
  if (isSyncing()) {
    return;
  }
  isSyncing.set(true);
  notify("Syncing vault…", "info");
  defer(() => {
    try {
      const next = OmawardenBridge.syncVault(currentFilter());
      applySnapshot(next);
      // applySnapshot already surfaces `next.error`; only announce success.
      if (!next.error) {
        notify("Vault synchronized.", "success");
      }
    } catch (error) {
      notify(`Sync failed: ${String(error)}`, "error");
    } finally {
      isSyncing.set(false);
    }
  });
}

export function setSearch(text: string): void {
  if (search() === text) return;
  search.set(text);
  query();
}

export function setCategory(next: ItemCategory): void {
  if (category() === next) return;
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
  expandVisibleLimitForSelection(index);
  selectedIndex.set(index);
  reveal.set(defaultReveal());
  repromptCipherId.set(null);
  repromptError.set(null);
  refreshInspector();
}

export function moveSelection(delta: number): void {
  const items = filteredItems();
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
    stopTotpTicker();
    inspector.set(null);
    return;
  }
  inspector.set(OmawardenBridge.inspectCipher(cipher.id, reveal()));
  syncTotpTicker();
}

let totpTimer: ReturnType<typeof setInterval> | null = null;

function stopTotpTicker(): void {
  if (totpTimer !== null) {
    clearInterval(totpTimer);
    totpTimer = null;
  }
}

function syncTotpTicker(): void {
  const totp = inspector()?.totp;
  if (phase() === "unlocked" && totp?.valid) {
    if (totpTimer === null) {
      totpTimer = setInterval(tickTotp, 1000);
    }
  } else {
    stopTotpTicker();
  }
}

/** One TOTP tick: decrement, or fetch the next code when the period ends. */
export function tickTotp(): void {
  const current = inspector();
  const totp = current?.totp;
  if (phase() !== "unlocked" || !current || !totp || !totp.valid) {
    stopTotpTicker();
    return;
  }
  if (totp.remaining > 1) {
    inspector.set({
      ...current,
      totp: { ...totp, remaining: totp.remaining - 1 },
    });
    return;
  }
  const next = OmawardenBridge.refreshTotp(current.id);
  inspector.set({ ...current, totp: next });
  if (!next.valid) {
    stopTotpTicker();
  }
}

export function toggleReveal(field: "password" | "cardNumber" | "cvv" | "privateKey"): void {
  if (!ensureReprompt(() => applyReveal(field))) {
    return;
  }
}

function applyReveal(field: "password" | "cardNumber" | "cvv" | "privateKey"): void {
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
  if (!ensureReprompt(() => applyRevealField(index))) {
    return;
  }
}

function applyRevealField(index: number): void {
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
    syncTotpTicker();
  }
}

export function copyField(field: string, customIndex?: number): void {
  const cipher = selectedCipher();
  if (!cipher) {
    notify("Select an item first.", "error");
    return;
  }
  const run = () => {
    const outcome: CopyOutcomeView = OmawardenBridge.copyCipherField(
      cipher.id,
      field,
      customIndex ?? null,
    );
    notify(outcome.message, outcome.ok ? "success" : "error");
  };
  if (fieldIsSensitive(field, customIndex)) {
    ensureReprompt(run);
    return;
  }
  run();
}

function fieldIsSensitive(field: string, customIndex?: number): boolean {
  if (["password", "totp", "card_number", "cvv", "private_key"].includes(field)) {
    return true;
  }
  if (field === "custom" && customIndex !== undefined) {
    const entry = inspector()?.fields.find((item) => item.index === customIndex);
    return entry?.kind === "hidden";
  }
  return false;
}

let pendingRepromptAction: (() => void) | null = null;

/** Runs `action` now, or after the master password is confirmed. */
function ensureReprompt(action: () => void): boolean {
  if (!repromptRequired()) {
    action();
    return true;
  }
  pendingRepromptAction = action;
  requestReprompt();
  return false;
}

/** Opens the master-password re-prompt dialog. */
export function requestReprompt(): void {
  repromptError.set(null);
  activeModal.set("reprompt");
}

/** Verifies the master password and runs the pending action on success. */
export function confirmMasterPassword(secret: string): void {
  const cipher = selectedCipher();
  if (!cipher) {
    return;
  }
  if (!OmawardenBridge.verifyMasterPassword(secret)) {
    repromptError.set("Incorrect master password.");
    return;
  }
  repromptCipherId.set(cipher.id);
  repromptError.set(null);
  activeModal.set("none");
  const action = pendingRepromptAction;
  pendingRepromptAction = null;
  action?.();
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

/** Opens the selected item's first website URI. */
export function openFirstUrl(): void {
  const uris = inspector()?.uris ?? [];
  if (uris.length === 0) {
    notify("This item has no website URL.", "error");
    return;
  }
  openUrl(uris[0].uri);
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
      dataUrl: outcome.previewDataUrl ?? "",
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

export function launchAttachmentPreview(): void {
  const preview = attachmentPreview();
  if (!preview?.path) {
    return;
  }
  if (!OmawardenBridge.openAttachmentPath(preview.path)) {
    notify("Could not open the attachment in the system viewer.", "error");
  }
}

export function saveAttachment(cipherId: string, attachmentId: string): void {
  const file = inspector()?.attachments.find((entry) => entry.id === attachmentId);
  const destination = OmawardenBridge.saveFile(
    "Save attachment",
    file?.filename ?? "attachment.bin",
  );
  if (!destination) {
    return;
  }
  const outcome = OmawardenBridge.saveAttachment(cipherId, attachmentId, destination);
  notify(
    outcome.ok
      ? `Saved to ${outcome.path ?? destination}`
      : outcome.error ?? "Could not save the attachment.",
    outcome.ok ? "success" : "error",
  );
}

// ---------------------------------------------------------------------------
// Native file pickers
// ---------------------------------------------------------------------------

export function pickFile(
  title: string,
  filterName?: string,
  extensions?: string[],
): string | null {
  return OmawardenBridge.pickFile(title, filterName ?? null, extensions ?? null);
}

export function pickFolder(title: string): string | null {
  return OmawardenBridge.pickFolder(title);
}

export function saveFile(title: string, defaultName?: string): string | null {
  return OmawardenBridge.saveFile(title, defaultName ?? null);
}

export function readTextFile(path: string): string | null {
  return OmawardenBridge.readTextFile(path);
}

export function browseClientCert(): void {
  const path = pickFile("Select Client Certificate", "Certificate files", [
    "crt",
    "pem",
  ]);
  if (path) {
    updateSettingsDraft({ clientCertPath: path });
  }
}

export function browseClientKey(): void {
  const path = pickFile("Select Client Private Key", "Key files", ["key", "pem"]);
  if (path) {
    updateSettingsDraft({ clientKeyPath: path });
  }
}

export function browseSshImport(): string | null {
  const path = pickFile("Select SSH Private Key", "SSH keys", ["pem", "key"]);
  if (!path) {
    return null;
  }
  return readTextFile(path);
}

export function chooseFolder(title: string): string | null {
  return pickFolder(title);
}

/** Persists the mTLS certificate and key before a login attempt. */
export function saveMtlsConfig(certPath: string, keyPath: string): void {
  const result = OmawardenBridge.updateSettings({
    clientCertPath: certPath,
    clientKeyPath: keyPath,
  });
  settings.set(result);
  health.set(result.health);
  if (result.error) {
    notify(result.error, "error");
  }
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

export function loadUiPrefs(): void {
  applyUiPrefs(OmawardenBridge.getUiPrefs());
}

export function loadSettings(): void {
  const next = OmawardenBridge.getSettings();
  settings.set(next);
  health.set(next.health);
  settingsDraft.set({ ...next.config });
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
  if (activeModal() === "reprompt") {
    pendingRepromptAction = null;
    repromptError.set(null);
  }
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
