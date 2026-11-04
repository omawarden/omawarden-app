//! The app's Rust code: what `App.tsx` imports from `omawarden-app/native`.
//!
//! The [`OmawardenBridge`] module is the only seam between the TSX UI and the
//! Omawarden Rust engine. It talks to the daemon over its Unix socket for
//! stateful vault operations, calls the stateless `omawarden` library
//! functions in-process, runs authentication through `omawarden::auth` after
//! starting the daemon in this process, and keeps an in-memory mock mode so the
//! headless UI tests never touch the real keyring, config, clipboard or daemon
//! socket.

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use nsh_core::prelude::*;
use serde_json::{json, Value};

use omawarden::api::is_loopback_host;
use omawarden::generator::{generate_passphrase, generate_password, PassphraseOptions, PasswordOptions};
use omawarden::health::check_system_health;
use omawarden::logging::sanitize_log_message;
use omawarden::totp::generate_totp;
use omawarden::vault::{is_fuzzy_match, VaultItem};

/// Pins Linux rendering to one lightweight GPU driver before GTK or `wgpu`
/// initializes.
///
/// GTK4 defaults to Vulkan, which on hybrid systems loads both `amdvlkpro64.so`
/// and `libvulkan_radeon.so` plus large anonymous GPU arenas. `GSK_RENDERER=ngl`
/// keeps GTK on OpenGL, `WGPU_BACKEND=vulkan` stops `wgpu` from initializing
/// both Vulkan and GL/EGL, and pinning the Vulkan ICD and EGL vendor library to
/// Mesa keeps the proprietary NVIDIA and AMD PRO stacks out of the process. A
/// value the user already set is respected.
#[cfg(target_os = "linux")]
fn configure_linux_renderer() {
    set_env_if_unset("GSK_RENDERER", "ngl");
    set_env_if_unset("WGPU_BACKEND", "vulkan");
    set_env_if_unset("WGPU_POWER_PREFERENCE", "low_power");
    if std::env::var_os("VK_DRIVER_FILES").is_none()
        && std::env::var_os("VK_ICD_FILENAMES").is_none()
    {
        const MESA_ICDS: [&str; 4] = [
            "/usr/share/vulkan/icd.d/radeon_icd.x86_64.json",
            "/usr/share/vulkan/icd.d/radeon_icd.json",
            "/usr/share/vulkan/icd.d/intel_icd.x86_64.json",
            "/usr/share/vulkan/icd.d/intel_icd.json",
        ];
        if let Some(path) = MESA_ICDS
            .iter()
            .find(|path| std::path::Path::new(path).is_file())
        {
            // SAFETY: the constructor runs before GTK starts and before the
            // process creates threads; `boot()` calls it on the UI thread.
            unsafe {
                std::env::set_var("VK_DRIVER_FILES", path);
                std::env::set_var("VK_ICD_FILENAMES", path);
            }
        }
    }
    if std::env::var_os("__EGL_VENDOR_LIBRARY_FILENAMES").is_none() {
        let mesa = "/usr/share/glvnd/egl_vendor.d/50_mesa.json";
        if std::path::Path::new(mesa).is_file() {
            // SAFETY: see above.
            unsafe {
                std::env::set_var("__EGL_VENDOR_LIBRARY_FILENAMES", mesa);
            }
        }
    }
}

/// Sets an environment variable when the process has not already set it.
#[cfg(target_os = "linux")]
fn set_env_if_unset(name: &str, value: &str) {
    if std::env::var_os(name).is_none() {
        // SAFETY: callers run before GTK starts and before the process creates
        // threads, or on the UI thread inside `boot()`.
        unsafe {
            std::env::set_var(name, value);
        }
    }
}

/// C constructor entry point that runs before `nsh_linux_host::main()`.
#[cfg(target_os = "linux")]
extern "C" fn init_linux_renderer() {
    configure_linux_renderer();
}

#[cfg(target_os = "linux")]
#[used]
#[unsafe(link_section = ".init_array")]
static INIT_LINUX_RENDERER: extern "C" fn() = init_linux_renderer;

/// The crate's UI set (`nsh.json` `"rust"`).
#[native_module("omawarden-app/native")]
fn native(registry: &mut Registry) {
    registry.module::<OmawardenBridge>();
}

/// The exact validation message for an out-of-range password length.
pub const ERR_PASSWORD_LENGTH: &str =
    "Password length must be between 5 and 128 characters. Use 14 or more characters for a strong password.";

/// The exact validation message for an out-of-range passphrase word count.
pub const ERR_PASSPHRASE_WORDS: &str = "Passphrase word count must be between 3 and 20 words.";

/// The top-level screen the app shows.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PropEnum)]
pub enum AppPhase {
    /// Checking for the required system packages.
    DependencyCheck,
    /// The user is logged out and signs in.
    Login,
    /// The user must answer a two-factor or new-device challenge.
    TwoFactor,
    /// The user is logged in but the vault is locked.
    Locked,
    /// The vault is unlocked and searchable.
    Unlocked,
}

/// The kind of authentication action the user asked for.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PropEnum)]
pub enum AuthKind {
    /// Master password login.
    Password,
    /// API key login (`client_id` + `client_secret`).
    ApiKey,
    /// A two-factor verification code.
    TwoFactor,
    /// A new-device verification OTP.
    NewDevice,
    /// Unlock an already logged-in account.
    Unlock,
    /// Polkit/system-auth quick unlock.
    QuickUnlock,
}

/// A cipher category used for filtering and tabs.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PropEnum)]
pub enum ItemCategory {
    /// Every category.
    All,
    /// Logins and passwords.
    Login,
    /// Payment cards.
    Card,
    /// Identities.
    Identity,
    /// Secure notes.
    SecureNote,
    /// SSH keys.
    SshKey,
}

/// The appearance preset chosen in settings.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PropEnum)]
pub enum ThemeAppearance {
    /// Tokyo Night dark palette.
    Dark,
    /// Catppuccin Latte light palette.
    Light,
}

/// What an SSH key modal does.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PropEnum)]
pub enum SshKeyMode {
    /// Generate a new key.
    Create,
    /// Import an existing OpenSSH private key.
    Import,
    /// Export a vault key to `~/.ssh`.
    Export,
}

/// When the SSH agent asks before signing.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PropEnum)]
pub enum SshAgentPolicy {
    /// Ask until the key, program and app are approved for this session.
    FirstUse,
    /// Ask every time.
    Always,
    /// Never ask (not recommended).
    Never,
}

/// One system package's installation state.
#[derive(Clone, Debug, JsObject)]
pub struct PackageStatusView {
    /// The package or binary name.
    pub name: String,
    /// A human-readable description.
    pub description: String,
    /// Whether the package is required.
    pub required: bool,
    /// Whether it is installed.
    pub installed: bool,
    /// The installed version, when known.
    pub version: Option<String>,
}

/// The dependency check result.
#[derive(Clone, Debug, JsObject)]
pub struct DependencyStatusView {
    /// The required and optional packages.
    pub packages: Vec<PackageStatusView>,
    /// Whether every required package is installed.
    pub all_required_installed: bool,
    /// The names of the packages that are missing.
    pub missing_packages: Vec<String>,
    /// The names of the missing required packages.
    pub missing_required: Vec<String>,
}

/// One two-factor provider the server offers.
#[derive(Clone, Debug, JsObject)]
pub struct TwoFactorProviderView {
    /// The provider id (`0` authenticator, `1` email, `3` YubiKey, `7` FIDO2).
    pub id: u32,
    /// The short name.
    pub name: String,
    /// The label shown to the user.
    pub label: String,
    /// Whether it is available now.
    pub available: bool,
}

/// The pending two-factor or new-device challenge.
#[derive(Clone, Debug, JsObject)]
pub struct TwoFactorChallengeView {
    /// The account email.
    pub email: String,
    /// The providers the server offered.
    pub providers: Vec<TwoFactorProviderView>,
    /// The provider currently selected.
    pub selected_provider: u32,
    /// The FIDO2 status or error text.
    pub fido2_status: Option<String>,
    /// Whether this is the new-device verification flow.
    pub new_device: bool,
}

/// A scope the vault can be filtered by (all, personal, organization or collection).
#[derive(Clone, Debug, JsObject)]
pub struct ScopeOptionView {
    /// The stable id (`all`, `personal`, `org:<id>`, `collection:<id>`).
    pub id: String,
    /// The display name.
    pub name: String,
    /// The kind of scope.
    pub kind: String,
    /// How many items are in it.
    pub count: u32,
}

/// A folder the vault can be filtered by.
#[derive(Clone, Debug, JsObject)]
pub struct FolderOptionView {
    /// The folder id.
    pub id: String,
    /// The display name.
    pub name: String,
    /// How many items are in it.
    pub count: u32,
}

/// Live counts per category tab.
#[derive(Clone, Debug, JsObject)]
pub struct CategoryCountsView {
    /// Every item.
    pub all: u32,
    /// Logins.
    pub logins: u32,
    /// Cards.
    pub cards: u32,
    /// Identities.
    pub identities: u32,
    /// Secure notes.
    pub secure_notes: u32,
    /// SSH keys.
    pub ssh_keys: u32,
}

/// One row of the vault list.
#[derive(Clone, Debug, JsObject)]
pub struct CipherRowView {
    /// The cipher id.
    pub id: String,
    /// The item title.
    pub title: String,
    /// The secondary line (username, card brand, key type, ...).
    pub subtitle: String,
    /// The category.
    pub category: ItemCategory,
    /// Whether the item is a favorite.
    pub favorite: bool,
    /// How many attachments it has.
    pub attachment_count: u32,
    /// The organization name, when it belongs to one.
    pub organization: Option<String>,
    /// The folder name, when it is in one.
    pub folder: Option<String>,
    /// Whether the item has a TOTP seed.
    pub has_totp: bool,
    /// Whether the login has previous passwords.
    pub has_password_history: bool,
    /// The login URIs, for website icon resolution.
    pub uris: Vec<String>,
    /// Whether the item requires the master password again (`1`) or not (`0`).
    pub reprompt: u32,
    /// The card brand, when the item is a card.
    pub card_brand: Option<String>,
    /// The masked card number, when the item is a card.
    pub card_mask: Option<String>,
}

/// The pending SSH agent signing request.
#[derive(Clone, Debug, JsObject)]
pub struct SshPromptView {
    /// The request id.
    pub id: u32,
    /// The short question.
    pub title: String,
    /// What is being signed.
    pub action: String,
    /// The key name.
    pub key_name: String,
    /// The key fingerprint.
    pub fingerprint: String,
    /// The requesting program.
    pub client: String,
    /// The command being run.
    pub command: String,
    /// Whether the request came over agent forwarding.
    pub forwarded: bool,
    /// Whether approval will be remembered for this session.
    pub remembered: bool,
    /// How many more requests are queued.
    pub remaining: u32,
}

/// The full snapshot the UI renders.
#[derive(Clone, Debug, JsObject)]
pub struct VaultSnapshotView {
    /// The screen to show.
    pub phase: AppPhase,
    /// The account email, when known.
    pub email: String,
    /// The sanitized server URL.
    pub server_url: String,
    /// The sanitized identity URL, when set.
    pub identity_url: Option<String>,
    /// Whether system-auth quick unlock is ready.
    pub quick_unlock_ready: bool,
    /// Whether quick unlock is configured at all.
    pub quick_unlock_usable: bool,
    /// Whether the vault is unlocked.
    pub unlocked: bool,
    /// Whether a sync is running.
    pub syncing: bool,
    /// The pending two-factor challenge.
    pub two_factor: Option<TwoFactorChallengeView>,
    /// The last error, if any.
    pub error: Option<String>,
    /// The filtered items.
    pub items: Vec<CipherRowView>,
    /// Every item in the unlocked vault before filtering.
    pub all_items: Vec<CipherRowView>,
    /// The total number of items before filtering.
    pub total_count: u32,
    /// The category counts.
    pub category_counts: CategoryCountsView,
    /// The available scopes.
    pub scopes: Vec<ScopeOptionView>,
    /// The available folders.
    pub folders: Vec<FolderOptionView>,
    /// The active scope id.
    pub active_scope: String,
    /// The active folder id.
    pub active_folder: Option<String>,
    /// The active search text.
    pub search: String,
    /// The active category.
    pub category: ItemCategory,
    /// The last successful sync time.
    pub last_sync: Option<String>,
    /// The selected cipher id.
    pub selected_cipher_id: Option<String>,
    /// The pending SSH prompt, when one exists.
    pub ssh_prompt: Option<SshPromptView>,
    /// The engine version.
    pub engine_version: Option<String>,
}

/// The fields a login, card or identity has.
#[derive(Clone, Debug, JsObject)]
pub struct UriView {
    /// The raw URI.
    pub uri: String,
    /// The parsed hostname, when it has one.
    pub host: String,
}

/// A payment card's fields.
#[derive(Clone, Debug, JsObject)]
pub struct CardView {
    /// The cardholder name.
    pub cardholder_name: String,
    /// The brand.
    pub brand: String,
    /// The card number (masked unless revealed).
    pub number: String,
    /// The always-masked card number.
    pub number_masked: String,
    /// The expiration month.
    pub exp_month: String,
    /// The expiration year.
    pub exp_year: String,
    /// The formatted expiration (`MM / YYYY`).
    pub expiration: String,
    /// The security code (masked unless revealed).
    pub cvv: String,
    /// The always-masked security code.
    pub cvv_masked: String,
}

/// An identity's fields.
#[derive(Clone, Debug, JsObject)]
pub struct IdentityView {
    /// The full name.
    pub full_name: String,
    /// The username.
    pub username: String,
    /// The company.
    pub company: String,
    /// The email.
    pub email: String,
    /// The phone.
    pub phone: String,
    /// The social security number.
    pub ssn: String,
    /// The passport number.
    pub passport_number: String,
    /// The license number.
    pub license_number: String,
    /// The address line 1.
    pub address1: String,
    /// The address line 2.
    pub address2: String,
    /// The address line 3.
    pub address3: String,
    /// The city.
    pub city: String,
    /// The state.
    pub state: String,
    /// The postal code.
    pub postal_code: String,
    /// The country.
    pub country: String,
}

/// An SSH key's fields.
#[derive(Clone, Debug, JsObject)]
pub struct SshKeyView {
    /// The key type (ED25519, RSA, ECDSA, ...).
    pub key_type: String,
    /// The SHA256 fingerprint.
    pub fingerprint: String,
    /// The public key.
    pub public_key: String,
    /// The private key (masked unless revealed).
    pub private_key: String,
    /// The always-masked private key.
    pub private_key_masked: String,
}

/// A custom field.
#[derive(Clone, Debug, JsObject)]
pub struct CustomFieldView {
    /// The field's index.
    pub index: u32,
    /// The field's name.
    pub name: String,
    /// The field kind (`text`, `hidden`, `boolean` or `linked`).
    pub kind: String,
    /// The value (masked for hidden fields unless revealed).
    pub value: String,
    /// The always-masked value.
    pub value_masked: String,
}

/// An attachment on a cipher.
#[derive(Clone, Debug, JsObject)]
pub struct AttachmentView {
    /// The attachment id.
    pub id: String,
    /// The filename.
    pub filename: String,
    /// The size in bytes.
    pub size: u64,
    /// The human-readable size.
    pub size_label: String,
}

/// One previous password.
#[derive(Clone, Debug, JsObject)]
pub struct PasswordHistoryEntryView {
    /// The password.
    pub password: String,
    /// When it was replaced.
    pub changed_at: String,
}

/// The live TOTP code.
#[derive(Clone, Debug, JsObject)]
pub struct TotpLiveView {
    /// Whether a code is available.
    pub valid: bool,
    /// The six-digit code.
    pub code: String,
    /// The code in `123 456` form.
    pub formatted: String,
    /// Seconds remaining in the period.
    pub remaining: u32,
    /// The period length in seconds.
    pub period: u32,
    /// The error, when no code is available.
    pub error: Option<String>,
}

/// The metadata shown at the bottom of the inspector.
#[derive(Clone, Debug, JsObject)]
pub struct MetadataView {
    /// The folder name.
    pub folder: String,
    /// The organization name.
    pub organization: String,
    /// When the item was created.
    pub created_at: String,
    /// When the item was last updated.
    pub updated_at: String,
}

/// Everything the inspector shows for one cipher.
#[derive(Clone, Debug, JsObject)]
pub struct InspectorView {
    /// The cipher id.
    pub id: String,
    /// The title.
    pub title: String,
    /// The category.
    pub category: ItemCategory,
    /// Whether it is a favorite.
    pub favorite: bool,
    /// The notes.
    pub notes: Option<String>,
    /// The login username.
    pub username: Option<String>,
    /// The login password (masked unless revealed).
    pub password: Option<String>,
    /// The always-masked password.
    pub password_masked: String,
    /// The live TOTP code.
    pub totp: Option<TotpLiveView>,
    /// The login URIs.
    pub uris: Vec<UriView>,
    /// The card fields.
    pub card: Option<CardView>,
    /// The identity fields.
    pub identity: Option<IdentityView>,
    /// The SSH key fields.
    pub ssh: Option<SshKeyView>,
    /// The custom fields.
    pub fields: Vec<CustomFieldView>,
    /// The attachments.
    pub attachments: Vec<AttachmentView>,
    /// The previous passwords.
    pub password_history: Vec<PasswordHistoryEntryView>,
    /// The item metadata.
    pub metadata: MetadataView,
    /// Whether the item requires the master password again (`1`) or not (`0`).
    pub reprompt: u32,
    /// The error, when the item could not be loaded.
    pub error: Option<String>,
}

/// The reveal toggles for the inspector.
#[derive(Clone, Debug, JsObject)]
pub struct RevealStateInput {
    /// Reveal the login password.
    pub reveal_password: bool,
    /// Reveal the card number.
    pub reveal_card_number: bool,
    /// Reveal the card security code.
    pub reveal_cvv: bool,
    /// Reveal the SSH private key.
    pub reveal_private_key: bool,
    /// The custom field indices to reveal.
    pub reveal_fields: Vec<u32>,
}

/// The authentication action.
#[derive(Clone, Debug, JsObject)]
pub struct AuthActionInput {
    /// The action kind.
    pub kind: AuthKind,
    /// The account email.
    pub email: String,
    /// The master password.
    pub password: String,
    /// The API key client id.
    pub client_id: String,
    /// The API key client secret.
    pub client_secret: String,
    /// The two-factor or new-device code.
    pub code: String,
    /// The selected two-factor provider.
    pub provider: Option<u32>,
    /// Remember the email for next time.
    pub remember_email: Option<bool>,
    /// The new-device verification OTP.
    pub new_device_otp: Option<String>,
}

/// The vault filter.
#[derive(Clone, Debug, JsObject)]
pub struct VaultFilterInput {
    /// The search text.
    pub search: String,
    /// The category.
    pub category: ItemCategory,
    /// The scope id.
    pub scope_id: Option<String>,
    /// The folder id.
    pub folder_id: Option<String>,
}

/// The outcome of a copy.
#[derive(Clone, Debug, JsObject)]
pub struct CopyOutcomeView {
    /// Whether the copy succeeded.
    pub ok: bool,
    /// What was copied.
    pub label: String,
    /// A short message for the toast.
    pub message: String,
    /// Whether the clipboard entry is sensitive.
    pub sensitive: bool,
    /// How long until the clipboard is cleared, in seconds.
    pub cleared_after_seconds: u32,
    /// The error, when it failed.
    pub error: Option<String>,
}

/// The outcome of an attachment action.
#[derive(Clone, Debug, JsObject)]
pub struct AttachmentOutcomeView {
    /// Whether the action succeeded.
    pub ok: bool,
    /// The decrypted file path.
    pub path: Option<String>,
    /// The filename.
    pub filename: Option<String>,
    /// Whether the preview is an image.
    pub is_image: bool,
    /// Whether the preview is text.
    pub is_text: bool,
    /// The text content for inline text previews.
    pub text_content: Option<String>,
    /// A `data:` URL for inline image previews.
    pub preview_data_url: Option<String>,
    /// The size in bytes.
    pub size: u64,
    /// The error, when it failed.
    pub error: Option<String>,
}

/// A generated password or passphrase.
#[derive(Clone, Debug, JsObject)]
pub struct GeneratedSecretView {
    /// Whether generation succeeded.
    pub ok: bool,
    /// The generated secret.
    pub value: String,
    /// The entropy in bits.
    pub entropy: f64,
    /// The strength label.
    pub strength: String,
    /// The error, when validation failed.
    pub error: Option<String>,
}

/// The password generator options.
#[derive(Clone, Debug, JsObject)]
pub struct PasswordGenInput {
    /// The length, strictly `5..=128`.
    pub length: u32,
    /// Include uppercase letters.
    pub uppercase: bool,
    /// Include lowercase letters.
    pub lowercase: bool,
    /// Include numbers.
    pub numbers: bool,
    /// Include special characters.
    pub special: bool,
    /// Avoid visually ambiguous characters.
    pub avoid_ambiguous: bool,
    /// The minimum number of digits.
    pub min_numbers: u32,
    /// The minimum number of special characters.
    pub min_special: u32,
}

