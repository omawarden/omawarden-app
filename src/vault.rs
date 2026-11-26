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

/// Clears a `String` and shrinks its buffer so the former heap bytes are
/// reclaimable and overwritable, instead of lingering as plaintext in the
/// freed heap after the value is dropped.
fn scrub_string(string: &mut String) {
    string.clear();
    string.shrink_to_fit();
}

/// Recursively zeroes every string in a JSON value tree.
///
/// `serde_json::Value` is an enum of `String`, `Number`, `Bool`, `Null`,
/// `Array` and `Object`. Only the string leaves carry secrets; the others are
/// either numeric, boolean, or structural and carry nothing sensitive. Walking
/// the tree and clearing each string is the only way to reach the heap bytes
/// without re-implementing the JSON parser.
fn scrub_value(value: &mut Value) {
    match value {
        Value::String(s) => scrub_string(s),
        Value::Array(items) => {
            for item in items {
                scrub_value(item);
            }
        }
        Value::Object(map) => {
            for (_, item) in map.iter_mut() {
                scrub_value(item);
            }
        }
        Value::Number(_) | Value::Bool(_) | Value::Null => {}
    }
}

/// Scrubs the decrypted secrets out of one cached vault item before it is
/// dropped. `VaultItem` is defined by the engine crate and carries its
/// secrets as `serde_json::Value` leaves (passwords, TOTP seeds, card numbers,
/// CVV, identity SSNs) plus raw `String`s for SSH private keys and passphrases.
/// None of those implement `Zeroize`, so the app scrubs them in place: the
/// engine's own `decrypted_items` is cleared the same way on lock.
fn scrub_vault_item(item: &mut VaultItem) {
    if let Some(ref mut login) = item.login {
        scrub_value(login);
    }
    if let Some(ref mut card) = item.card {
        scrub_value(card);
    }
    if let Some(ref mut identity) = item.identity {
        scrub_value(identity);
    }
    for field in &mut item.fields {
        scrub_value(field);
    }
    for attachment in &mut item.attachments {
        scrub_value(attachment);
    }
    if let Some(ref mut notes) = item.notes {
        scrub_string(notes);
    }
    scrub_string(&mut item.search_text);
    if let Some(ref mut ssh) = item.ssh_key {
        if let Some(ref mut private_key) = ssh.private_key {
            scrub_string(private_key);
        }
        if let Some(ref mut passphrase) = ssh.passphrase {
            scrub_string(passphrase);
        }
    }
}

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
            let (items, reprompts) = parse_items(&value);
            let rows = items
                .iter()
                .map(|item| {
                    let reprompt = reprompts.get(&item.id).copied().unwrap_or(0);
                    row_from_item(item, reprompt)
                })
                .collect();
            // Keep the parsed ciphers beside the rows: this reply is the only
            // place a trashed cipher's fields ever arrive.
            store_trash_details(items, reprompts);
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
    if error.is_some() {
        // A failed read leaves nothing to inspect, so a stale detail from an
        // earlier read cannot outlive the rows it belonged to.
        clear_trash_details();
    }
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
    // Keep what the read carried, so the inspector can render a trashed
    // cipher's fields without a second request. The real adapter does the same
    // with the parsed `VaultItem`s.
    state.trash_details = state
        .items
        .iter()
        .filter(|item| !item.is_active())
        .map(|item| (item.id.clone(), item.clone()))
        .collect();
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

/// The decrypted ciphers the last Trash read carried, keyed by id.
///
/// The daemon's `list` reply is the only channel that reaches a trashed cipher:
/// every per-item read (`get_item`, `get_ssh_key`, `totp`, `get_attachment_key`)
/// resolves through the active-only `find_item`. So the Trash read keeps what it
/// parsed instead of projecting it away and dropping it.
///
/// This never enters [`CachedVault`], which stays active-only. It lives as long
/// as the loaded Trash rows: [`clear_session_state`] drops it when the session
/// ends, while `clear_cached_vault` — also the return-from-Trash refresh — leaves
/// it alone, so re-opening the Trash stays request-free.
#[derive(Debug, Default)]
pub(crate) struct TrashDetails {
    items: HashMap<String, VaultItem>,
    reprompts: HashMap<String, u32>,
}

pub(crate) fn trash_details() -> &'static Mutex<TrashDetails> {
    static DETAILS: OnceLock<Mutex<TrashDetails>> = OnceLock::new();
    DETAILS.get_or_init(|| Mutex::new(TrashDetails::default()))
}

/// The trashed cipher with `id` and its re-prompt flag, when the Trash has been
/// read this session.
pub(crate) fn trashed_cipher(id: &str) -> Option<(VaultItem, u32)> {
    let guard = trash_details().lock().ok()?;
    let item = guard.items.get(id)?.clone();
    let reprompt = guard.reprompts.get(id).copied().unwrap_or(0);
    Some((item, reprompt))
}

