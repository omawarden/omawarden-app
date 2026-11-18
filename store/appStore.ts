import { computed, fontScale, host, signal, untracked, type ViewRef } from "nsh";
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
import {
  blurCipherFields,
  blurCipherPassword,
  cipherFieldKeys,
  focusCipherField,
  focusCipherPassword,
  focusedCipherField,
  markCipherFieldFocus,
  resetCipherFields,
} from "./cipherFormFocus";
import { buildDiagnosticReport } from "./diagnosticReport";
import {
  mode as generatorMode,
  passphraseOptions,
  passwordOptions,
} from "./generatorOptions";

export type ModalKind =
  | "none"
  | "actionPalette"
  | "typePicker"
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
/**
 * Which vault the list shows. The Trash is a view, not an `ItemCategory`, so
 * the category tabs keep their meaning inside it.
 */
export type VaultView = "active" | "trash";
export const vaultView = signal<VaultView>("active");
/**
 * The loaded Trash rows, or null until the first open of the session.
 *
 * The Trash is read on demand and kept here, never in `rawItems`: the active
 * vault's cache stays active-only, and a cold path cannot reach a trashed row.
 */
export const trashItems = signal<CipherRowView[] | null>(null);
/**
 * Whether a Trash mutation changed the active rows while the Trash was open.
 *
 * A restore or purge does not re-read the active vault from inside the Trash:
 * the refresh happens once on the way back, so the view keeps its own row
 * source and no cold path gains an extra request.
 */
let activeRowsStale = false;
export const phase = computed<AppPhase>(() => snapshot().phase);
export const sshPrompt = computed(() => snapshot().sshPrompt);
export const dependencies = signal<DependencyStatusView | null>(null);
export const inspector = signal<InspectorView | null>(null);
export const settings = signal<SettingsSnapshotView | null>(null);
export const settingsDraft = signal<SettingsUpdateInput>({});
export const updateStatus = signal<UpdateStatusView | null>(null);
export const sshPreview = signal<SshKeyPreviewView | null>(null);
/** The daemon's reason for a failed SSH save, shown inside the modal. */
export const sshSaveError = signal<string | null>(null);
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
/** Whether a Trash restore is in flight, so a double press cannot fire twice. */
export const isRestoring = signal(false);
/** The cipher whose master-password re-prompt grant is active. */
export const repromptCipherId = signal<string | null>(null);
export const repromptError = signal<string | null>(null);

/** The Inspector Form's live draft, or null when the form is closed. */
export const cipherForm = signal<CipherMutationInput | null>(null);
/** The draft as the form opened it: what "unsaved changes" compares against. */
export const cipherFormBaseline = signal<CipherMutationInput | null>(null);
/** The id being edited, or null when the form is a create. */
export const cipherFormId = signal<string | null>(null);
/** The outcome of the last mutation, shown inline until the form closes. */
export const cipherFormOutcome = signal<CipherMutationOutcomeView | null>(null);
/** Whether the form asks before throwing an unsaved draft away. */
export const cipherFormDiscardConfirm = signal(false);
/**
 * The form's buttons in the order they read, as the form declares them.
 *
 * The action registry reports the order the platform mounted the controls in,
 * which is breadth first and puts the panel's buttons after the row below it;
 * the form names its own order so Tab walks the screen top to bottom.
 */
export const cipherFormActionRing = signal<string[]>([]);

// What to do after the form's discard strip is answered: a navigation that
// asked to leave the open form (a list row, a scope, the Trash) waits here.
let pendingCipherFormLeave: (() => void) | null = null;
/** The Type Picker's highlighted choice: 0 is Login, 1 is Secure Note. */
export const typePickerIndex = signal(0);
/** Whether the password generator fills the open form instead of the clipboard. */
export const generatorFillMode = signal(false);
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

/**
 * Filters the loaded Trash rows.
 *
 * The Trash is server-wide, so scope and folder do not narrow it. The rows
 * arrive newest-deletion-first and keep that order: a search must not re-sort
 * them by fuzzy score the way the active list does.
 */
function filterTrashRows(
  rows: CipherRowView[],
  cat: ItemCategory,
  queryText: string,
): CipherRowView[] {
  const kept: CipherRowView[] = [];
  for (const row of rows) {
    if (cat !== "all" && row.category !== cat) continue;
    const haystack = `${row.title} ${row.subtitle} ${row.organization ?? ""} ${row.folder ?? ""}`;
    if (fuzzyScore(queryText, haystack) === null) continue;
    kept.push(row);
  }
  return kept;
}

