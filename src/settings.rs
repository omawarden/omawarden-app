//! Settings: the configuration snapshot and the update path.
//!
//! [`SettingsEngine`] is the seam. [`InProcess`] reads and writes the real
//! config file; [`Mock`] serves the headless UI tests from the process-wide
//! mock state.

use omawarden::config::ConfigUpdateOptions;
use omawarden::keyring::KeyringManager;
use omawarden::storage::StorageManager;

use nsh_core::prelude::*;

use crate::diagnostics::{process_rss_mb, recent_logs};
use crate::{
    DiagnosticsView, HealthSnapshotView, MockState, SshAgentPolicy, config_manager, load_config,
    sanitize_server_url, validate_server_url, with_mock,
};

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
}

/// The settings capabilities the bridge exposes.
pub(crate) trait SettingsEngine {
    /// Loads the configuration, health, and diagnostics.
    fn snapshot(&self) -> SettingsSnapshotView;

    /// Applies `input`, validating URL schemes and refreshing daemon state.
    fn update(&self, input: SettingsUpdateInput) -> SettingsSnapshotView;
}

/// The real adapter: the config file, the engine, and the daemon.
pub(crate) struct InProcess;

impl SettingsEngine for InProcess {
    fn snapshot(&self) -> SettingsSnapshotView {
        real_settings()
    }

    fn update(&self, input: SettingsUpdateInput) -> SettingsSnapshotView {
        real_update(input)
    }
}

/// The mock adapter: the process-wide mock state.
pub(crate) struct Mock;

impl SettingsEngine for Mock {
    fn snapshot(&self) -> SettingsSnapshotView {
        with_mock(|state| mock_snapshot(state))
    }

    fn update(&self, input: SettingsUpdateInput) -> SettingsSnapshotView {
        with_mock(|state| mock_update(state, input))
    }
}

/// The real settings snapshot.
fn real_settings() -> SettingsSnapshotView {
    let config = load_config();
    let health = crate::engine::diagnostics().health();
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
        },
        health,
        diagnostics: DiagnosticsView {
            server_url_sanitized: sanitize_server_url(&config.server_url),
            logs: recent_logs(),
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            engine_version,
            git_commit: option_env!("GIT_HASH").unwrap_or("unknown").to_string(),
            build_date: option_env!("BUILD_DATE").unwrap_or("unknown").to_string(),
            memory_rss_mb: process_rss_mb(),
        },
        error: None,
    }
}

