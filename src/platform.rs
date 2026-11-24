//! The host platform: opening a URL, the native file dialogs, and reading a
//! text file.
//!
//! [`PlatformEngine`] is the seam. [`InProcess`] opens the desktop's own
//! dialogs, launches the host's opener (see [`crate::host`]), and touches the
//! filesystem; [`Mock`] names a path under `/tmp/omawarden-mock` so the UI tests
//! never show a dialog.

use std::path::PathBuf;

use crate::host::{Host, open_with};

/// The platform capabilities the bridge exposes.
pub(crate) trait PlatformEngine {
    /// Opens an http(s) URL in the user's browser.
    fn launch_url(&self, raw_url: String) -> bool;

    /// Shows the native file picker.
    fn pick_file(
        &self,
        title: Option<String>,
        filter_name: Option<String>,
        extensions: Option<Vec<String>>,
    ) -> Option<String>;

    /// Shows the native folder picker.
    fn pick_folder(&self, title: Option<String>) -> Option<String>;

    /// Shows the native save dialog.
    fn save_file(&self, title: Option<String>, default_name: Option<String>) -> Option<String>;

    /// Reads a UTF-8 text file of at most 2 MiB.
    fn read_text_file(&self, path: String) -> Option<String>;
}

/// The real adapter: the host's opener, the desktop's dialogs, and the
/// filesystem.
pub(crate) struct InProcess;

impl PlatformEngine for InProcess {
    fn launch_url(&self, raw_url: String) -> bool {
        let Ok(parsed) = validate_launch_url(&raw_url) else {
            return false;
        };
        open_with(Host::current(), parsed.as_str().as_ref())
    }

    fn pick_file(
        &self,
        title: Option<String>,
        filter_name: Option<String>,
        extensions: Option<Vec<String>>,
    ) -> Option<String> {
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

    fn pick_folder(&self, title: Option<String>) -> Option<String> {
        let mut dialog = rfd::FileDialog::new();
        if let Some(title) = title {
            dialog = dialog.set_title(title);
        }
        if let Some(home) = std::env::var_os("HOME") {
            dialog = dialog.set_directory(home);
        }
        dialog.pick_folder().map(|path| path.display().to_string())
    }

    fn save_file(&self, title: Option<String>, default_name: Option<String>) -> Option<String> {
        let mut dialog = rfd::FileDialog::new();
        if let Some(title) = title {
            dialog = dialog.set_title(title);
        }
        if let Some(name) = default_name {
            dialog = dialog.set_file_name(name);
        }
        dialog.save_file().map(|path| path.display().to_string())
    }

    fn read_text_file(&self, path: String) -> Option<String> {
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
}

/// The mock adapter: fixed paths under `/tmp/omawarden-mock`.
pub(crate) struct Mock;

impl PlatformEngine for Mock {
    fn launch_url(&self, raw_url: String) -> bool {
        validate_launch_url(&raw_url).is_ok()
    }

    fn pick_file(
        &self,
        _title: Option<String>,
        _filter_name: Option<String>,
        _extensions: Option<Vec<String>>,
    ) -> Option<String> {
        Some("/tmp/omawarden-mock/client.pem".to_string())
    }

    fn pick_folder(&self, _title: Option<String>) -> Option<String> {
        Some("/tmp/omawarden-mock/folder".to_string())
    }

    fn save_file(&self, _title: Option<String>, default_name: Option<String>) -> Option<String> {
        let name = default_name.unwrap_or_else(|| "attachment.bin".to_string());
        Some(format!("/tmp/omawarden-mock/{name}"))
    }

    fn read_text_file(&self, _path: String) -> Option<String> {
        Some(
            "-----BEGIN OPENSSH PRIVATE KEY-----\nmock-key-material\n-----END OPENSSH PRIVATE KEY-----"
                .to_string(),
        )
    }
}

/// Parses a URL that may be opened in the browser.
pub(crate) fn validate_launch_url(raw: &str) -> Result<url::Url, String> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn url_launching_accepts_only_http_and_https() {
        assert!(validate_launch_url("https://vault.example.com").is_ok());
        assert!(validate_launch_url("http://127.0.0.1:8080").is_ok());
        assert!(validate_launch_url("file:///etc/passwd").is_err());
        assert!(validate_launch_url("javascript:alert(1)").is_err());
        assert!(validate_launch_url("   ").is_err());
    }

    #[test]
    fn a_parsed_url_is_what_the_launcher_receives() {
        let parsed = validate_launch_url("  https://vault.example.com/items  ").unwrap();
        assert_eq!(parsed.as_str(), "https://vault.example.com/items");
    }
}
