//! The app's Rust code: what `App.tsx` imports from `omawarden-app/native`.
//!
//! The [`OmawardenBridge`] module is the only seam between the TSX UI and the
//! Omawarden Rust engine. It talks to the daemon over its Unix socket for
//! stateful vault operations, calls the stateless `omawarden` library
//! functions in-process, runs authentication through `omawarden::auth` after
//! starting the daemon in this process, and keeps an in-memory mock mode so the
//! headless UI tests never touch the real keyring, config, clipboard or daemon
//! socket.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use nsh_core::prelude::*;
use serde_json::{Value, json};

use omawarden::api::is_loopback_host;

mod attachments;
mod auth;
mod clipboard;
mod diagnostics;
mod engine;
mod generator;
mod inspector;
mod platform;
mod projection;
mod settings;
mod ssh;
mod vault;

pub use settings::{SettingsSnapshotView, SettingsUpdateInput, SettingsView};

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
pub const ERR_PASSWORD_LENGTH: &str = "Password length must be between 5 and 128 characters. Use 14 or more characters for a strong password.";

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
    let month = if month.len() == 1 {
        format!("0{month}")
    } else {
        month.to_string()
    };
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
pub(crate) struct MockSettings {
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
pub(crate) struct MockState {
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
    let mut guard = mock_state()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    f(&mut guard)
}

/// Parses a string field from JSON.
fn json_string(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(|field| field.as_str())
        .map(str::to_string)
}

/// Parses a boolean field from JSON with a default.
fn json_bool(value: &Value, key: &str, default: bool) -> bool {
    value
        .get(key)
        .and_then(|field| field.as_bool())
        .unwrap_or(default)
}

/// Parses an integer field from JSON.
fn json_u32(value: &Value, key: &str) -> Option<u32> {
    value
        .get(key)
        .and_then(|field| field.as_u64())
        .map(|number| number as u32)
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
        let category = parse_category(
            value
                .get("category")
                .and_then(|v| v.as_str())
                .unwrap_or("login"),
        );
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
                            entry
                                .as_str()
                                .map(str::to_string)
                                .or_else(|| json_string(entry, "uri"))
                        })
                        .collect()
                })
                .unwrap_or_default(),
            favorite: json_bool(value, "favorite", false),
            folder: json_string(value, "folder"),
            organization: json_string(value, "organization"),
            reprompt: value.get("reprompt").and_then(Value::as_u64).unwrap_or(0) as u32,
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
            card_mask: self
                .card
                .as_ref()
                .map(|card| mask_card_number_for(&card.number, &card.brand)),
        }
    }
}

