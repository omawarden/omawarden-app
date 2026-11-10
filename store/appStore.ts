import { computed, fontScale, host, signal, untracked } from "nsh";
import {
  OmawardenBridge,
  type AppPhase,
  type AuthActionInput,
  type CategoryCountsView,
  type CipherMutationInput,
  type CipherMutationOutcomeView,
  type CipherRowView,
  type CipherTargetCandidateView,
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
  type SettingsView,
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
import { clearAuthSecrets, clearTwoFactorCodes, serverPanelOpen } from "./authForm";

export type ModalKind =
  | "none"
  | "actionPalette"
  | "cipherForm"
  | "cipherEdit"
  | "cipherDelete"
  | "cipherResolve"
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
/**
 * The login screen's own step. The engine's `phase` stays the truth about the
 * session; this only says which half of the login the screen shows, so Back
 * can return to the credentials without cancelling the outstanding challenge.
 */
export const loginStep = signal<"credentials" | "secondFactor">("credentials");
/** The auth failure the login or unlock form shows above its fields. */
export const authError = signal<string | null>(null);
/** The live security-key state, refreshed while the FIDO2 provider is active. */
export const fido2Status = signal<string | null>(null);
/** Whether this challenge has already sent its verification email. */
export const twoFactorEmailSent = signal(false);
export const focusedAction = signal<string | null>(null);
export const isSubmitting = signal(false);
/** Whether a vault sync is in flight (kept separate from auth submission). */
export const isSyncing = signal(false);
/** The cipher whose master-password re-prompt grant is active. */
export const repromptCipherId = signal<string | null>(null);
export const repromptError = signal<string | null>(null);

/** The cipher mutation form's live draft, or null when the form is closed. */
export const cipherForm = signal<CipherMutationInput | null>(null);
/** The draft fields the user changed since the form opened. */
export const cipherFormDirty = signal<string[]>([]);
/** The id being edited, or null when the form is a create. */
export const cipherFormId = signal<string | null>(null);
/** The outcome of the last mutation, shown inline until the modal closes. */
export const cipherFormOutcome = signal<CipherMutationOutcomeView | null>(null);
/** The target-resolution menu, when a name matched more than one cipher. */
export const cipherCandidates = signal<CipherTargetCandidateView[] | null>(null);
/** The name typed into the "go to item" resolver. */
export const cipherResolveQuery = signal("");
/** The resolver's failure message, shown under its input. */
export const cipherResolveError = signal<string | null>(null);
/** The delete confirmation's permanent flag. */
export const cipherDeletePermanent = signal(false);

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
    fido2Status.set(next.twoFactor.fido2Status ?? null);
  } else {
    fido2Status.set(null);
  }
  if (next.phase !== "twoFactor") {
    twoFactorEmailSent.set(false);
  }
  // The engine's phase decides the step: an outstanding challenge means the
  // second factor, and every other phase starts over at the credentials.
  loginStep.set(
    next.phase === "twoFactor" && next.twoFactor ? "secondFactor" : "credentials",
  );
  // The auth screens render the failure inside the form, so raising a toast as
  // well would show the same failure twice. Everything else has no inline
  // surface and still needs the notification.
  const showsErrorInline =
    next.phase === "login" || next.phase === "twoFactor" || next.phase === "locked";
  authError.set(showsErrorInline ? next.error ?? null : null);
  if (next.error && !showsErrorInline) {
    notify(next.error, "error");
  }
  syncFido2Ticker();
  syncLockTicker();
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

// ---------------------------------------------------------------------------
// Two-factor: security-key detection
// ---------------------------------------------------------------------------

let fido2Timer: ReturnType<typeof setInterval> | null = null;

function stopFido2Ticker(): void {
  if (fido2Timer !== null) {
    clearInterval(fido2Timer);
    fido2Timer = null;
  }
}

/** Polls the security key while the FIDO2 provider is the active one. */
function syncFido2Ticker(): void {
  const wanted =
    loginStep() === "secondFactor" &&
    snapshot().phase === "twoFactor" &&
    snapshot().twoFactor !== null &&
    selectedProvider() === 7 &&
    fido2Status() !== "tool_not_found";
  if (!wanted) {
    stopFido2Ticker();
    return;
  }
  if (fido2Timer === null) {
    fido2Timer = setInterval(checkFido2Status, 2000);
    checkFido2Status();
  }
}