/// The passphrase generator options.
#[derive(Clone, Debug, JsObject)]
pub struct PassphraseGenInput {
    /// The word count, strictly `3..=20`.
    pub words: u32,
    /// The separator between words.
    pub separator: String,
    /// Capitalize each word.
    pub capitalize: bool,
}

/// A preview of a generated or imported SSH key.
#[derive(Clone, Debug, JsObject)]
pub struct SshKeyPreviewView {
    /// Whether the preview succeeded.
    pub ok: bool,
    /// The mode (`create` or `import`).
    pub mode: String,
    /// The key type.
    pub algorithm: String,
    /// The public key.
    pub public_key: String,
    /// The private key.
    pub private_key: String,
    /// The fingerprint.
    pub fingerprint: String,
    /// The comment.
    pub comment: String,
    /// The error, when it failed.
    pub error: Option<String>,
}

/// What to do with a generated or imported SSH key.
#[derive(Clone, Debug, JsObject)]
pub struct SshKeySaveInput {
    /// The mode.
    pub mode: SshKeyMode,
    /// The key algorithm.
    pub algorithm: String,
    /// The key comment.
    pub comment: String,
    /// The imported private key PEM, for import mode.
    pub private_key_pem: String,
    /// The item name.
    pub name: String,
    /// The filename base for exports.
    pub filename: String,
    /// Save the key to the vault.
    pub save_to_vault: bool,
    /// Export the key to `~/.ssh`.
    pub export_to_ssh: bool,
    /// The directory to export into (defaults to `~/.ssh`).
    pub export_dir: Option<String>,
}

/// The outcome of saving an SSH key.
#[derive(Clone, Debug, JsObject)]
pub struct SshKeySaveOutcomeView {
    /// Whether it succeeded.
    pub ok: bool,
    /// A short message.
    pub message: String,
    /// The exported private key path.
    pub path: Option<String>,
    /// The vault item id, when saved to the vault.
    pub item_id: Option<String>,
    /// The error, when it failed.
    pub error: Option<String>,
}

/// A background daemon poll result.
#[derive(Clone, Debug, JsObject)]
pub struct DaemonTickView {
    /// Whether the daemon answered.
    pub online: bool,
    /// Whether the vault is unlocked.
    pub unlocked: bool,
    /// Whether quick unlock is ready.
    pub quick_unlock_ready: bool,
    /// The pending SSH prompt.
    pub ssh_prompt: Option<SshPromptView>,
    /// How many SSH prompts are queued.
    pub ssh_pending_count: u32,
    /// The active TOTP code.
    pub totp: Option<TotpLiveView>,
    /// The error, when the daemon did not answer.
    pub error: Option<String>,
}

/// One health check row.
#[derive(Clone, Debug, JsObject)]
pub struct HealthCheckView {
    /// The check's name.
    pub name: String,
    /// Whether it passed.
    pub ok: bool,
    /// A short detail.
    pub detail: String,
}

/// The engine health snapshot.
#[derive(Clone, Debug, JsObject)]
pub struct HealthSnapshotView {
    /// Whether the engine is installed.
    pub engine_installed: bool,
    /// The engine version.
    pub engine_version: String,
    /// Whether the server is reachable.
    pub server_reachable: bool,
    /// Whether the secret service keyring is available.
    pub keyring_available: bool,
    /// Whether the Wayland clipboard is available.
    pub clipboard_available: bool,
    /// Whether memory locking is active.
    pub memory_locked: bool,
    /// The individual checks.
    pub checks: Vec<HealthCheckView>,
    /// The error, when the health check failed.
    pub error: Option<String>,
}

/// The configuration shown in settings.
#[derive(Clone, Debug, JsObject)]
pub struct SettingsView {
    /// The server URL.
    pub server_url: String,
    /// The identity URL.
    pub identity_url: String,
    /// The download directory.
    pub download_dir: String,
    /// The auto-lock timeout in minutes.
    pub auto_lock_minutes: i64,
    /// The clipboard clear timeout in seconds.
    pub clipboard_clear_seconds: i64,
    /// The remembered email.
    pub email: String,
    /// Whether the email is remembered.
    pub remember_email: bool,
    /// Whether update checks are enabled.
    pub check_updates: bool,
    /// Whether website icons are shown.
    pub show_website_icons: bool,
    /// Whether the last search is remembered.
    pub remember_last_search: bool,
    /// The maximum attachment size in MB.
    pub max_attachment_size_mb: u64,
    /// Whether the SSH agent is enabled.
    pub ssh_agent_enabled: bool,
    /// The SSH agent confirmation policy.
    pub ssh_agent_confirm: SshAgentPolicy,
    /// Whether quick unlock is enabled.
    pub quick_unlock: bool,
    /// The client certificate path.
    pub client_cert_path: String,
    /// The client key path.
    pub client_key_path: String,
    /// The appearance.
    pub theme: ThemeAppearance,
}

/// The sanitized diagnostic report.
#[derive(Clone, Debug, JsObject)]
pub struct DiagnosticsView {
    /// The sanitized server URL.
    pub server_url_sanitized: String,
    /// The sanitized log lines.
    pub logs: Vec<String>,
    /// The app version.
    pub app_version: String,
    /// The engine version.
    pub engine_version: String,
    /// The engine git commit.
    pub git_commit: String,
    /// The engine build date.
    pub build_date: String,
    /// The current process's resident memory, in MiB.
    pub memory_rss_mb: f64,
}

/// The full settings snapshot.
#[derive(Clone, Debug, JsObject)]
pub struct SettingsSnapshotView {
    /// The configuration.
    pub config: SettingsView,
    /// The health snapshot.
    pub health: HealthSnapshotView,
    /// The diagnostic report.
    pub diagnostics: DiagnosticsView,
    /// The error, when loading failed.
    pub error: Option<String>,
}

/// The settings update.
#[derive(Clone, Debug, JsObject)]
pub struct SettingsUpdateInput {
    /// The server URL.
    pub server_url: Option<String>,
    /// The identity URL.
    pub identity_url: Option<String>,
    /// The download directory.
    pub download_dir: Option<String>,
    /// The auto-lock timeout in minutes.
    pub auto_lock_minutes: Option<i64>,
    /// The clipboard clear timeout in seconds.
    pub clipboard_clear_seconds: Option<i64>,
    /// The remembered email.
    pub email: Option<String>,
    /// Whether the email is remembered.
    pub remember_email: Option<bool>,
    /// Whether update checks are enabled.
    pub check_updates: Option<bool>,
    /// Whether website icons are shown.
    pub show_website_icons: Option<bool>,
    /// Whether the last search is remembered.
    pub remember_last_search: Option<bool>,
    /// The maximum attachment size in MB.
    pub max_attachment_size_mb: Option<u64>,
    /// Whether the SSH agent is enabled.
    pub ssh_agent_enabled: Option<bool>,
    /// The SSH agent confirmation policy.
    pub ssh_agent_confirm: Option<SshAgentPolicy>,
    /// Whether quick unlock is enabled.
    pub quick_unlock: Option<bool>,
    /// The client certificate path.
    pub client_cert_path: Option<String>,
    /// The client key path.
    pub client_key_path: Option<String>,
    /// The appearance.
    pub theme: Option<ThemeAppearance>,
}

/// The release notes.
#[derive(Clone, Debug, JsObject)]
pub struct ReleaseNotesView {
    /// The version.
    pub version: String,
    /// The release title.
    pub title: String,
    /// The markdown body.
    pub notes: String,
    /// The release page URL.
    pub url: String,
    /// When it was published.
    pub published_at: String,
}

/// The update check result.
#[derive(Clone, Debug, JsObject)]
pub struct UpdateStatusView {
    /// Whether the check ran.
    pub checked: bool,
    /// Whether a newer version is available.
    pub available: bool,
    /// The current version.
    pub current_version: String,
    /// The latest version.
    pub latest_version: Option<String>,
    /// The release notes.
    pub release: Option<ReleaseNotesView>,
    /// The error, when the check failed.
    pub error: Option<String>,
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/// The exact shape of a masked secret in the inspector.
const MASK: &str = "••••••••";

/// The configuration manager the app uses.
fn config_manager() -> omawarden::config::ConfigManager {
    omawarden::config::ConfigManager::new(None)
}

/// Loads the current configuration.
fn load_config() -> omawarden::config::Config {
    config_manager().load()
}

/// Removes credentials, query strings and fragments from a URL before showing it.
fn sanitize_server_url(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    match url::Url::parse(trimmed) {
        Ok(mut parsed) => {
            let _ = parsed.set_username("");
            let _ = parsed.set_password(None);
            parsed.set_query(None);
            parsed.set_fragment(None);
            let mut text = parsed.to_string();
            if text.ends_with('/') && parsed.path() == "/" {
                text.pop();
            }
            text
        }
        Err(_) => {
            let mut text = trimmed.to_string();
            if let Some(index) = text.find(['?', '#']) {
                text.truncate(index);
            }
            text
        }
    }
}

/// Validates and normalizes a server or identity URL.
fn validate_server_url(raw: &str, field: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    if let Some((scheme, _)) = trimmed.split_once("://") {
        if scheme != "http" && scheme != "https" {
            return Err(format!(
                "Invalid {field} '{}': only http:// and https:// URLs are supported (got {scheme}).",
                trimmed
            ));
        }
    }
    let normalized = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };
    let parsed = url::Url::parse(&normalized)
        .map_err(|error| format!("Invalid {field} '{}': {error}", trimmed))?;
    match parsed.scheme() {
        "http" if is_loopback_host(parsed.host_str().unwrap_or("")) => {}
        "http" => {
            return Err(format!(
                "Insecure {field} '{}': Plaintext HTTP is only permitted for local loopback addresses (localhost, 127.0.0.1, [::1]). Remote servers must use HTTPS.",
                trimmed
            ));
        }
        "https" => {}
        other => {
            return Err(format!(
                "Invalid {field} '{}': only http:// and https:// URLs are supported (got {other}).",
                trimmed
            ));
        }
    }
    Ok(normalized.trim_end_matches('/').to_string())
}

/// Parses a URL that may be opened in the browser.
fn validate_launch_url(raw: &str) -> Result<url::Url, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("No URL to open.".to_string());
    }
    let parsed = url::Url::parse(trimmed).map_err(|error| format!("Invalid URL: {error}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(parsed),
        other => Err(format!(
            "Only http:// and https:// URLs can be opened (got {other})."
        )),
    }
}

/// Maps a cipher to its UI category.
fn category_of(item: &VaultItem) -> ItemCategory {
    if item.ssh_key.is_some() || item.item_type == 5 {
        return ItemCategory::SshKey;
    }
    match item.item_type {
        1 => ItemCategory::Login,
        2 => ItemCategory::SecureNote,
        3 => ItemCategory::Card,
        4 => ItemCategory::Identity,
        _ => ItemCategory::Login,
    }
}

/// Masks a secret with a fixed run of dots.
fn mask_secret(value: &str) -> String {
    if value.is_empty() {
        String::new()
    } else {
        MASK.to_string()
    }
}

/// Masks all but the last four digits of a card number.
/// The grouping lengths for a card number, by issuer and BIN.
fn card_segments(digits: &str, brand: &str) -> Vec<usize> {
    let len = digits.len();
    if len <= 4 {
        return vec![len];
    }
    let brand = brand.to_lowercase();
    let brand = brand.replace([' ', '-', '_'], "");
    let is_amex_brand = brand == "amex" || brand.contains("americanexpress");
    let is_amex_bin = digits.starts_with("34") || digits.starts_with("37");
    if len == 15 && (is_amex_bin || is_amex_brand) {
        return vec![4, 6, 5];
    }
    let is_diners_brand = brand.contains("diners");
    let is_diners_bin = digits.starts_with("36")
        || digits.starts_with("38")
        || (300..=305).any(|prefix| digits.starts_with(&prefix.to_string()));
    if len == 14 && (is_diners_bin || is_diners_brand) {
        return vec![4, 6, 4];
    }
    let mut segments = Vec::new();
    let mut remaining = len;
    while remaining > 0 {
        let chunk = remaining.min(4);
        segments.push(chunk);
        remaining -= chunk;
    }
    segments
}

/// Partitions `text` according to `segments`.
fn partition_card(text: &str, segments: &[usize]) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut parts = Vec::new();
    let mut index = 0;
    for size in segments {
        if index >= chars.len() {
            break;
        }
        let end = (index + size).min(chars.len());
        parts.push(chars[index..end].iter().collect::<String>());
        index = end;
    }
    if index < chars.len() {
        parts.push(chars[index..].iter().collect());
    }
    parts.join(" ")
}

/// Masks a card number, revealing only the last four digits.
fn mask_card_number_for(number: &str, brand: &str) -> String {
    let digits: String = number.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return "•••• •••• •••• ••••".to_string();
    }
    if digits.len() <= 4 {
        return "•".repeat(digits.len());
    }
    let mask_count = digits.len() - 4;
    let last_four = &digits[digits.len() - 4..];
    let masked = format!("{}{last_four}", "•".repeat(mask_count));
    partition_card(&masked, &card_segments(&digits, brand))
}

/// Formats a revealed card number with the issuer's grouping.
fn format_card_number_for(number: &str, brand: &str) -> String {
    let digits: String = number.chars().filter(|c| c.is_ascii_digit()).collect();
    if digits.is_empty() {
        return String::new();
    }
    partition_card(&digits, &card_segments(&digits, brand))
}

/// Masks a card number, revealing only the last four digits.
#[cfg(test)]
fn mask_card_number(number: &str) -> String {
    mask_card_number_for(number, "")
}

/// Formats a card number in spaced groups of four (revealed).
#[cfg(test)]
fn format_card_number(number: &str) -> String {
    format_card_number_for(number, "")
}

/// Formats an expiration as `MM / YYYY`.
fn format_expiration(month: &str, year: &str) -> String {
    if month.is_empty() && year.is_empty() {
        return String::new();
    }
    let month = month.trim();
    let year = year.trim();
    let month = if month.len() == 1 { format!("0{month}") } else { month.to_string() };
    if year.is_empty() {
        month
    } else if month.is_empty() {
        year.to_string()
    } else {
        format!("{month} / {year}")
    }
}

/// Formats a byte size for humans.
fn format_size(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0usize;
    while value >= 1024.0 && unit + 1 < UNITS.len() {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} B")
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

/// The strength label for an entropy in bits.
fn strength_label(entropy: f64) -> &'static str {
    if entropy < 40.0 {
        "Weak"
    } else if entropy < 60.0 {
        "Fair"
    } else if entropy < 80.0 {
        "Good"
    } else if entropy < 100.0 {
        "Strong"
    } else {
        "Very Strong"
    }
}

/// A simple fuzzy score: higher for tighter matches; `None` when it misses.
fn fuzzy_score(pattern: &str, text: &str) -> Option<i32> {
    if pattern.is_empty() {
        return Some(0);
    }
    let pattern = pattern.to_lowercase();
    let text = text.to_lowercase();
    if !is_fuzzy_match(&pattern, &text) {
        return None;
    }
    if text == pattern {
        return Some(1000);
    }
    if text.starts_with(&pattern) {
        return Some(800 - text.len().min(100) as i32);
    }
    if let Some(index) = text.find(&pattern) {
        return Some(600 - index.min(100) as i32);
    }
    Some(300 - text.len().min(200) as i32)
}

/// Builds the TOTP view for a seed.
fn totp_view(seed: Option<&str>) -> Option<TotpLiveView> {
    let seed = seed?.trim();
    if seed.is_empty() {
        return None;
    }
    match generate_totp(seed, None, 6, 30) {
        Some(result) => Some(TotpLiveView {
            valid: true,
            code: result.code.clone(),
            formatted: format!("{} {}", &result.code[..3.min(result.code.len())], &result.code[3.min(result.code.len())..]),
            remaining: result.ttl as u32,
            period: result.period as u32,
            error: None,
        }),
        None => Some(TotpLiveView {
            valid: false,
            code: String::new(),
            formatted: String::new(),
            remaining: 0,
            period: 30,
            error: Some("Item has an invalid TOTP configuration".to_string()),
        }),
    }
}

/// Parses the daemon's item array and the per-item re-prompt flags.
fn parse_items(value: &Value) -> (Vec<VaultItem>, HashMap<String, u32>) {
    let mut reprompts = HashMap::new();
    if let Some(entries) = value.as_array() {
        for entry in entries {
            if let Some(id) = entry.get("id").and_then(Value::as_str) {
                let reprompt = entry
                    .get("reprompt")
                    .and_then(Value::as_u64)
                    .unwrap_or(0) as u32;
                reprompts.insert(id.to_string(), reprompt);
            }
        }
    }
    (
        serde_json::from_value::<Vec<VaultItem>>(value.clone()).unwrap_or_default(),
        reprompts,
    )
}