/// Applies `input` to the real config and returns the refreshed snapshot.
fn real_update(input: SettingsUpdateInput) -> SettingsSnapshotView {
    // Captured before `input` is moved into `ConfigUpdateOptions`: the daemon
    // has to be told about these two, and the CLI's dispatch is the only place
    // that does it. Reading them here keeps the value available after the move.
    let auto_lock_minutes = input.auto_lock_minutes;
    let ssh_agent_changed = input.ssh_agent_enabled.is_some() || input.ssh_agent_confirm.is_some();
    let options = ConfigUpdateOptions {
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
    let result = config_manager().update_config(
        options,
        &StorageManager::default(),
        &KeyringManager::default(),
    );
    match result {
        Ok(_) => {
            apply_daemon_side_effects(auto_lock_minutes, ssh_agent_changed);
            real_settings()
        }
        Err(error) => {
            let mut snapshot = real_settings();
            snapshot.error = Some(error.to_string());
            snapshot
        }
    }
}

/// Tells the running daemon about the settings it caches.
///
/// `ConfigManager::update_config` writes `config.json` and sends nothing, so a
/// saved auto-lock timeout or SSH-agent toggle would not take effect until the
/// next daemon restart. The engine's own CLI dispatches exactly these two after
/// `config set` (`omawarden/src/main.rs:1683,1687`), and this sends the same
/// action shapes it does: `auto_lock_minutes`, the unit the setting is stored
/// in, rather than the seconds it could also accept.
///
/// A dispatch failure is logged rather than surfaced: the config file already
/// holds the new value, so the user's intent is recorded and the daemon picks
/// it up on its next start. Reporting success for a policy the daemon is not
/// yet running would be worse, hence the log.
fn apply_daemon_side_effects(auto_lock_minutes: Option<i64>, ssh_agent_changed: bool) {
    if let Some(minutes) = auto_lock_minutes {
        let action = serde_json::json!({
            "action": "set_auto_lock",
            "auto_lock_minutes": minutes,
        });
        if crate::daemon::daemon(action).is_none() {
            crate::diagnostics::push_log(
                crate::diagnostics::LogLevel::Warn,
                "app:settings",
                "The auto-lock timeout was saved but the daemon did not take it; it will apply on the next daemon start.",
            );
        }
    }
    if ssh_agent_changed {
        let action = serde_json::json!({ "action": "ssh_agent_apply" });
        if crate::daemon::daemon(action).is_none() {
            crate::diagnostics::push_log(
                crate::diagnostics::LogLevel::Warn,
                "app:settings",
                "The SSH-agent setting was saved but the daemon did not take it; it will apply on the next daemon start.",
            );
        }
    }
}

/// The mock settings snapshot.
fn mock_snapshot(state: &MockState) -> SettingsSnapshotView {
    let settings = &state.settings;
    let config = SettingsView {
        server_url: settings.server_url.clone(),
        identity_url: settings.identity_url.clone(),
        download_dir: settings.download_dir.clone(),
        auto_lock_minutes: settings.auto_lock_minutes,
        clipboard_clear_seconds: settings.clipboard_clear_seconds,
        email: settings.email.clone(),
        remember_email: settings.remember_email,
        check_updates: settings.check_updates,
        show_website_icons: settings.show_website_icons,
        remember_last_search: settings.remember_last_search,
        max_attachment_size_mb: settings.max_attachment_size_mb,
        ssh_agent_enabled: settings.ssh_agent_enabled,
        ssh_agent_confirm: settings.ssh_agent_confirm,
        quick_unlock: settings.quick_unlock,
        client_cert_path: settings.client_cert_path.clone(),
        client_key_path: settings.client_key_path.clone(),
    };
    SettingsSnapshotView {
        config,
        health: crate::diagnostics::mock_health(state.host, &settings.server_url),
        diagnostics: DiagnosticsView {
            server_url_sanitized: sanitize_server_url(&settings.server_url),
            logs: state.logs.clone(),
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            engine_version: env!("CARGO_PKG_VERSION").to_string(),
            git_commit: "mock".to_string(),
            build_date: "mock".to_string(),
            memory_rss_mb: 0.0,
        },
        error: None,
    }
}

/// Applies `input` to the mock state and returns the refreshed snapshot.
fn mock_update(state: &mut MockState, input: SettingsUpdateInput) -> SettingsSnapshotView {
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
    if let Some(value) = &input.download_dir {
        state.settings.download_dir = value.clone();
    }
    if let Some(value) = input.auto_lock_minutes {
        state.settings.auto_lock_minutes = value;
    }
    if let Some(value) = input.clipboard_clear_seconds {
        state.settings.clipboard_clear_seconds = value;
    }
    if let Some(value) = &input.email {
        state.settings.email = value.clone();
        state.email = value.clone();
    }
    if let Some(value) = input.remember_email {
        state.settings.remember_email = value;
    }
    if let Some(value) = input.check_updates {
        state.settings.check_updates = value;
    }
    if let Some(value) = input.show_website_icons {
        state.settings.show_website_icons = value;
    }
    if let Some(value) = input.remember_last_search {
        state.settings.remember_last_search = value;
    }
    if let Some(value) = input.max_attachment_size_mb {
        state.settings.max_attachment_size_mb = value;
    }
    if let Some(value) = input.ssh_agent_enabled {
        state.settings.ssh_agent_enabled = value;
    }
    if let Some(value) = input.ssh_agent_confirm {
        state.settings.ssh_agent_confirm = value;
    }
    if let Some(value) = input.quick_unlock {
        state.settings.quick_unlock = value;
        state.quick_unlock_usable = value;
    }
    if let Some(value) = &input.client_cert_path {
        state.settings.client_cert_path = value.clone();
    }
    if let Some(value) = &input.client_key_path {
        state.settings.client_key_path = value.clone();
    }
    let mut snapshot = mock_snapshot(state);
    snapshot.error = error;
    snapshot
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Value, json};

    /// A config directory of its own, restored on drop.
    ///
    /// `settings::InProcess::update` writes the real config file, so a test that
    /// calls it must not touch the developer's own configuration.
    struct ConfigHome {
        xdg: Option<std::ffi::OsString>,
        config_dir: Option<std::ffi::OsString>,
        _guard: std::sync::MutexGuard<'static, ()>,
    }

    impl ConfigHome {
        fn new(path: &std::path::Path) -> Self {
            let _guard = crate::test_state::lock();
            let xdg = std::env::var_os("XDG_CONFIG_HOME");
            let config_dir = std::env::var_os("OMAWARDEN_CONFIG_DIR");
            // SAFETY: `test_state::lock()` keeps every test that touches these
            // variables from running at the same time.
            unsafe {
                std::env::set_var("XDG_CONFIG_HOME", path);
                std::env::remove_var("OMAWARDEN_CONFIG_DIR");
            }
            Self {
                xdg,
                config_dir,
                _guard,
            }
        }
    }

    impl Drop for ConfigHome {
        fn drop(&mut self) {
            // SAFETY: see `ConfigHome::new`.
            unsafe {
                match &self.xdg {
                    Some(value) => std::env::set_var("XDG_CONFIG_HOME", value),
                    None => std::env::remove_var("XDG_CONFIG_HOME"),
                }
                match &self.config_dir {
                    Some(value) => std::env::set_var("OMAWARDEN_CONFIG_DIR", value),
                    None => std::env::remove_var("OMAWARDEN_CONFIG_DIR"),
                }
            }
        }
    }

    fn base_input() -> SettingsUpdateInput {
        SettingsUpdateInput {
            server_url: None,
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
        }
    }

    /// The daemon must be told, not just the config file written.
    ///
    /// `ConfigManager::update_config` persists `config.json` and sends nothing;
    /// the engine's own CLI dispatches `set_auto_lock` and `ssh_agent_apply`
    /// afterwards. Without those the setting appears to save and the running
    /// daemon keeps the old policy until it restarts.
    #[test]
    fn saving_the_auto_lock_notifies_the_daemon() {
        let home = tempfile::tempdir().unwrap();
        let _config = ConfigHome::new(home.path());

        let seen = std::rc::Rc::new(std::cell::RefCell::new(Vec::<Value>::new()));
        let recorder = seen.clone();
        let _seam = crate::daemon::test_seam::set(move |action: Value| {
            recorder.borrow_mut().push(action.clone());
            Some(json!({ "ok": true }))
        });

        let mut input = base_input();
        input.auto_lock_minutes = Some(30);
        let snapshot = InProcess.update(input);
        assert!(snapshot.error.is_none(), "the config write must succeed");

        let sent = seen.borrow();
        let auto_lock = sent
            .iter()
            .find(|action| action["action"] == "set_auto_lock")
            .expect("set_auto_lock must be sent after the config write");
        assert_eq!(
            auto_lock["auto_lock_minutes"], 30,
            "the daemon is sent the setting in the unit the config stores it in"
        );
    }

    /// Enabling or disabling the SSH agent must reach the agent, too.
    #[test]
    fn saving_the_ssh_agent_notifies_the_daemon() {
        let home = tempfile::tempdir().unwrap();
        let _config = ConfigHome::new(home.path());

        let seen = std::rc::Rc::new(std::cell::RefCell::new(Vec::<Value>::new()));
        let recorder = seen.clone();
        let _seam = crate::daemon::test_seam::set(move |action: Value| {
            recorder.borrow_mut().push(action.clone());
            Some(json!({ "ok": true }))
        });

        let mut input = base_input();
        input.ssh_agent_enabled = Some(true);
        let snapshot = InProcess.update(input);
        assert!(snapshot.error.is_none());

        assert!(
            seen.borrow()
                .iter()
                .any(|action| action["action"] == "ssh_agent_apply"),
            "ssh_agent_apply must be sent when the agent toggle changes"
        );
    }

    /// A setting the daemon does not police must not wake it.
    #[test]
    fn saving_an_unrelated_setting_sends_nothing() {
        let home = tempfile::tempdir().unwrap();
        let _config = ConfigHome::new(home.path());

        let seen = std::rc::Rc::new(std::cell::RefCell::new(Vec::<Value>::new()));
        let recorder = seen.clone();
        let _seam = crate::daemon::test_seam::set(move |action: Value| {
            recorder.borrow_mut().push(action.clone());
            Some(json!({ "ok": true }))
        });

        let mut input = base_input();
        input.clipboard_clear_seconds = Some(45);
        let snapshot = InProcess.update(input);
        assert!(snapshot.error.is_none());

        let sent = seen.borrow();
        assert!(
            sent.iter().all(|action| action["action"] != "set_auto_lock"
                && action["action"] != "ssh_agent_apply"),
            "clipboard_clear_seconds needs no daemon action, got {sent:?}"
        );
    }
}
