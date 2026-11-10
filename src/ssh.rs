//! SSH keys: previewing a generated or imported key, and saving or exporting it.
//!
//! [`SshEngine`] is the seam. [`InProcess`] writes the key to the vault or to
//! `~/.ssh`; [`Mock`] reports the same outcome without touching either.

use std::path::PathBuf;

use serde_json::{Value, json};

use crate::vault;
use crate::{
    SshKeyMode, SshKeyPreviewView, SshKeySaveInput, SshKeySaveOutcomeView, daemon, expand_home,
};

/// The SSH capabilities the bridge exposes.
pub(crate) trait SshEngine {
    /// Saves `input` to the vault, or exports it to `~/.ssh`.
    fn save(&self, input: SshKeySaveInput) -> SshKeySaveOutcomeView;
}

/// The real adapter: the vault daemon and the filesystem.
pub(crate) struct InProcess;

impl SshEngine for InProcess {
    fn save(&self, input: SshKeySaveInput) -> SshKeySaveOutcomeView {
        real_save_ssh_key(input)
    }
}

/// The mock adapter: the seeded mock state.
pub(crate) struct Mock;

impl SshEngine for Mock {
    fn save(&self, input: SshKeySaveInput) -> SshKeySaveOutcomeView {
        mock_save_ssh_key(input)
    }
}