export const filteredItems = computed<CipherRowView[]>(() =>
  vaultView() === "trash"
    ? filterTrashRows(trashItems() ?? [], category(), search())
    : filterRows(rawItems(), category(), scopeId(), folderId(), search()),
);

/** Every row the current view can list, before filtering. */
export const viewRows = computed<CipherRowView[]>(() =>
  vaultView() === "trash" ? trashItems() ?? [] : rawItems(),
);

/** The Trash's row count, or null before the first load. */
export const trashCount = computed<number | null>(() => trashItems()?.length ?? null);

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
  const rows =
    vaultView() === "trash"
      ? filterTrashRows(trashItems() ?? [], "all", search())
      : filterRows(rawItems(), "all", scopeId(), folderId(), search());
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

/**
 * Whether the current view has an item for the inspector to show.
 *
 * The active view needs an engine inspector; the Trash renders the selected row
 * itself, because the daemon's per-item reads are active-only.
 */
export const selectionActive = computed<boolean>(() =>
  vaultView() === "trash" ? selectedCipher() !== null : inspector() !== null,
);

/**
 * Refuses a write or extract action while the Trash is the current view.
 *
 * Edit, favourite, delete, copy, open URL, password history and SSH export all
 * leave the read-only view or write through an active-only path, so they stay
 * off in the Trash. Revealing in place is not one of them: the inspector
 * unmasks what the Trash read already carried.
 */
function trashBlocksItemActions(): boolean {
  if (vaultView() !== "trash") {
    return false;
  }
  notify("This item is in the Trash.", "info");
  return true;
}

export const activeScopeName = computed(() => {
  const active = scopeId();
  const match = snapshot().scopes.find((scope) => scope.id === active);
  return match ? match.name : "All Vaults";
});

/** The scope trigger's label: the Trash is a view, not a scope. */
export const scopeLabel = computed(() =>
  vaultView() === "trash" ? "Scope: Trash" : `Scope: ${activeScopeName()}`,
);

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
  if (modal !== "none") {
    return `modal:${modal}`;
  }
  // The Inspector Form is not a dialog, but it owns the keyboard while it is
  // open: Tab walks its fields and its buttons, not the vault's controls.
  return cipherForm() !== null ? "form" : "base";
}

/** The native view behind each action, so the ring can move focus onto it. */
const actionElements = new Map<string, ViewRef | null>();