/// Builds a row from a vault item.
fn row_from_item(item: &VaultItem, reprompt: u32) -> CipherRowView {
    let category = category_of(item);
    let has_totp = item
        .login
        .as_ref()
        .and_then(|login| login.get("totp"))
        .and_then(|value| value.as_str())
        .is_some_and(|seed| !seed.trim().is_empty());
    let has_password_history = item
        .login
        .as_ref()
        .and_then(|login| login.get("passwordHistory"))
        .and_then(|value| value.as_array())
        .is_some_and(|history| !history.is_empty());
    let uris = item
        .login
        .as_ref()
        .and_then(|login| login.get("uris"))
        .and_then(|value| value.as_array())
        .map(|array| {
            array
                .iter()
                .filter_map(|entry| entry.get("uri").and_then(|value| value.as_str()))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let card_brand = item
        .card
        .as_ref()
        .and_then(|card| card.get("brand"))
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let card_mask = item.card.as_ref().map(|card| {
        let number = card
            .get("number")
            .and_then(|value| value.as_str())
            .unwrap_or_default();
        mask_card_number_for(number, card_brand.as_deref().unwrap_or(""))
    });
    CipherRowView {
        id: item.id.clone(),
        title: item.name.clone(),
        subtitle: if item.sub_title.is_empty() {
            item.type_name.clone()
        } else {
            item.sub_title.clone()
        },
        category,
        favorite: item.favorite,
        attachment_count: item.attachments.len() as u32,
        organization: item.organization_name.clone(),
        folder: item.folder_name.clone(),
        has_totp,
        has_password_history,
        uris,
        reprompt,
        card_brand,
        card_mask,
    }
}

/// Whether a row belongs to the active scope.
fn row_in_scope(row: &CipherRowView, active_scope: &str) -> bool {
    match active_scope {
        "all" | "" => true,
        "personal" => row.organization.is_none(),
        scope => match scope.strip_prefix("org:") {
            Some(name) => row.organization.as_deref() == Some(name),
            None => true,
        },
    }
}

/// Whether a row belongs to the active folder.
fn row_in_folder(row: &CipherRowView, folder: Option<&String>) -> bool {
    match folder {
        Some(folder) => {
            let name = folder.strip_prefix("folder:").unwrap_or(folder);
            row.folder.as_deref() == Some(name)
        }
        None => true,
    }
}

/// Whether a row matches the fuzzy search query.
fn row_matches_search(row: &CipherRowView, search: &str) -> bool {
    let haystack = format!(
        "{} {} {} {}",
        row.title,
        row.subtitle,
        row.organization.clone().unwrap_or_default(),
        row.folder.clone().unwrap_or_default()
    );
    fuzzy_score(search, &haystack).is_some()
}

/// Builds a snapshot from rows and a filter.
#[allow(clippy::too_many_arguments)]
fn build_snapshot(
    phase: AppPhase,
    email: String,
    server_url: String,
    identity_url: Option<String>,
    quick_unlock_ready: bool,
    quick_unlock_usable: bool,
    two_factor: Option<TwoFactorChallengeView>,
    error: Option<String>,
    all_rows: Vec<CipherRowView>,
    filter: &VaultFilterInput,
    last_sync: Option<String>,
    selected_cipher_id: Option<String>,
    ssh_prompt: Option<SshPromptView>,
    engine_version: Option<String>,
) -> VaultSnapshotView {
    let total_count = all_rows.len() as u32;
    let active_scope = filter.scope_id.clone().unwrap_or_else(|| "all".to_string());
    let mut counts = CategoryCountsView {
        all: 0,
        logins: 0,
        cards: 0,
        identities: 0,
        secure_notes: 0,
        ssh_keys: 0,
    };
    for row in &all_rows {
        if !row_in_scope(row, &active_scope)
            || !row_in_folder(row, filter.folder_id.as_ref())
            || !row_matches_search(row, &filter.search)
        {
            continue;
        }
        counts.all += 1;
        match row.category {
            ItemCategory::Login => counts.logins += 1,
            ItemCategory::Card => counts.cards += 1,
            ItemCategory::Identity => counts.identities += 1,
            ItemCategory::SecureNote => counts.secure_notes += 1,
            ItemCategory::SshKey => counts.ssh_keys += 1,
            ItemCategory::All => {}
        }
    }

    let mut scopes = vec![
        ScopeOptionView {
            id: "all".to_string(),
            name: "All Vaults".to_string(),
            kind: "all".to_string(),
            count: total_count,
        },
        ScopeOptionView {
            id: "personal".to_string(),
            name: "My Vault".to_string(),
            kind: "personal".to_string(),
            count: all_rows.iter().filter(|row| row.organization.is_none()).count() as u32,
        },
    ];
    let mut organizations: Vec<(String, u32)> = Vec::new();
    let mut folders: Vec<FolderOptionView> = Vec::new();
    for row in &all_rows {
        if let Some(org) = &row.organization {
            if let Some(entry) = organizations.iter_mut().find(|(name, _)| name == org) {
                entry.1 += 1;
            } else {
                organizations.push((org.clone(), 1));
            }
        }
        if let Some(folder) = &row.folder {
            if let Some(entry) = folders.iter_mut().find(|entry| &entry.name == folder) {
                entry.count += 1;
            } else {
                folders.push(FolderOptionView {
                    id: format!("folder:{folder}"),
                    name: folder.clone(),
                    count: 1,
                });
            }
        }
    }
    for (name, count) in organizations {
        scopes.push(ScopeOptionView {
            id: format!("org:{name}"),
            name: name.clone(),
            kind: "organization".to_string(),
            count,
        });
    }

    let all_items = all_rows.clone();
    let mut filtered: Vec<(i32, CipherRowView)> = all_rows
        .into_iter()
        .filter(|row| match filter.category {
            ItemCategory::All => true,
            category => row.category == category,
        })
        .filter(|row| row_in_scope(row, &active_scope))
        .filter(|row| row_in_folder(row, filter.folder_id.as_ref()))
        .filter_map(|row| {
            let haystack = format!(
                "{} {} {} {}",
                row.title,
                row.subtitle,
                row.organization.clone().unwrap_or_default(),
                row.folder.clone().unwrap_or_default()
            );
            fuzzy_score(&filter.search, &haystack).map(|score| (score, row))
        })
        .collect();
    filtered.sort_by(|(score_a, row_a), (score_b, row_b)| {
        score_b
            .cmp(score_a)
            .then_with(|| row_b.favorite.cmp(&row_a.favorite))
            .then_with(|| row_a.title.to_lowercase().cmp(&row_b.title.to_lowercase()))
    });
    let items = filtered.into_iter().map(|(_, row)| row).collect();

    VaultSnapshotView {
        phase,
        email,
        server_url,
        identity_url,
        quick_unlock_ready,
        quick_unlock_usable,
        unlocked: phase == AppPhase::Unlocked,
        syncing: false,
        two_factor,
        error,
        items,
        all_items,
        total_count,
        category_counts: counts,
        scopes,
        folders,
        active_scope,
        active_folder: filter.folder_id.clone(),
        search: filter.search.clone(),
        category: filter.category,
        last_sync,
        selected_cipher_id,
        ssh_prompt,
        engine_version,
    }
}

// ---------------------------------------------------------------------------
// Mock state
// ---------------------------------------------------------------------------

/// A card as seeded by a test.
#[derive(Clone, Debug, Default)]
struct MockCard {
    cardholder_name: String,
    brand: String,
    number: String,
    exp_month: String,
    exp_year: String,
    code: String,
}

/// An identity as seeded by a test.
#[derive(Clone, Debug, Default)]
struct MockIdentity {
    full_name: String,
    username: String,
    company: String,
    email: String,
    phone: String,
    ssn: String,
    passport_number: String,
    license_number: String,
    address1: String,
    address2: String,
    address3: String,
    city: String,
    state: String,
    postal_code: String,
    country: String,
}

/// An SSH key as seeded by a test.
#[derive(Clone, Debug, Default)]
struct MockSsh {
    key_type: String,
    fingerprint: String,
    public_key: String,
    private_key: String,
}

/// A custom field as seeded by a test.
#[derive(Clone, Debug)]
struct MockField {
    name: String,
    value: String,
    kind: String,
}

/// A cipher as seeded by a test.
#[derive(Clone, Debug, Default)]
struct MockItem {
    id: String,
    title: String,
    category: ItemCategory,
    username: Option<String>,
    password: Option<String>,
    totp: Option<String>,
    notes: Option<String>,
    uris: Vec<String>,
    favorite: bool,
    folder: Option<String>,
    organization: Option<String>,
    card: Option<MockCard>,
    identity: Option<MockIdentity>,
    ssh: Option<MockSsh>,
    fields: Vec<MockField>,
    attachments: Vec<AttachmentView>,
    password_history: Vec<PasswordHistoryEntryView>,
    reprompt: u32,
    totp_remaining: Option<u32>,
    totp_period: Option<u32>,
}

impl Default for ItemCategory {
    fn default() -> Self {
        ItemCategory::Login
    }
}

/// The settings a test seeds.
#[derive(Clone, Debug)]
struct MockSettings {
    server_url: String,
    identity_url: String,
    download_dir: String,
    auto_lock_minutes: i64,
    clipboard_clear_seconds: i64,
    email: String,
    remember_email: bool,
    check_updates: bool,
    show_website_icons: bool,
    remember_last_search: bool,
    max_attachment_size_mb: u64,
    ssh_agent_enabled: bool,
    ssh_agent_confirm: SshAgentPolicy,
    quick_unlock: bool,
    client_cert_path: String,
    client_key_path: String,
    theme: ThemeAppearance,
}

impl Default for MockSettings {
    fn default() -> Self {
        Self {
            server_url: "https://vault.bitwarden.com".to_string(),
            identity_url: String::new(),
            download_dir: "~/Downloads".to_string(),
            auto_lock_minutes: 15,
            clipboard_clear_seconds: 30,
            email: "user@example.com".to_string(),
            remember_email: true,
            check_updates: true,
            show_website_icons: true,
            remember_last_search: false,
            max_attachment_size_mb: 500,
            ssh_agent_enabled: false,
            ssh_agent_confirm: SshAgentPolicy::FirstUse,
            quick_unlock: true,
            client_cert_path: String::new(),
            client_key_path: String::new(),
            theme: ThemeAppearance::Dark,
        }
    }
}

/// The in-memory state of mock mode.
#[derive(Clone, Debug)]
struct MockState {
    enabled: bool,
    phase: AppPhase,
    email: String,
    server_url: String,
    identity_url: Option<String>,
    quick_unlock_ready: bool,
    quick_unlock_usable: bool,
    dependencies_missing: Vec<String>,
    two_factor_required: bool,
    two_factor: Option<TwoFactorChallengeView>,
    items: Vec<MockItem>,
    ssh_prompt: Option<SshPromptView>,
    settings: MockSettings,
    update_available: bool,
    last_sync: Option<String>,
    error: Option<String>,
    /// A sync failure the mock reports while keeping the unlocked view.
    sync_error: Option<String>,
    filter: VaultFilterInput,
    selected_cipher_id: Option<String>,
    master_password: String,
}

impl Default for VaultFilterInput {
    fn default() -> Self {
        Self {
            search: String::new(),
            category: ItemCategory::All,
            scope_id: None,
            folder_id: None,
        }
    }
}

impl Default for MockState {
    fn default() -> Self {
        Self {
            enabled: false,
            phase: AppPhase::Login,
            email: String::new(),
            server_url: "https://vault.bitwarden.com".to_string(),
            identity_url: None,
            quick_unlock_ready: false,
            quick_unlock_usable: true,
            dependencies_missing: Vec::new(),
            two_factor_required: false,
            two_factor: None,
            items: Vec::new(),
            ssh_prompt: None,
            settings: MockSettings::default(),
            update_available: false,
            last_sync: None,
            error: None,
            sync_error: None,
            filter: VaultFilterInput::default(),
            selected_cipher_id: None,
            master_password: "correct horse battery staple".to_string(),
        }
    }
}

/// The process-wide mock state.
static MOCK: OnceLock<Mutex<MockState>> = OnceLock::new();

/// The mock state, creating it on first use.
fn mock_state() -> &'static Mutex<MockState> {
    MOCK.get_or_init(|| Mutex::new(MockState::default()))
}

/// Runs `f` with the locked mock state.
fn with_mock<T>(f: impl FnOnce(&mut MockState) -> T) -> T {
    let mut guard = mock_state().lock().unwrap_or_else(|error| error.into_inner());
    f(&mut guard)
}

/// Parses a string field from JSON.
fn json_string(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(|field| field.as_str()).map(str::to_string)
}

/// Parses a boolean field from JSON with a default.
fn json_bool(value: &Value, key: &str, default: bool) -> bool {
    value.get(key).and_then(|field| field.as_bool()).unwrap_or(default)
}

/// Parses an integer field from JSON.
fn json_u32(value: &Value, key: &str) -> Option<u32> {
    value.get(key).and_then(|field| field.as_u64()).map(|number| number as u32)
}

/// Parses an item category.
fn parse_category(raw: &str) -> ItemCategory {
    match raw {
        "card" => ItemCategory::Card,
        "identity" => ItemCategory::Identity,
        "secureNote" | "secure_note" | "note" => ItemCategory::SecureNote,
        "sshKey" | "ssh_key" | "ssh" => ItemCategory::SshKey,
        "all" => ItemCategory::All,
        _ => ItemCategory::Login,
    }
}

impl MockItem {
    /// Builds a mock cipher from a JSON object.
    fn from_json(value: &Value) -> Self {
        let category = parse_category(value.get("category").and_then(|v| v.as_str()).unwrap_or("login"));
        let mut item = Self {
            id: json_string(value, "id").unwrap_or_else(|| "mock-item".to_string()),
            title: json_string(value, "title")
                .or_else(|| json_string(value, "name"))
                .unwrap_or_else(|| "Untitled".to_string()),
            category,
            username: json_string(value, "username"),
            password: json_string(value, "password"),
            totp: json_string(value, "totp"),
            notes: json_string(value, "notes"),
            uris: value
                .get("uris")
                .and_then(|v| v.as_array())
                .map(|array| {
                    array
                        .iter()
                        .filter_map(|entry| {
                            entry.as_str().map(str::to_string).or_else(|| json_string(entry, "uri"))
                        })
                        .collect()
                })
                .unwrap_or_default(),
            favorite: json_bool(value, "favorite", false),
            folder: json_string(value, "folder"),
            organization: json_string(value, "organization"),
            reprompt: value
                .get("reprompt")
                .and_then(Value::as_u64)
                .unwrap_or(0) as u32,
            totp_remaining: value
                .get("totpRemaining")
                .and_then(Value::as_u64)
                .map(|value| value as u32),
            totp_period: value
                .get("totpPeriod")
                .and_then(Value::as_u64)
                .map(|value| value as u32),
            ..Default::default()
        };
        if let Some(card) = value.get("card") {
            item.card = Some(MockCard {
                cardholder_name: json_string(card, "cardholderName").unwrap_or_default(),
                brand: json_string(card, "brand").unwrap_or_default(),
                number: json_string(card, "number").unwrap_or_default(),
                exp_month: json_string(card, "expMonth").unwrap_or_default(),
                exp_year: json_string(card, "expYear").unwrap_or_default(),
                code: json_string(card, "code").unwrap_or_default(),
            });
        }
        if let Some(identity) = value.get("identity") {
            item.identity = Some(MockIdentity {
                full_name: json_string(identity, "fullName").unwrap_or_default(),
                username: json_string(identity, "username").unwrap_or_default(),
                company: json_string(identity, "company").unwrap_or_default(),
                email: json_string(identity, "email").unwrap_or_default(),
                phone: json_string(identity, "phone").unwrap_or_default(),
                ssn: json_string(identity, "ssn").unwrap_or_default(),
                passport_number: json_string(identity, "passportNumber").unwrap_or_default(),
                license_number: json_string(identity, "licenseNumber").unwrap_or_default(),
                address1: json_string(identity, "address1").unwrap_or_default(),
                address2: json_string(identity, "address2").unwrap_or_default(),
                address3: json_string(identity, "address3").unwrap_or_default(),
                city: json_string(identity, "city").unwrap_or_default(),
                state: json_string(identity, "state").unwrap_or_default(),
                postal_code: json_string(identity, "postalCode").unwrap_or_default(),
                country: json_string(identity, "country").unwrap_or_default(),
            });
        }
        if let Some(ssh) = value.get("ssh") {
            item.ssh = Some(MockSsh {
                key_type: json_string(ssh, "keyType").unwrap_or_else(|| "ED25519".to_string()),
                fingerprint: json_string(ssh, "fingerprint").unwrap_or_default(),
                public_key: json_string(ssh, "publicKey").unwrap_or_default(),
                private_key: json_string(ssh, "privateKey").unwrap_or_default(),
            });
        }
        if let Some(fields) = value.get("fields").and_then(|v| v.as_array()) {
            item.fields = fields
                .iter()
                .map(|field| MockField {
                    name: json_string(field, "name").unwrap_or_default(),
                    value: json_string(field, "value").unwrap_or_default(),
                    kind: json_string(field, "kind").unwrap_or_else(|| "text".to_string()),
                })
                .collect();
        }
        if let Some(attachments) = value.get("attachments").and_then(|v| v.as_array()) {
            item.attachments = attachments
                .iter()
                .map(|attachment| {
                    let size = attachment.get("size").and_then(|v| v.as_u64()).unwrap_or(0);
                    AttachmentView {
                        id: json_string(attachment, "id").unwrap_or_default(),
                        filename: json_string(attachment, "filename").unwrap_or_default(),
                        size,
                        size_label: format_size(size),
                    }
                })
                .collect();
        }
        if let Some(history) = value.get("passwordHistory").and_then(|v| v.as_array()) {
            item.password_history = history
                .iter()
                .map(|entry| PasswordHistoryEntryView {
                    password: json_string(entry, "password").unwrap_or_default(),
                    changed_at: json_string(entry, "changedAt").unwrap_or_default(),
                })
                .collect();
        }
        item
    }

    /// The row for the list.
    fn row(&self) -> CipherRowView {
        let subtitle = match self.category {
            ItemCategory::Login => self.username.clone().unwrap_or_default(),
            ItemCategory::Card => self
                .card
                .as_ref()
                .map(|card| {
                    if card.brand.is_empty() {
                        mask_card_number_for(&card.number, "")
                    } else {
                        card.brand.clone()
                    }
                })
                .unwrap_or_default(),
            ItemCategory::Identity => self
                .identity
                .as_ref()
                .map(|identity| identity.full_name.clone())
                .unwrap_or_default(),
            ItemCategory::SshKey => self
                .ssh
                .as_ref()
                .map(|ssh| ssh.key_type.clone())
                .unwrap_or_else(|| "SSH".to_string()),
            ItemCategory::SecureNote => "Secure Note".to_string(),
            ItemCategory::All => String::new(),
        };
        CipherRowView {
            id: self.id.clone(),
            title: self.title.clone(),
            subtitle,
            category: self.category,
            favorite: self.favorite,
            attachment_count: self.attachments.len() as u32,
            organization: self.organization.clone(),
            folder: self.folder.clone(),
            has_totp: self.totp.as_deref().is_some_and(|seed| !seed.is_empty()),
            has_password_history: !self.password_history.is_empty(),
            uris: self.uris.clone(),
            reprompt: self.reprompt,
            card_brand: self.card.as_ref().map(|card| card.brand.clone()),
            card_mask: self.card.as_ref().map(|card| {
                mask_card_number_for(&card.number, &card.brand)
            }),
        }
    }

    /// Builds the inspector view with the requested fields revealed.
    fn inspector(&self, reveal: &RevealStateInput) -> InspectorView {
        let password_masked = mask_secret(self.password.as_deref().unwrap_or(""));
        let password = if reveal.reveal_password {
            self.password.clone()
        } else {
            None
        };
        let card = self.card.as_ref().map(|card| CardView {
            cardholder_name: card.cardholder_name.clone(),
            brand: card.brand.clone(),
            number: if reveal.reveal_card_number {
                format_card_number_for(&card.number, &card.brand)
            } else {
                mask_card_number_for(&card.number, &card.brand)
            },
            number_masked: mask_card_number_for(&card.number, &card.brand),
            exp_month: card.exp_month.clone(),
            exp_year: card.exp_year.clone(),
            expiration: format_expiration(&card.exp_month, &card.exp_year),
            cvv: if reveal.reveal_cvv { card.code.clone() } else { mask_secret(&card.code) },
            cvv_masked: mask_secret(&card.code),
        });
        let identity = self.identity.as_ref().map(|identity| IdentityView {
            full_name: identity.full_name.clone(),
            username: identity.username.clone(),
            company: identity.company.clone(),
            email: identity.email.clone(),
            phone: identity.phone.clone(),
            ssn: identity.ssn.clone(),
            passport_number: identity.passport_number.clone(),
            license_number: identity.license_number.clone(),
            address1: identity.address1.clone(),
            address2: identity.address2.clone(),
            address3: identity.address3.clone(),
            city: identity.city.clone(),
            state: identity.state.clone(),
            postal_code: identity.postal_code.clone(),
            country: identity.country.clone(),
        });
        let ssh = self.ssh.as_ref().map(|ssh| SshKeyView {
            key_type: ssh.key_type.clone(),
            fingerprint: ssh.fingerprint.clone(),
            public_key: ssh.public_key.clone(),
            private_key: if reveal.reveal_private_key {
                ssh.private_key.clone()
            } else {
                mask_secret(&ssh.private_key)
            },
            private_key_masked: mask_secret(&ssh.private_key),
        });
        let fields = self
            .fields
            .iter()
            .enumerate()
            .map(|(index, field)| {
                let index = index as u32;
                let hidden = field.kind == "hidden";
                let revealed = !hidden || reveal.reveal_fields.contains(&index);
                CustomFieldView {
                    index,
                    name: field.name.clone(),
                    kind: field.kind.clone(),
                    value: if revealed { field.value.clone() } else { mask_secret(&field.value) },
                    value_masked: mask_secret(&field.value),
                }
            })
            .collect();
        let uris = self
            .uris
            .iter()
            .map(|uri| UriView {
                uri: uri.clone(),
                host: url::Url::parse(uri)
                    .ok()
                    .and_then(|parsed| parsed.host_str().map(str::to_string))
                    .unwrap_or_else(|| uri.clone()),
            })
            .collect();
        InspectorView {
            id: self.id.clone(),
            title: self.title.clone(),
            category: self.category,
            favorite: self.favorite,
            notes: self.notes.clone(),
            username: self.username.clone(),
            password,
            password_masked,
            totp: self.totp_view(),
            uris,
            card,
            identity,
            ssh,
            fields,
            attachments: self.attachments.clone(),
            password_history: self.password_history.clone(),
            metadata: MetadataView {
                folder: self.folder.clone().unwrap_or_default(),
                organization: self.organization.clone().unwrap_or_default(),
                created_at: String::new(),
                updated_at: String::new(),
            },
            reprompt: self.reprompt,
            error: None,
        }
    }

    /// The mock TOTP view, honouring the test's remaining/period overrides.
    fn totp_view(&self) -> Option<TotpLiveView> {
        let mut view = totp_view(self.totp.as_deref())?;
        if let Some(period) = self.totp_period {
            view.period = period;
        }
        if let Some(remaining) = self.totp_remaining {
            view.remaining = remaining;
        }
        Some(view)
    }
}

impl MockState {
    /// The current snapshot.
    fn snapshot(&self) -> VaultSnapshotView {
        build_snapshot(
            self.phase,
            self.email.clone(),
            sanitize_server_url(&self.server_url),
            self.identity_url.as_deref().map(sanitize_server_url),
            self.quick_unlock_ready,
            self.quick_unlock_usable,
            self.two_factor.clone(),
            self.error.clone(),
            self.items.iter().map(MockItem::row).collect(),
            &self.filter,
            self.last_sync.clone(),
            self.selected_cipher_id.clone(),
            self.ssh_prompt.clone(),
            Some(env!("CARGO_PKG_VERSION").to_string()),
        )
    }

    /// The mock health snapshot.
    fn health(&self) -> HealthSnapshotView {
        let checks = vec![
            HealthCheckView {
                name: "Engine Installed".to_string(),
                ok: true,
                detail: "omawarden engine is available".to_string(),
            },
            HealthCheckView {
                name: "Server Reachable".to_string(),
                ok: true,
                detail: sanitize_server_url(&self.settings.server_url),
            },
            HealthCheckView {
                name: "Secret Service Keyring".to_string(),
                ok: true,
                detail: "secret-tool is available".to_string(),
            },
            HealthCheckView {
                name: "Wayland Clipboard".to_string(),
                ok: true,
                detail: "wl-copy is available".to_string(),
            },
            HealthCheckView {
                name: "Memory Locked".to_string(),
                ok: true,
                detail: "mlock is active".to_string(),
            },
        ];
        HealthSnapshotView {
            engine_installed: true,
            engine_version: env!("CARGO_PKG_VERSION").to_string(),
            server_reachable: true,
            keyring_available: true,
            clipboard_available: true,
            memory_locked: true,
            checks,
            error: None,
        }
    }

    /// The mock settings snapshot.
    fn settings_snapshot(&self) -> SettingsSnapshotView {
        let config = SettingsView {
            server_url: self.settings.server_url.clone(),
            identity_url: self.settings.identity_url.clone(),
            download_dir: self.settings.download_dir.clone(),
            auto_lock_minutes: self.settings.auto_lock_minutes,
            clipboard_clear_seconds: self.settings.clipboard_clear_seconds,
            email: self.settings.email.clone(),
            remember_email: self.settings.remember_email,
            check_updates: self.settings.check_updates,
            show_website_icons: self.settings.show_website_icons,
            remember_last_search: self.settings.remember_last_search,
            max_attachment_size_mb: self.settings.max_attachment_size_mb,
            ssh_agent_enabled: self.settings.ssh_agent_enabled,
            ssh_agent_confirm: self.settings.ssh_agent_confirm,
            quick_unlock: self.settings.quick_unlock,
            client_cert_path: self.settings.client_cert_path.clone(),
            client_key_path: self.settings.client_key_path.clone(),
            theme: self.settings.theme,
        };
        SettingsSnapshotView {
            config,
            health: self.health(),
            diagnostics: DiagnosticsView {
                server_url_sanitized: sanitize_server_url(&self.settings.server_url),
                logs: vec![
                    "[info] omawarden: mock mode is active".to_string(),
                    "[info] omawarden: daemon socket untouched".to_string(),
                ],
                app_version: env!("CARGO_PKG_VERSION").to_string(),
                engine_version: env!("CARGO_PKG_VERSION").to_string(),
                git_commit: "mock".to_string(),
                build_date: "mock".to_string(),
                memory_rss_mb: 0.0,
            },
            error: None,
        }
    }
}

/// Applies a test's JSON state to the mock.
fn configure_mock_from_json(state: &mut MockState, value: &Value) {
    if let Some(phase) = value.get("phase").and_then(|v| v.as_str()) {
        state.phase = match phase {
            "dependencyCheck" | "dependency_check" | "dependencies" => AppPhase::DependencyCheck,
            "login" => AppPhase::Login,
            "twoFactor" | "two_factor" | "2fa" => AppPhase::TwoFactor,
            "locked" => AppPhase::Locked,
            "unlocked" => AppPhase::Unlocked,
            _ => state.phase,
        };
    }
    if let Some(email) = json_string(value, "email") {
        state.email = email;
        state.settings.email = state.email.clone();
    }
    if let Some(server_url) = json_string(value, "serverUrl").or_else(|| json_string(value, "server_url")) {
        state.server_url = server_url.clone();
        state.settings.server_url = server_url;
    }
    if let Some(identity_url) = json_string(value, "identityUrl").or_else(|| json_string(value, "identity_url")) {
        state.identity_url = if identity_url.is_empty() { None } else { Some(identity_url.clone()) };
        state.settings.identity_url = identity_url;
    }
    state.quick_unlock_ready = json_bool(value, "quickUnlockReady", state.quick_unlock_ready);
    state.quick_unlock_usable = json_bool(value, "quickUnlockUsable", state.quick_unlock_usable);
    state.two_factor_required = json_bool(value, "twoFactorRequired", state.two_factor_required);
    state.update_available = json_bool(value, "updateAvailable", state.update_available);
    if let Some(password) = json_string(value, "masterPassword") {
        state.master_password = password;
    }
    state.last_sync = json_string(value, "lastSync").or(state.last_sync.clone());
    state.error = json_string(value, "error");
    state.sync_error = json_string(value, "syncError");
    if let Some(missing) = value.get("dependenciesMissing").and_then(|v| v.as_array()) {
        state.dependencies_missing = missing
            .iter()
            .filter_map(|entry| entry.as_str().map(str::to_string))
            .collect();
    }
    if let Some(two_factor) = value.get("twoFactor") {
        let providers = two_factor
            .get("providers")
            .and_then(|v| v.as_array())
            .map(|array| {
                array
                    .iter()
                    .map(|provider| TwoFactorProviderView {
                        id: json_u32(provider, "id").unwrap_or(0),
                        name: json_string(provider, "name").unwrap_or_default(),
                        label: json_string(provider, "label").unwrap_or_default(),
                        available: json_bool(provider, "available", true),
                    })
                    .collect()
            })
            .unwrap_or_else(default_two_factor_providers);
        state.two_factor = Some(TwoFactorChallengeView {
            email: json_string(two_factor, "email").unwrap_or_else(|| state.email.clone()),
            providers,
            selected_provider: json_u32(two_factor, "selectedProvider").unwrap_or(0),
            fido2_status: json_string(two_factor, "fido2Status"),
            new_device: json_bool(two_factor, "newDevice", false),
        });
    }
    if let Some(prompt) = value.get("sshPrompt") {
        state.ssh_prompt = Some(SshPromptView {
            id: json_u32(prompt, "id").unwrap_or(1),
            title: json_string(prompt, "title").unwrap_or_else(|| "Sign a Git commit?".to_string()),
            action: json_string(prompt, "action").unwrap_or_else(|| "SSH login as git@github.com".to_string()),
            key_name: json_string(prompt, "keyName").unwrap_or_else(|| "GitHub".to_string()),
            fingerprint: json_string(prompt, "fingerprint").unwrap_or_else(|| "SHA256:mock".to_string()),
            client: json_string(prompt, "client").unwrap_or_else(|| "git (ssh)".to_string()),
            command: json_string(prompt, "command").unwrap_or_else(|| "git push".to_string()),
            forwarded: json_bool(prompt, "forwarded", false),
            remembered: json_bool(prompt, "remembered", true),
            remaining: json_u32(prompt, "remaining").unwrap_or(0),
        });
    }
    if let Some(items) = value.get("items").and_then(|v| v.as_array()) {
        state.items = items.iter().map(MockItem::from_json).collect();
    }
    if let Some(settings) = value.get("settings") {
        let mock = &mut state.settings;
        if let Some(v) = json_string(settings, "serverUrl") { mock.server_url = v; }
        if let Some(v) = json_string(settings, "identityUrl") { mock.identity_url = v; }
        if let Some(v) = json_string(settings, "downloadDir") { mock.download_dir = v; }
        if let Some(v) = settings.get("autoLockMinutes").and_then(|v| v.as_i64()) { mock.auto_lock_minutes = v; }
        if let Some(v) = settings.get("clipboardClearSeconds").and_then(|v| v.as_i64()) { mock.clipboard_clear_seconds = v; }
        if let Some(v) = json_string(settings, "email") { mock.email = v; }
        if let Some(v) = settings.get("rememberEmail").and_then(|v| v.as_bool()) { mock.remember_email = v; }
        if let Some(v) = settings.get("checkUpdates").and_then(|v| v.as_bool()) { mock.check_updates = v; }
        if let Some(v) = settings.get("showWebsiteIcons").and_then(|v| v.as_bool()) { mock.show_website_icons = v; }
        if let Some(v) = settings.get("rememberLastSearch").and_then(|v| v.as_bool()) { mock.remember_last_search = v; }
        if let Some(v) = settings.get("maxAttachmentSizeMb").and_then(|v| v.as_u64()) { mock.max_attachment_size_mb = v; }
        if let Some(v) = settings.get("sshAgentEnabled").and_then(|v| v.as_bool()) { mock.ssh_agent_enabled = v; }
        if let Some(v) = json_string(settings, "sshAgentConfirm") {
            mock.ssh_agent_confirm = match v.as_str() {
                "always" => SshAgentPolicy::Always,
                "never" => SshAgentPolicy::Never,
                _ => SshAgentPolicy::FirstUse,
            };
        }
        if let Some(v) = settings.get("quickUnlock").and_then(|v| v.as_bool()) { mock.quick_unlock = v; }
        if let Some(v) = json_string(settings, "clientCertPath") { mock.client_cert_path = v; }
        if let Some(v) = json_string(settings, "clientKeyPath") { mock.client_key_path = v; }
        if let Some(v) = json_string(settings, "theme") {
            mock.theme = if v == "light" { ThemeAppearance::Light } else { ThemeAppearance::Dark };
        }
    }
}

/// The default two-factor provider list.
fn default_two_factor_providers() -> Vec<TwoFactorProviderView> {
    vec![
        TwoFactorProviderView { id: 0, name: "authenticator".to_string(), label: "Authenticator App".to_string(), available: true },
        TwoFactorProviderView { id: 1, name: "email".to_string(), label: "Email".to_string(), available: true },
        TwoFactorProviderView { id: 3, name: "yubikey".to_string(), label: "YubiKey OTP".to_string(), available: true },
        TwoFactorProviderView { id: 7, name: "fido2".to_string(), label: "FIDO2 Security Key".to_string(), available: true },
    ]
}

/// Trims an optional user-entered code and treats blank input as absent.
///
/// The engine treats `Some("")` as a present new-device code and then omits
/// the two-factor token from the login request, which silently breaks FIDO2.
fn normalize_optional_code(value: Option<String>) -> Option<String> {
    value
        .map(|text| text.trim().to_string())
        .filter(|text| !text.is_empty())
}

/// A simple action outcome.
#[derive(Clone, Debug, JsObject)]
pub struct ActionOutcomeView {
    /// Whether the action succeeded.
    pub ok: bool,
    /// A short message.
    pub message: String,
    /// The error, when it failed.
    pub error: Option<String>,
}

// ---------------------------------------------------------------------------
// Real (non-mock) helpers
// ---------------------------------------------------------------------------

/// Sends one daemon request, returning `None` when no daemon answers.
fn daemon(action: Value) -> Option<Value> {
    omawarden::daemon::send_daemon_request(&action)
}

/// The auth manager for the current configuration.
fn auth_manager() -> omawarden::auth::AuthManager {
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

/// Ensures an Omawarden daemon answers `ping`, starting one in this process.
///
/// The engine's `ensure_daemon_running` falls back to
/// `std::env::current_exe().arg("daemon")`. Inside an nsh host that executable
/// is the GUI host binary, so the fallback would open a second app window.
/// Starting the daemon on a dedicated thread here keeps the socket alive and
/// lets every later engine call take its `ping` fast path instead.
fn ensure_app_daemon_running() -> bool {
    if daemon(json!({ "action": "ping", "touch": false })).is_some() {
        return true;
    }

    // At most one in-process daemon server per process.
    static DAEMON_SPAWNED: AtomicBool = AtomicBool::new(false);
    if !DAEMON_SPAWNED.swap(true, Ordering::SeqCst) {
        let config = load_config();
        let auto_lock_minutes = if config.auto_lock_minutes >= 0 {
            config.auto_lock_minutes as u64
        } else {
            15
        };
        let state = std::sync::Arc::new(omawarden::daemon::DaemonState::new(
            omawarden::storage::StorageManager::default(),
            auto_lock_minutes,
        ));
        let _ = std::thread::Builder::new()
            .name("omawarden-daemon".into())
            .spawn(move || {
                if let Err(error) = omawarden::daemon::run_daemon_server(state) {
                    eprintln!("omawarden in-process daemon stopped: {error}");
                }
            });
    }

    for _ in 0..40 {
        std::thread::sleep(Duration::from_millis(25));
        if daemon(json!({ "action": "ping", "touch": false })).is_some() {
            return true;
        }
    }
    false
}

/// Builds the provider list the two-factor screen shows.
fn two_factor_provider_view(id: i32) -> TwoFactorProviderView {
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

    let mut snapshot = real_snapshot(VaultFilterInput::default());
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

/// Checks one package.
fn package_status(binary: &str, name: &str, description: &str, required: bool) -> PackageStatusView {
    let installed_path = which::which(binary).ok();
    let installed = installed_path.is_some();
    let version = installed_path.and_then(|path| {
        Command::new(path)
            .arg("--version")
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
            .ok()
            .and_then(|output| String::from_utf8(output.stdout).ok())
            .map(|text| text.lines().next().unwrap_or_default().trim().to_string())
            .filter(|text| !text.is_empty())
    });
    PackageStatusView {
        name: name.to_string(),
        description: description.to_string(),
        required,
        installed,
        version,
    }
}

/// The real dependency check.
fn real_dependencies() -> DependencyStatusView {
    let packages = vec![
        package_status("omawarden", "omawarden", "Omawarden engine and daemon", true),
        package_status("secret-tool", "libsecret", "Secret Service keyring bridge", true),
        package_status("wl-copy", "wl-clipboard", "Wayland clipboard", true),
        package_status("fido2-token", "libfido2", "FIDO2 security keys (optional)", false),
    ];
    let missing_packages: Vec<String> = packages
        .iter()
        .filter(|package| !package.installed)
        .map(|package| package.name.clone())
        .collect();
    let missing_required: Vec<String> = packages
        .iter()
        .filter(|package| package.required && !package.installed)
        .map(|package| package.name.clone())
        .collect();
    DependencyStatusView {
        all_required_installed: missing_required.is_empty(),
        packages,
        missing_packages,
        missing_required,
    }
}

/// The mock dependency check.
fn mock_dependencies(missing: &[String]) -> DependencyStatusView {
    let packages = vec![
        ("omawarden", "Omawarden engine and daemon", true),
        ("libsecret", "Secret Service keyring bridge", true),
        ("wl-clipboard", "Wayland clipboard", true),
        ("libfido2", "FIDO2 security keys (optional)", false),
    ]
    .into_iter()
    .map(|(name, description, required)| PackageStatusView {
        name: name.to_string(),
        description: description.to_string(),
        required,
        installed: !missing.iter().any(|entry| entry == name),
        version: Some("mock".to_string()),
    })
    .collect::<Vec<_>>();
    let missing_packages: Vec<String> = packages
        .iter()
        .filter(|package| !package.installed)
        .map(|package| package.name.clone())
        .collect();
    let missing_required: Vec<String> = packages
        .iter()
        .filter(|package| package.required && !package.installed)
        .map(|package| package.name.clone())
        .collect();
    DependencyStatusView {
        all_required_installed: missing_required.is_empty(),
        packages,
        missing_packages,
        missing_required,
    }
}

/// Reads the daemon's unlocked item list.
///
/// It never calls `ensure_daemon_running`: that would spawn the nsh host as a
/// "daemon" when the vault locks between the status probe and this call.
fn real_items() -> (Vec<VaultItem>, HashMap<String, u32>) {
    daemon(json!({ "action": "list", "touch": false }))
        .map(|value| parse_items(&value))
        .unwrap_or_default()
}

/// Cached in-memory state of the unlocked vault for zero-IPC hot-path queries and inspection.
#[derive(Clone, Debug)]
struct CachedVault {
    email: String,
    server_url: String,
    identity_url: Option<String>,
    quick_unlock_ready: bool,
    quick_unlock_usable: bool,
    last_sync: Option<String>,
    engine_version: Option<String>,
    items: Vec<VaultItem>,
    rows: Vec<CipherRowView>,
    reprompts: HashMap<String, u32>,
}

fn cached_vault() -> &'static Mutex<Option<CachedVault>> {
    static CACHE: OnceLock<Mutex<Option<CachedVault>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

fn clear_cached_vault() {
    if let Ok(mut guard) = cached_vault().lock() {
        *guard = None;
    }
}

/// Builds an unlocked snapshot from the in-memory cache, carrying `error` when
/// the daemon could not refresh the vault.
///
/// A failed sync or query must never drop the user back to the locked screen:
/// the cache is the last known good unlocked view, so it wins over a status
/// probe that happens to see the daemon mid-restart.
fn cached_snapshot(filter: &VaultFilterInput, error: Option<String>) -> Option<VaultSnapshotView> {
    let guard = cached_vault().lock().ok()?;
    let cached = guard.as_ref()?;
    Some(build_snapshot(
        AppPhase::Unlocked,
        cached.email.clone(),
        cached.server_url.clone(),
        cached.identity_url.clone(),
        cached.quick_unlock_ready,
        cached.quick_unlock_usable,
        None,
        error,
        cached.rows.clone(),
        filter,
        cached.last_sync.clone(),
        None,
        None,
        cached.engine_version.clone(),
    ))
}

/// Reads the daemon status and builds a real snapshot.
fn real_snapshot(filter: VaultFilterInput) -> VaultSnapshotView {
    let config = load_config();
    let ping = daemon(json!({ "action": "ping", "touch": false }));
    let status = daemon(json!({ "action": "status", "touch": false })).unwrap_or(Value::Null);
    let unlocked = status
        .get("is_unlocked")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    // Before the daemon is up (or while the vault is locked) the socket has no
    // useful status, so read the engine's stored session in-process. This keeps
    // login vs locked, the account email, and the server URL accurate without
    // spawning anything.
    let auth_status = if unlocked {
        None
    } else {
        Some(auth_manager().get_status(false))
    };
    let has_session = status
        .get("has_session")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
        || auth_status
            .as_ref()
            .map(|value| value.has_session)
            .unwrap_or(false);
    let phase = if unlocked {
        AppPhase::Unlocked
    } else if has_session {
        AppPhase::Locked
    } else {
        AppPhase::Login
    };
    let email = status
        .get("user_email")
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            auth_status
                .as_ref()
                .and_then(|value| value.user_email.clone())
                .filter(|value| !value.is_empty())
        })
        .unwrap_or_else(|| config.email.clone());
    let server_url = status
        .get("server_url")
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            auth_status
                .as_ref()
                .and_then(|value| value.server_url.clone())
                .filter(|value| !value.is_empty())
        })
        .unwrap_or_else(|| config.server_url.clone());
    let quick_unlock_ready = ping
        .as_ref()
        .and_then(|value| value.get("quick_unlock"))
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let last_sync = status
        .get("last_sync")
        .and_then(|value| value.as_str())
        .map(str::to_string)
        .or_else(|| auth_status.and_then(|value| value.last_sync));
    let engine_version = ping
        .as_ref()
        .and_then(|value| value.get("version"))
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let (items, reprompts) = if unlocked {
        real_items()
    } else {
        (Vec::new(), HashMap::new())
    };
    let rows: Vec<CipherRowView> = items
        .iter()
        .map(|item| {
            let reprompt = reprompts.get(&item.id).copied().unwrap_or(0);
            row_from_item(item, reprompt)
        })
        .collect();
    let ssh_prompt = daemon(json!({ "action": "ssh_agent_pending", "touch": false }))
        .and_then(|value| parse_prompt(&value, 0));
    let sanitized_server_url = sanitize_server_url(&server_url);
    let sanitized_identity_url = config.identity_url.as_deref().map(sanitize_server_url);
    if unlocked {
        if let Ok(mut guard) = cached_vault().lock() {
            *guard = Some(CachedVault {
                email: email.clone(),
                server_url: sanitized_server_url.clone(),
                identity_url: sanitized_identity_url.clone(),
                quick_unlock_ready,
                quick_unlock_usable: config.quick_unlock,
                last_sync: last_sync.clone(),
                engine_version: engine_version.clone(),
                items,
                rows: rows.clone(),
                reprompts,
            });
        }
    } else {
        clear_cached_vault();
    }
    build_snapshot(
        phase,
        email,
        sanitized_server_url,
        sanitized_identity_url,
        quick_unlock_ready,
        config.quick_unlock,
        None,
        None,
        rows,
        &filter,
        last_sync,
        None,
        ssh_prompt,
        engine_version,
    )
}

