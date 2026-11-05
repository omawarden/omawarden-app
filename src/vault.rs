//! The vault: the in-process cache, the daemon snapshot, and the two read
//! paths.
//!
//! [`VaultEngine`] is the seam. [`InProcess`] reads the daemon and keeps the
//! last known good unlocked view in memory; [`Mock`] projects the seeded
//! items.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use omawarden::vault::VaultItem;
use serde_json::{Value, json};

use crate::auth::auth_manager;
use crate::diagnostics::push_log;
use crate::projection::{build_snapshot, parse_items, row_from_item};
use crate::{
    AppPhase, CipherRowView, MockState, VaultFilterInput, VaultSnapshotView, daemon,
    ensure_app_daemon_running, load_config, parse_prompt, sanitize_server_url, with_mock,
};

/// The vault capabilities the bridge exposes.
pub(crate) trait VaultEngine {
    /// Projects the cached or freshly read vault through `filter`.
    fn query(&self, filter: VaultFilterInput) -> VaultSnapshotView;

    /// Syncs with the server, keeping the cached view when the sync fails.
    fn sync(&self, filter: VaultFilterInput) -> VaultSnapshotView;
}

/// The real adapter: the daemon and the in-memory cache.
pub(crate) struct InProcess;

impl VaultEngine for InProcess {
    fn query(&self, filter: VaultFilterInput) -> VaultSnapshotView {
        real_query(filter)
    }

    fn sync(&self, filter: VaultFilterInput) -> VaultSnapshotView {
        real_sync(filter)
    }
}

/// The mock adapter: the seeded mock items.
pub(crate) struct Mock;

impl VaultEngine for Mock {
    fn query(&self, filter: VaultFilterInput) -> VaultSnapshotView {
        with_mock(|state| mock_query(state, filter))
    }

    fn sync(&self, filter: VaultFilterInput) -> VaultSnapshotView {
        with_mock(|state| mock_sync(state, filter))
    }
}

/// Answers a query from the cache, or reads the daemon when the cache is cold.
fn real_query(filter: VaultFilterInput) -> VaultSnapshotView {
    if let Some(snapshot) = cached_snapshot(&filter, None) {
        return snapshot;
    }
    real_snapshot(filter)
}

/// Syncs through the daemon and keeps the cached view when it fails.
fn real_sync(filter: VaultFilterInput) -> VaultSnapshotView {
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

/// Applies the mock filter and returns the mock snapshot.
fn mock_query(state: &mut MockState, filter: VaultFilterInput) -> VaultSnapshotView {
    state.filter = filter;
    state.error = None;
    state.snapshot()
}

/// Applies the mock sync and returns the mock snapshot.
fn mock_sync(state: &mut MockState, filter: VaultFilterInput) -> VaultSnapshotView {
    state.filter = filter;
    match state.sync_error.clone() {
        Some(error) => state.error = Some(error),
        None => {
            state.last_sync = Some(chrono::Local::now().format("%Y-%m-%d %H:%M").to_string());
            state.error = None;
        }
    }
    state.snapshot()
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
pub(crate) struct CachedVault {
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

impl CachedVault {
    /// The cached item with `id`, when the last snapshot held it.
    pub(crate) fn item(&self, id: &str) -> Option<&VaultItem> {
        self.items.iter().find(|item| item.id == id)
    }

    /// The reprompt flag for `id`, or `0` when the cache does not know it.
    pub(crate) fn reprompt(&self, id: &str) -> u32 {
        self.reprompts.get(id).copied().unwrap_or(0)
    }
}

pub(crate) fn cached_vault() -> &'static Mutex<Option<CachedVault>> {
    static CACHE: OnceLock<Mutex<Option<CachedVault>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

pub(crate) fn clear_cached_vault() {
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
pub(crate) fn real_snapshot(filter: VaultFilterInput) -> VaultSnapshotView {
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