export function registerActionElement(id: string, ref: ViewRef | null): void {
  if (ref) {
    actionElements.set(id, ref);
    return;
  }
  actionElements.delete(id);
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

/** The Inspector Form's button order for Tab, set by the form itself. */
export function setCipherFormActionRing(ids: string[]): void {
  cipherFormActionRing.set(ids);
}

/**
 * Tab's two stops: the vault's controls, or the Inspector Form's ring.
 *
 * Both the default Tab binding and the vault's `always` one call this, so the
 * order the platform resolves them in cannot change what Tab does.
 */
export function cycleVaultFocus(delta: number): void {
  if (cipherForm() !== null) {
    cycleCipherFormFocus(delta);
    return;
  }
  cycleAction(delta);
}

/**
 * Moves the keyboard one stop around the open Inspector Form.
 *
 * The ring is the form's text fields in the order they read, then its buttons:
 * the desktop's native traversal reaches text fields only, so the app walks the
 * buttons itself, as it does for the vault. Shift+Tab on the first stop wraps
 * to the last, so the ring is closed and the fields are never a trap (the form
 * is left with Esc).
 */
export function cycleCipherFormFocus(delta: number): void {
  // A dialog over the form owns the keyboard; nothing behind it moves.
  if (activeModal() !== "none") {
    return;
  }
  const layer = currentLayer();
  const declared = cipherFormActionRing().filter((id) => actionEntries.get(id)?.layer === layer);
  const actions =
    declared.length > 0
      ? declared
      : actionOrder.filter((id) => actionEntries.get(id)?.layer === layer);
  const stops = [...cipherFieldKeys().map((key) => `field:${key}`), ...actions];
  if (stops.length === 0) {
    return;
  }
  const focused = focusedCipherField();
  const current = focused ? `field:${focused}` : focusedAction();
  const index = current ? stops.indexOf(current) : -1;
  const from = index < 0 ? (delta > 0 ? -1 : 0) : index;
  const next = stops[(from + delta + stops.length) % stops.length];
  if (next.startsWith("field:")) {
    clearActionFocus();
    focusCipherField(next.slice(6));
    return;
  }
  blurCipherFields();
  focusedAction.set(next);
  // Real focus on the control, not just the app's ring: a text input holding
  // the keyboard would otherwise keep every key, Enter and Space included.
  actionElements.get(next)?.focus();
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
    vaultView.set("active");
    trashItems.set(null);
    // A new session re-reads the active rows on unlock, so neither a pending
    // Trash refresh nor an in-flight restore flag survives the lock.
    activeRowsStale = false;
    isRestoring.set(false);
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

/**
 * The filter a Trash read sends: the whole list, filtered locally.
 *
 * The Trash is server-wide, so the request carries no scope or folder, and the
 * store applies the search and category tabs to the loaded rows itself.
 */
function trashFilter(): VaultFilterInput {
  return {
    search: "",
    category: "all",
    scopeId: null,
    folderId: null,
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

export function query(keepId: string | null = null): void {
  resetVisibleLimit();
  // A filter change normally re-picks the first row, but the caller can ask to
  // keep a specific row selected — clearing the search should not move the
  // viewer away from the item they were reading.
  if (keepId !== null) {
    const index = filteredItems().findIndex((row) => row.id === keepId);
    if (index >= 0) {
      selectCipher(index);
      return;
    }
  }
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
      // The Trash is a separate read, so an explicit sync is the one moment it
      // has to be refreshed while the user is looking at it.
      if (vaultView() === "trash" && phase() === "unlocked") {
        reloadTrash();
      }
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
  // Remember the row being inspected so the projection change keeps it — and
  // the inspector — in place instead of jumping back to the first row. The
  // Trash has no engine inspector, so its selection is the row itself.
  const keepId =
    vaultView() === "trash" ? (selectedCipher()?.id ?? null) : (inspector()?.id ?? null);
  search.set(text);
  query(keepId);
}

/**
 * Runs a navigation that would leave the open Inspector Form behind.
 *
 * A clean draft closes at once and the navigation proceeds; a changed one asks
 * with the form's own discard strip and remembers what to do after. Returns
 * true when the navigation was deferred, so the caller stops.
 */
function guardCipherFormLeave(proceed: () => void): boolean {
  if (cipherForm() === null) {
    return false;
  }
  if (cipherFormIsDirty()) {
    pendingCipherFormLeave = proceed;
    cipherFormDiscardConfirm.set(true);
    return true;
  }
  closeCipherEditor();
  return false;
}

export function setCategory(next: ItemCategory): void {
  if (category() === next) return;
  if (guardCipherFormLeave(() => setCategory(next))) return;
  category.set(next);
  query();
}

export function setScope(next: string): void {
  // The dropdown the row was picked from closes either way; a deferred move
  // must not leave it hanging over the form's discard strip.
  scopeOpen.set(false);
  if (guardCipherFormLeave(() => setScope(next))) return;
  scopeId.set(next);
  // A scope belongs to the active vault: picking one leaves the Trash.
  leaveTrash();
  query();
}

export function setFolder(next: string | null): void {
  scopeOpen.set(false);
  if (guardCipherFormLeave(() => setFolder(next))) return;
  folderId.set(next);
  leaveTrash();
  query();
}

export function toggleScope(): void {
  scopeOpen.update((open) => !open);
}

/**
 * Switches the list to the Trash, loading it on first open.
 *
 * The Trash is read on demand: boot, unlock, the daemon tick, and active-vault
 * filtering never touch it. Once loaded it stays for the session, so re-opening
 * it is instant.
 */
export function openTrash(): void {
  scopeOpen.set(false);
  if (guardCipherFormLeave(openTrash)) return;
  vaultView.set("trash");
  resetVisibleLimit();
  selectedIndex.set(0);
  reveal.set(defaultReveal());
  repromptCipherId.set(null);
  repromptError.set(null);
  loadTrash();
  refreshInspector();
}

/**
 * Leaves the Trash for the active vault, applying a pending active-row refresh.
 *
 * Every way back (a scope row, the folder picker, the name resolver) goes
 * through here, so a restore or purge cannot leave the active list a mutation
 * behind.
 */
function leaveTrash(): void {
  if (vaultView() !== "trash") {
    return;
  }
  vaultView.set("active");
  selectedIndex.set(0);
  if (activeRowsStale) {
    activeRowsStale = false;
    // The active-vault cache doesn't know about the Trash mutation; clear it
    // so the next query_vault picks up the restored/purged cipher.
    OmawardenBridge.clearVaultCache();
    reloadVault();
  }
}

/** Leaves the Trash for the active vault, keeping the loaded Trash rows. */
export function closeTrash(): void {
  if (vaultView() === "active") {
    return;
  }
  leaveTrash();
  query();
}

/** Reads the Trash once per session, unless a mutation invalidates it. */
export function loadTrash(): void {
  if (trashItems() !== null) {
    return;
  }
  const next = OmawardenBridge.queryTrash(trashFilter());
  trashItems.set(next.allItems);
  if (next.error) {
    notify(next.error, "error");
  }
}

/** Re-reads the Trash after a restore, a purge, or an explicit sync. */
function reloadTrash(): void {
  trashItems.set(null);
  loadTrash();
  if (selectedIndex() >= (trashItems()?.length ?? 0)) {
    selectedIndex.set(0);
  }
  refreshInspector();
}

/**
 * Restores the selected Trash row in one action, with no confirmation.
 *
 * On success the Trash is re-read so the row disappears and the selection is
 * clamped to the rows that remain. The user stays in the Trash; the active rows
 * are marked stale so the cipher is there when they go back. A failure only
 * toasts the daemon's error and leaves the list untouched.
 */
export function restoreCipher(id: string): void {
  if (vaultView() !== "trash" || isRestoring()) {
    return;
  }
  const row = (trashItems() ?? []).find((item) => item.id === id);
  if (!row) {
    return;
  }
  isRestoring.set(true);
  defer(() => {
    try {
      const outcome: CipherMutationOutcomeView = OmawardenBridge.restoreCipher(id);
      if (!outcome.ok) {
        notify(outcome.error ?? "Could not restore the item.", "error");
        return;
      }
      notify(`Restored "${outcome.name ?? row.title}".`, "success");
      activeRowsStale = true;
      reloadTrash();
    } catch (error) {
      notify(`Restore failed: ${String(error)}`, "error");
    } finally {
      isRestoring.set(false);
    }
  });
}

export function selectCipher(index: number): void {
  if (guardCipherFormLeave(() => selectCipher(index))) return;
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
  if (!selectionActive()) {
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
  if (trashBlocksItemActions()) {
    return;
  }
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

/** Toggles the selected item's favorite flag, then refreshes the row. */
export function toggleFavorite(): void {
  const cipher = editableCipher();
  if (!cipher) {
    return;
  }
  const previous = cipher.favorite;
  const nextFavorite = !previous;
  // Flip the row and inspector locally first: the press must show at once, even
  // when the daemon's cached list still holds the old flag. The mutation runs in
  // the background and only reports a toast when it fails.
  patchRawItem(cipher.id, { favorite: nextFavorite });
  patchInspectorFavorite(cipher.id, nextFavorite);
  keepSelectionOn(cipher.id);

  const next: CipherMutationInput = {
    cipherType: cipher.category === "secureNote" ? "note" : "login",
    name: cipher.title,
    favorite: nextFavorite,
  };
  defer(() => {
    const outcome = OmawardenBridge.mutateCipher(next, cipher.id);
    if (outcome.ok) {
      return;
    }
    // Roll back only if this toggle is still the one on screen; a newer press
    // owns the row now.
    rawItems.update((rows) =>
      rows.map((row) =>
        row.id === cipher.id && row.favorite === nextFavorite
          ? { ...row, favorite: previous }
          : row,
      ),
    );
    patchInspectorFavorite(cipher.id, previous);
    keepSelectionOn(cipher.id);
    notify(outcome.error ?? "Could not toggle favorite.", "error");
  });
}

/** Opens the selected item's first website URI. */
export function openFirstUrl(): void {
  if (trashBlocksItemActions()) {
    return;
  }
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
  sshSaveError.set(null);
  notify("Saving SSH key…", "info");
  defer(() => {
    const outcome = OmawardenBridge.saveSshKey(input, currentFilter());
    notify(outcome.message, outcome.ok ? "success" : "error");
    if (outcome.ok) {
      sshSaveError.set(null);
      sshPreview.set(null);
      activeModal.set("none");
      clearActionFocus();
      // A vault save adds a row; an export only writes to disk. Without this
      // the new key is missing from the SSH keys category until the next query.
      if (!outcome.path) {
        reloadVault();
      }
    } else {
      // The daemon's reason (a locked vault, a server without
      // `ssh-key-vault-item`, a rejected key) is more useful than the generic
      // "Could not save the SSH key." toast, so the modal carries it too.
      sshSaveError.set(outcome.error ?? outcome.message);
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
  // Re-read the whole snapshot so the Log Viewer picks up Log Pipeline events
  // emitted since Settings was opened, without a close/reopen round trip.
  const current = OmawardenBridge.getSettings();
  health.set(next);
  settings.set({ ...current, health: next });
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
  const snapshot = health();
  const report = buildDiagnosticReport({
    diagnostics: current.diagnostics,
    health: { checks: snapshot?.checks ?? [] },
    generatedAt: new Date().toISOString(),
  });
  copyText(report, "diagnostic report", false);
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
  if (activeModal() === "generator") {
    generatorFillMode.set(false);
  }
  activeModal.set("none");
  clearActionFocus();
}

/** Generates with the panel's current mode and options. */
function secretFromGeneratorOptions(): GeneratedSecretView {
  return generatorMode() === "passphrase"
    ? OmawardenBridge.generatePassphrase(passphraseOptions())
    : OmawardenBridge.generatePassword(passwordOptions());
}

export function openGenerator(): void {
  generatorFillMode.set(false);
  generatedSecret.set(secretFromGeneratorOptions());
  openModal("generator");
}

/**
 * Opens the generator over the Inspector Form to fill its password field.
 *
 * The password field lets go of the keyboard first: the dialog sits above it,
 * and the length the user types would otherwise edit the hidden secret.
 */
export function openGeneratorFill(): void {
  if (!cipherForm()) {
    return;
  }
  blurCipherPassword();
  openGenerator();
  generatorFillMode.set(true);
}

/**
 * Fills the open form's password with the generated secret.
 *
 * The secret goes straight into the field: it never reaches the clipboard, so
 * a fill cannot leave the generated password behind for a clipboard monitor.
 */
export function useGeneratedPassword(): void {
  const secret = generatedSecret();
  if (!cipherForm()) {
    return;
  }
  if (!secret?.ok || !secret.value) {
    notify("Generate a secret first.", "error");
    return;
  }
  updateCipherDraft({ password: secret.value });
  generatorFillMode.set(false);
  activeModal.set("none");
  clearActionFocus();
  focusCipherPassword(secret.value.length);
}

export function openSettings(): void {
  loadSettings();
  openModal("settings");
}

export function openSshKey(mode: SshKeyMode): void {
  // Creating a key is a vault-wide action; exporting the selected one is not,
  // because the Trash never shows secrets.
  if (mode === "export" && trashBlocksItemActions()) {
    return;
  }
  sshKeyMode.set(mode);
  sshPreview.set(null);
  sshSaveError.set(null);
  openModal("sshKey");
}

export function openPasswordHistory(): void {
  if (trashBlocksItemActions()) {
    return;
  }
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

/** Replaces one cached row in place, so the list updates without a query. */
function patchRawItem(id: string, patch: Partial<CipherRowView>): void {
  rawItems.update((rows) =>
    rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
  );
}

/** Mirrors a row's favorite flag into the open inspector, if it is showing. */
function patchInspectorFavorite(id: string, favorite: boolean): void {
  inspector.update((current) =>
    current && current.id === id ? { ...current, favorite } : current,
  );
}

/** Keeps `id` selected after a local patch reorders the filtered list. */
function keepSelectionOn(id: string): void {
  const index = filteredItems().findIndex((row) => row.id === id);
  if (index >= 0) {
    selectedIndex.set(index);
  }
}

/**
 * Selects a row that was just added locally, clearing the filters that hide it.
 *
 * Unlike `selectCipherById`, this never queries the vault: the row exists only
 * in `rawItems` until the next snapshot, so a query would drop it.
 */
function selectLocalRow(id: string): void {
  const find = () => filteredItems().findIndex((row) => row.id === id);
  let index = find();
  if (index < 0) {
    search.set("");
    category.set("all");
    scopeId.set("all");
    folderId.set(null);
    index = find();
  }
  if (index >= 0) {
    selectCipher(index);
  }
}

/** The folder name for a form's folder id, matching the snapshot's options. */
function folderNameFor(folderId: string | null | undefined): string | null {
  if (!folderId) {
    return null;
  }
  const match = snapshot().folders.find((folder) => folder.id === folderId);
  if (match) {
    return match.name;
  }
  return folderId.startsWith("folder:") ? folderId.slice(7) : folderId;
}

/** Builds the list row a freshly created cipher shows, from the form input. */
function rowFromForm(id: string, input: CipherMutationInput): CipherRowView {
  const isNote = input.cipherType === "note" || input.cipherType === "secureNote";
  const uris = (input.uris ?? [])
    .map((uri) => uri.trim())
    .filter((uri) => uri.length > 0);
  return {
    id,
    title: (input.name ?? "").trim() || "Untitled",
    subtitle: isNote ? "Secure Note" : input.username ?? "",
    category: isNote ? "secureNote" : "login",
    favorite: input.favorite ?? false,
    attachmentCount: 0,
    organization: null,
    folder: folderNameFor(input.folderId),
    hasTotp: false,
    hasPasswordHistory: false,
    uris,
    reprompt: 0,
    cardBrand: null,
    cardMask: null,
  };
}

/** Applies an edit's dirty fields to the cached row. */
function patchRowFromMutation(
  row: CipherRowView,
  payload: CipherMutationInput,
): CipherRowView {
  const next: CipherRowView = { ...row };
  if (typeof payload.name === "string" && payload.name.length > 0) {
    next.title = payload.name;
  }
  if (typeof payload.favorite === "boolean") {
    next.favorite = payload.favorite;
  }
  if ("folderId" in payload) {
    next.folder = folderNameFor(payload.folderId);
  }
  if (row.category === "login" && "username" in payload) {
    next.subtitle = payload.username ?? "";
  }
  if (Array.isArray(payload.uris)) {
    // An update only replaces the stored first URL; the rest are kept.
    const first = payload.uris[0] ?? "";
    if (row.uris.length === 0) {
      next.uris = first ? [first] : [];
    } else {
      const merged = [...row.uris];
      merged[0] = first;
      next.uris = merged;
    }
  }
  return next;
}

/**
 * Whether two draft values are the same for the purpose of "unsaved changes".
 *
 * Website rows compare without their blank scaffolding: adding a row, or
 * typing into it and clearing it again, is not a change the user would expect
 * to be told they are about to lose.
 */
function sameFormValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    const clean = (value: unknown) =>
      (Array.isArray(value) ? value : [])
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter((entry) => entry !== "");
    const leftUris = clean(left);
    const rightUris = clean(right);
    return (
      leftUris.length === rightUris.length &&
      leftUris.every((uri, index) => uri === rightUris[index])
    );
  }
  return (left ?? "") === (right ?? "");
}

/** The draft fields that differ from the baseline, in payload-key order. */
export function cipherFormChangedFields(): string[] {
  const draft = cipherForm();
  const baseline = cipherFormBaseline();
  if (!draft || !baseline) {
    return [];
  }
  const changed: string[] = [];
  const source = draft as unknown as Record<string, unknown>;
  const original = baseline as unknown as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (key === "cipherType") {
      continue;
    }
    if (!sameFormValue(source[key], original[key])) {
      changed.push(key);
    }
  }
  return changed;
}

/** Whether the form holds changes a cancel or Esc would throw away. */
export function cipherFormIsDirty(): boolean {
  return cipherFormChangedFields().length > 0;
}

/** Puts the Inspector into form view, closing any dialog that opened it. */
function openCipherEditor(draft: CipherMutationInput, id: string | null): void {
  pendingCipherFormLeave = null;
  cipherForm.set(draft);
  cipherFormBaseline.set({
    ...draft,
    uris: draft.uris ? [...draft.uris] : null,
  });
  cipherFormId.set(id);
  cipherFormOutcome.set(null);
  cipherFormDiscardConfirm.set(false);
  cipherCandidates.set(null);
  activeModal.set("none");
  scopeOpen.set(false);
  clearActionFocus();
  // Name carries `autoFocus`, so the ring starts there whatever the platform
  // reports about focus; a Tab from the form's entry is a Tab from the title.
  markCipherFieldFocus("name", true);
}

/** Opens the create form in the Inspector for a login or secure note. */
export function openCipherForm(cipherType: "login" | "note" = "login"): void {
  // Creating is a vault-wide action and the new row belongs to the active
  // vault, so a Trash view would hide it as soon as it was saved.
  closeTrash();
  openCipherEditor(
    {
      cipherType,
      name: null,
      username: null,
      password: null,
      notes: null,
      uris: cipherType === "login" ? [""] : null,
      folderId: null,
      favorite: null,
    },
    null,
  );
}

/** The selected cipher when it is a login or a secure note, else null. */
function editableCipher(): CipherRowView | null {
  if (trashBlocksItemActions()) {
    return null;
  }
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

/** Opens the edit form in the Inspector, pre-filled from the selected cipher. */
export function openCipherEdit(): void {
  const cipher = editableCipher();
  if (!cipher) {
    return;
  }
  const detail = inspector();
  // An update can only replace the first URL, so the form carries the whole
  // list and only the first row is editable; the rest are preserved.
  openCipherEditor(
    {
      cipherType: cipher.category === "secureNote" ? "note" : "login",
      name: cipher.title,
      username: detail?.username ?? null,
      password: null,
      notes: detail?.notes ?? null,
      uris: (detail?.uris ?? []).map((uri) => uri.uri),
      folderId: cipher.folder ?? null,
      favorite: cipher.favorite,
    },
    cipher.id,
  );
}

/** Submits the create/edit form through the daemon. */
export function submitCipherForm(input: CipherMutationInput, id: string | null): void {
  if (isSubmitting()) {
    return;
  }
  isSubmitting.set(true);
  notify(id ? "Saving item…" : "Creating item…", "info");
  defer(() => {
    const payload = id === null ? input : editPayload(input);
    const outcome: CipherMutationOutcomeView = OmawardenBridge.mutateCipher(payload, id);
    cipherFormOutcome.set(outcome);
    if (outcome.ok) {
      // Apply the receipt to the cached list instead of re-reading the vault:
      // the daemon's cached `list` may still hold the pre-save rows, so a query
      // here would drop the change until the next sync.
      const receiptId = outcome.id;
      // Leave form view before the list moves: the selection is a navigation,
      // and a saved draft is not one the discard strip should offer to throw
      // away.
      closeCipherEditor();
      if (id === null) {
        if (receiptId) {
          rawItems.update((rows) => [...rows, rowFromForm(receiptId, input)]);
          // A new item should be the one the inspector shows, so the user sees
          // what they just created without hunting for it.
          selectLocalRow(receiptId);
        }
      } else {
        rawItems.update((rows) =>
          rows.map((row) =>
            row.id === id ? patchRowFromMutation(row, payload) : row,
          ),
        );
        keepSelectionOn(id);
      }
      notify(outcome.outcome || (id ? "Item saved." : "Item created."), "success");
      refreshInspector();
    } else {
      notify(outcome.error ?? "Could not save the item.", "error");
    }
    isSubmitting.set(false);
  });
}

/**
 * Validates the live draft and saves it: the form's Save button and `Ctrl+S`
 * share this one path, so both answer a missing name the same way.
 */
export function submitCipherFormDraft(): void {
  const input = cipherForm();
  if (!input || isSubmitting()) {
    return;
  }
  const name = (input.name ?? "").trim();
  if (!name) {
    notify("Enter an item name before saving.", "error");
    return;
  }
  submitCipherForm({ ...input, name }, cipherFormId());
}

/** Updates one field of the live Inspector Form draft. */
export function updateCipherDraft(fields: Partial<CipherMutationInput>): void {
  cipherForm.update((current) => (current ? { ...current, ...fields } : current));
}

/**
 * On an edit, sends the name plus only the fields the user changed, so an
 * untouched password is left alone instead of being cleared.
 */
function editPayload(input: CipherMutationInput): CipherMutationInput {
  const payload: CipherMutationInput = {
    cipherType: input.cipherType,
    name: input.name,
  };
  const target = payload as unknown as Record<string, unknown>;
  const source = input as unknown as Record<string, unknown>;
  for (const key of cipherFormChangedFields()) {
    if (key === "name" || key === "cipherType") {
      continue;
    }
    target[key] = source[key];
  }
  return payload;
}

/** Leaves form view without saving. */
function closeCipherEditor(): void {
  cipherForm.set(null);
  cipherFormBaseline.set(null);
  cipherFormId.set(null);
  cipherFormOutcome.set(null);
  cipherFormDiscardConfirm.set(false);
  cipherCandidates.set(null);
  resetCipherFields();
  clearActionFocus();
}

/**
 * Cancels the form: a clean draft closes at once, a changed one asks first, so
 * a typed secret is not thrown away by a stray Esc.
 */
export function cancelCipherForm(): void {
  if (isSubmitting()) {
    return;
  }
  // Esc goes back to editing from the prompt itself rather than asking again.
  if (cipherFormDiscardConfirm()) {
    keepCipherFormEditing();
    return;
  }
  if (cipherFormIsDirty()) {
    cipherFormDiscardConfirm.set(true);
    return;
  }
  closeCipherEditor();
}

/** Throws the unsaved draft away, after the form asked. */
export function confirmCipherFormDiscard(): void {
  // A navigation that asked to leave runs once the draft is gone, so the row,
  // scope or Trash the user picked arrives without a second press.
  const leave = pendingCipherFormLeave;
  pendingCipherFormLeave = null;
  closeCipherEditor();
  leave?.();
}

/** Goes back to editing after the discard prompt, dropping a pending move. */
export function keepCipherFormEditing(): void {
  pendingCipherFormLeave = null;
  cipherFormDiscardConfirm.set(false);
}

// ---------------------------------------------------------------------------
// Type Picker
// ---------------------------------------------------------------------------

/** Opens the Type Picker: the "which kind?" step behind `Ctrl+N`. */
export function openTypePicker(): void {
  typePickerIndex.set(0);
  openModal("typePicker");
}

/** Moves the highlighted choice, keeping it inside the two options. */
export function moveTypePicker(delta: number): void {
  typePickerIndex.update((current) => (current + delta + 2) % 2);
}

/** `Ctrl+N` again while the picker is open toggles the highlighted choice. */
export function cycleTypePicker(): void {
  moveTypePicker(1);
}

/** Creates the type the picker highlights. */
export function chooseTypePickerSelection(): void {
  selectTypePicker(typePickerIndex() === 0 ? "login" : "note");
}

/** Closes the picker and opens the Inspector Form for the chosen type. */
export function selectTypePicker(cipherType: "login" | "note"): void {
  activeModal.set("none");
  clearActionFocus();
  openCipherForm(cipherType);
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
  // The resolver targets the active vault, so a hit there has to leave the
  // Trash first; otherwise the row is never in the list being searched.
  if (vaultView() === "trash") {
    leaveTrash();
  }
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

/** Opens the permanent-delete confirmation for the selected Trash row. */
export function openTrashDelete(): void {
  if (vaultView() !== "trash") {
    return;
  }
  const row = selectedCipher();
  if (!row) {
    return;
  }
  cipherDeletePermanent.set(true);
  openModal("cipherDelete");
}

/** Confirms a permanent delete of the selected Trash row. */
export function confirmDeleteTrashCipher(): void {
  if (vaultView() !== "trash") {
    return;
  }
  const row = selectedCipher();
  if (!row) {
    return;
  }
  const outcome: CipherMutationOutcomeView = OmawardenBridge.deleteTrashCipher(row.id);
  if (outcome.ok) {
    notify(outcome.outcome || "Item permanently deleted.", "success");
    reloadTrash();
    activeModal.set("none");
    clearActionFocus();
  } else {
    notify(outcome.error ?? "Could not permanently delete the item.", "error");
  }
}

/** Opens the delete confirmation dialog for the selected cipher. */
export function openCipherDelete(permanent: boolean): void {
  if (permanent) {
    // Permanent delete is only reachable from the Trash via openTrashDelete().
    // The active vault's delete is always soft.
    return;
  }
  if (!editableCipher()) {
    return;
  }
  cipherDeletePermanent.set(false);
  openModal("cipherDelete");
}