/** Re-reads the libfido2 tools and the attached security key. */
export function checkFido2Status(): void {
  defer(() => {
    if (snapshot().phase !== "twoFactor" || loginStep() !== "secondFactor") {
      return;
    }
    const next = OmawardenBridge.checkFido2Status();
    fido2Status.set(next);
    if (next === "tool_not_found") {
      stopFido2Ticker();
    }
  });
}

/** Switches the two-factor method and restarts the security-key poll. */
export function selectTwoFactorProvider(id: number): void {
  selectedProvider.set(id);
  syncFido2Ticker();
}

/**
 * Returns the login screen to its credentials step.
 *
 * The engine keeps its outstanding challenge: there is no way to cancel one,
 * and a challenge without a completed first factor holds no session. Only the
 * screen's step and the transient state that belonged to the second step move.
 */
export function backToCredentials(): void {
  if (isSubmitting() || loginStep() !== "secondFactor") {
    return;
  }
  loginStep.set("credentials");
  authError.set(null);
  clearTwoFactorCodes();
  selectedProvider.set(0);
  fido2Status.set(null);
  twoFactorEmailSent.set(false);
  serverPanelOpen.set(false);
  stopFido2Ticker();
}

/** Opens a terminal to install libfido2, the tool security keys need. */
export function installFido2(): void {
  notify("Launching the package installer…", "info");
  defer(() => {
    const ok = OmawardenBridge.installMissingDependencies(["libfido2"]);
    notify(
      ok
        ? "Installing libfido2 in a floating terminal."
        : "Could not launch the package installer.",
      ok ? "success" : "error",
    );
  });
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
      // The progress toast must not outlive the attempt: on failure the form
      // shows the error inline, and a stale "Signing in…" would sit under it.
      dismissToast();
      if (next.error) {
        return;
      }
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
    if (outcome.ok) {
      twoFactorEmailSent.set(true);
    }
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

/** Re-reads the vault after a mutation so the rows reflect the new state. */
function reloadVault(): void {
  applySnapshot(OmawardenBridge.queryVault(currentFilter()));
  selectFirstIfNeeded();
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

// The daemon locks the vault on its own timer, and nothing else tells the app.
// Polling while unlocked is what turns that lock into a screen change; the
// probe carries `touch: false`, so it cannot postpone the lock it watches for.
const LOCK_TICK_MS = 2000;

let lockTimer: ReturnType<typeof setInterval> | null = null;
let lockTickRunning = false;

function stopLockTicker(): void {
  if (lockTimer !== null) {
    clearInterval(lockTimer);
    lockTimer = null;
  }
}

function syncLockTicker(): void {
  if (phase() !== "unlocked") {
    stopLockTicker();
    return;
  }
  if (lockTimer === null) {
    lockTimer = setInterval(tickDaemon, LOCK_TICK_MS);
  }
}

/** One daemon tick: notice a lock and leave the vault screen. */
function tickDaemon(): void {
  // Synchronous on purpose: the flag is exact only while the call owns the
  // thread, and there is no user action waiting to be acknowledged.
  if (lockTickRunning || phase() !== "unlocked") {
    return;
  }
  lockTickRunning = true;
  try {
    const tick = OmawardenBridge.pollDaemonTick(null);
    // A missing daemon is not a lock. Reacting to it would fight the daemon's
    // own idle exit; copy, inspect and TOTP already report it in place.
    if (!tick.online || tick.unlocked) {
      return;
    }
    applySnapshot(OmawardenBridge.boot(null));
    selectedIndex.set(0);
    activeModal.set("none");
  } finally {
    lockTickRunning = false;
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
    case "sshKey": {
      // The plugin's primary action is the private key, falling back to the
      // public key for a key that was imported without one.
      const ssh = inspector()?.ssh;
      if (ssh && ssh.privateKey) {
        copyField("private_key");
      } else {
        copyField("public_key");
      }
      break;
    }
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

/** Reads the stored configuration for the login screen's inline server panel. */
export function loadServerConfig(): SettingsView {
  const result = OmawardenBridge.getSettings();
  settings.set(result);
  health.set(result.health);
  if (result.error) {
    notify(result.error, "error");
  }
  return result.config;
}

/**
 * Saves the server URL and its mTLS material on their own, so the login
 * screen's panel cannot carry unsaved changes from the settings dialog.
 */
export function saveServerConfig(serverUrl: string, certPath: string, keyPath: string): void {
  const result = OmawardenBridge.updateSettings({
    serverUrl,
    clientCertPath: certPath,
    clientKeyPath: keyPath,
  });
  settings.set(result);
  health.set(result.health);
  if (result.error) {
    notify(result.error, "error");
    return;
  }
  notify("Server settings saved.", "success");
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
  if (activeModal() === "cipherResolve") {
    cipherCandidates.set(null);
    cipherResolveError.set(null);
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

// ---------------------------------------------------------------------------
// Cipher mutation: create, edit, delete
// ---------------------------------------------------------------------------

/** Opens the create form for a login or secure note cipher. */
export function openCipherForm(cipherType: "login" | "note" = "login"): void {
  cipherForm.set({
    cipherType,
    name: null,
    username: null,
    password: null,
    notes: null,
    uris: cipherType === "login" ? [""] : null,
    folderId: null,
    favorite: null,
  });
  cipherFormId.set(null);
  cipherFormDirty.set([]);
  cipherFormOutcome.set(null);
  cipherCandidates.set(null);
  openModal("cipherForm");
}

/** The selected cipher when it is a login or a secure note, else null. */
function editableCipher(): CipherRowView | null {
  const cipher = selectedCipher();
  if (!cipher) {
    notify("Select an item first.", "error");
    return null;
  }
  if (cipher.category !== "login" && cipher.category !== "secureNote") {
    notify("Only logins and secure notes can be changed.", "error");
    return null;
  }
  return cipher;
}

/** Opens the edit form pre-filled from the selected cipher. */
export function openCipherEdit(): void {
  const cipher = editableCipher();
  if (!cipher) {
    return;
  }
  const detail = inspector();
  // An update can only replace the first URL, so the form carries the whole
  // list and only the first row is editable; the rest are preserved.
  cipherForm.set({
    cipherType: cipher.category === "secureNote" ? "note" : "login",
    name: cipher.title,
    username: detail?.username ?? null,
    password: null,
    notes: detail?.notes ?? null,
    uris: (detail?.uris ?? []).map((uri) => uri.uri),
    folderId: cipher.folder ?? null,
    favorite: cipher.favorite,
  });
  cipherFormId.set(cipher.id);
  cipherFormDirty.set([]);
  cipherFormOutcome.set(null);
  cipherCandidates.set(null);
  openModal("cipherEdit");
}

/** Submits the create/edit form through the daemon. */
export function submitCipherForm(input: CipherMutationInput, id: string | null): void {
  isSubmitting.set(true);
  notify(id ? "Saving item…" : "Creating item…", "info");
  defer(() => {
    const payload = id === null ? input : editPayload(input, cipherFormDirty());
    const outcome: CipherMutationOutcomeView = OmawardenBridge.mutateCipher(payload, id);
    cipherFormOutcome.set(outcome);
    if (outcome.ok) {
      notify(outcome.outcome || (id ? "Item saved." : "Item created."), "success");
      reloadVault();
      refreshInspector();
      cipherForm.set(null);
      cipherFormId.set(null);
      cipherCandidates.set(null);
      activeModal.set("none");
      clearActionFocus();
    } else {
      notify(outcome.error ?? "Could not save the item.", "error");
    }
    isSubmitting.set(false);
  });
}

/** Updates one field of the live cipher form draft. */
export function updateCipherDraft(fields: Partial<CipherMutationInput>): void {
  cipherForm.update((current) => (current ? { ...current, ...fields } : current));
  cipherFormDirty.update((current) => {
    const next = [...current];
    for (const key of Object.keys(fields)) {
      if (!next.includes(key)) {
        next.push(key);
      }
    }
    return next;
  });
}

/**
 * On an edit, sends the name plus only the fields the user changed, so an
 * untouched password is left alone instead of being cleared.
 */
function editPayload(input: CipherMutationInput, dirty: string[]): CipherMutationInput {
  const payload: CipherMutationInput = {
    cipherType: input.cipherType,
    name: input.name,
  };
  const target = payload as unknown as Record<string, unknown>;
  const source = input as unknown as Record<string, unknown>;
  for (const key of dirty) {
    if (key === "name" || key === "cipherType") {
      continue;
    }
    target[key] = source[key];
  }
  return payload;
}

/**
 * Fills the open cipher form's password with a generated 16-character secret,
 * the GUI's answer to the CLI's Enter-at-the-prompt generator.
 */
export function generateCipherPassword(): void {
  const secret: GeneratedSecretView = OmawardenBridge.generatePassword({
    length: 16,
    uppercase: true,
    lowercase: true,
    numbers: true,
    special: true,
    avoidAmbiguous: false,
    minNumbers: 1,
    minSpecial: 1,
  });
  if (!secret.ok || !secret.value) {
    notify(secret.error ?? "Could not generate a password.", "error");
    return;
  }
  updateCipherDraft({ password: secret.value });
}

/** Cancels the create/edit form, discarding the draft. */
export function cancelCipherForm(): void {
  cipherForm.set(null);
  cipherFormId.set(null);
  cipherFormOutcome.set(null);
  cipherCandidates.set(null);
  activeModal.set("none");
  clearActionFocus();
}

/** Opens the "go to item" resolver, which targets a cipher by name or id. */
export function openCipherResolve(): void {
  cipherResolveQuery.set("");
  cipherResolveError.set(null);
  cipherCandidates.set(null);
  openModal("cipherResolve");
}

/** Updates the resolver's query. */
export function updateCipherResolveQuery(value: string): void {
  cipherResolveQuery.set(value);
  cipherResolveError.set(null);
}

/**
 * Selects the row with `id`, clearing the search, category, scope, and folder
 * when one of them hides it. Returns false when no row has that id.
 */
export function selectCipherById(id: string): boolean {
  const find = () => filteredItems().findIndex((row) => row.id === id);
  let index = find();
  if (index < 0) {
    search.set("");
    category.set("all");
    scopeId.set("all");
    folderId.set(null);
    query();
    index = find();
  }
  if (index < 0) {
    return false;
  }
  selectCipher(index);
  return true;
}

/**
 * Resolves the typed target and selects it. An exact id or name selects the
 * item directly; a name that matches several ciphers fills the candidate menu
 * instead, so the wrong item is never picked by accident.
 */
export function submitCipherResolve(): void {
  const target = cipherResolveQuery().trim();
  if (!target) {
    cipherResolveError.set("Enter an item name or id.");
    return;
  }
  const resolved = OmawardenBridge.resolveCipherTarget(target);
  if (resolved.ok && resolved.item) {
    if (selectCipherById(resolved.item.id)) {
      cipherCandidates.set(null);
      activeModal.set("none");
      clearActionFocus();
      return;
    }
    cipherResolveError.set(`Cipher '${target}' is not in the current vault.`);
    return;
  }
  if (resolved.candidates.length > 0) {
    cipherCandidates.set(resolved.candidates);
    cipherResolveError.set(resolved.error ?? "More than one item matched.");
    return;
  }
  cipherCandidates.set(null);
  cipherResolveError.set(resolved.error ?? `Cipher '${target}' not found.`);
}

/** Picks one candidate from the disambiguation menu and selects its row. */
export function pickCipherCandidate(candidate: CipherTargetCandidateView): void {
  if (!selectCipherById(candidate.id)) {
    cipherResolveError.set(`Cipher '${candidate.name}' is not in the current vault.`);
    return;
  }
  cipherCandidates.set(null);
  cipherResolveError.set(null);
  activeModal.set("none");
  clearActionFocus();
}

/** Confirms a delete of the selected cipher. */
export function confirmDeleteCipher(permanent: boolean): void {
  const cipher = editableCipher();
  if (!cipher) {
    return;
  }
  const outcome: CipherMutationOutcomeView = OmawardenBridge.deleteCipher(cipher.id, permanent);
  if (outcome.ok) {
    notify(
      outcome.outcome || (permanent ? "Item deleted." : "Item deleted; pending sync."),
      "success",
    );
    inspector.set(null);
    selectedIndex.set(0);
    reloadVault();
    activeModal.set("none");
    clearActionFocus();
  } else {
    notify(outcome.error ?? "Could not delete the item.", "error");
  }
}

/** Opens the delete confirmation dialog for the selected cipher. */
export function openCipherDelete(permanent: boolean): void {
  if (!editableCipher()) {
    return;
  }
  cipherDeletePermanent.set(permanent);
  openModal("cipherDelete");
}
