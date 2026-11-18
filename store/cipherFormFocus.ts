import type { InputRef } from "nsh";

/**
 * The Inspector Form's password field, and the one place that moves the
 * keyboard back into it after the generator fills it.
 *
 * A module value rather than state, for the same reason as the vault search's
 * handle: the component body runs once and the ref is what an action acts on.
 */
let passwordField: InputRef | null = null;

/** The password `<Input ref>` callback: remembers the form's field. */
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
}

/**
 * Takes the keyboard out of the password field before a dialog opens over it,
 * so the next keystroke goes to the dialog rather than the field behind it.
 */
export function blurCipherPassword(): void {
  passwordField?.blur();
}
