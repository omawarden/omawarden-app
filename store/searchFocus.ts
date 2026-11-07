import type { InputRef } from "nsh";
import * as store from "./appStore";

/**
 * The vault search field's native handle, and the one place that moves the
 * keyboard into or out of it.
 *
 * The ref is a module value rather than state: component bodies run once, and
 * the handle is what the shortcuts act on. A stale handle between the
 * workspace unmounting and mounting again is harmless — every caller is behind
 * the vault guard, and the next mount overwrites it.
 */
let field: InputRef | null = null;

/** The `<Input ref>` callback: remembers the vault search field. */
export function setSearchField(ref: InputRef | null): void {
  field = ref;
}

/**
 * Puts the keyboard in the vault search and drops any action focus, so Enter
 * cannot mean two things at once. With `selectAll`, the query already there is
 * selected and the first keystroke replaces it.
 */
export function focusSearch(selectAll = false): void {
  const input = field;
  if (!input) {
    return;
  }
  store.clearActionFocus();
  input.focus();
  if (selectAll) {
    // The ref's calls are queued in order, so the selection lands after the
    // field has the focus.
    input.setSelection(0, store.search().length);
  }
}

/** Takes the keyboard out of the vault search, as Tab does on its way out. */
export function blurSearch(): void {
  field?.blur();
}