/// Builds the preview for `mode`, generating or importing the key.
pub(crate) fn preview(
    mode: &str,
    algorithm: &str,
    comment: &str,
    private_key_pem: &str,
) -> SshKeyPreviewView {
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
    match omawarden::ssh::generate_keypair(
        algorithm,
        Some(comment).filter(|value| !value.is_empty()),
    ) {
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

/// Generates or imports the key and returns the failure the bridge reports.
fn prepare(input: &SshKeySaveInput) -> Result<SshKeyPreviewView, SshKeySaveOutcomeView> {
    let mode = match input.mode {
        SshKeyMode::Import => "import",
        _ => "create",
    };
    let preview = preview(
        mode,
        &input.algorithm,
        &input.comment,
        &input.private_key_pem,
    );
    if preview.ok {
        Ok(preview)
    } else {
        Err(SshKeySaveOutcomeView {
            ok: false,
            message: "Could not prepare the SSH key.".to_string(),
            path: None,
            item_id: None,
            error: preview.error,
        })
    }
}

/// Probes the daemon for the vault's unlocked state without spawning
/// anything. Returns `None` when the daemon does not answer, so the caller
/// can distinguish "vault is locked" from "the daemon is not running".
///
/// The ping reply carries `unlocked`; the status reply carries `is_unlocked`.
/// Either field is authoritative, so read both.
fn daemon_unlocked() -> Option<bool> {
    let ping = daemon(json!({ "action": "ping", "touch": false }));
    if let Some(unlocked) = ping
        .as_ref()
        .and_then(|value| value.get("unlocked"))
        .and_then(|value| value.as_bool())
    {
        return Some(unlocked);
    }
    let status = daemon(json!({ "action": "status", "touch": false }));
    status
        .as_ref()
        .and_then(|value| value.get("is_unlocked"))
        .and_then(|value| value.as_bool())
}

/// The upstream flag that must be enabled for type-5 SSH key storage.
const SSH_KEY_CAPABILITY: &str = "ssh-key-vault-item";

/// Asks the daemon whether the server advertises `ssh-key-vault-item`.
///
/// Returns `Some(reason)` only when the daemon reports the feature as disabled
/// or unsupported. Everything else — an older daemon without the
/// `server_capabilities` action, a failed discovery, or a reply without the
/// entry — returns `None`, so this check fails open and never blocks a save on
/// its own. The daemon answers from the cache its sync refreshes, so the usual
/// call is a file read rather than a network probe.
fn ssh_key_capability_block() -> Option<String> {
    let response = daemon(json!({ "action": "server_capabilities", "touch": false }))?;
    if response.get("ok").and_then(Value::as_bool) != Some(true) {
        return None;
    }
    let entry = response
        .get("matrix")
        .and_then(Value::as_array)?
        .iter()
        .find(|entry| entry.get("name").and_then(Value::as_str) == Some(SSH_KEY_CAPABILITY))?;
    let status = entry.get("status").and_then(Value::as_str)?;
    if status != "disabled" && status != "unsupported" {
        return None;
    }
    Some(format!(
        "Upstream server does not support '{SSH_KEY_CAPABILITY}' (feature status: {status}). \
         For Vaultwarden self-hosters: enable SSH Key vault storage by configuring \
         EXPERIMENTAL_CLIENT_FEATURE_FLAGS={SSH_KEY_CAPABILITY} in your server environment."
    ))
}

/// Writes the key to the vault or to `~/.ssh`.
fn real_save_ssh_key(input: SshKeySaveInput) -> SshKeySaveOutcomeView {
    let preview = match prepare(&input) {
        Ok(preview) => preview,
        Err(outcome) => return outcome,
    };

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
    // The daemon only accepts `ssh_key_create_v2`; the legacy action is
    // rejected with "Update the CLI to create SSH keys safely." It also
    // refuses the write when the vault is locked, so probe first instead of
    // sending a request the daemon will throw away. A probe that gets no
    // answer at all is a missing daemon, not a locked vault, and must say so.
    match daemon_unlocked() {
        Some(true) => {}
        Some(false) => {
            return SshKeySaveOutcomeView {
                ok: false,
                message: "Could not save the SSH key.".to_string(),
                path: None,
                item_id: None,
                error: Some("Unlock the vault before saving an SSH key.".to_string()),
            };
        }
        None => {
            return SshKeySaveOutcomeView {
                ok: false,
                message: "Could not save the SSH key.".to_string(),
                path: None,
                item_id: None,
                error: Some("The Omawarden daemon is not running.".to_string()),
            };
        }
    }
    if let Some(error) = ssh_key_capability_block() {
        return SshKeySaveOutcomeView {
            ok: false,
            message: "Could not save the SSH key.".to_string(),
            path: None,
            item_id: None,
            error: Some(error),
        };
    }
    let response = daemon(json!({
        "action": "ssh_key_create_v2",
        "name": name,
        "private_key": preview.private_key,
        "public_key": preview.public_key,
        "fingerprint": preview.fingerprint,
        "notes": input.comment,
        "touch": true,
    }));
    map_ssh_save_response(response)
}

/// Maps a daemon save reply onto the outcome view the UI asserts on.
///
/// The v2 action returns `{"ok": true, "outcome": "saved"|"saved_needs_sync",
/// "item": {"id": ..., "revisionDate": ...}}`; `item.id` becomes `item_id`.
/// `None` means the daemon did not answer, and a non-ok reply carries its own
/// error string.
fn map_ssh_save_response(response: Option<Value>) -> SshKeySaveOutcomeView {
    match response {
        Some(response) if response.get("ok").and_then(|value| value.as_bool()) == Some(true) => {
            vault::clear_cached_vault();
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
            error: response
                .get("error")
                .and_then(|value| value.as_str())
                .map(str::to_string),
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

/// Reports the outcome the UI tests assert on, without touching disk or vault.
fn mock_save_ssh_key(input: SshKeySaveInput) -> SshKeySaveOutcomeView {
    if let Err(outcome) = prepare(&input) {
        return outcome;
    }
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
        path: if input.export_to_ssh {
            Some(format!("{export_dir}/{filename}"))
        } else {
            None
        },
        item_id: if input.save_to_vault {
            Some("mock-ssh-item".to_string())
        } else {
            None
        },
        error: None,
    };
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::daemon::test_seam;
    use serde_json::{Value, json};

    /// A save input that generates an ED25519 key and writes to the vault.
    fn vault_save_input() -> SshKeySaveInput {
        SshKeySaveInput {
            mode: SshKeyMode::Create,
            algorithm: "ed25519".to_string(),
            comment: "test".to_string(),
            private_key_pem: String::new(),
            name: "My Key".to_string(),
            filename: String::new(),
            save_to_vault: true,
            export_to_ssh: false,
            export_dir: None,
        }
    }

    /// Ticket 1 + 2: the save path sends `ssh_key_create_v2` with the same
    /// payload fields the daemon expects, and the v2 receipt's `item.id`
    /// becomes `item_id`.
    #[test]
    fn real_save_ssh_key_sends_v2_action_and_reads_item_id() {
        let _seam = test_seam::set(|action: Value| {
            match action.get("action").and_then(|value| value.as_str()) {
                Some("ping") => Some(json!({ "ok": true, "unlocked": true })),
                Some("ssh_key_create_v2") => {
                    assert_eq!(
                        action.get("name").and_then(|value| value.as_str()),
                        Some("My Key"),
                        "the item name must pass through unchanged"
                    );
                    assert_eq!(
                        action.get("notes").and_then(|value| value.as_str()),
                        Some("test"),
                        "the comment must pass through as notes"
                    );
                    assert_eq!(
                        action.get("touch").and_then(|value| value.as_bool()),
                        Some(true),
                        "the touch flag must pass through"
                    );
                    Some(json!({
                        "ok": true,
                        "outcome": "saved_needs_sync",
                        "item": { "id": "cipher-123", "revisionDate": "2026-11-09T00:00:00Z" }
                    }))
                }
                _ => None,
            }
        });

        let outcome = real_save_ssh_key(vault_save_input());

        assert!(outcome.ok, "save must succeed: {:?}", outcome.error);
        assert_eq!(outcome.item_id.as_deref(), Some("cipher-123"));
        assert_eq!(outcome.message, "Saved SSH key to the vault.");
    }

    /// Ticket 3: a locked vault short-circuits before any write request is
    /// sent, with the unlock message the daemon would otherwise reject with.
    #[test]
    fn real_save_ssh_key_refuses_when_vault_locked() {
        let _seam = test_seam::set(|action: Value| {
            let action_str = action
                .get("action")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            assert_ne!(
                action_str, "ssh_key_create_v2",
                "no write request may be sent when the vault is locked"
            );
            Some(json!({ "ok": true, "unlocked": false }))
        });

        let outcome = real_save_ssh_key(vault_save_input());

        assert!(!outcome.ok, "a locked vault must not save");
        assert_eq!(
            outcome.error.as_deref(),
            Some("Unlock the vault before saving an SSH key.")
        );
    }

    /// Ticket 3: when the daemon answers neither probe, the outcome must say
    /// the daemon is missing rather than blaming a locked vault.
    #[test]
    fn real_save_ssh_key_reports_missing_daemon() {
        let _seam = test_seam::set(|_action: Value| None);

        let outcome = real_save_ssh_key(vault_save_input());

        assert!(!outcome.ok);
        assert_eq!(
            outcome.error.as_deref(),
            Some("The Omawarden daemon is not running.")
        );
    }

    /// A server without `ssh-key-vault-item` is refused before the write, with
    /// the actionable message the CLI prints.
    #[test]
    fn real_save_ssh_key_refuses_when_the_server_lacks_ssh_key_storage() {
        let _seam = test_seam::set(|action: Value| {
            match action.get("action").and_then(|value| value.as_str()) {
                Some("ping") => Some(json!({ "ok": true, "unlocked": true })),
                Some("server_capabilities") => Some(json!({
                    "ok": true,
                    "matrix": [
                        { "name": "ssh-key-vault-item", "status": "disabled" }
                    ]
                })),
                Some("ssh_key_create_v2") => panic!("the write must not be sent"),
                _ => None,
            }
        });

        let outcome = real_save_ssh_key(vault_save_input());

        assert!(!outcome.ok);
        let error = outcome.error.unwrap_or_default();
        assert!(error.contains("ssh-key-vault-item"), "{error}");
        assert!(
            error.contains("EXPERIMENTAL_CLIENT_FEATURE_FLAGS"),
            "{error}"
        );
    }

    /// An older daemon that does not know `server_capabilities` must not block
    /// the save: the capability check fails open.
    #[test]
    fn real_save_ssh_key_fails_open_when_capabilities_are_unknown() {
        let _seam = test_seam::set(|action: Value| {
            match action.get("action").and_then(|value| value.as_str()) {
                Some("ping") => Some(json!({ "ok": true, "unlocked": true })),
                Some("server_capabilities") => Some(json!({
                    "ok": false,
                    "error": "Unknown action: server_capabilities"
                })),
                Some("ssh_key_create_v2") => Some(json!({
                    "ok": true,
                    "outcome": "saved",
                    "item": { "id": "cipher-9" }
                })),
                _ => None,
            }
        });

        let outcome = real_save_ssh_key(vault_save_input());

        assert!(outcome.ok, "{:?}", outcome.error);
        assert_eq!(outcome.item_id.as_deref(), Some("cipher-9"));
    }

    /// Ticket 2: the outcome mapper preserves the existing error handling for
    /// a non-ok reply and for `None` (daemon not running).
    #[test]
    fn map_ssh_save_response_handles_rejection_and_missing_daemon() {
        let rejected = map_ssh_save_response(Some(json!({
            "ok": false,
            "outcome": "rejected",
            "error": "Vault is locked. Please unlock the vault first."
        })));
        assert!(!rejected.ok);
        assert_eq!(
            rejected.error.as_deref(),
            Some("Vault is locked. Please unlock the vault first.")
        );
        assert!(rejected.item_id.is_none());

        let missing = map_ssh_save_response(None);
        assert!(!missing.ok);
        assert_eq!(
            missing.error.as_deref(),
            Some("The Omawarden daemon is not running.")
        );
    }
}
