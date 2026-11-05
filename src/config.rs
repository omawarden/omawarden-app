//! Configuration and server URLs: loading the user's config, and the rules
//! for accepting, normalizing, and displaying a server or identity URL.
//!
//! These are plain functions over the engine's config, so there is no adapter
//! seam. Settings, diagnostics, auth, and the vault all read the config and
//! sanitize URLs through here.

use omawarden::api::is_loopback_host;

/// The configuration manager the app uses.
pub(crate) fn config_manager() -> omawarden::config::ConfigManager {
    omawarden::config::ConfigManager::new(None)
}

/// Loads the current configuration.
pub(crate) fn load_config() -> omawarden::config::Config {
    config_manager().load()
}

/// Removes credentials, query strings and fragments from a URL before showing it.
pub(crate) fn sanitize_server_url(raw: &str) -> String {
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
pub(crate) fn validate_server_url(raw: &str, field: &str) -> Result<String, String> {
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