/// Parses the first pending SSH prompt.
fn parse_prompt(value: &Value, offset: usize) -> Option<SshPromptView> {
    let prompts = value.get("prompts")?.as_array()?;
    let prompt = prompts.get(offset)?;
    Some(SshPromptView {
        id: prompt.get("id").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
        title: prompt.get("title").and_then(|v| v.as_str()).unwrap_or("SSH request").to_string(),
        action: prompt.get("action").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        key_name: prompt.get("key_name").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        fingerprint: prompt.get("fingerprint").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        client: prompt.get("client").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        command: prompt.get("command").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
        forwarded: prompt.get("forwarded").and_then(|v| v.as_bool()).unwrap_or(false),
        remembered: prompt.get("remembered").and_then(|v| v.as_bool()).unwrap_or(false),
        remaining: prompts.len().saturating_sub(offset + 1) as u32,
    })
}

/// Builds an inspector from a real vault item.
fn vault_item_inspector(item: &VaultItem, reveal: &RevealStateInput, reprompt: u32) -> InspectorView {
    let login = item.login.as_ref();
    let username = login
        .and_then(|value| value.get("username"))
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let password = login
        .and_then(|value| value.get("password"))
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let totp_seed = login
        .and_then(|value| value.get("totp"))
        .and_then(|value| value.as_str());
    let uris = login
        .and_then(|value| value.get("uris"))
        .and_then(|value| value.as_array())
        .map(|array| {
            array
                .iter()
                .filter_map(|entry| entry.get("uri").and_then(|value| value.as_str()))
                .map(|uri| UriView {
                    uri: uri.to_string(),
                    host: url::Url::parse(uri)
                        .ok()
                        .and_then(|parsed| parsed.host_str().map(str::to_string))
                        .unwrap_or_else(|| uri.to_string()),
                })
                .collect()
        })
        .unwrap_or_default();
    let password_history = login
        .and_then(|value| value.get("passwordHistory"))
        .and_then(|value| value.as_array())
        .map(|array| {
            array
                .iter()
                .map(|entry| PasswordHistoryEntryView {
                    password: entry.get("password").and_then(|value| value.as_str()).unwrap_or_default().to_string(),
                    changed_at: entry.get("lastUsedDate").and_then(|value| value.as_str()).unwrap_or_default().to_string(),
                })
                .collect()
        })
        .unwrap_or_default();
    let card = item.card.as_ref().map(|card| {
        let field = |name: &str| card.get(name).and_then(|value| value.as_str()).unwrap_or_default().to_string();
        let number = field("number");
        let brand = field("brand");
        let code = field("code");
        CardView {
            cardholder_name: field("cardholderName"),
            brand: brand.clone(),
            number: if reveal.reveal_card_number { format_card_number_for(&number, &brand) } else { mask_card_number_for(&number, &brand) },
            number_masked: mask_card_number_for(&number, &brand),
            exp_month: field("expMonth"),
            exp_year: field("expYear"),
            expiration: format_expiration(&field("expMonth"), &field("expYear")),
            cvv: if reveal.reveal_cvv { code.clone() } else { mask_secret(&code) },
            cvv_masked: mask_secret(&code),
        }
    });
    let identity = item.identity.as_ref().map(|identity| {
        let field = |name: &str| identity.get(name).and_then(|value| value.as_str()).unwrap_or_default().to_string();
        IdentityView {
            full_name: field("firstName").trim().to_string() + " " + field("lastName").trim(),
            username: field("username"),
            company: field("company"),
            email: field("email"),
            phone: field("phone"),
            ssn: field("ssn"),
            passport_number: field("passportNumber"),
            license_number: field("licenseNumber"),
            address1: field("address1"),
            address2: field("address2"),
            address3: field("address3"),
            city: field("city"),
            state: field("state"),
            postal_code: field("postalCode"),
            country: field("country"),
        }
    });
    let ssh = item.ssh_key.as_ref().map(|ssh| SshKeyView {
        key_type: ssh.key_type.clone(),
        fingerprint: ssh.fingerprint.clone().unwrap_or_default(),
        public_key: ssh.public_key.clone().unwrap_or_default(),
        private_key: if reveal.reveal_private_key {
            ssh.private_key.clone().unwrap_or_default()
        } else {
            mask_secret(ssh.private_key.as_deref().unwrap_or(""))
        },
        private_key_masked: mask_secret(ssh.private_key.as_deref().unwrap_or("")),
    });
    let fields = item
        .fields
        .iter()
        .enumerate()
        .map(|(index, field)| {
            let index = index as u32;
            let name = field.get("name").and_then(|value| value.as_str()).unwrap_or_default().to_string();
            let value = field.get("value").and_then(|value| value.as_str()).unwrap_or_default().to_string();
            let field_type = field.get("type").and_then(|value| value.as_u64()).unwrap_or(0);
            let kind = match field_type {
                1 => "hidden",
                2 => "boolean",
                3 => "linked",
                _ => "text",
            };
            let hidden = kind == "hidden";
            let revealed = !hidden || reveal.reveal_fields.contains(&index);
            CustomFieldView {
                index,
                name,
                kind: kind.to_string(),
                value: if revealed { value.clone() } else { mask_secret(&value) },
                value_masked: mask_secret(&value),
            }
        })
        .collect();
    let attachments = item
        .attachments
        .iter()
        .map(|attachment| {
            let size = attachment.get("size").and_then(|value| value.as_u64()).unwrap_or(0);
            AttachmentView {
                id: attachment.get("id").and_then(|value| value.as_str()).unwrap_or_default().to_string(),
                filename: attachment.get("fileName").and_then(|value| value.as_str()).unwrap_or_default().to_string(),
                size,
                size_label: format_size(size),
            }
        })
        .collect();
    InspectorView {
        id: item.id.clone(),
        title: item.name.clone(),
        category: category_of(item),
        favorite: item.favorite,
        notes: item.notes.clone(),
        username,
        password: if reveal.reveal_password { password.clone() } else { None },
        password_masked: mask_secret(password.as_deref().unwrap_or("")),
        totp: totp_view(totp_seed),
        uris,
        card,
        identity,
        ssh,
        fields,
        attachments,
        password_history,
        metadata: MetadataView {
            folder: item.folder_name.clone().unwrap_or_default(),
            organization: item.organization_name.clone().unwrap_or_default(),
            created_at: item.created_at.clone().unwrap_or_default(),
            updated_at: item.updated_at.clone().unwrap_or_default(),
        },
        reprompt,
        error: None,
    }
}

