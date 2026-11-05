//! SSH keys: previewing a generated or imported key, and saving or exporting it.
//!
//! [`SshEngine`] is the seam. [`InProcess`] writes the key to the vault or to
//! `~/.ssh`; [`Mock`] reports the same outcome without touching either.

use std::path::PathBuf;

use serde_json::json;

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