/// Scrubs the decrypted ciphers a Trash read kept before their map is replaced
/// or dropped.
///
/// The Trash details hold a second plaintext copy of the trashed ciphers, so
/// they need the same treatment as [`CachedVault`]: neither `String` nor
/// `serde_json::Value` implements `Zeroize`, and dropping the map alone leaves
/// the secrets in the freed heap.
fn scrub_trash_details(details: &mut TrashDetails) {
    for item in details.items.values_mut() {
        scrub_vault_item(item);
    }
}

/// Replaces the Trash details with the items of the read that just happened.
fn store_trash_details(items: Vec<VaultItem>, reprompts: HashMap<String, u32>) {
    if let Ok(mut guard) = trash_details().lock() {
        // A re-read replaces the previous Trash: scrub the outgoing ciphers
        // before the map that holds them is dropped.
        scrub_trash_details(&mut guard);
        *guard = TrashDetails {
            items: items
                .into_iter()
                .map(|item| (item.id.clone(), item))
                .collect(),
            reprompts,
        };
    }
}

fn clear_trash_details() {
    if let Ok(mut guard) = trash_details().lock() {
        scrub_trash_details(&mut guard);
        *guard = TrashDetails::default();
    }
}

/// Ends the session: the active cache and the Trash details both go.
///
/// Distinct from [`clear_cached_vault`], which is also the return-from-Trash
/// refresh and must leave the loaded Trash rows and their details in place.
pub(crate) fn clear_session_state() {
    clear_cached_vault();
    clear_trash_details();
}