impl MockState {
    /// The current snapshot.
    fn snapshot(&self) -> VaultSnapshotView {
        projection::build_snapshot(
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
    if let Some(server_url) =
        json_string(value, "serverUrl").or_else(|| json_string(value, "server_url"))
    {
        state.server_url = server_url.clone();
        state.settings.server_url = server_url;
    }
    if let Some(identity_url) =
        json_string(value, "identityUrl").or_else(|| json_string(value, "identity_url"))
    {
        state.identity_url = if identity_url.is_empty() {
            None
        } else {
            Some(identity_url.clone())
        };
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
            action: json_string(prompt, "action")
                .unwrap_or_else(|| "SSH login as git@github.com".to_string()),
            key_name: json_string(prompt, "keyName").unwrap_or_else(|| "GitHub".to_string()),
            fingerprint: json_string(prompt, "fingerprint")
                .unwrap_or_else(|| "SHA256:mock".to_string()),
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
        if let Some(v) = json_string(settings, "serverUrl") {
            mock.server_url = v;
        }
        if let Some(v) = json_string(settings, "identityUrl") {
            mock.identity_url = v;
        }
        if let Some(v) = json_string(settings, "downloadDir") {
            mock.download_dir = v;
        }
        if let Some(v) = settings.get("autoLockMinutes").and_then(|v| v.as_i64()) {
            mock.auto_lock_minutes = v;
        }
        if let Some(v) = settings
            .get("clipboardClearSeconds")
            .and_then(|v| v.as_i64())
        {
            mock.clipboard_clear_seconds = v;
        }
        if let Some(v) = json_string(settings, "email") {
            mock.email = v;
        }
        if let Some(v) = settings.get("rememberEmail").and_then(|v| v.as_bool()) {
            mock.remember_email = v;
        }
        if let Some(v) = settings.get("checkUpdates").and_then(|v| v.as_bool()) {
            mock.check_updates = v;
        }
        if let Some(v) = settings.get("showWebsiteIcons").and_then(|v| v.as_bool()) {
            mock.show_website_icons = v;
        }
        if let Some(v) = settings.get("rememberLastSearch").and_then(|v| v.as_bool()) {
            mock.remember_last_search = v;
        }
        if let Some(v) = settings.get("maxAttachmentSizeMb").and_then(|v| v.as_u64()) {
            mock.max_attachment_size_mb = v;
        }
        if let Some(v) = settings.get("sshAgentEnabled").and_then(|v| v.as_bool()) {
            mock.ssh_agent_enabled = v;
        }
        if let Some(v) = json_string(settings, "sshAgentConfirm") {
            mock.ssh_agent_confirm = match v.as_str() {
                "always" => SshAgentPolicy::Always,
                "never" => SshAgentPolicy::Never,
                _ => SshAgentPolicy::FirstUse,
            };
        }
        if let Some(v) = settings.get("quickUnlock").and_then(|v| v.as_bool()) {
            mock.quick_unlock = v;
        }
        if let Some(v) = json_string(settings, "clientCertPath") {
            mock.client_cert_path = v;
        }
        if let Some(v) = json_string(settings, "clientKeyPath") {
            mock.client_key_path = v;
        }
        if let Some(v) = json_string(settings, "theme") {
            mock.theme = if v == "light" {
                ThemeAppearance::Light
            } else {
                ThemeAppearance::Dark
            };
        }
    }
}

/// The default two-factor provider list.
fn default_two_factor_providers() -> Vec<TwoFactorProviderView> {
    vec![
        TwoFactorProviderView {
            id: 0,
            name: "authenticator".to_string(),
            label: "Authenticator App".to_string(),
            available: true,
        },
        TwoFactorProviderView {
            id: 1,
            name: "email".to_string(),
            label: "Email".to_string(),
            available: true,
        },
        TwoFactorProviderView {
            id: 3,
            name: "yubikey".to_string(),
            label: "YubiKey OTP".to_string(),
            available: true,
        },
        TwoFactorProviderView {
            id: 7,
            name: "fido2".to_string(),
            label: "FIDO2 Security Key".to_string(),
            available: true,
        },
    ]
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

/// Parses the first pending SSH prompt.
fn parse_prompt(value: &Value, offset: usize) -> Option<SshPromptView> {
    let prompts = value.get("prompts")?.as_array()?;
    let prompt = prompts.get(offset)?;
    Some(SshPromptView {
        id: prompt.get("id").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
        title: prompt
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("SSH request")
            .to_string(),
        action: prompt
            .get("action")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        key_name: prompt
            .get("key_name")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        fingerprint: prompt
            .get("fingerprint")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        client: prompt
            .get("client")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        command: prompt
            .get("command")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        forwarded: prompt
            .get("forwarded")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        remembered: prompt
            .get("remembered")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        remaining: prompts.len().saturating_sub(offset + 1) as u32,
    })
}

/// Builds an inspector from a real vault item.
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
                                id: payload
                                    .get("id")
                                    .and_then(|value| value.as_u64())
                                    .unwrap_or(1) as u32,
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
        vault::real_snapshot(VaultFilterInput::default())
    }

    /// Re-check system dependencies (omawarden, libsecret, wl-clipboard, libfido2).
    pub fn check_dependencies() -> DependencyStatusView {
        engine::diagnostics().dependencies()
    }

    /// Launch a floating terminal to install missing system packages.
    pub fn install_missing_dependencies(packages: Vec<String>) -> bool {
        engine::diagnostics().install_missing(packages)
    }

    /// Authenticate or unlock the vault (password, API key, 2FA, OTP, master password, quick unlock).
    pub fn authenticate(mut input: AuthActionInput) -> VaultSnapshotView {
        // A blank new-device code must reach the engine as `None`; `Some("")`
        // makes it skip the two-factor token and provider entirely, which is
        // what broke FIDO2 assertions after a successful key touch.
        input.new_device_otp = auth::normalize_optional_code(input.new_device_otp);
        engine::auth().authenticate(input)
    }

    /// Send two-factor verification email.
    pub fn send_two_factor_email(email: String, password: String) -> ActionOutcomeView {
        engine::auth().send_two_factor_email(&email, &password)
    }

    /// Lock or log out of the current vault session, purging sensitive state and preview files.
    pub fn lock_or_logout(logout: bool) -> VaultSnapshotView {
        engine::auth().lock_or_logout(logout)
    }

    /// Query, fuzzy-score, and filter the unlocked vault by search text, scope, folder, and category.
    pub fn query_vault(filter: VaultFilterInput) -> VaultSnapshotView {
        engine::vault().query(filter)
    }

    /// Synchronize the vault with the Bitwarden server and return the updated snapshot.
    pub fn sync_vault(filter: VaultFilterInput) -> VaultSnapshotView {
        engine::vault().sync(filter)
    }

    /// Inspect a specific cipher item, computing masked/revealed fields, TOTP state, and actions.
    pub fn inspect_cipher(cipher_id: String, reveal: RevealStateInput) -> InspectorView {
        engine::inspector().inspect(cipher_id, reveal)
    }

    /// Compute live TOTP code and remaining TTL for a cipher item.
    pub fn refresh_totp(cipher_id: String) -> TotpLiveView {
        engine::inspector().totp(cipher_id)
    }

    /// Copy a specific field of a cipher item to the Wayland clipboard with Clipboard Guard TTL.
    pub fn copy_cipher_field(
        cipher_id: String,
        field: String,
        custom_index: Option<u32>,
    ) -> CopyOutcomeView {
        engine::clipboard().copy_cipher_field(cipher_id, field, custom_index)
    }

    /// Copy arbitrary text to the clipboard with optional sensitivity flag.
    pub fn copy_text(text: String, label: String, sensitive: bool) -> CopyOutcomeView {
        engine::clipboard().copy_text(text, label, sensitive)
    }

    /// Preview or download an encrypted attachment (`0600` permissions in `$XDG_RUNTIME_DIR`).
    pub fn open_attachment(
        cipher_id: String,
        attachment_id: String,
        mode: String,
    ) -> AttachmentOutcomeView {
        engine::attachments().open(cipher_id, attachment_id, mode)
    }

    /// Clean up temporary decrypted attachment previews.
    pub fn clean_attachment_previews(cipher_id: Option<String>) -> bool {
        engine::attachments().clean_previews(cipher_id)
    }

    /// Download an attachment to the destination chosen by the user.
    pub fn save_attachment(
        cipher_id: String,
        attachment_id: String,
        destination: String,
    ) -> AttachmentOutcomeView {
        engine::attachments().save(cipher_id, attachment_id, destination)
    }

    /// Open a decrypted attachment preview in the system viewer.
    pub fn open_attachment_path(path: String) -> bool {
        engine::attachments().open_path(path)
    }

    /// Generate a random password with strict range validation (5..=128) and entropy calculation.
    pub fn generate_password(input: PasswordGenInput) -> GeneratedSecretView {
        engine::generator().password(input)
    }

    /// Generate an EFF Diceware passphrase with strict word count validation (3..=20) and entropy.
    pub fn generate_passphrase(input: PassphraseGenInput) -> GeneratedSecretView {
        engine::generator().passphrase(input)
    }

    /// Generate or import an SSH keypair without saving yet (for live preview in SshKeyModal).
    pub fn preview_ssh_key(
        mode: String,
        algorithm: String,
        comment: String,
        private_key_pem: String,
    ) -> SshKeyPreviewView {
        let mode = if mode == "import" { "import" } else { "create" };
        ssh::preview(mode, &algorithm, &comment, &private_key_pem)
    }

    /// Save a generated or imported SSH key to the Bitwarden vault or export it to `~/.ssh`.
    pub fn save_ssh_key(
        input: SshKeySaveInput,
        _filter: VaultFilterInput,
    ) -> SshKeySaveOutcomeView {
        engine::ssh().save(input)
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
                        .and_then(|item| inspector::totp_view(item.totp.as_deref()))
                });
                DaemonTickView {
                    online: true,
                    unlocked: state.phase == AppPhase::Unlocked,
                    quick_unlock_ready: state.quick_unlock_ready,
                    ssh_prompt: state.ssh_prompt.clone(),
                    ssh_pending_count: state
                        .ssh_prompt
                        .as_ref()
                        .map(|prompt| prompt.remaining + 1)
                        .unwrap_or(0),
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
        let pending =
            daemon(json!({ "action": "ssh_agent_pending", "touch": false })).unwrap_or(Value::Null);
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
            let code = response
                .get("code")
                .and_then(|value| value.as_str())?
                .to_string();
            Some(TotpLiveView {
                valid: true,
                formatted: format!(
                    "{} {}",
                    &code[..3.min(code.len())],
                    &code[3.min(code.len())..]
                ),
                code,
                remaining: response
                    .get("ttl")
                    .and_then(|value| value.as_u64())
                    .unwrap_or(0) as u32,
                period: response
                    .get("period")
                    .and_then(|value| value.as_u64())
                    .unwrap_or(30) as u32,
                error: None,
            })
        });
        let unlocked = ping
            .get("unlocked")
            .and_then(|value| value.as_bool())
            .unwrap_or(false);
        if !unlocked {
            vault::clear_cached_vault();
        }
        DaemonTickView {
            online: true,
            unlocked,
            quick_unlock_ready: ping
                .get("quick_unlock")
                .and_then(|value| value.as_bool())
                .unwrap_or(false),
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
                if state
                    .ssh_prompt
                    .as_ref()
                    .is_some_and(|prompt| prompt.id as u64 == prompt_id)
                {
                    state.ssh_prompt = None;
                }
                state.error = None;
            });
            return Self::poll_daemon_tick(None);
        }
        let _ = daemon(
            json!({ "action": "ssh_agent_reply", "id": prompt_id, "approve": approve, "touch": true }),
        );
        Self::poll_daemon_tick(None)
    }

    /// Load current configuration, health status, and diagnostic logs.
    pub fn get_settings() -> SettingsSnapshotView {
        engine::settings().snapshot()
    }

    /// Update configuration settings (validating URL scheme security and refreshing daemon state).
    pub fn update_settings(input: SettingsUpdateInput) -> SettingsSnapshotView {
        engine::settings().update(input)
    }

    /// Run system health diagnostics.
    pub fn refresh_health() -> HealthSnapshotView {
        engine::diagnostics().health()
    }

    /// Check for engine/plugin updates.
    pub fn check_updates(force: bool) -> UpdateStatusView {
        engine::diagnostics().updates(force)
    }

    /// Safely open an `http://` or `https://` URL via `xdg-open` (rejecting all other schemes).
    pub fn launch_url(raw_url: String) -> bool {
        engine::platform().launch_url(raw_url)
    }

    /// Show the desktop's native file picker and return the chosen path.
    pub fn pick_file(
        title: Option<String>,
        filter_name: Option<String>,
        extensions: Option<Vec<String>>,
    ) -> Option<String> {
        engine::platform().pick_file(title, filter_name, extensions)
    }

    /// Show the desktop's native folder picker and return the chosen path.
    pub fn pick_folder(title: Option<String>) -> Option<String> {
        engine::platform().pick_folder(title)
    }

    /// Show the desktop's native save dialog and return the chosen path.
    pub fn save_file(title: Option<String>, default_name: Option<String>) -> Option<String> {
        engine::platform().save_file(title, default_name)
    }

    /// Read a UTF-8 text file (used to import SSH keys from the file picker).
    pub fn read_text_file(path: String) -> Option<String> {
        engine::platform().read_text_file(path)
    }

    /// Verify the master password without unlocking the daemon.
    pub fn verify_master_password(password: String) -> bool {
        engine::auth().verify_master_password(&password)
    }
}

