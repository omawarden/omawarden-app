import { signal } from "nsh";
import type { InputRef } from "nsh";

/**
 * The Inspector Form's text fields and the keyboard ring around them.
 *
 * A module value rather than state, for the same reason as the vault search's
 * handle: the form's component body runs once, and a ref is what an action acts
 * on. Tab walks these fields and the form's buttons as one ring, because the
 * desktop's native traversal only visits text fields.
 */

// Registered fields, keyed by name. `Map.set` keeps a key's original position,
// so a re-render — which hands over a fresh ref callback — cannot reorder the
// ring; `cipherFieldKeys` sorts the result into the order the form reads in.
const fields = new Map<string, InputRef | null>();

/** The field the keyboard is in, or null while it is on a button. */
export const focusedCipherField = signal<string | null>(null);

/** The password field's handle, which the generator fills from outside. */
let passwordField: InputRef | null = null;

/** How the ring reads a field key: down the form, then the URI rows. */
function fieldRank(key: string): number {
  if (key === "name") return 0;
  if (key === "username") return 1;
  if (key === "password") return 2;
  if (key.startsWith("uri-")) return 3;
  return 4;
}

/** A field `<Input ref>` callback: remembers it under its form key. */
export function registerCipherField(key: string, ref: InputRef | null): void {
  fields.set(key, ref);
}

/** The registered field keys, in the order the form reads them. */
export function cipherFieldKeys(): string[] {
  return [...fields.entries()]
    .filter(([, ref]) => ref !== null)
    .map(([key]) => key)
    .sort((left, right) => {
      const rank = fieldRank(left) - fieldRank(right);
      if (rank !== 0) {
        return rank;
      }
      return Number(left.slice(4)) - Number(right.slice(4));
    });
}

/** A field's `onFocus` / `onBlur`: says whether the keyboard is in a field. */
export function markCipherFieldFocus(key: string, focused: boolean): void {
  if (focused) {
    focusedCipherField.set(key);
    return;
  }
  if (focusedCipherField() === key) {
    focusedCipherField.set(null);
  }
}

/** Puts the keyboard back in a field the ring walked away from. */
export function focusCipherField(key: string): void {
  const field = fields.get(key);
  if (!field) {
    return;
  }
  field.focus();
  focusedCipherField.set(key);
}

/** Takes the keyboard out of every field, before the ring moves to a button. */
export function blurCipherFields(): void {
  for (const field of fields.values()) {
    field?.blur();
  }
  focusedCipherField.set(null);
}

/** Forgets the fields: the form closed, and its ring went with it. */
export function resetCipherFields(): void {
  fields.clear();
  focusedCipherField.set(null);
}

/** The password `<Input ref>` callback: remembers the field the fill targets. */
export function setCipherPasswordField(ref: InputRef | null): void {
  passwordField = ref;
}

/** Puts the keyboard in the password field with the caret after its text. */
export function focusCipherPassword(caret: number): void {
  const field = passwordField;
  if (!field) {
    return;
  }
  field.focus();
  field.setSelection(caret);
  focusedCipherField.set("password");
}

/**
 * Takes the keyboard out of the password field before a dialog opens over it,
 * so the next keystroke goes to the dialog rather than the field behind it.
 */
export function blurCipherPassword(): void {
  passwordField?.blur();
}