/// Clears the in-memory cache and scrubs the decrypted secrets out of every
/// cached item before the heap is freed.
///
/// Setting the `Mutex` to `None` drops the `CachedVault`, which drops its
/// `Vec<VaultItem>`. The engine's `purge_decrypted_state` clears its own
/// `decrypted_items` the same way, but neither `String` nor `serde_json::Value`
/// implements `Zeroize`, so the plaintext would otherwise linger in the freed
/// heap until the allocator reuses those bytes. This scrubs each item first.
pub(crate) fn clear_cached_vault() {
    if let Ok(mut guard) = cached_vault().lock() {
        if let Some(ref mut cached) = *guard {
            for item in &mut cached.items {
                scrub_vault_item(item);
            }
            // Rows carry the raw login URIs, which may embed credentials in
            // the userinfo component of the scheme://user:pass@host form.
            for row in &mut cached.rows {
                for uri in &mut row.uris {
                    scrub_string(uri);
                }
            }
            scrub_string(&mut cached.email);
            scrub_string(&mut cached.server_url);
            if let Some(ref mut identity_url) = cached.identity_url {
                scrub_string(identity_url);
            }
            if let Some(ref mut last_sync) = cached.last_sync {
                scrub_string(last_sync);
            }
            if let Some(ref mut engine_version) = cached.engine_version {
                scrub_string(engine_version);
            }
        }
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
        clear_session_state();
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
        let _guard = crate::test_state::lock();
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

    /// The minimum a `VaultItem` needs to deserialize, with `extra` merged in.
    fn trashed_entry(extra: Value) -> Value {
        let mut entry = json!({
            "id": "id-1",
            "name": "Old GitHub",
            "type": 1,
            "type_name": "Login",
            "sub_title": "octocat",
            "favorite": false,
            "search_text": "old github",
            "deleted_at": "2026-01-15T10:30:00Z",
        });
        if let (Some(base), Some(extra)) = (entry.as_object_mut(), extra.as_object()) {
            for (key, value) in extra {
                base.insert(key.clone(), value.clone());
            }
        }
        entry
    }

    #[test]
    fn real_trash_rows_carry_the_cipher_reprompt() {
        let _guard = crate::test_state::lock();
        let _seam =
            test_seam::set(|_action: Value| Some(json!([trashed_entry(json!({ "reprompt": 1 }))])));

        let snapshot = InProcess.query_trash(VaultFilterInput::default());
        let row = snapshot.all_items.first().expect("a trashed row");
        assert_eq!(
            row.reprompt, 1,
            "the Trash row keeps the cipher's re-prompt flag, so Reveal is gated"
        );
    }

    /// `scrub_value` must reach every string leaf, including nested ones, so
    /// that clearing the cache leaves no plaintext behind in the freed heap.
    #[test]
    fn scrub_value_clears_every_string_leaf() {
        let mut value = json!({
            "password": "hunter2",
            "login": {
                "username": "alice",
                "totp": "JBSWY3DPEHPK3PXP"
            },
            "cards": [
                {"number": "4111111111111234", "code": "123"},
                {"number": "378282246310005", "code": "456"}
            ],
            "identity": {
                "ssn": "123-45-6789",
                "passportNumber": "X1234567"
            },
            "ssh": {
                "privateKey": "-----BEGIN OPENSSH PRIVATE KEY-----\nsecret\n-----END OPENSSH PRIVATE KEY-----",
                "passphrase": "letmein"
            },
            "count": 42,
            "favorite": true
        });
        scrub_value(&mut value);
        assert_eq!(value["password"].as_str(), Some(""));
        assert_eq!(value["login"]["username"].as_str(), Some(""));
        assert_eq!(value["login"]["totp"].as_str(), Some(""));
        assert_eq!(value["cards"][0]["number"].as_str(), Some(""));
        assert_eq!(value["cards"][0]["code"].as_str(), Some(""));
        assert_eq!(value["cards"][1]["number"].as_str(), Some(""));
        assert_eq!(value["cards"][1]["code"].as_str(), Some(""));
        assert_eq!(value["identity"]["ssn"].as_str(), Some(""));
        assert_eq!(value["identity"]["passportNumber"].as_str(), Some(""));
        assert_eq!(value["ssh"]["privateKey"].as_str(), Some(""));
        assert_eq!(value["ssh"]["passphrase"].as_str(), Some(""));
        // Numeric and boolean leaves carry no secrets and must survive intact.
        assert_eq!(value["count"].as_u64(), Some(42));
        assert_eq!(value["favorite"].as_bool(), Some(true));
    }

    /// A cipher carrying one of every secret the GUI holds in plaintext.
    fn secret_item() -> VaultItem {
        VaultItem {
            id: "abc".to_string(),
            name: "Example".to_string(),
            item_type: 1,
            type_name: "Login".to_string(),
            sub_title: String::new(),
            notes: Some("a note".to_string()),
            favorite: false,
            created_at: None,
            updated_at: None,
            deleted_at: None,
            folder_id: None,
            folder_name: None,
            organization_id: None,
            organization_name: None,
            collection_ids: None,
            // Permission flags the engine added with organization write
            // support. Nothing in this app reads them yet (app #73 decided a
            // capability is read and not required), so they are a personal
            // cipher's permissive values rather than a fixture for a rule.
            edit: true,
            view_password: true,
            can_delete: true,
            can_restore: false,
            login: Some(json!({
                "username": "alice",
                "password": "hunter2",
                "totp": "JBSWY3DPEHPK3PXP"
            })),
            card: Some(json!({
                "number": "4111111111111234",
                "code": "123"
            })),
            identity: Some(json!({"ssn": "123-45-6789"})),
            ssh_key: Some(omawarden::vault::SshMetadata {
                is_ssh_key: true,
                key_type: "ED25519".to_string(),
                private_key: Some("-----BEGIN OPENSSH PRIVATE KEY-----\nsecret\n-----END OPENSSH PRIVATE KEY-----".to_string()),
                public_key: Some("ssh-ed25519 AAAA...".to_string()),
                fingerprint: Some("SHA256:abc".to_string()),
                passphrase: Some("letmein".to_string()),
            }),
            fields: vec![json!({"name": "field", "value": "secret", "type": "hidden"})],
            attachments: vec![json!({"id": "att1", "fileName": "doc.txt", "size": 1024})],
            search_text: "alice example".to_string(),
        }
    }

    /// `scrub_vault_item` must reach the decrypted secrets of every field the
    /// engine carries: login JSON, card JSON, identity JSON, custom fields,
    /// attachments, notes, and the SSH private key + passphrase.
    #[test]
    fn scrub_vault_item_clears_all_decrypted_secrets() {
        let mut item = secret_item();
        scrub_vault_item(&mut item);
        assert_eq!(item.notes.as_deref(), Some(""));
        assert_eq!(item.login.as_ref().unwrap()["password"].as_str(), Some(""));
        assert_eq!(item.login.as_ref().unwrap()["username"].as_str(), Some(""));
        assert_eq!(item.login.as_ref().unwrap()["totp"].as_str(), Some(""));
        assert_eq!(item.card.as_ref().unwrap()["number"].as_str(), Some(""));
        assert_eq!(item.card.as_ref().unwrap()["code"].as_str(), Some(""));
        assert_eq!(item.identity.as_ref().unwrap()["ssn"].as_str(), Some(""));
        assert_eq!(
            item.ssh_key.as_ref().unwrap().private_key.as_deref(),
            Some("")
        );
        assert_eq!(
            item.ssh_key.as_ref().unwrap().passphrase.as_deref(),
            Some("")
        );
        assert_eq!(item.fields[0]["value"].as_str(), Some(""));
        assert_eq!(item.attachments[0]["fileName"].as_str(), Some(""));
        assert_eq!(item.search_text, "");
    }

    /// The Trash details are a second plaintext copy of the trashed ciphers, so
    /// they get the same scrub before the session drops them.
    #[test]
    fn scrub_trash_details_clears_every_kept_cipher() {
        let mut details = TrashDetails::default();
        details.items.insert("abc".to_string(), secret_item());
        scrub_trash_details(&mut details);
        let item = &details.items["abc"];
        assert_eq!(item.login.as_ref().unwrap()["password"].as_str(), Some(""));
        assert_eq!(item.card.as_ref().unwrap()["number"].as_str(), Some(""));
        assert_eq!(item.identity.as_ref().unwrap()["ssn"].as_str(), Some(""));
        assert_eq!(item.notes.as_deref(), Some(""));
        assert_eq!(item.search_text, "");
    }
}
