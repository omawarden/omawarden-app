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
use crate::daemon::parse_prompt;
use crate::diagnostics::{LogLevel, push_log};
use crate::projection::{build_snapshot, parse_items, row_from_item, sort_trash};
use crate::{
    AppPhase, CipherRowView, MockItem, MockState, VaultFilterInput, VaultSnapshotView, daemon,
    ensure_app_daemon_running, load_config, sanitize_server_url, with_mock,
};

/// The vault capabilities the bridge exposes.
pub(crate) trait VaultEngine {
    /// Projects the cached or freshly read vault through `filter`.
    fn query(&self, filter: VaultFilterInput) -> VaultSnapshotView;

    /// Reads the Trash, newest deletion first.
    fn query_trash(&self, filter: VaultFilterInput) -> VaultSnapshotView;

    /// Syncs with the server, keeping the cached view when the sync fails.
    fn sync(&self, filter: VaultFilterInput) -> VaultSnapshotView;
}

/// The real adapter: the daemon and the in-memory cache.
pub(crate) struct InProcess;

impl VaultEngine for InProcess {
    fn query(&self, filter: VaultFilterInput) -> VaultSnapshotView {
        real_query(filter)
    }

    fn query_trash(&self, filter: VaultFilterInput) -> VaultSnapshotView {
        real_trash(filter)
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

    fn query_trash(&self, filter: VaultFilterInput) -> VaultSnapshotView {
        with_mock(|state| mock_trash(state, filter))
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
    push_log(LogLevel::Info, "app:vault", "vault sync requested");
    let start_error = ensure_app_daemon_running().err();
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
        None => {
            Some(start_error.unwrap_or_else(|| "The Omawarden daemon is not running.".to_string()))
        }
    };
    let Some(error) = failure else {
        // Only replace the cache once the daemon reports a successful sync.
        push_log(LogLevel::Info, "app:vault", "vault sync completed");
        return real_snapshot(filter);
    };
    // Keep the unlocked view and surface the failure instead of locking.
    push_log(
        LogLevel::Error,
        "app:vault",
        &format!("vault sync failed: {error}"),
    );
    if let Some(snapshot) = cached_snapshot(&filter, Some(error.clone())) {
        return snapshot;
    }
    let mut snapshot = real_snapshot(filter);
    snapshot.error = Some(error);
    snapshot
}

/// Reads the daemon's Trash list and builds a snapshot from it.
///
/// The Trash is a user-initiated read, so it is never cached: `CachedVault`
/// stays the active vault. The account context comes from that cache, which
/// boot or unlock has already filled before the Trash can be opened.
fn real_trash(filter: VaultFilterInput) -> VaultSnapshotView {
    let response = daemon(json!({ "action": "list", "trash": true, "touch": false }));
    // A `list` replies with a bare array. Anything else is the daemon's error
    // envelope, whose message the UI shows as-is.
    let (mut rows, error) = match response {
        Some(value) if value.is_array() => {
            let rows = parse_items(&value)
                .0
                .iter()
                .map(|item| row_from_item(item, 0))
                .collect();
            (rows, None)
        }
        Some(value) => (
            Vec::new(),
            Some(
                value
                    .get("error")
                    .and_then(Value::as_str)
                    .map(str::to_string)
                    .unwrap_or_else(|| "Could not read the Trash.".to_string()),
            ),
        ),
        None => (
            Vec::new(),
            Some("The Omawarden daemon is not running.".to_string()),
        ),
    };
    sort_trash(&mut rows);
    let filter = trash_filter(&filter);
    let cached = cached_vault().lock().ok().and_then(|guard| {
        guard
            .as_ref()
            .map(|vault| vault.snapshot_with_rows(rows.clone(), &filter, error.clone()))
    });
    cached.unwrap_or_else(|| {
        build_snapshot(
            AppPhase::Unlocked,
            String::new(),
            String::new(),
            None,
            false,
            false,
            None,
            error.or_else(|| Some("The vault is locked.".to_string())),
            rows,
            &filter,
            None,
            None,
            None,
            None,
        )
    })
}

/// The filter a Trash read uses: the Trash is server-wide, so a stale scope or
/// folder from the active view cannot narrow it.
fn trash_filter(filter: &VaultFilterInput) -> VaultFilterInput {
    VaultFilterInput {
        search: filter.search.clone(),
        category: filter.category,
        scope_id: None,
        folder_id: None,
    }
}

/// Applies the mock filter and returns the mock snapshot.
fn mock_query(state: &mut MockState, filter: VaultFilterInput) -> VaultSnapshotView {
    state.filter = filter;
    state.error = None;
    // When the stale-list seam is on, the daemon's `list` serves its cached
    // rows: a cipher mutation does not invalidate them, so only a sync makes a
    // new or changed item visible. This is what the GUI must not depend on.
    state.query_snapshot()
}

/// Reads the mock Trash: the soft-deleted items, newest deletion first.
fn mock_trash(state: &mut MockState, filter: VaultFilterInput) -> VaultSnapshotView {
    state.trash_queries = state.trash_queries.saturating_add(1);
    state.filter = trash_filter(&filter);
    state.error = None;
    let mut rows: Vec<CipherRowView> = state
        .items
        .iter()
        .filter(|item| !item.is_active())
        .map(MockItem::row)
        .collect();
    sort_trash(&mut rows);
    state.snapshot_with_rows(rows)
}

/// Applies the mock sync and returns the mock snapshot.
fn mock_sync(state: &mut MockState, filter: VaultFilterInput) -> VaultSnapshotView {
    state.filter = filter;
    // A sync re-reads the vault, so the daemon's cached list is refreshed.
    state.list_cache = None;
    match state.sync_error.clone() {
        Some(error) => {
            state.error = Some(error.clone());
            state.record_log(
                LogLevel::Error,
                "app:vault",
                &format!("vault sync failed: {error}"),
            );
        }
        None => {
            state.last_sync = Some(chrono::Local::now().format("%Y-%m-%d %H:%M").to_string());
            state.error = None;
            state.record_log(LogLevel::Info, "app:vault", "vault sync requested");
            state.record_log(LogLevel::Info, "app:vault", "vault sync completed");
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

    /// Builds a snapshot with `rows` and the cached account context.
    ///
    /// The active cache normally supplies its own rows; the Trash read passes
    /// the daemon's deleted rows instead, which keeps the Trash out of the
    /// cache while still carrying the unlocked account's identity.
    fn snapshot_with_rows(
        &self,
        rows: Vec<CipherRowView>,
        filter: &VaultFilterInput,
        error: Option<String>,
    ) -> VaultSnapshotView {
        build_snapshot(
            AppPhase::Unlocked,
            self.email.clone(),
            self.server_url.clone(),
            self.identity_url.clone(),
            self.quick_unlock_ready,
            self.quick_unlock_usable,
            None,
            error,
            rows,
            filter,
            self.last_sync.clone(),
            None,
            None,
            self.engine_version.clone(),
        )
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
    Some(cached.snapshot_with_rows(cached.rows.clone(), filter, error))
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::daemon::test_seam;

    #[test]
    fn real_trash_sends_the_trash_flag_and_surfaces_the_daemon_error() {
        let _seam = test_seam::set(|action: Value| {
            assert_eq!(
                action.get("action").and_then(Value::as_str),
                Some("list"),
                "the Trash read is the daemon's list action"
            );
            assert_eq!(
                action.get("trash").and_then(Value::as_bool),
                Some(true),
                "the daemon must return only deleted ciphers"
            );
            assert_eq!(
                action.get("touch").and_then(Value::as_bool),
                Some(false),
                "browsing the Trash must not postpone the daemon's lock"
            );
            Some(json!({ "ok": false, "error": "vault is locked" }))
        });

        let snapshot = InProcess.query_trash(VaultFilterInput::default());
        assert_eq!(snapshot.error.as_deref(), Some("vault is locked"));
        assert!(snapshot.all_items.is_empty());

        // The failed read wrote nothing into the active cache: it stays
        // active-only even when the daemon refuses the Trash list.
        let cache_is_active_only = cached_vault()
            .lock()
            .ok()
            .and_then(|guard| {
                guard
                    .as_ref()
                    .map(|vault| vault.rows.iter().all(|row| row.deleted_at.is_none()))
            })
            .unwrap_or(true);
        assert!(cache_is_active_only);
    }
}
