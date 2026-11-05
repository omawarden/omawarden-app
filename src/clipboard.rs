//! The clipboard: copying a cipher field, copying arbitrary text, and the
//! clear timer.
//!
//! [`ClipboardEngine`] is the seam. [`InProcess`] writes the real Wayland
//! clipboard; [`Mock`] only reports the toast the UI tests assert on.

use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use omawarden::vault::VaultItem;
use serde_json::json;

use crate::inspector::totp_view;
use crate::vault;
use crate::{CopyOutcomeView, MockState, daemon, load_config, with_mock};

/// The clipboard capabilities the bridge exposes.
pub(crate) trait ClipboardEngine {
    /// Copies one field of a cipher, honoring the Clipboard Guard TTL.
    fn copy_cipher_field(
        &self,
        cipher_id: String,
        field: String,
        custom_index: Option<u32>,
    ) -> CopyOutcomeView;

    /// Copies arbitrary text, clearing it after the TTL when sensitive.
    fn copy_text(&self, text: String, label: String, sensitive: bool) -> CopyOutcomeView;
}

/// The real adapter: the Wayland clipboard and its clear timer.
pub(crate) struct InProcess;

impl ClipboardEngine for InProcess {
    fn copy_cipher_field(
        &self,
        cipher_id: String,
        field: String,
        custom_index: Option<u32>,
    ) -> CopyOutcomeView {
        real_copy_cipher_field(cipher_id, field, custom_index)
    }

    fn copy_text(&self, text: String, label: String, sensitive: bool) -> CopyOutcomeView {
        real_copy_text(text, label, sensitive)
    }
}

/// The mock adapter: the process-wide mock state.
pub(crate) struct Mock;

impl ClipboardEngine for Mock {
    fn copy_cipher_field(
        &self,
        cipher_id: String,
        field: String,
        custom_index: Option<u32>,
    ) -> CopyOutcomeView {
        with_mock(|state| mock_copy_cipher_field(state, cipher_id, field, custom_index))
    }

    fn copy_text(&self, text: String, label: String, sensitive: bool) -> CopyOutcomeView {
        with_mock(|state| mock_copy_text(state, text, label, sensitive))
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

fn real_copy_cipher_field(
    cipher_id: String,
    field: String,
    custom_index: Option<u32>,
) -> CopyOutcomeView {
    let cached_item = vault::cached_vault().lock().ok().and_then(|guard| {
        guard
            .as_ref()
            .and_then(|cached| cached.item(&cipher_id).cloned())
    });
    let item = match cached_item {
        Some(item) => item,
        None => {
            let response =
                daemon(json!({ "action": "get_item", "query": cipher_id, "touch": false }));
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
        error: if ok {
            None
        } else {
            Some("Could not access the clipboard.".to_string())
        },
    }
}

fn mock_copy_cipher_field(
    state: &mut MockState,
    cipher_id: String,
    field: String,
    custom_index: Option<u32>,
) -> CopyOutcomeView {
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
}

fn real_copy_text(text: String, label: String, sensitive: bool) -> CopyOutcomeView {
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
        error: if ok {
            None
        } else {
            Some("Could not access the clipboard.".to_string())
        },
    }
}

fn mock_copy_text(
    state: &mut MockState,
    _text: String,
    label: String,
    sensitive: bool,
) -> CopyOutcomeView {
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
}
