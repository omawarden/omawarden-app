//! Authentication: sign-in, two-factor, locking, and the master-password check.
//!
//! [`AuthEngine`] is the seam. [`InProcess`] drives the real auth manager and
//! the daemon; [`Mock`] drives the process-wide mock state through the same
//! transitions the UI tests assert on.

use serde_json::json;

use crate::diagnostics::push_log;
use crate::{
    ActionOutcomeView, AppPhase, AuthActionInput, AuthKind, MockState, TwoFactorChallengeView,
    TwoFactorProviderView, VaultFilterInput, VaultSnapshotView, config_manager, daemon,
    default_two_factor_providers, ensure_app_daemon_running, load_config, vault, with_mock,
};

/// The authentication capabilities the bridge exposes.
pub(crate) trait AuthEngine {
    /// Signs in, unlocks, or answers a two-factor challenge.
    fn authenticate(&self, input: AuthActionInput) -> VaultSnapshotView;

    /// Sends a two-factor verification email.
    fn send_two_factor_email(&self, email: &str, password: &str) -> ActionOutcomeView;

    /// Locks the vault, or logs out of the session when `logout` is set.
    fn lock_or_logout(&self, logout: bool) -> VaultSnapshotView;

    /// Checks the master password without unlocking the daemon.
    fn verify_master_password(&self, password: &str) -> bool;
}

/// The real adapter: the auth manager, the daemon, and the engine's session.
pub(crate) struct InProcess;

impl AuthEngine for InProcess {
    fn authenticate(&self, input: AuthActionInput) -> VaultSnapshotView {
        real_authenticate(input)
    }

    fn send_two_factor_email(&self, email: &str, password: &str) -> ActionOutcomeView {
        real_send_two_factor_email(email, password)
    }

    fn lock_or_logout(&self, logout: bool) -> VaultSnapshotView {
        real_lock_or_logout(logout)
    }

    fn verify_master_password(&self, password: &str) -> bool {
        let storage_mgr = omawarden::storage::StorageManager::default();
        let storage = storage_mgr.load();
        if storage.enc_user_key.is_none() {
            return false;
        }
        storage_mgr.unlock_user_key(password, &storage).is_ok()
    }
}

/// The mock adapter: the process-wide mock state.
pub(crate) struct Mock;

impl AuthEngine for Mock {
    fn authenticate(&self, input: AuthActionInput) -> VaultSnapshotView {
        with_mock(|state| mock_authenticate(state, input))
    }

    fn send_two_factor_email(&self, email: &str, password: &str) -> ActionOutcomeView {
        with_mock(|state| mock_send_two_factor_email(state, email, password))
    }

    fn lock_or_logout(&self, logout: bool) -> VaultSnapshotView {
        with_mock(|state| mock_lock_or_logout(state, logout))
    }

    fn verify_master_password(&self, password: &str) -> bool {
        with_mock(|state| password == state.master_password)
    }
}