/// Expands a leading `~` to the current user's home directory.
fn expand_home(path: &str) -> PathBuf {
    let trimmed = path.trim();
    if trimmed == "~" || trimmed.starts_with("~/") {
        let home = std::env::var("HOME").unwrap_or_else(|_| ".".to_string());
        let rest = trimmed
            .strip_prefix('~')
            .unwrap_or(trimmed)
            .trim_start_matches('/');
        if rest.is_empty() {
            return PathBuf::from(home);
        }
        return PathBuf::from(home).join(rest);
    }
    PathBuf::from(trimmed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{normalize_optional_code, two_factor_provider_view};
    use crate::platform::validate_launch_url;
    use crate::projection::fuzzy_score;

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
            assert!(
                result.ok,
                "length {length} must be accepted: {:?}",
                result.error
            );
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
            assert!(
                result.ok,
                "words {words} must be accepted: {:?}",
                result.error
            );
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
        assert_eq!(
            format_card_number("4111111111111234"),
            "4111 1111 1111 1234"
        );
        assert_eq!(
            format_card_number("4111-1111-1111-1234"),
            "4111 1111 1111 1234"
        );
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
        assert!(OmawardenBridge::install_missing_dependencies(vec![
            "libsecret".to_string()
        ]));

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
        assert!(
            settings.error.is_some(),
            "plain http to a remote host must be rejected"
        );

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
        assert!(!OmawardenBridge::launch_url(
            "javascript:alert(1)".to_string()
        ));
        assert!(!OmawardenBridge::launch_url(
            "file:///etc/passwd".to_string()
        ));
        assert!(OmawardenBridge::launch_url(
            "https://example.com".to_string()
        ));
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
        assert_eq!(
            if code.is_empty() { None } else { Some(code) },
            Some("123456")
        );
    }
}
