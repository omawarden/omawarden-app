//! The data the bridge hands to and takes from the UI.
//!
//! These are the shapes in `native.d.ts`: one struct per screen or action
//! payload, and the enums the UI switches on. They are re-exported from the
//! crate root, so every module and the bridge itself name them the same way.

use nsh_core::prelude::*;

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
#[derive(Clone, Copy, Debug, PartialEq, Eq, PropEnum, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "lowercase")]
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