/// Trims an optional user-entered code and treats blank input as absent.
///
/// The engine treats `Some("")` as a present new-device code and then omits
/// the two-factor token from the login request, which silently breaks FIDO2.
pub(crate) fn normalize_optional_code(value: Option<String>) -> Option<String> {
    value
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

/// The auth manager for the current configuration.
pub(crate) fn auth_manager() -> omawarden::auth::AuthManager {
    let config = load_config();
    omawarden::auth::AuthManager::with_config(
        &config.server_url,
        config.identity_url.as_deref(),
        None,
        None,
        Some(config_manager()),
    )
}

/// Persists the user's remember-email choice after a successful sign-in.
fn apply_remember_email(input: &AuthActionInput) {
    let Some(remember) = input.remember_email else {
        return;
    };
    if !matches!(
        input.kind,
        AuthKind::Password | AuthKind::TwoFactor | AuthKind::NewDevice
    ) {
        return;
    }
    let manager = config_manager();
    let mut config = manager.load();
    config.remember_email = remember;
    if remember {
        config.email = input.email.trim().to_lowercase();
    } else {
        config.email.clear();
    }
    let _ = manager.save(&config);
}

/// Builds the provider list the two-factor screen shows.
pub(crate) fn two_factor_provider_view(id: i32) -> TwoFactorProviderView {
    TwoFactorProviderView {
        id: id.max(0) as u32,
        name: match id {
            0 => "authenticator".to_string(),
            1 => "email".to_string(),
            3 => "yubikey".to_string(),
            7 => "fido2".to_string(),
            other => format!("provider-{other}"),
        },
        label: match id {
            0 => "Authenticator App".to_string(),
            1 => "Email".to_string(),
            3 => "YubiKey OTP".to_string(),
            7 => "FIDO2 Security Key".to_string(),
            other => format!("Provider {other}"),
        },
        available: true,
    }
}

/// Builds the vault snapshot from the in-process authentication result.
fn snapshot_from_auth_result(
    result: &omawarden::auth::AuthResult,
    email: &str,
) -> VaultSnapshotView {
    let two_factor_required = result.two_factor_required.unwrap_or(false);
    let new_device = result.new_device_verification_required.unwrap_or(false);
    let providers = result.two_factor_providers.clone().unwrap_or_default();
    let selected_provider = result
        .two_factor_provider
        .filter(|id| *id >= 0)
        .map(|id| id as u32);

    let mut snapshot = vault::real_snapshot(VaultFilterInput::default());
    if let Some(error) = result.error.clone() {
        snapshot.error = Some(error);
    }
    if two_factor_required {
        snapshot.phase = AppPhase::TwoFactor;
        snapshot.two_factor = Some(TwoFactorChallengeView {
            email: if email.is_empty() {
                snapshot.email.clone()
            } else {
                email.to_string()
            },
            providers: providers
                .into_iter()
                .map(two_factor_provider_view)
                .collect(),
            selected_provider: selected_provider.unwrap_or(0),
            fido2_status: result.fido2_status.clone(),
            new_device,
        });
    } else if result.ok {
        match result.status.as_deref() {
            Some("locked") => snapshot.phase = AppPhase::Locked,
            Some("unlocked") if snapshot.phase != AppPhase::Unlocked => {
                snapshot.phase = AppPhase::Locked;
                snapshot.error = Some(
                    "The vault was unlocked, but the Omawarden daemon did not start. Try unlocking again."
                        .to_string(),
                );
            }
            _ => {}
        }
    }
    snapshot
}

/// Signs in through the real auth manager, starting the daemon first.
fn real_authenticate(input: AuthActionInput) -> VaultSnapshotView {
    ensure_app_daemon_running();

    let auth = auth_manager();
    let result = match input.kind {
        AuthKind::Password | AuthKind::TwoFactor | AuthKind::NewDevice => {
            let code = input.code.trim();
            let code = if code.is_empty() { None } else { Some(code) };
            auth.login_password(
                &input.email,
                &input.password,
                code,
                input.provider.map(|id| id as i32),
                input.new_device_otp.as_deref(),
            )
        }
        AuthKind::ApiKey => auth.login_apikey(&input.client_id, &input.client_secret),
        AuthKind::Unlock => auth.unlock(&input.password),
        AuthKind::QuickUnlock => {
            // The engine keeps quick unlock on the daemon: the polkit
            // check and the retained key live in the daemon state, not in
            // `AuthManager`.
            let response = daemon(json!({ "action": "quick_unlock" })).unwrap_or_else(|| {
                json!({
                    "ok": false,
                    "status": "locked",
                    "error": "The Omawarden daemon is not running. Try again.",
                })
            });
            serde_json::from_value::<omawarden::auth::AuthResult>(response).unwrap_or_else(|_| {
                omawarden::auth::AuthResult {
                    ok: false,
                    status: Some("locked".to_string()),
                    error: Some(
                        "The Omawarden daemon returned an unreadable response.".to_string(),
                    ),
                    ..Default::default()
                }
            })
        }
    };

    if result.ok {
        apply_remember_email(&input);
        push_log(format!("authentication succeeded: {:?}", input.kind));
    } else {
        push_log(format!(
            "authentication failed: {}",
            result.error.as_deref().unwrap_or("unknown error")
        ));
    }
    snapshot_from_auth_result(&result, &input.email)
}

/// Sends a two-factor verification email through the real auth manager.
fn real_send_two_factor_email(email: &str, password: &str) -> ActionOutcomeView {
    match auth_manager().send_two_factor_email(email, password) {
        Ok(()) => ActionOutcomeView {
            ok: true,
            message: "Verification email sent.".to_string(),
            error: None,
        },
        Err(error) => ActionOutcomeView {
            ok: false,
            message: "Could not send the verification email.".to_string(),
            error: Some(error.to_string()),
        },
    }
}

/// Locks or logs out of the real session and purges derived state.
fn real_lock_or_logout(logout: bool) -> VaultSnapshotView {
    let auth = auth_manager();
    let _ = if logout { auth.logout() } else { auth.lock() };
    vault::clear_cached_vault();
    omawarden::attachment::clear_preview_attachments(None);
    vault::real_snapshot(VaultFilterInput::default())
}

/// Applies the mock's sign-in transitions.
fn mock_authenticate(state: &mut MockState, input: AuthActionInput) -> VaultSnapshotView {
    state.error = None;
    match input.kind {
        AuthKind::Password => {
            if input.email.trim().is_empty() || input.password.is_empty() {
                state.error = Some("Email and master password are required.".to_string());
            } else if state.two_factor_required {
                state.email = input.email.clone();
                state.phase = AppPhase::TwoFactor;
                if state.two_factor.is_none() {
                    state.two_factor = Some(TwoFactorChallengeView {
                        email: input.email.clone(),
                        providers: default_two_factor_providers(),
                        selected_provider: 0,
                        fido2_status: None,
                        new_device: false,
                    });
                }
            } else {
                state.email = input.email.clone();
                state.phase = AppPhase::Unlocked;
                state.settings.email = input.email.clone();
            }
        }
        AuthKind::ApiKey => {
            if input.client_id.trim().is_empty() || input.client_secret.is_empty() {
                state.error = Some("Client ID and client secret are required.".to_string());
            } else if state.two_factor_required {
                state.phase = AppPhase::TwoFactor;
            } else {
                state.phase = AppPhase::Unlocked;
            }
        }
        AuthKind::TwoFactor | AuthKind::NewDevice => {
            // Provider 7 is FIDO2: the engine performs the key
            // assertion itself, so no typed code is required.
            let fido2 = input.provider == Some(7);
            if fido2 && input.new_device_otp.is_some() {
                // Mirrors the engine's `newDeviceOtp` branch, which
                // shadows the two-factor token when it is present.
                state.error = Some(
                    "Security key error: the new-device code shadowed the assertion.".to_string(),
                );
            } else if !fido2 && input.code.trim().is_empty() && input.new_device_otp.is_none() {
                state.error = Some("Enter a verification code.".to_string());
            } else {
                state.phase = AppPhase::Unlocked;
                state.two_factor = None;
            }
        }
        AuthKind::Unlock => {
            if input.password.is_empty() {
                state.error = Some("Master password is required.".to_string());
            } else {
                state.phase = AppPhase::Unlocked;
            }
        }
        AuthKind::QuickUnlock => {
            if state.quick_unlock_ready {
                state.phase = AppPhase::Unlocked;
            } else {
                state.error =
                    Some("Quick unlock is not available. Use your master password.".to_string());
            }
        }
    }
    state.snapshot()
}

/// Answers the mock's two-factor email request.
fn mock_send_two_factor_email(
    _state: &mut MockState,
    email: &str,
    _password: &str,
) -> ActionOutcomeView {
    if email.trim().is_empty() {
        return ActionOutcomeView {
            ok: false,
            message: "Email is required.".to_string(),
            error: Some("Email is required.".to_string()),
        };
    }
    ActionOutcomeView {
        ok: true,
        message: "Verification email sent.".to_string(),
        error: None,
    }
}

/// Applies the mock's lock or logout transition.
fn mock_lock_or_logout(state: &mut MockState, logout: bool) -> VaultSnapshotView {
    state.phase = if logout {
        AppPhase::Login
    } else {
        AppPhase::Locked
    };
    state.selected_cipher_id = None;
    state.ssh_prompt = None;
    state.two_factor = None;
    state.error = None;
    if logout {
        state.email.clear();
        state.items.clear();
        state.last_sync = None;
    }
    state.snapshot()
}