/// An empty inspector carrying an error.
fn empty_inspector(cipher_id: &str, error: String) -> InspectorView {
    InspectorView {
        id: cipher_id.to_string(),
        title: String::new(),
        category: ItemCategory::Login,
        favorite: false,
        notes: None,
        username: None,
        password: None,
        password_masked: String::new(),
        totp: None,
        uris: Vec::new(),
        card: None,
        identity: None,
        ssh: None,
        fields: Vec::new(),
        attachments: Vec::new(),
        password_history: Vec::new(),
        metadata: MetadataView {
            folder: String::new(),
            organization: String::new(),
            created_at: String::new(),
            updated_at: String::new(),
        },
        reprompt: 0,
        error: Some(error),
    }
}

/// Parses an SSH algorithm name.
fn parse_ssh_algorithm(raw: &str) -> Result<omawarden::ssh::SshAlgorithm, String> {
    match raw.trim().to_lowercase().as_str() {
        "" | "ed25519" => Ok(omawarden::ssh::SshAlgorithm::Ed25519),
        "rsa-2048" | "rsa2048" => Ok(omawarden::ssh::SshAlgorithm::Rsa2048),
        "rsa-4096" | "rsa4096" => Ok(omawarden::ssh::SshAlgorithm::Rsa4096),
        "ecdsa-p256" | "p256" => Ok(omawarden::ssh::SshAlgorithm::EcdsaP256),
        "ecdsa-p384" | "p384" => Ok(omawarden::ssh::SshAlgorithm::EcdsaP384),
        other => Err(format!("Unknown SSH algorithm '{other}'.")),
    }
}

/// Builds a preview by generating or importing a key.
fn build_ssh_preview(mode: &str, algorithm: &str, comment: &str, private_key_pem: &str) -> SshKeyPreviewView {
    if mode == "import" {
        return match omawarden::ssh::parse_private_key(private_key_pem) {
            Ok(key) => SshKeyPreviewView {
                ok: true,
                mode: mode.to_string(),
                algorithm: key.algorithm_name,
                public_key: key.public_key,
                private_key: key.private_key,
                fingerprint: key.fingerprint,
                comment: comment.to_string(),
                error: None,
            },
            Err(error) => SshKeyPreviewView {
                ok: false,
                mode: mode.to_string(),
                algorithm: String::new(),
                public_key: String::new(),
                private_key: String::new(),
                fingerprint: String::new(),
                comment: comment.to_string(),
                error: Some(error),
            },
        };
    }
    let algorithm = match parse_ssh_algorithm(algorithm) {
        Ok(algorithm) => algorithm,
        Err(error) => {
            return SshKeyPreviewView {
                ok: false,
                mode: mode.to_string(),
                algorithm: String::new(),
                public_key: String::new(),
                private_key: String::new(),
                fingerprint: String::new(),
                comment: comment.to_string(),
                error: Some(error),
            };
        }
    };
    match omawarden::ssh::generate_keypair(algorithm, Some(comment).filter(|value| !value.is_empty())) {
        Ok(key) => SshKeyPreviewView {
            ok: true,
            mode: mode.to_string(),
            algorithm: key.algorithm_name,
            public_key: key.public_key,
            private_key: key.private_key,
            fingerprint: key.fingerprint,
            comment: comment.to_string(),
            error: None,
        },
        Err(error) => SshKeyPreviewView {
            ok: false,
            mode: mode.to_string(),
            algorithm: String::new(),
            public_key: String::new(),
            private_key: String::new(),
            fingerprint: String::new(),
            comment: comment.to_string(),
            error: Some(error),
        },
    }
}

/// Monotonic token that invalidates older clipboard-clear timers.
static CLIPBOARD_GENERATION: AtomicU64 = AtomicU64::new(0);

/// Copies text with the in-process clipboard guard.
///
/// `ClipboardManager` spawns `std::env::current_exe() clipboard-holder` when a
/// timeout is passed. Inside an nsh host that executable is the GUI binary, so
/// the copy is made without a timeout and a Rust timer clears the clipboard
/// after `clipboard_clear_seconds` unless a newer copy superseded it.
fn clipboard_copy(text: &str, sensitive: bool) -> bool {
    let config = load_config();
    let copied = omawarden::clipboard::ClipboardManager::default().copy(text, sensitive, 0);
    if copied && sensitive && config.clipboard_clear_seconds > 0 {
        let generation = CLIPBOARD_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
        let seconds = config.clipboard_clear_seconds as u64;
        let _ = std::thread::Builder::new()
            .name("omawarden-clipboard-guard".into())
            .spawn(move || {
                std::thread::sleep(Duration::from_secs(seconds));
                if CLIPBOARD_GENERATION.load(Ordering::SeqCst) == generation {
                    let _ = Command::new("wl-copy")
                        .arg("--clear")
                        .stdin(Stdio::null())
                        .stdout(Stdio::null())
                        .stderr(Stdio::null())
                        .status();
                }
            });
    }
    copied
}

/// The toast for a successful copy, naming what was copied and its clipboard TTL.
fn clipboard_message(label: &str, sensitive: bool, ttl: u32) -> String {
    if sensitive && ttl > 0 {
        format!("Copied {label} to clipboard (clears in {ttl}s).")
    } else {
        format!("Copied {label} to clipboard.")
    }
}

// ---------------------------------------------------------------------------
// The native module
// ---------------------------------------------------------------------------

/// Native bridge connecting the Omawarden NSH frontend to the omawarden Rust engine and daemon.
#[module]
pub struct OmawardenBridge;

#[module]
impl OmawardenBridge {
    /// Enable or disable deterministic in-memory mock mode for headless UI tests.
    pub fn set_mock_mode(enabled: bool) -> bool {
        with_mock(|state| {
            state.enabled = enabled;
            enabled
        })
    }

    /// Seed mock state (phase, quick unlock, dependencies, SSH prompt, items) for tests.
    pub fn configure_mock_state(state_json: String) -> VaultSnapshotView {
        with_mock(|state| {
            state.enabled = true;
            let mut fresh = MockState::default();
            fresh.enabled = true;
            match serde_json::from_str::<Value>(&state_json) {
                Ok(value) => configure_mock_from_json(&mut fresh, &value),
                Err(error) => fresh.error = Some(format!("Invalid mock state JSON: {error}")),
            }
            *state = fresh;
            state.snapshot()
        })
    }

    /// Initialize the app or handle an external summon payload (e.g. `{"view":"ssh-approval","id":1}`).
    pub fn boot(payload_json: Option<String>) -> VaultSnapshotView {
        #[cfg(target_os = "linux")]
        configure_linux_renderer();
        let payload = payload_json
            .as_deref()
            .and_then(|raw| serde_json::from_str::<Value>(raw).ok());
        if with_mock(|state| state.enabled) {
            return with_mock(|state| {
                if let Some(payload) = &payload {
                    let view = payload.get("view").and_then(|value| value.as_str());
                    if view == Some("ssh-approval") {
                        state.phase = AppPhase::Unlocked;
                        if state.ssh_prompt.is_none() {
                            state.ssh_prompt = Some(SshPromptView {
                                id: payload.get("id").and_then(|value| value.as_u64()).unwrap_or(1) as u32,
                                title: "Sign a Git commit?".to_string(),
                                action: "SSH login as git@github.com".to_string(),
                                key_name: "GitHub".to_string(),
                                fingerprint: "SHA256:mock".to_string(),
                                client: "git (ssh)".to_string(),
                                command: "git push".to_string(),
                                forwarded: false,
                                remembered: true,
                                remaining: 0,
                            });
                        }
                    }
                }
                state.snapshot()
            });
        }
        real_snapshot(VaultFilterInput::default())
    }

    /// Re-check system dependencies (omawarden, libsecret, wl-clipboard, libfido2).
    pub fn check_dependencies() -> DependencyStatusView {
        if with_mock(|state| state.enabled) {
            return with_mock(|state| mock_dependencies(&state.dependencies_missing));
        }
        real_dependencies()
    }

