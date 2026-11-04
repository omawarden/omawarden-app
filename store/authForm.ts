import { signal } from "nsh";

/**
 * Authentication form state lives outside `AuthView` so the store can clear
 * secrets only after a successful unlock, never on a failed attempt.
 */

export const loginTab = signal<"password" | "apiKey">("password");
export const email = signal("");
export const password = signal("");
export const clientId = signal("");
export const clientSecret = signal("");
export const rememberEmail = signal(true);
export const pendingPassword = signal("");
export const twoFactorCode = signal("");
export const newDeviceOtp = signal("");
export const unlockPassword = signal("");
export const confirmLogout = signal(false);

export const mtlsOpen = signal(false);
export const mtlsEnabled = signal(false);
export const mtlsCertPath = signal("");
export const mtlsKeyPath = signal("");

/** Clears every secret the auth forms hold. */
export function clearAuthSecrets(): void {
  password.set("");
  clientSecret.set("");
  pendingPassword.set("");
  twoFactorCode.set("");
  newDeviceOtp.set("");
  unlockPassword.set("");
  if (!rememberEmail()) {
    email.set("");
  }
}

/** Clears the two-factor codes after a completed challenge. */
export function clearTwoFactorCodes(): void {
  twoFactorCode.set("");
  newDeviceOtp.set("");
}
