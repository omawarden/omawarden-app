//! Attachments: previewing, saving, cleaning up, and opening decrypted files.
//!
//! [`AttachmentsEngine`] is the seam. [`InProcess`] talks to the engine's
//! attachment layer and the daemon; [`Mock`] answers from the seeded items.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde_json::{Value, json};

use crate::diagnostics::push_log;
use crate::{AttachmentOutcomeView, MockState, daemon, load_config, with_mock};

/// The attachment capabilities the bridge exposes.
pub(crate) trait AttachmentsEngine {
    /// Previews or opens an attachment.
    fn open(&self, cipher_id: String, attachment_id: String, mode: String)
    -> AttachmentOutcomeView;

    /// Removes temporary decrypted previews, all of them when no id is given.
    fn clean_previews(&self, cipher_id: Option<String>) -> bool;

    /// Downloads an attachment to `destination`.
    fn save(
        &self,
        cipher_id: String,
        attachment_id: String,
        destination: String,
    ) -> AttachmentOutcomeView;

    /// Opens a decrypted preview in the system viewer.
    fn open_path(&self, path: String) -> bool;
}

/// The real adapter: the engine's attachment layer and the daemon.
pub(crate) struct InProcess;

impl AttachmentsEngine for InProcess {
    fn open(
        &self,
        cipher_id: String,
        attachment_id: String,
        mode: String,
    ) -> AttachmentOutcomeView {
        real_open_attachment(cipher_id, attachment_id, mode)
    }

    fn clean_previews(&self, cipher_id: Option<String>) -> bool {
        real_clean_attachment_previews(cipher_id)
    }

    fn save(
        &self,
        cipher_id: String,
        attachment_id: String,
        destination: String,
    ) -> AttachmentOutcomeView {
        real_save_attachment(cipher_id, attachment_id, destination)
    }

    fn open_path(&self, path: String) -> bool {
        real_open_attachment_path(path)
    }
}

/// The mock adapter: the seeded mock items.
pub(crate) struct Mock;

impl AttachmentsEngine for Mock {
    fn open(
        &self,
        cipher_id: String,
        attachment_id: String,
        mode: String,
    ) -> AttachmentOutcomeView {
        with_mock(|state| mock_open_attachment(state, cipher_id, attachment_id, mode))
    }

    fn clean_previews(&self, cipher_id: Option<String>) -> bool {
        with_mock(|state| mock_clean_attachment_previews(state, cipher_id))
    }

    fn save(
        &self,
        cipher_id: String,
        attachment_id: String,
        destination: String,
    ) -> AttachmentOutcomeView {
        with_mock(|state| mock_save_attachment(state, cipher_id, attachment_id, destination))
    }

    fn open_path(&self, path: String) -> bool {
        with_mock(|state| mock_open_attachment_path(state, path))
    }
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

fn real_open_attachment(
    cipher_id: String,
    attachment_id: String,
    mode: String,
) -> AttachmentOutcomeView {
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
                        attachment.get("id").and_then(|value| value.as_str())
                            == Some(attachment_id.as_str())
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

fn mock_open_attachment(
    state: &mut MockState,
    cipher_id: String,
    attachment_id: String,
    _mode: String,
) -> AttachmentOutcomeView {
    let attachment = state
        .items
        .iter()
        .find(|item| item.id == cipher_id)
        .and_then(|item| {
            item.attachments
                .iter()
                .find(|attachment| attachment.id == attachment_id)
        });
    match attachment {
        Some(attachment) => {
            let is_image = matches!(
                attachment
                    .filename
                    .rsplit('.')
                    .next()
                    .unwrap_or_default()
                    .to_lowercase()
                    .as_str(),
                "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg"
            );
            let is_text = matches!(
                attachment
                    .filename
                    .rsplit('.')
                    .next()
                    .unwrap_or_default()
                    .to_lowercase()
                    .as_str(),
                "txt" | "md" | "json" | "log" | "csv"
            );
            AttachmentOutcomeView {
                ok: true,
                path: Some(format!("/run/user/1000/omawarden/{}", attachment.filename)),
                filename: Some(attachment.filename.clone()),
                is_image,
                is_text,
                text_content: if is_text {
                    Some("Mock attachment preview".to_string())
                } else {
                    None
                },
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
}

fn real_clean_attachment_previews(cipher_id: Option<String>) -> bool {
    omawarden::attachment::clean_previews(cipher_id.as_deref()).is_ok()
}

fn mock_clean_attachment_previews(_state: &mut MockState, _cipher_id: Option<String>) -> bool {
    true
}

fn real_save_attachment(
    cipher_id: String,
    attachment_id: String,
    destination: String,
) -> AttachmentOutcomeView {
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
                        attachment.get("id").and_then(Value::as_str) == Some(attachment_id.as_str())
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

fn mock_save_attachment(
    state: &mut MockState,
    cipher_id: String,
    attachment_id: String,
    destination: String,
) -> AttachmentOutcomeView {
    let attachment = state
        .items
        .iter()
        .find(|item| item.id == cipher_id)
        .and_then(|item| {
            item.attachments
                .iter()
                .find(|entry| entry.id == attachment_id)
        });
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
}

fn real_open_attachment_path(path: String) -> bool {
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

fn mock_open_attachment_path(_state: &mut MockState, _path: String) -> bool {
    true
}