    /// Launch a floating terminal to install missing system packages.
    pub fn install_missing_dependencies(packages: Vec<String>) -> bool {
        let safe: Vec<String> = packages
            .into_iter()
            .filter(|package| {
                !package.is_empty()
                    && package
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '+'))
            })
            .collect();
        if safe.is_empty() {
            return false;
        }
        if with_mock(|state| state.enabled) {
            return true;
        }
        let command = format!("sudo pacman -S --noconfirm {}", safe.join(" "));
        for terminal in ["omarchy-launch-floating-terminal-with-presentation", "alacritty", "foot", "kitty"] {
            let Ok(path) = which::which(terminal) else { continue };
            let mut process = Command::new(path);
            if terminal == "omarchy-launch-floating-terminal-with-presentation" {
                process.arg("sh").arg("-c").arg(&command);
            } else {
                process.arg("-e").arg("sh").arg("-c").arg(&command);
            }
            if process.stdin(Stdio::null()).spawn().is_ok() {
                return true;
            }
        }
        false
    }

    /// Authenticate or unlock the vault (password, API key, 2FA, OTP, master password, quick unlock).
    pub fn authenticate(mut input: AuthActionInput) -> VaultSnapshotView {
        // A blank new-device code must reach the engine as `None`; `Some("")`
        // makes it skip the two-factor token and provider entirely, which is
        // what broke FIDO2 assertions after a successful key touch.
        input.new_device_otp = normalize_optional_code(input.new_device_otp);
        if with_mock(|state| state.enabled) {
            return with_mock(|state| {
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
                                "Security key error: the new-device code shadowed the assertion."
                                    .to_string(),
                            );
                        } else if !fido2
                            && input.code.trim().is_empty()
                            && input.new_device_otp.is_none()
                        {
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
                            state.error = Some("Quick unlock is not available. Use your master password.".to_string());
                        }
                    }
                }
                state.snapshot()
            });
        }

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
                serde_json::from_value::<omawarden::auth::AuthResult>(response).unwrap_or_else(
                    |_| omawarden::auth::AuthResult {
                        ok: false,
                        status: Some("locked".to_string()),
                        error: Some(
                            "The Omawarden daemon returned an unreadable response.".to_string(),
                        ),
                        ..Default::default()
                    },
                )
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

    /// Send two-factor verification email.
    pub fn send_two_factor_email(email: String, password: String) -> ActionOutcomeView {
        if with_mock(|state| state.enabled) {
            if email.trim().is_empty() {
                return ActionOutcomeView {
                    ok: false,
                    message: "Email is required.".to_string(),
                    error: Some("Email is required.".to_string()),
                };
            }
            return ActionOutcomeView {
                ok: true,
                message: "Verification email sent.".to_string(),
                error: None,
            };
        }
        match auth_manager().send_two_factor_email(&email, &password) {
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

    /// Lock or log out of the current vault session, purging sensitive state and preview files.
    pub fn lock_or_logout(logout: bool) -> VaultSnapshotView {
        if with_mock(|state| state.enabled) {
            return with_mock(|state| {
                state.phase = if logout { AppPhase::Login } else { AppPhase::Locked };
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
            });
        }
        let auth = auth_manager();
        let _ = if logout { auth.logout() } else { auth.lock() };
        clear_cached_vault();
        omawarden::attachment::clear_preview_attachments(None);
        real_snapshot(VaultFilterInput::default())
    }

    /// Query, fuzzy-score, and filter the unlocked vault by search text, scope, folder, and category.
    pub fn query_vault(filter: VaultFilterInput) -> VaultSnapshotView {
        if with_mock(|state| state.enabled) {
            return with_mock(|state| {
                state.filter = filter;
                state.error = None;
                state.snapshot()
            });
        }
        if let Some(snapshot) = cached_snapshot(&filter, None) {
            return snapshot;
        }
        real_snapshot(filter)
    }

    /// Synchronize the vault with the Bitwarden server and return the updated snapshot.
    pub fn sync_vault(filter: VaultFilterInput) -> VaultSnapshotView {
        if with_mock(|state| state.enabled) {
            return with_mock(|state| {
                state.filter = filter;
                match state.sync_error.clone() {
                    Some(error) => state.error = Some(error),
                    None => {
                        state.last_sync =
                            Some(chrono::Local::now().format("%Y-%m-%d %H:%M").to_string());
                        state.error = None;
                    }
                }
                state.snapshot()
            });
        }
        push_log("vault sync requested");
        ensure_app_daemon_running();
        let response = daemon(json!({ "action": "sync", "touch": true }));
        let failure = match response {
            Some(response) if response.get("ok").and_then(|value| value.as_bool()) == Some(true) => {
                None
            }
            Some(response) => Some(
                response
                    .get("error")
                    .and_then(|value| value.as_str())
                    .map(str::to_string)
                    .unwrap_or_else(|| "Sync failed.".to_string()),
            ),
            None => Some("The Omawarden daemon is not running.".to_string()),
        };
        let Some(error) = failure else {
            // Only replace the cache once the daemon reports a successful sync.
            return real_snapshot(filter);
        };
        // Keep the unlocked view and surface the failure instead of locking.
        if let Some(snapshot) = cached_snapshot(&filter, Some(error.clone())) {
            return snapshot;
        }
        let mut snapshot = real_snapshot(filter);
        snapshot.error = Some(error);
        snapshot
    }

    /// Inspect a specific cipher item, computing masked/revealed fields, TOTP state, and actions.
    pub fn inspect_cipher(cipher_id: String, reveal: RevealStateInput) -> InspectorView {
        if with_mock(|state| state.enabled) {
            return with_mock(|state| {
                match state.items.iter().find(|item| item.id == cipher_id) {
                    Some(item) => {
                        state.selected_cipher_id = Some(cipher_id.clone());
                        item.inspector(&reveal)
                    }
                    None => empty_inspector(&cipher_id, format!("Item '{cipher_id}' was not found.")),
                }
            });
        }
        if let Ok(guard) = cached_vault().lock() {
            if let Some(cached) = guard.as_ref() {
                if let Some(item) = cached.items.iter().find(|item| item.id == cipher_id) {
                    let reprompt = cached.reprompts.get(&item.id).copied().unwrap_or(0);
                    return vault_item_inspector(item, &reveal, reprompt);
                }
            }
        }
        let response = daemon(json!({ "action": "get_item", "query": cipher_id, "touch": false }));
        let Some(response) = response else {
            return empty_inspector(&cipher_id, "The Omawarden daemon is not running.".to_string());
        };
        if response.get("ok").and_then(|value| value.as_bool()) != Some(true) {
            return empty_inspector(
                &cipher_id,
                response
                    .get("error")
                    .and_then(|value| value.as_str())
                    .unwrap_or("Item not found.")
                    .to_string(),
            );
        }
        let reprompt = response
            .get("item")
            .and_then(|item| item.get("reprompt"))
            .and_then(Value::as_u64)
            .unwrap_or(0) as u32;
        match response.get("item").cloned().and_then(|value| serde_json::from_value::<VaultItem>(value).ok()) {
            Some(item) => vault_item_inspector(&item, &reveal, reprompt),
            None => empty_inspector(&cipher_id, "Could not read the vault item.".to_string()),
        }
    }

    /// Compute live TOTP code and remaining TTL for a cipher item.
    pub fn refresh_totp(cipher_id: String) -> TotpLiveView {
        if with_mock(|state| state.enabled) {
            return with_mock(|state| {
                let Some(item) = state.items.iter().find(|item| item.id == cipher_id) else {
                    return TotpLiveView {
                        valid: false,
                        code: String::new(),
                        formatted: String::new(),
                        remaining: 0,
                        period: 30,
                        error: Some("Item has no TOTP configured.".to_string()),
                    };
                };
                let mut view = totp_view(item.totp.as_deref()).unwrap_or_else(|| TotpLiveView {
                    valid: false,
                    code: String::new(),
                    formatted: String::new(),
                    remaining: 0,
                    period: 30,
                    error: Some("Item has no TOTP configured.".to_string()),
                });
                // A seeded period makes the auto-refresh deterministic in tests:
                // the next code starts a fresh period.
                if let Some(period) = item.totp_period {
                    view.period = period;
                    view.remaining = period;
                }
                view
            });
        }
        if let Ok(guard) = cached_vault().lock() {
            if let Some(cached) = guard.as_ref() {
                if let Some(item) = cached.items.iter().find(|item| item.id == cipher_id) {
                    let seed = item
                        .login
                        .as_ref()
                        .and_then(|login| login.get("totp"))
                        .and_then(|value| value.as_str());
                    return totp_view(seed).unwrap_or_else(|| TotpLiveView {
                        valid: false,
                        code: String::new(),
                        formatted: String::new(),
                        remaining: 0,
                        period: 30,
                        error: Some("Item has no TOTP configured.".to_string()),
                    });
                }
            }
        }
        let response = daemon(json!({ "action": "totp", "query": cipher_id, "touch": false }));
        let Some(response) = response else {
            return TotpLiveView {
                valid: false,
                code: String::new(),
                formatted: String::new(),
                remaining: 0,
                period: 30,
                error: Some("The Omawarden daemon is not running.".to_string()),
            };
        };
        if response.get("ok").and_then(|value| value.as_bool()) != Some(true) {
            return TotpLiveView {
                valid: false,
                code: String::new(),
                formatted: String::new(),
                remaining: 0,
                period: 30,
                error: response
                    .get("error")
                    .and_then(|value| value.as_str())
                    .map(str::to_string)
                    .or_else(|| Some("No TOTP code is available.".to_string())),
            };
        }
        let code = response.get("code").and_then(|value| value.as_str()).unwrap_or_default().to_string();
        TotpLiveView {
            valid: !code.is_empty(),
            formatted: format!("{} {}", &code[..3.min(code.len())], &code[3.min(code.len())..]),
            code,
            remaining: response.get("ttl").and_then(|value| value.as_u64()).unwrap_or(0) as u32,
            period: response.get("period").and_then(|value| value.as_u64()).unwrap_or(30) as u32,
            error: None,
        }
    }

    /// Copy a specific field of a cipher item to the Wayland clipboard with Clipboard Guard TTL.
    pub fn copy_cipher_field(cipher_id: String, field: String, custom_index: Option<u32>) -> CopyOutcomeView {
        if with_mock(|state| state.enabled) {
            return with_mock(|state| {
                let Some(item) = state.items.iter().find(|item| item.id == cipher_id) else {
                    return CopyOutcomeView {
                        ok: false,
                        label: field.clone(),
                        message: "Item not found.".to_string(),
                        sensitive: false,
                        cleared_after_seconds: 0,
                        error: Some("Item not found.".to_string()),
                    };
                };
                let (text, sensitive, label) = match field.as_str() {
                    "username" => (item.username.clone().unwrap_or_default(), false, "username"),
                    "password" => (item.password.clone().unwrap_or_default(), true, "password"),
                    "totp" => (
                        totp_view(item.totp.as_deref())
                            .map(|view| view.code)
                            .unwrap_or_default(),
                        true,
                        "TOTP code",
                    ),
                    "card_number" => (
                        item.card
                            .as_ref()
                            .map(|card| card.number.clone())
                            .unwrap_or_default(),
                        true,
                        "card number",
                    ),
                    "cvv" => (
                        item.card
                            .as_ref()
                            .map(|card| card.code.clone())
                            .unwrap_or_default(),
                        true,
                        "card security code",
                    ),
                    "private_key" => (
                        item.ssh
                            .as_ref()
                            .map(|ssh| ssh.private_key.clone())
                            .unwrap_or_default(),
                        true,
                        "private key",
                    ),
                    "public_key" => (
                        item.ssh
                            .as_ref()
                            .map(|ssh| ssh.public_key.clone())
                            .unwrap_or_default(),
                        false,
                        "public key",
                    ),
                    "notes" => (item.notes.clone().unwrap_or_default(), true, "secure note"),
                    "custom" => {
                        let index = custom_index.unwrap_or(0) as usize;
                        match item.fields.get(index) {
                            Some(entry) => (
                                entry.value.clone(),
                                entry.kind == "hidden",
                                entry.name.as_str(),
                            ),
                            None => (String::new(), false, "custom field"),
                        }
                    }
                    _ => (String::new(), false, "value"),
                };
                if text.is_empty() {
                    return CopyOutcomeView {
                        ok: false,
                        label: field,
                        message: "Nothing to copy.".to_string(),
                        sensitive,
                        cleared_after_seconds: 0,
                        error: Some("Nothing to copy.".to_string()),
                    };
                }
                let ttl = if sensitive {
                    state.settings.clipboard_clear_seconds.max(0) as u32
                } else {
                    0
                };
                CopyOutcomeView {
                    ok: true,
                    label: field,
                    message: clipboard_message(label, sensitive, ttl),
                    sensitive,
                    cleared_after_seconds: ttl,
                    error: None,
                }
            });
        }
        let cached_item = cached_vault().lock().ok().and_then(|guard| {
            guard
                .as_ref()
                .and_then(|cached| cached.items.iter().find(|item| item.id == cipher_id).cloned())
        });
        let item = match cached_item {
            Some(item) => item,
            None => {
                let response = daemon(json!({ "action": "get_item", "query": cipher_id, "touch": false }));
                let Some(response) = response else {
                    return CopyOutcomeView {
                        ok: false,
                        label: field.clone(),
                        message: "The Omawarden daemon is not running.".to_string(),
                        sensitive: false,
                        cleared_after_seconds: 0,
                        error: Some("The Omawarden daemon is not running.".to_string()),
                    };
                };
                let Some(item) = response
                    .get("item")
                    .cloned()
                    .and_then(|value| serde_json::from_value::<VaultItem>(value).ok())
                else {
                    return CopyOutcomeView {
                        ok: false,
                        label: field.clone(),
                        message: "Item not found.".to_string(),
                        sensitive: false,
                        cleared_after_seconds: 0,
                        error: Some("Item not found.".to_string()),
                    };
                };
                item
            }
        };
        let (text, sensitive, label) = match field.as_str() {
            "username" => (
                item.login
                    .as_ref()
                    .and_then(|login| login.get("username"))
                    .and_then(|value| value.as_str())
                    .unwrap_or_default()
                    .to_string(),
                false,
                "username",
            ),
            "password" => (
                item.login
                    .as_ref()
                    .and_then(|login| login.get("password"))
                    .and_then(|value| value.as_str())
                    .unwrap_or_default()
                    .to_string(),
                true,
                "password",
            ),
            "totp" => {
                let seed = item
                    .login
                    .as_ref()
                    .and_then(|login| login.get("totp"))
                    .and_then(|value| value.as_str());
                (
                    totp_view(seed).map(|view| view.code).unwrap_or_default(),
                    true,
                    "TOTP code",
                )
            }
            "card_number" => (
                item.card
                    .as_ref()
                    .and_then(|card| card.get("number"))
                    .and_then(|value| value.as_str())
                    .unwrap_or_default()
                    .to_string(),
                true,
                "card number",
            ),
            "cvv" => (
                item.card
                    .as_ref()
                    .and_then(|card| card.get("code"))
                    .and_then(|value| value.as_str())
                    .unwrap_or_default()
                    .to_string(),
                true,
                "card security code",
            ),
            "private_key" => (
                item.ssh_key
                    .as_ref()
                    .and_then(|ssh| ssh.private_key.clone())
                    .unwrap_or_default(),
                true,
                "private key",
            ),
            "public_key" => (
                item.ssh_key
                    .as_ref()
                    .and_then(|ssh| ssh.public_key.clone())
                    .unwrap_or_default(),
                false,
                "public key",
            ),
            "notes" => (item.notes.clone().unwrap_or_default(), true, "secure note"),
            "custom" => {
                let index = custom_index.unwrap_or(0) as usize;
                match item.fields.get(index) {
                    Some(entry) => (
                        entry
                            .get("value")
                            .and_then(|value| value.as_str())
                            .unwrap_or_default()
                            .to_string(),
                        entry.get("type").and_then(|value| value.as_u64()) == Some(1),
                        entry
                            .get("name")
                            .and_then(|value| value.as_str())
                            .unwrap_or("custom field"),
                    ),
                    None => (String::new(), false, "custom field"),
                }
            }
            _ => (String::new(), false, "value"),
        };
        if text.is_empty() {
            return CopyOutcomeView {
                ok: false,
                label: field.clone(),
                message: "Nothing to copy.".to_string(),
                sensitive,
                cleared_after_seconds: 0,
                error: Some("Nothing to copy.".to_string()),
            };
        }
        let config = load_config();
        let ok = clipboard_copy(&text, sensitive);
        let ttl = if sensitive {
            config.clipboard_clear_seconds.max(0) as u32
        } else {
            0
        };
        CopyOutcomeView {
            ok,
            label: field,
            message: if ok {
                clipboard_message(label, sensitive, ttl)
            } else {
                "Could not access the clipboard.".to_string()
            },
            sensitive,
            cleared_after_seconds: ttl,
            error: if ok { None } else { Some("Could not access the clipboard.".to_string()) },
        }
    }

    /// Copy arbitrary text to the clipboard with optional sensitivity flag.
    pub fn copy_text(text: String, label: String, sensitive: bool) -> CopyOutcomeView {
        if with_mock(|state| state.enabled) {
            return with_mock(|state| {
                let ttl = if sensitive {
                    state.settings.clipboard_clear_seconds.max(0) as u32
                } else {
                    0
                };
                CopyOutcomeView {
                    ok: true,
                    message: clipboard_message(&label, sensitive, ttl),
                    label,
                    sensitive,
                    cleared_after_seconds: ttl,
                    error: None,
                }
            });
        }
        let config = load_config();
        let ok = clipboard_copy(&text, sensitive);
        let ttl = if sensitive {
            config.clipboard_clear_seconds.max(0) as u32
        } else {
            0
        };
        CopyOutcomeView {
            ok,
            message: if ok {
                clipboard_message(&label, sensitive, ttl)
            } else {
                "Could not access the clipboard.".to_string()
            },
            label,
            sensitive,
            cleared_after_seconds: ttl,
            error: if ok { None } else { Some("Could not access the clipboard.".to_string()) },
        }
    }

    /// Preview or download an encrypted attachment (`0600` permissions in `$XDG_RUNTIME_DIR`).
    pub fn open_attachment(cipher_id: String, attachment_id: String, mode: String) -> AttachmentOutcomeView {
        if with_mock(|state| state.enabled) {
            return with_mock(|state| {
                let attachment = state
                    .items
                    .iter()
                    .find(|item| item.id == cipher_id)
                    .and_then(|item| item.attachments.iter().find(|attachment| attachment.id == attachment_id));
                match attachment {
                    Some(attachment) => {
                        let is_image = matches!(
                            attachment.filename.rsplit('.').next().unwrap_or_default().to_lowercase().as_str(),
                            "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg"
                        );
                        let is_text = matches!(
                            attachment.filename.rsplit('.').next().unwrap_or_default().to_lowercase().as_str(),
                            "txt" | "md" | "json" | "log" | "csv"
                        );
                        AttachmentOutcomeView {
                            ok: true,
                            path: Some(format!("/run/user/1000/omawarden/{}", attachment.filename)),
                            filename: Some(attachment.filename.clone()),
                            is_image,
                            is_text,
                            text_content: if is_text { Some("Mock attachment preview".to_string()) } else { None },
                            preview_data_url: if is_image {
                                Some(
                                    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
                                        .to_string(),
                                )
                            } else {
                                None
                            },
                            size: attachment.size,
                            error: None,
                        }
                    }
                    None => AttachmentOutcomeView {
                        ok: false,
                        path: None,
                        filename: None,
                        is_image: false,
                        is_text: false,
                        text_content: None,
                        preview_data_url: None,
                        size: 0,
                        error: Some("Attachment not found.".to_string()),
                    },
                }
            });
        }
        let config = load_config();
        // `get_attachment` calls `ensure_daemon_running` internally. Only call
        // it while the daemon reports unlocked, so that check never has to
        // replace a locked daemon by spawning the nsh host as one.
        let ping = daemon(json!({ "action": "ping", "touch": false }));
        let unlocked = ping
            .as_ref()
            .and_then(|value| value.get("unlocked"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if !unlocked {
            return AttachmentOutcomeView {
                ok: false,
                path: None,
                filename: None,
                is_image: false,
                is_text: false,
                text_content: None,
                preview_data_url: None,
                size: 0,
                error: Some("Unlock the vault before opening attachments.".to_string()),
            };
        }
        let filename = daemon(json!({ "action": "get_item", "query": cipher_id, "touch": false }))
            .and_then(|value| {
                value
                    .get("item")
                    .and_then(|item| item.get("attachments"))
                    .and_then(|attachments| attachments.as_array())
                    .and_then(|attachments| {
                        attachments.iter().find(|attachment| {
                            attachment.get("id").and_then(|value| value.as_str()) == Some(attachment_id.as_str())
                        })
                    })
                    .and_then(|attachment| attachment.get("fileName"))
                    .and_then(|value| value.as_str())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "attachment".to_string());
        let response = omawarden::attachment::get_attachment(
            &cipher_id,
            &attachment_id,
            &filename,
            Some(&config.download_dir),
            mode == "open",
            mode == "preview",
            None,
            None,
            false,
        );
        let is_image = response.is_image.unwrap_or(false);
        let preview_data_url = if mode == "preview" && is_image {
            attachment_image_data_url(response.path.as_deref(), response.filename.as_deref())
        } else {
            None
        };
        AttachmentOutcomeView {
            ok: response.ok,
            path: response.path,
            filename: response.filename,
            is_image,
            is_text: response.is_text.unwrap_or(false),
            text_content: response.text_content,
            preview_data_url,
            size: response.size.unwrap_or(0),
            error: response.error,
        }
    }

    /// Clean up temporary decrypted attachment previews.
    pub fn clean_attachment_previews(cipher_id: Option<String>) -> bool {
        if with_mock(|state| state.enabled) {
            return true;
        }
        omawarden::attachment::clear_preview_attachments(cipher_id.as_deref());
        true
    }

    /// Download an attachment to the destination chosen by the user.
    pub fn save_attachment(
        cipher_id: String,
        attachment_id: String,
        destination: String,
    ) -> AttachmentOutcomeView {
        if with_mock(|state| state.enabled) {
            return with_mock(|state| {
                let attachment = state
                    .items
                    .iter()
                    .find(|item| item.id == cipher_id)
                    .and_then(|item| item.attachments.iter().find(|entry| entry.id == attachment_id));
                match attachment {
                    Some(attachment) => AttachmentOutcomeView {
                        ok: true,
                        path: Some(destination.clone()),
                        filename: Some(attachment.filename.clone()),
                        is_image: false,
                        is_text: false,
                        text_content: None,
                        preview_data_url: None,
                        size: attachment.size,
                        error: None,
                    },
                    None => AttachmentOutcomeView {
                        ok: false,
                        path: None,
                        filename: None,
                        is_image: false,
                        is_text: false,
                        text_content: None,
                        preview_data_url: None,
                        size: 0,
                        error: Some("Attachment not found.".to_string()),
                    },
                }
            });
        }
        let destination = PathBuf::from(destination.trim());
        if destination.as_os_str().is_empty() || !destination.is_absolute() {
            return AttachmentOutcomeView {
                ok: false,
                path: None,
                filename: None,
                is_image: false,
                is_text: false,
                text_content: None,
                preview_data_url: None,
                size: 0,
                error: Some("Choose an absolute destination path.".to_string()),
            };
        }
        let directory = destination
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("."));
        if !directory.is_dir() {
            return AttachmentOutcomeView {
                ok: false,
                path: None,
                filename: None,
                is_image: false,
                is_text: false,
                text_content: None,
                preview_data_url: None,
                size: 0,
                error: Some("The destination folder does not exist.".to_string()),
            };
        }
        let filename = daemon(json!({ "action": "get_item", "query": cipher_id, "touch": false }))
            .and_then(|value| {
                value
                    .get("item")
                    .and_then(|item| item.get("attachments"))
                    .and_then(|attachments| attachments.as_array())
                    .and_then(|attachments| {
                        attachments.iter().find(|attachment| {
                            attachment.get("id").and_then(Value::as_str)
                                == Some(attachment_id.as_str())
                        })
                    })
                    .and_then(|attachment| attachment.get("fileName"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "attachment".to_string());
        let response = omawarden::attachment::get_attachment(
            &cipher_id,
            &attachment_id,
            &filename,
            directory.to_str(),
            false,
            false,
            None,
            None,
            false,
        );
        if !response.ok {
            return AttachmentOutcomeView {
                ok: false,
                path: None,
                filename: response.filename,
                is_image: false,
                is_text: false,
                text_content: None,
                preview_data_url: None,
                size: response.size.unwrap_or(0),
                error: response.error,
            };
        }
        let source = response.path.clone().map(PathBuf::from);
        if let Some(source) = source {
            if source != destination {
                if let Err(error) = std::fs::rename(&source, &destination) {
                    return AttachmentOutcomeView {
                        ok: false,
                        path: None,
                        filename: response.filename,
                        is_image: false,
                        is_text: false,
                        text_content: None,
                        preview_data_url: None,
                        size: response.size.unwrap_or(0),
                        error: Some(format!("Could not write the attachment: {error}")),
                    };
                }
            }
        }
        push_log(format!("attachment saved to {}", destination.display()));
        AttachmentOutcomeView {
            ok: true,
            path: Some(destination.display().to_string()),
            filename: response.filename,
            is_image: response.is_image.unwrap_or(false),
            is_text: response.is_text.unwrap_or(false),
            text_content: None,
            preview_data_url: None,
            size: response.size.unwrap_or(0),
            error: None,
        }
    }

    /// Open a decrypted attachment preview in the system viewer.
    pub fn open_attachment_path(path: String) -> bool {
        if with_mock(|state| state.enabled) {
            return true;
        }
        let candidate = PathBuf::from(path.trim());
        if !candidate.is_absolute() || !candidate.is_file() {
            return false;
        }
        let runtime = std::env::var("XDG_RUNTIME_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("/tmp"))
            .join("omawarden");
        let download = PathBuf::from(load_config().download_dir);
        if !candidate.starts_with(&runtime) && !candidate.starts_with(&download) {
            return false;
        }
        Command::new("xdg-open")
            .arg(candidate)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .is_ok()
    }

    /// Generate a random password with strict range validation (5..=128) and entropy calculation.
    pub fn generate_password(input: PasswordGenInput) -> GeneratedSecretView {
        if !(5..=128).contains(&input.length) {
            return GeneratedSecretView {
                ok: false,
                value: String::new(),
                entropy: 0.0,
                strength: "Weak".to_string(),
                error: Some(ERR_PASSWORD_LENGTH.to_string()),
            };
        }
        let options = PasswordOptions {
            length: input.length as usize,
            uppercase: input.uppercase,
            lowercase: input.lowercase,
            numbers: input.numbers,
            special: input.special,
            avoid_ambiguous: input.avoid_ambiguous,
            min_numbers: input.min_numbers as usize,
            min_special: input.min_special as usize,
        };
        match generate_password(&options) {
            Ok(secret) => GeneratedSecretView {
                ok: true,
                value: secret.value.clone(),
                entropy: secret.entropy,
                strength: strength_label(secret.entropy).to_string(),
                error: None,
            },
            Err(error) => GeneratedSecretView {
                ok: false,
                value: String::new(),
                entropy: 0.0,
                strength: "Weak".to_string(),
                error: Some(error),
            },
        }
    }

    /// Generate an EFF Diceware passphrase with strict word count validation (3..=20) and entropy.
    pub fn generate_passphrase(input: PassphraseGenInput) -> GeneratedSecretView {
        if !(3..=20).contains(&input.words) {
            return GeneratedSecretView {
                ok: false,
                value: String::new(),
                entropy: 0.0,
                strength: "Weak".to_string(),
                error: Some(ERR_PASSPHRASE_WORDS.to_string()),
            };
        }
        let separator = if input.separator.is_empty() { "-".to_string() } else { input.separator.clone() };
        let options = PassphraseOptions {
            words: input.words as usize,
            separator,
            capitalize: input.capitalize,
        };
        match generate_passphrase(&options) {
            Ok(secret) => GeneratedSecretView {
                ok: true,
                value: secret.value.clone(),
                entropy: secret.entropy,
                strength: strength_label(secret.entropy).to_string(),
                error: None,
            },
            Err(error) => GeneratedSecretView {
                ok: false,
                value: String::new(),
                entropy: 0.0,
                strength: "Weak".to_string(),
                error: Some(error),
            },
        }
    }

    /// Generate or import an SSH keypair without saving yet (for live preview in SshKeyModal).
    pub fn preview_ssh_key(mode: String, algorithm: String, comment: String, private_key_pem: String) -> SshKeyPreviewView {
        let mode = if mode == "import" { "import" } else { "create" };
        build_ssh_preview(mode, &algorithm, &comment, &private_key_pem)
    }

    /// Save a generated or imported SSH key to the Bitwarden vault or export it to `~/.ssh`.
    pub fn save_ssh_key(input: SshKeySaveInput, _filter: VaultFilterInput) -> SshKeySaveOutcomeView {
        let mode = match input.mode {
            SshKeyMode::Import => "import",
            _ => "create",
        };
        let preview = build_ssh_preview(mode, &input.algorithm, &input.comment, &input.private_key_pem);
        if !preview.ok {
            return SshKeySaveOutcomeView {
                ok: false,
                message: "Could not prepare the SSH key.".to_string(),
                path: None,
                item_id: None,
                error: preview.error,
            };
        }
        if with_mock(|state| state.enabled) {
            let filename = if input.filename.trim().is_empty() {
                "id_ed25519".to_string()
            } else {
                input.filename.trim().to_string()
            };
            let export_dir = input
                .export_dir
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("~/.ssh");
            return SshKeySaveOutcomeView {
                ok: true,
                message: if input.export_to_ssh {
                    format!("Exported to {export_dir}/{filename}")
                } else {
                    "Saved SSH key to the vault.".to_string()
                },
                path: if input.export_to_ssh { Some(format!("{export_dir}/{filename}")) } else { None },
                item_id: if input.save_to_vault { Some("mock-ssh-item".to_string()) } else { None },
                error: None,
            };
        }
        if input.export_to_ssh {
            let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
            let ssh_dir = input
                .export_dir
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(expand_home)
                .unwrap_or_else(|| PathBuf::from(&home).join(".ssh"));
            let base = if input.filename.trim().is_empty() {
                match parse_ssh_algorithm(&input.algorithm) {
                    Ok(algorithm) => algorithm.default_filename_prefix().to_string(),
                    Err(_) => "id_ed25519".to_string(),
                }
            } else {
                input.filename.trim().to_string()
            };
            let private_name = base.clone();
            let public_name = format!("{base}.pub");
            match omawarden::ssh::write_keypair_files_named(
                &ssh_dir,
                &private_name,
                &public_name,
                &preview.private_key,
                &preview.public_key,
            ) {
                Ok((private_path, _)) => {
                    return SshKeySaveOutcomeView {
                        ok: true,
                        message: format!("Exported to {}", private_path.display()),
                        path: Some(private_path.to_string_lossy().into_owned()),
                        item_id: None,
                        error: None,
                    };
                }
                Err(error) => {
                    return SshKeySaveOutcomeView {
                        ok: false,
                        message: "Could not export the SSH key.".to_string(),
                        path: None,
                        item_id: None,
                        error: Some(error.to_string()),
                    };
                }
            }
        }
        let name = if input.name.trim().is_empty() {
            input.comment.trim().to_string()
        } else {
            input.name.trim().to_string()
        };
        let response = daemon(json!({
            "action": "ssh_key_create",
            "name": name,
            "private_key": preview.private_key,
            "public_key": preview.public_key,
            "fingerprint": preview.fingerprint,
            "notes": input.comment,
            "touch": true,
        }));
        match response {
            Some(response) if response.get("ok").and_then(|value| value.as_bool()) == Some(true) => {
                clear_cached_vault();
                SshKeySaveOutcomeView {
                    ok: true,
                    message: "Saved SSH key to the vault.".to_string(),
                    path: None,
                    item_id: response
                        .get("item")
                        .and_then(|item| item.get("id"))
                        .and_then(|value| value.as_str())
                        .map(str::to_string),
                    error: None,
                }
            }
            Some(response) => SshKeySaveOutcomeView {
                ok: false,
                message: "Could not save the SSH key.".to_string(),
                path: None,
                item_id: None,
                error: response.get("error").and_then(|value| value.as_str()).map(str::to_string),
            },
            None => SshKeySaveOutcomeView {
                ok: false,
                message: "The Omawarden daemon is not running.".to_string(),
                path: None,
                item_id: None,
                error: Some("The Omawarden daemon is not running.".to_string()),
            },
        }
    }

    /// Poll background daemon status (`touch: false`), pending SSH approval prompts, and active TOTP.
    pub fn poll_daemon_tick(active_cipher_id: Option<String>) -> DaemonTickView {
        if with_mock(|state| state.enabled) {
            return with_mock(|state| {
                let totp = active_cipher_id.as_ref().and_then(|id| {
                    state
                        .items
                        .iter()
                        .find(|item| &item.id == id)
                        .and_then(|item| totp_view(item.totp.as_deref()))
                });
                DaemonTickView {
                    online: true,
                    unlocked: state.phase == AppPhase::Unlocked,
                    quick_unlock_ready: state.quick_unlock_ready,
                    ssh_prompt: state.ssh_prompt.clone(),
                    ssh_pending_count: state.ssh_prompt.as_ref().map(|prompt| prompt.remaining + 1).unwrap_or(0),
                    totp,
                    error: None,
                }
            });
        }
        let ping = daemon(json!({ "action": "ping", "touch": false }));
        let Some(ping) = ping else {
            return DaemonTickView {
                online: false,
                unlocked: false,
                quick_unlock_ready: false,
                ssh_prompt: None,
                ssh_pending_count: 0,
                totp: None,
                error: Some("The Omawarden daemon is not running.".to_string()),
            };
        };
        let pending = daemon(json!({ "action": "ssh_agent_pending", "touch": false })).unwrap_or(Value::Null);
        let ssh_prompt = parse_prompt(&pending, 0);
        let ssh_pending_count = pending
            .get("prompts")
            .and_then(|value| value.as_array())
            .map(|prompts| prompts.len() as u32)
            .unwrap_or(0);
        let totp = active_cipher_id.and_then(|cipher_id| {
            let response = daemon(json!({ "action": "totp", "query": cipher_id, "touch": false }))?;
            if response.get("ok").and_then(|value| value.as_bool()) != Some(true) {
                return None;
            }
            let code = response.get("code").and_then(|value| value.as_str())?.to_string();
            Some(TotpLiveView {
                valid: true,
                formatted: format!("{} {}", &code[..3.min(code.len())], &code[3.min(code.len())..]),
                code,
                remaining: response.get("ttl").and_then(|value| value.as_u64()).unwrap_or(0) as u32,
                period: response.get("period").and_then(|value| value.as_u64()).unwrap_or(30) as u32,
                error: None,
            })
        });
        let unlocked = ping.get("unlocked").and_then(|value| value.as_bool()).unwrap_or(false);
        if !unlocked {
            clear_cached_vault();
        }
        DaemonTickView {
            online: true,
            unlocked,
            quick_unlock_ready: ping.get("quick_unlock").and_then(|value| value.as_bool()).unwrap_or(false),
            ssh_prompt,
            ssh_pending_count,
            totp,
            error: None,
        }
    }

    /// Approve or deny a pending SSH agent signing request.
    pub fn resolve_ssh_prompt(prompt_id: u64, approve: bool) -> DaemonTickView {
        if with_mock(|state| state.enabled) {
            with_mock(|state| {
                if state.ssh_prompt.as_ref().is_some_and(|prompt| prompt.id as u64 == prompt_id) {
                    state.ssh_prompt = None;
                }
                state.error = None;
            });
            return Self::poll_daemon_tick(None);
        }
        let _ = daemon(json!({ "action": "ssh_agent_reply", "id": prompt_id, "approve": approve, "touch": true }));
        Self::poll_daemon_tick(None)
    }

    /// Load current configuration, health status, and diagnostic logs.
    pub fn get_settings() -> SettingsSnapshotView {
        if with_mock(|state| state.enabled) {
            return with_mock(|state| state.settings_snapshot());
        }
        real_settings()
    }

    /// Update configuration settings (validating URL scheme security and refreshing daemon state).
    pub fn update_settings(input: SettingsUpdateInput) -> SettingsSnapshotView {
        if with_mock(|state| state.enabled) {
            return with_mock(|state| {
                let mut error = None;
                if let Some(server_url) = &input.server_url {
                    match validate_server_url(server_url, "server URL") {
                        Ok(value) => {
                            state.settings.server_url = value.clone();
                            state.server_url = value;
                        }
                        Err(message) => error = Some(message),
                    }
                }
                if let Some(identity_url) = &input.identity_url {
                    if identity_url.trim().is_empty() {
                        state.settings.identity_url.clear();
                        state.identity_url = None;
                    } else {
                        match validate_server_url(identity_url, "identity URL") {
                            Ok(value) => {
                                state.settings.identity_url = value.clone();
                                state.identity_url = Some(value);
                            }
                            Err(message) => error = Some(message),
                        }
                    }
                }
                if let Some(value) = &input.download_dir { state.settings.download_dir = value.clone(); }
                if let Some(value) = input.auto_lock_minutes { state.settings.auto_lock_minutes = value; }
                if let Some(value) = input.clipboard_clear_seconds { state.settings.clipboard_clear_seconds = value; }
                if let Some(value) = &input.email {
                    state.settings.email = value.clone();
                    state.email = value.clone();
                }
                if let Some(value) = input.remember_email { state.settings.remember_email = value; }
                if let Some(value) = input.check_updates { state.settings.check_updates = value; }
                if let Some(value) = input.show_website_icons { state.settings.show_website_icons = value; }
                if let Some(value) = input.remember_last_search { state.settings.remember_last_search = value; }
                if let Some(value) = input.max_attachment_size_mb { state.settings.max_attachment_size_mb = value; }
                if let Some(value) = input.ssh_agent_enabled { state.settings.ssh_agent_enabled = value; }
                if let Some(value) = input.ssh_agent_confirm { state.settings.ssh_agent_confirm = value; }
                if let Some(value) = input.quick_unlock {
                    state.settings.quick_unlock = value;
                    state.quick_unlock_usable = value;
                }
                if let Some(value) = &input.client_cert_path { state.settings.client_cert_path = value.clone(); }
                if let Some(value) = &input.client_key_path { state.settings.client_key_path = value.clone(); }
                if let Some(value) = input.theme { state.settings.theme = value; }
                let mut snapshot = state.settings_snapshot();
                snapshot.error = error;
                snapshot
            });
        }
        let mut options = omawarden::config::ConfigUpdateOptions {
            server_url: input.server_url,
            identity_url: input.identity_url,
            download_dir: input.download_dir,
            auto_lock_minutes: input.auto_lock_minutes,
            clipboard_clear_seconds: input.clipboard_clear_seconds,
            email: input.email,
            remember_email: input.remember_email,
            check_updates: input.check_updates,
            log_level: None,
            show_website_icons: input.show_website_icons,
            remember_last_search: input.remember_last_search,
            max_attachment_size_mb: input.max_attachment_size_mb,
            client_cert_path: input.client_cert_path,
            client_key_path: input.client_key_path,
            ssh_agent_enabled: input.ssh_agent_enabled,
            ssh_agent_confirm: input.ssh_agent_confirm.map(|policy| match policy {
                SshAgentPolicy::FirstUse => "first-use".to_string(),
                SshAgentPolicy::Always => "always".to_string(),
                SshAgentPolicy::Never => "never".to_string(),
            }),
            quick_unlock: input.quick_unlock,
        };
        if options.ssh_agent_confirm.is_none() {
            options.ssh_agent_confirm = None;
        }
        let result = config_manager().update_config(
            options,
            &omawarden::storage::StorageManager::default(),
            &omawarden::keyring::KeyringManager::default(),
        );
        match result {
            Ok(_) => real_settings(),
            Err(error) => {
                let mut snapshot = real_settings();
                snapshot.error = Some(error.to_string());
                snapshot
            }
        }
    }

    /// Run system health diagnostics.
    pub fn refresh_health() -> HealthSnapshotView {
        if with_mock(|state| state.enabled) {
            return with_mock(|state| state.health());
        }
        let config = load_config();
        let status = check_system_health(&config.server_url);
        let memory_locked = daemon(json!({ "action": "ping", "touch": false }))
            .and_then(|value| value.get("memory_locked").and_then(|value| value.as_bool()))
            .unwrap_or(false);
        let checks = vec![
            HealthCheckView {
                name: "Engine Installed".to_string(),
                ok: status.installed,
                detail: status.version.clone().unwrap_or_else(|| "unknown".to_string()),
            },
            HealthCheckView {
                name: "Server Reachable".to_string(),
                ok: status.server_reachable,
                detail: sanitize_server_url(&status.server_url),
            },
            HealthCheckView {
                name: "Secret Service Keyring".to_string(),
                ok: status.keyring_available,
                detail: if status.keyring_available { "secret-tool is available".to_string() } else { "secret-tool is missing".to_string() },
            },
            HealthCheckView {
                name: "Wayland Clipboard".to_string(),
                ok: status.clipboard_available,
                detail: if status.clipboard_available { "wl-copy is available".to_string() } else { "wl-copy is missing".to_string() },
            },
            HealthCheckView {
                name: "Memory Locked".to_string(),
                ok: memory_locked,
                detail: if memory_locked { "mlock is active".to_string() } else { "mlock is not active".to_string() },
            },
        ];
        HealthSnapshotView {
            engine_installed: status.installed,
            engine_version: status.version.unwrap_or_default(),
            server_reachable: status.server_reachable,
            keyring_available: status.keyring_available,
            clipboard_available: status.clipboard_available,
            memory_locked,
            checks,
            error: status.error,
        }
    }

    /// Check for engine/plugin updates.
    pub fn check_updates(force: bool) -> UpdateStatusView {
        let current_version = env!("CARGO_PKG_VERSION").to_string();
        if with_mock(|state| state.enabled) {
            return with_mock(|state| {
                let release = state.update_available.then(|| ReleaseNotesView {
                    version: "0.4.0".to_string(),
                    title: "Omawarden 0.4.0".to_string(),
                    notes: "## What's new\n\n- Faster fuzzy search\n- Quick unlock improvements\n- SSH agent polish".to_string(),
                    url: "https://github.com/omawarden/omawarden-app/releases/tag/v0.4.0".to_string(),
                    published_at: "2026-10-01".to_string(),
                });
                UpdateStatusView {
                    checked: true,
                    available: state.update_available,
                    current_version: current_version.clone(),
                    latest_version: release.as_ref().map(|release| release.version.clone()),
                    release,
                    error: None,
                }
            });
        }
        let _ = force;
        match fetch_latest_release() {
            Ok(release) => {
                let tag = release
                    .get("tag_name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .trim_start_matches(['v', 'V'])
                    .to_string();
                if tag.is_empty() {
                    push_log("update check: the release response had no tag");
                    return UpdateStatusView {
                        checked: true,
                        available: false,
                        current_version,
                        latest_version: None,
                        release: None,
                        error: Some("No published release was found.".to_string()),
                    };
                }
                let available = version_is_newer(&current_version, &tag);
                push_log(format!(
                    "update check: current {current_version}, latest {tag}, available {available}"
                ));
                let notes = ReleaseNotesView {
                    version: tag.clone(),
                    title: release
                        .get("name")
                        .and_then(Value::as_str)
                        .unwrap_or("Omawarden release")
                        .to_string(),
                    notes: release
                        .get("body")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    url: release
                        .get("html_url")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                    published_at: release
                        .get("published_at")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string(),
                };
                UpdateStatusView {
                    checked: true,
                    available,
                    current_version,
                    latest_version: Some(tag),
                    release: Some(notes),
                    error: None,
                }
            }
            Err(error) => {
                push_log(format!("update check failed: {error}"));
                UpdateStatusView {
                    checked: true,
                    available: false,
                    current_version,
                    latest_version: None,
                    release: None,
                    error: Some(error),
                }
            }
        }
    }

    /// Safely open an `http://` or `https://` URL via `xdg-open` (rejecting all other schemes).
    pub fn launch_url(raw_url: String) -> bool {
        let Ok(parsed) = validate_launch_url(&raw_url) else {
            return false;
        };
        if with_mock(|state| state.enabled) {
            return true;
        }
        Command::new("xdg-open")
            .arg(parsed.as_str())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .is_ok()
    }

    /// Show the desktop's native file picker and return the chosen path.
    pub fn pick_file(
        title: Option<String>,
        filter_name: Option<String>,
        extensions: Option<Vec<String>>,
    ) -> Option<String> {
        if with_mock(|state| state.enabled) {
            return Some("/tmp/omawarden-mock/client.pem".to_string());
        }
        let mut dialog = rfd::FileDialog::new();
        if let Some(title) = title {
            dialog = dialog.set_title(title);
        }
        if let (Some(name), Some(extensions)) = (filter_name, extensions) {
            let extensions: Vec<&str> = extensions.iter().map(String::as_str).collect();
            if !extensions.is_empty() {
                dialog = dialog.add_filter(name, &extensions);
            }
        }
        dialog.pick_file().map(|path| path.display().to_string())
    }

    /// Show the desktop's native folder picker and return the chosen path.
    pub fn pick_folder(title: Option<String>) -> Option<String> {
        if with_mock(|state| state.enabled) {
            return Some("/tmp/omawarden-mock/folder".to_string());
        }
        let mut dialog = rfd::FileDialog::new();
        if let Some(title) = title {
            dialog = dialog.set_title(title);
        }
        if let Some(home) = std::env::var_os("HOME") {
            dialog = dialog.set_directory(home);
        }
        dialog.pick_folder().map(|path| path.display().to_string())
    }

    /// Show the desktop's native save dialog and return the chosen path.
    pub fn save_file(title: Option<String>, default_name: Option<String>) -> Option<String> {
        if with_mock(|state| state.enabled) {
            let name = default_name.unwrap_or_else(|| "attachment.bin".to_string());
            return Some(format!("/tmp/omawarden-mock/{name}"));
        }
        let mut dialog = rfd::FileDialog::new();
        if let Some(title) = title {
            dialog = dialog.set_title(title);
        }
        if let Some(name) = default_name {
            dialog = dialog.set_file_name(name);
        }
        dialog.save_file().map(|path| path.display().to_string())
    }

    /// Read a UTF-8 text file (used to import SSH keys from the file picker).
    pub fn read_text_file(path: String) -> Option<String> {
        if with_mock(|state| state.enabled) {
            return Some(
                "-----BEGIN OPENSSH PRIVATE KEY-----\nmock-key-material\n-----END OPENSSH PRIVATE KEY-----"
                    .to_string(),
            );
        }
        let path = PathBuf::from(path.trim());
        if !path.is_file() {
            return None;
        }
        let metadata = std::fs::metadata(&path).ok()?;
        if metadata.len() > 2 * 1024 * 1024 {
            return None;
        }
        std::fs::read_to_string(path).ok()
    }

    /// Verify the master password without unlocking the daemon.
    pub fn verify_master_password(password: String) -> bool {
        if with_mock(|state| state.enabled) {
            return with_mock(|state| password == state.master_password);
        }
        let storage_mgr = omawarden::storage::StorageManager::default();
        let storage = storage_mgr.load();
        if storage.enc_user_key.is_none() {
            return false;
        }
        storage_mgr.unlock_user_key(&password, &storage).is_ok()
    }
}

/// A bounded, sanitized ring of recent app diagnostics.
static LOG_RING: OnceLock<Mutex<VecDeque<String>>> = OnceLock::new();

/// Records a sanitized diagnostic line.
fn push_log(line: impl Into<String>) {
    let line = sanitize_log_message(&line.into());
    let ring = LOG_RING.get_or_init(|| Mutex::new(VecDeque::new()));
    if let Ok(mut guard) = ring.lock() {
        guard.push_back(format!("[app] {line}"));
        while guard.len() > 40 {
            guard.pop_front();
        }
    }
}

/// Returns the recent diagnostic lines, oldest first.
fn recent_logs() -> Vec<String> {
    LOG_RING
        .get()
        .and_then(|ring| ring.lock().ok().map(|guard| guard.iter().cloned().collect()))
        .unwrap_or_default()
}

/// The process's resident set size in MiB, from `/proc/self/statm`.
fn process_rss_mb() -> f64 {
    let Ok(statm) = std::fs::read_to_string("/proc/self/statm") else {
        return 0.0;
    };
    let pages = statm
        .split_whitespace()
        .nth(1)
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    let page_size = 4096_u64;
    (pages.saturating_mul(page_size) as f64) / (1024.0 * 1024.0)
}

/// Compares two dotted versions, ignoring a leading `v` and pre-release tags.
fn version_is_newer(current: &str, latest: &str) -> bool {
    fn parts(version: &str) -> Vec<u64> {
        version
            .trim()
            .trim_start_matches(['v', 'V'])
            .split(['-', '+'])
            .next()
            .unwrap_or_default()
            .split('.')
            .map(|part| part.parse::<u64>().unwrap_or(0))
            .collect()
    }
    let current = parts(current);
    let latest = parts(latest);
    let length = current.len().max(latest.len());
    for index in 0..length {
        let left = current.get(index).copied().unwrap_or(0);
        let right = latest.get(index).copied().unwrap_or(0);
        if right != left {
            return right > left;
        }
    }
    false
}

/// Fetches the latest GitHub release JSON for this repository.
fn fetch_latest_release() -> Result<Value, String> {
    let output = Command::new("curl")
        .args([
            "-fsSL",
            "--max-time",
            "10",
            "-H",
            "Accept: application/vnd.github+json",
            "https://api.github.com/repos/omawarden/omawarden-app/releases/latest",
        ])
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("Could not run curl: {error}"))?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if message.is_empty() {
            "No published release was found.".to_string()
        } else {
            message
        });
    }
    serde_json::from_slice::<Value>(&output.stdout)
        .map_err(|error| format!("Could not read the release response: {error}"))
}

/// Reads an image attachment into a `data:` URL the image element can show.
///
/// The decrypted file lives outside the app's own assets, so it cannot be
/// referenced as an `asset:` or remote URL; a data URL also needs no network
/// grant.
fn attachment_image_data_url(path: Option<&str>, filename: Option<&str>) -> Option<String> {
    const MAX_PREVIEW_BYTES: u64 = 16 * 1024 * 1024;
    let path = path?;
    let metadata = std::fs::metadata(path).ok()?;
    if !metadata.is_file() || metadata.len() > MAX_PREVIEW_BYTES {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    let extension = filename
        .and_then(|name| name.rsplit('.').next())
        .unwrap_or_default()
        .to_lowercase();
    let mime = match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        _ => "application/octet-stream",
    };
    use base64::Engine as _;
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    Some(format!("data:{mime};base64,{encoded}"))
}

/// Expands a leading `~` to the current user's home directory.
fn expand_home(path: &str) -> PathBuf {    let trimmed = path.trim();
    if trimmed == "~" || trimmed.starts_with("~/") {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        let rest = trimmed.strip_prefix('~').unwrap_or(trimmed).trim_start_matches('/');
        if rest.is_empty() {
            return PathBuf::from(home);
        }
        return PathBuf::from(home).join(rest);
    }
    PathBuf::from(trimmed)
}

/// The real settings snapshot.
fn real_settings() -> SettingsSnapshotView {
    let config = load_config();
    let health = OmawardenBridge::refresh_health();
    let engine_version = health.engine_version.clone();
    SettingsSnapshotView {
        config: SettingsView {
            server_url: config.server_url.clone(),
            identity_url: config.identity_url.clone().unwrap_or_default(),
            download_dir: config.download_dir.clone(),
            auto_lock_minutes: config.auto_lock_minutes,
            clipboard_clear_seconds: config.clipboard_clear_seconds,
            email: config.email.clone(),
            remember_email: config.remember_email,
            check_updates: config.check_updates,
            show_website_icons: config.show_website_icons,
            remember_last_search: config.remember_last_search,
            max_attachment_size_mb: config.max_attachment_size_mb,
            ssh_agent_enabled: config.ssh_agent_enabled,
            ssh_agent_confirm: match config.ssh_agent_confirm.as_str() {
                "always" => SshAgentPolicy::Always,
                "never" => SshAgentPolicy::Never,
                _ => SshAgentPolicy::FirstUse,
            },
            quick_unlock: config.quick_unlock,
            client_cert_path: config.client_cert_path.clone().unwrap_or_default(),
            client_key_path: config.client_key_path.clone().unwrap_or_default(),
            theme: ThemeAppearance::Dark,
        },
        health,
        diagnostics: DiagnosticsView {
            server_url_sanitized: sanitize_server_url(&config.server_url),
            logs: {
                let mut logs = recent_logs();
                if logs.is_empty() {
                    logs.push("[app] omawarden diagnostics ready".to_string());
                }
                logs
            },
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            engine_version,
            git_commit: option_env!("GIT_HASH").unwrap_or("unknown").to_string(),
            build_date: option_env!("BUILD_DATE").unwrap_or("unknown").to_string(),
            memory_rss_mb: process_rss_mb(),
        },
        error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Serializes tests that share the process-wide mock state.
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    fn mock_state_json(value: Value) -> String {
        value.to_string()
    }

    fn password_input(length: u32) -> PasswordGenInput {
        PasswordGenInput {
            length,
            uppercase: true,
            lowercase: true,
            numbers: true,
            special: true,
            avoid_ambiguous: false,
            min_numbers: 1,
            min_special: 1,
        }
    }

    fn passphrase_input(words: u32) -> PassphraseGenInput {
        PassphraseGenInput {
            words,
            separator: "|".to_string(),
            capitalize: false,
        }
    }

    fn reveal_none() -> RevealStateInput {
        RevealStateInput {
            reveal_password: false,
            reveal_card_number: false,
            reveal_cvv: false,
            reveal_private_key: false,
            reveal_fields: Vec::new(),
        }
    }

    #[test]
    fn password_length_is_strictly_validated() {
        for length in [0, 1, 4, 129, 200] {
            let result = OmawardenBridge::generate_password(password_input(length));
            assert!(!result.ok, "length {length} must be rejected");
            assert_eq!(result.error.as_deref(), Some(ERR_PASSWORD_LENGTH));
            assert!(result.value.is_empty());
        }
        for length in [5, 14, 128] {
            let result = OmawardenBridge::generate_password(password_input(length));
            assert!(result.ok, "length {length} must be accepted: {:?}", result.error);
            assert_eq!(result.value.chars().count(), length as usize);
            assert!(result.entropy > 0.0);
        }
    }

    #[test]
    fn passphrase_words_are_strictly_validated() {
        for words in [0, 2, 21, 100] {
            let result = OmawardenBridge::generate_passphrase(passphrase_input(words));
            assert!(!result.ok, "words {words} must be rejected");
            assert_eq!(result.error.as_deref(), Some(ERR_PASSPHRASE_WORDS));
        }
        for words in [3, 6, 20] {
            let result = OmawardenBridge::generate_passphrase(passphrase_input(words));
            assert!(result.ok, "words {words} must be accepted: {:?}", result.error);
            assert_eq!(result.value.split('|').count(), words as usize);
        }
    }

    #[test]
    fn fuzzy_scoring_prefers_tighter_matches() {
        assert_eq!(fuzzy_score("", "anything"), Some(0));
        assert!(fuzzy_score("gh", "GitHub").is_some());
        assert!(fuzzy_score("zzz", "GitHub").is_none());
        let exact = fuzzy_score("github", "GitHub").unwrap();
        let prefix = fuzzy_score("git", "GitHub").unwrap();
        let contains = fuzzy_score("thu", "GitHub").unwrap();
        assert!(exact > prefix);
        assert!(prefix > contains);
    }

    #[test]
    fn card_masking_and_formatting() {
        assert_eq!(mask_card_number("4111111111111234"), "•••• •••• •••• 1234");
        assert_eq!(mask_card_number("1234"), "••••");
        assert_eq!(mask_card_number(""), "•••• •••• •••• ••••");
        assert_eq!(format_card_number("4111111111111234"), "4111 1111 1111 1234");
        assert_eq!(format_card_number("4111-1111-1111-1234"), "4111 1111 1111 1234");
        assert_eq!(
            format_card_number_for("378282246310005", "American Express"),
            "3782 822463 10005"
        );
        assert_eq!(
            mask_card_number_for("378282246310005", "Amex"),
            "•••• •••••• •0005"
        );
        assert_eq!(
            format_card_number_for("36123456789012", "Diners Club"),
            "3612 345678 9012"
        );
        assert_eq!(format_expiration("1", "2030"), "01 / 2030");
        assert_eq!(format_expiration("12", "2030"), "12 / 2030");
        assert_eq!(format_size(512), "512 B");
        assert_eq!(format_size(2048), "2.0 KB");
    }

    #[test]
    fn version_comparison_detects_newer_releases() {
        assert!(version_is_newer("1.0.0", "1.0.1"));
        assert!(version_is_newer("v1.2.3", "1.3.0"));
        assert!(version_is_newer("1.0", "1.0.1"));
        assert!(!version_is_newer("1.2.3", "1.2.3"));
        assert!(!version_is_newer("2.0.0", "1.9.9"));
        assert!(!version_is_newer("1.0.0", "1.0.0-beta.2"));
    }

    #[test]
    fn category_counts_follow_search_and_scope() {
        let _guard = TEST_LOCK.lock().unwrap_or_else(|error| error.into_inner());
        let snapshot = OmawardenBridge::configure_mock_state(mock_state_json(json!({
            "phase": "unlocked",
            "items": [
                {"id": "1", "title": "GitHub", "category": "login", "username": "octocat", "organization": "Acme"},
                {"id": "2", "title": "Personal Mail", "category": "login", "username": "me"},
                {"id": "3", "title": "Visa", "category": "card", "card": {"number": "4111111111111234"}, "organization": "Acme"}
            ]
        })));
        assert_eq!(snapshot.category_counts.all, 3);

        let searched = OmawardenBridge::query_vault(VaultFilterInput {
            search: "github".to_string(),
            category: ItemCategory::All,
            scope_id: None,
            folder_id: None,
        });
        assert_eq!(searched.category_counts.all, 1);
        assert_eq!(searched.category_counts.logins, 1);
        assert_eq!(searched.category_counts.cards, 0);

        let scoped = OmawardenBridge::query_vault(VaultFilterInput {
            search: String::new(),
            category: ItemCategory::All,
            scope_id: Some("org:Acme".to_string()),
            folder_id: None,
        });
        assert_eq!(scoped.category_counts.all, 2);
        assert_eq!(scoped.category_counts.logins, 1);
        assert_eq!(scoped.category_counts.cards, 1);
    }

    #[test]
    fn url_schemes_are_validated() {
        assert!(validate_launch_url("https://example.com/login").is_ok());
        assert!(validate_launch_url("http://localhost:8080").is_ok());
        assert!(validate_launch_url("javascript:alert(1)").is_err());
        assert!(validate_launch_url("file:///etc/passwd").is_err());
        assert!(validate_launch_url("").is_err());

        assert_eq!(
            validate_server_url("http://localhost:8080", "server URL").unwrap(),
            "http://localhost:8080"
        );
        assert_eq!(
            validate_server_url("http://127.0.0.1", "server URL").unwrap(),
            "http://127.0.0.1"
        );
        assert!(validate_server_url("http://vault.example.com", "server URL").is_err());
        assert!(validate_server_url("ftp://vault.example.com", "server URL").is_err());
        assert_eq!(
            validate_server_url("vault.example.com", "server URL").unwrap(),
            "https://vault.example.com"
        );
    }

    #[test]
    fn mock_auth_and_lock_transitions() {
        let _guard = TEST_LOCK.lock().unwrap_or_else(|error| error.into_inner());
        OmawardenBridge::configure_mock_state(mock_state_json(json!({
            "phase": "login",
            "email": "user@example.com",
            "quickUnlockReady": true
        })));
        let input = |kind| AuthActionInput {
            kind,
            email: "user@example.com".to_string(),
            password: "correct horse battery staple".to_string(),
            client_id: String::new(),
            client_secret: String::new(),
            code: String::new(),
            provider: None,
            remember_email: Some(true),
            new_device_otp: None,
        };
        let unlocked = OmawardenBridge::authenticate(input(AuthKind::Password));
        assert_eq!(unlocked.phase, AppPhase::Unlocked);
        assert!(unlocked.error.is_none());

        let locked = OmawardenBridge::lock_or_logout(false);
        assert_eq!(locked.phase, AppPhase::Locked);
        let unlocked = OmawardenBridge::authenticate(input(AuthKind::QuickUnlock));
        assert_eq!(unlocked.phase, AppPhase::Unlocked);

        let logged_out = OmawardenBridge::lock_or_logout(true);
        assert_eq!(logged_out.phase, AppPhase::Login);
        assert!(logged_out.email.is_empty());
    }

    #[test]
    fn mock_two_factor_challenge() {
        let _guard = TEST_LOCK.lock().unwrap_or_else(|error| error.into_inner());
        OmawardenBridge::configure_mock_state(mock_state_json(json!({
            "phase": "login",
            "twoFactorRequired": true
        })));
        let mut input = AuthActionInput {
            kind: AuthKind::Password,
            email: "user@example.com".to_string(),
            password: "hunter2hunter2".to_string(),
            client_id: String::new(),
            client_secret: String::new(),
            code: String::new(),
            provider: Some(0),
            remember_email: None,
            new_device_otp: None,
        };
        let challenge = OmawardenBridge::authenticate(input.clone());
        assert_eq!(challenge.phase, AppPhase::TwoFactor);
        assert!(challenge.two_factor.is_some());

        input.kind = AuthKind::TwoFactor;
        input.code = "123456".to_string();
        let unlocked = OmawardenBridge::authenticate(input);
        assert_eq!(unlocked.phase, AppPhase::Unlocked);
    }

    #[test]
    fn mock_search_scope_category_and_inspector() {
        let _guard = TEST_LOCK.lock().unwrap_or_else(|error| error.into_inner());
        let snapshot = OmawardenBridge::configure_mock_state(mock_state_json(json!({
            "phase": "unlocked",
            "items": [
                {
                    "id": "1",
                    "title": "GitHub",
                    "category": "login",
                    "username": "octocat",
                    "password": "s3cret",
                    "totp": "JBSWY3DPEHPK3PXP",
                    "folder": "Work",
                    "organization": "Acme",
                    "uris": ["https://github.com/login"],
                    "passwordHistory": [{"password": "old", "changedAt": "2025-01-01"}]
                },
                {
                    "id": "2",
                    "title": "Visa",
                    "category": "card",
                    "card": {"cardholderName": "Ada", "brand": "Visa", "number": "4111111111111234", "expMonth": "12", "expYear": "2030", "code": "123"},
                    "folder": "Personal"
                },
                {
                    "id": "3",
                    "title": "Server key",
                    "category": "sshKey",
                    "ssh": {"keyType": "ED25519", "fingerprint": "SHA256:abc", "publicKey": "ssh-ed25519 AAAA", "privateKey": "-----BEGIN OPENSSH PRIVATE KEY-----"}
                }
            ]
        })));
        assert_eq!(snapshot.phase, AppPhase::Unlocked);
        assert_eq!(snapshot.total_count, 3);
        assert_eq!(snapshot.category_counts.logins, 1);
        assert_eq!(snapshot.category_counts.cards, 1);
        assert_eq!(snapshot.category_counts.ssh_keys, 1);
        assert!(snapshot.scopes.iter().any(|scope| scope.id == "org:Acme"));
        assert!(snapshot.folders.iter().any(|folder| folder.name == "Work"));

        let filtered = OmawardenBridge::query_vault(VaultFilterInput {
            search: "git".to_string(),
            category: ItemCategory::All,
            scope_id: None,
            folder_id: None,
        });
        assert_eq!(filtered.items.len(), 1);
        assert_eq!(filtered.items[0].title, "GitHub");

        let cards = OmawardenBridge::query_vault(VaultFilterInput {
            search: String::new(),
            category: ItemCategory::Card,
            scope_id: Some("personal".to_string()),
            folder_id: None,
        });
        assert_eq!(cards.items.len(), 1);
        assert_eq!(cards.items[0].title, "Visa");

        let hidden = OmawardenBridge::inspect_cipher("1".to_string(), reveal_none());
        assert!(hidden.password.is_none());
        assert_eq!(hidden.password_masked, MASK);
        assert!(hidden.totp.as_ref().is_some_and(|totp| totp.valid));
        assert_eq!(hidden.password_history.len(), 1);
        assert_eq!(hidden.uris[0].host, "github.com");

        let mut reveal = reveal_none();
        reveal.reveal_password = true;
        let shown = OmawardenBridge::inspect_cipher("1".to_string(), reveal);
        assert_eq!(shown.password.as_deref(), Some("s3cret"));

        let card = OmawardenBridge::inspect_cipher("2".to_string(), reveal_none());
        assert_eq!(card.card.as_ref().unwrap().number, "•••• •••• •••• 1234");
        assert_eq!(card.card.as_ref().unwrap().cvv, MASK);

        let missing = OmawardenBridge::inspect_cipher("nope".to_string(), reveal_none());
        assert!(missing.error.is_some());
    }

    #[test]
    fn mock_dependencies_and_settings() {
        let _guard = TEST_LOCK.lock().unwrap_or_else(|error| error.into_inner());
        OmawardenBridge::configure_mock_state(mock_state_json(json!({
            "phase": "dependencyCheck",
            "dependenciesMissing": ["libsecret", "libfido2"]
        })));
        let dependencies = OmawardenBridge::check_dependencies();
        assert!(!dependencies.all_required_installed);
        assert_eq!(dependencies.missing_required, vec!["libsecret".to_string()]);
        assert!(OmawardenBridge::install_missing_dependencies(vec!["libsecret".to_string()]));

        let settings = OmawardenBridge::update_settings(SettingsUpdateInput {
            server_url: Some("http://example.com".to_string()),
            identity_url: None,
            download_dir: None,
            auto_lock_minutes: None,
            clipboard_clear_seconds: None,
            email: None,
            remember_email: None,
            check_updates: None,
            show_website_icons: None,
            remember_last_search: None,
            max_attachment_size_mb: None,
            ssh_agent_enabled: None,
            ssh_agent_confirm: None,
            quick_unlock: None,
            client_cert_path: None,
            client_key_path: None,
            theme: None,
        });
        assert!(settings.error.is_some(), "plain http to a remote host must be rejected");

        let settings = OmawardenBridge::update_settings(SettingsUpdateInput {
            server_url: Some("http://localhost:8080".to_string()),
            identity_url: None,
            download_dir: None,
            auto_lock_minutes: Some(30),
            clipboard_clear_seconds: Some(45),
            email: None,
            remember_email: None,
            check_updates: None,
            show_website_icons: None,
            remember_last_search: None,
            max_attachment_size_mb: None,
            ssh_agent_enabled: None,
            ssh_agent_confirm: None,
            quick_unlock: None,
            client_cert_path: None,
            client_key_path: None,
            theme: Some(ThemeAppearance::Light),
        });
        assert!(settings.error.is_none());
        assert_eq!(settings.config.auto_lock_minutes, 30);
        assert_eq!(settings.config.clipboard_clear_seconds, 45);
        assert_eq!(settings.config.theme, ThemeAppearance::Light);
    }

    #[test]
    fn mock_ssh_prompt_and_update() {
        let _guard = TEST_LOCK.lock().unwrap_or_else(|error| error.into_inner());
        OmawardenBridge::configure_mock_state(mock_state_json(json!({
            "phase": "unlocked",
            "updateAvailable": true,
            "sshPrompt": {"id": 7, "title": "Sign a Git commit?", "remaining": 2}
        })));
        let tick = OmawardenBridge::poll_daemon_tick(None);
        assert!(tick.online);
        assert_eq!(tick.ssh_prompt.as_ref().unwrap().id, 7);
        assert_eq!(tick.ssh_pending_count, 3);

        let resolved = OmawardenBridge::resolve_ssh_prompt(7, true);
        assert!(resolved.ssh_prompt.is_none());

        let update = OmawardenBridge::check_updates(true);
        assert!(update.checked);
        assert!(update.available);
        assert_eq!(update.latest_version.as_deref(), Some("0.4.0"));
        assert!(update.release.is_some());
    }

    #[test]
    fn blank_codes_are_treated_as_absent() {
        assert_eq!(normalize_optional_code(None), None);
        assert_eq!(normalize_optional_code(Some(String::new())), None);
        assert_eq!(normalize_optional_code(Some("   ".to_string())), None);
        assert_eq!(
            normalize_optional_code(Some(" 123456 ".to_string())),
            Some("123456".to_string())
        );
    }

    #[test]
    fn mock_fido2_two_factor_succeeds_without_a_code() {
        let _guard = TEST_LOCK.lock().unwrap_or_else(|error| error.into_inner());
        OmawardenBridge::configure_mock_state(mock_state_json(json!({
            "phase": "twoFactor",
            "email": "user@example.com",
            "twoFactorRequired": true,
            "twoFactor": {
                "email": "user@example.com",
                "providers": [
                    {"id": 0, "name": "authenticator", "label": "Authenticator App", "available": true},
                    {"id": 7, "name": "fido2", "label": "FIDO2 Security Key", "available": true}
                ],
                "selectedProvider": 7,
                "fido2Status": "available"
            }
        })));
        let unlocked = OmawardenBridge::authenticate(AuthActionInput {
            kind: AuthKind::TwoFactor,
            email: "user@example.com".to_string(),
            password: "correct horse battery staple".to_string(),
            client_id: String::new(),
            client_secret: String::new(),
            code: String::new(),
            provider: Some(7),
            remember_email: None,
            new_device_otp: Some(String::new()),
        });
        assert_eq!(unlocked.phase, AppPhase::Unlocked);
        assert!(unlocked.error.is_none());
    }

    #[test]
    fn launch_url_rejects_unsafe_schemes() {
        let _guard = TEST_LOCK.lock().unwrap_or_else(|error| error.into_inner());
        OmawardenBridge::set_mock_mode(true);
        assert!(!OmawardenBridge::launch_url("javascript:alert(1)".to_string()));
        assert!(!OmawardenBridge::launch_url("file:///etc/passwd".to_string()));
        assert!(OmawardenBridge::launch_url("https://example.com".to_string()));
    }

    #[test]
    fn two_factor_providers_are_labelled_in_process() {
        let fido2 = two_factor_provider_view(7);
        assert_eq!(fido2.id, 7);
        assert_eq!(fido2.name, "fido2");
        assert_eq!(fido2.label, "FIDO2 Security Key");
        assert!(fido2.available);

        let email = two_factor_provider_view(1);
        assert_eq!(email.name, "email");
        assert_eq!(email.label, "Email");

        let unknown = two_factor_provider_view(9);
        assert_eq!(unknown.name, "provider-9");
        assert_eq!(unknown.label, "Provider 9");
    }

    #[test]
    fn blank_codes_are_omitted_from_the_in_process_call() {
        assert_eq!(normalize_optional_code(Some("   ".to_string())), None);
        assert_eq!(
            normalize_optional_code(Some(" 123456 ".to_string())),
            Some("123456".to_string())
        );
        let code = " 123456 ";
        let code = code.trim();
        assert_eq!(if code.is_empty() { None } else { Some(code) }, Some("123456"));
    }
}
