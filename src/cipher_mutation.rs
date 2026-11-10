//! Cipher mutation: create, edit, and delete vault ciphers through the
//! shared daemon, plus target resolution by name or id.
//!
//! This module is the GUI's single seam over the CLI's `cipher_write.rs`,
//! `main.rs` resolve path, and the daemon's `cipher_*` handlers. It builds
//! the same JSON payloads the CLI sends, dispatches them through
//! [`crate::daemon`], and maps the receipts onto
//! [`CipherMutationOutcomeView`] and [`CipherTargetResolvedView`].

use serde_json::{Value, json};

use crate::MockItem;
use crate::types::{
    CipherMutationInput, CipherMutationOutcomeView, CipherTargetCandidateView,
    CipherTargetResolvedView,
};

/// The mutation capabilities the bridge exposes.
pub(crate) trait CipherEngine {
    /// Create or update a cipher.
    fn mutate(&self, input: CipherMutationInput, id: Option<String>) -> CipherMutationOutcomeView;

    /// Resolve a create/edit/delete target by name or id.
    fn resolve_target(&self, target: String) -> CipherTargetResolvedView;

    /// Delete a cipher, soft or permanent.
    fn delete(&self, id: String, permanent: bool) -> CipherMutationOutcomeView;
}

/// The real adapter: the shared daemon socket.
pub(crate) struct InProcess;

impl CipherEngine for InProcess {
    fn mutate(&self, input: CipherMutationInput, id: Option<String>) -> CipherMutationOutcomeView {
        real_mutate(input, id)
    }

    fn resolve_target(&self, target: String) -> CipherTargetResolvedView {
        real_resolve_target(target)
    }

    fn delete(&self, id: String, permanent: bool) -> CipherMutationOutcomeView {
        real_delete(id, permanent)
    }
}

/// The mock adapter: the seeded mock state.
pub(crate) struct Mock;

impl CipherEngine for Mock {
    fn mutate(&self, input: CipherMutationInput, id: Option<String>) -> CipherMutationOutcomeView {
        mock_mutate(input, id)
    }

    fn resolve_target(&self, target: String) -> CipherTargetResolvedView {
        mock_resolve_target(target)
    }

    fn delete(&self, id: String, permanent: bool) -> CipherMutationOutcomeView {
        mock_delete(id, permanent)
    }
}

/// Builds a `cipher_create` or `cipher_update` payload from the form input.
///
/// Empty strings clear a field (matching the CLI's `--password ""` behaviour);
/// `None` leaves the field untouched on an edit. Values are sent verbatim, so a
/// password keeps its leading and trailing spaces; only the name is trimmed, to
/// reject a whitespace-only one. On a create, the type is resolved from
/// `cipher_type` and the name is required.
///
/// URIs are a list, matching the daemon's `login.uris`. A create sends them as
/// `login.uris`, so every URL lands. An update can only replace the first URL
/// (`CipherUpdateDraft` has no `uris`), so the rest are preserved and the UI
/// labels that row accordingly.
fn build_mutation_payload(input: &CipherMutationInput, id: Option<&str>) -> Result<Value, String> {
    let cipher_type = input.cipher_type.trim().to_lowercase();
    let is_login = cipher_type == "login";
    let is_note =
        cipher_type == "note" || cipher_type == "secure_note" || cipher_type == "securenote";
    if !is_login && !is_note {
        return Err(
            "Unsupported cipher type. Only login and secure note ciphers are supported."
                .to_string(),
        );
    }

    let name = input
        .name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Cipher name is required.".to_string())?;

    let first_uri = input
        .uris
        .as_deref()
        .and_then(|uris| uris.first().map(String::as_str));

    let mut payload = if let Some(id) = id {
        json!({
            "action": "cipher_update",
            "id": id,
            "name": name,
            "username": input.username.as_deref(),
            "password": input.password.as_deref(),
            "notes": input.notes.as_deref(),
            "uri": first_uri,
            "folder_id": input.folder_id.as_deref(),
            "favorite": input.favorite,
        })
    } else {
        let mut create = json!({
            "action": "cipher_create",
            "cipher_type": if is_login { "login" } else { "note" },
            "name": name,
            "username": input.username.as_deref(),
            "password": input.password.as_deref(),
            "notes": input.notes.as_deref(),
            "folder_id": input.folder_id.as_deref(),
            "favorite": input.favorite,
        });
        if is_login {
            if let Some(uris) = input.uris.as_deref() {
                // The form always keeps one row, so a blank row means "no URL"
                // rather than an empty URI entry.
                let list: Vec<Value> = uris
                    .iter()
                    .map(|uri| uri.trim())
                    .filter(|uri| !uri.is_empty())
                    .map(|uri| json!({"uri": uri, "match": Value::Null}))
                    .collect();
                if !list.is_empty() {
                    create["login"] = json!({"uris": list});
                }
            }
        }
        create
    };

    // The daemon's `CipherUpdateDraft` treats a JSON `null` as "leave
    // untouched"; an absent key deserialises to `None` either way, so drop
    // fields the form did not set instead of writing them as null.
    if id.is_some() {
        if input.username.is_none() {
            payload.as_object_mut().unwrap().remove("username");
        }
        if input.password.is_none() {
            payload.as_object_mut().unwrap().remove("password");
        }
        if input.notes.is_none() {
            payload.as_object_mut().unwrap().remove("notes");
        }
        if input.uris.is_none() {
            payload.as_object_mut().unwrap().remove("uri");
        }
        if input.folder_id.is_none() {
            payload.as_object_mut().unwrap().remove("folder_id");
        }
        if input.favorite.is_none() {
            payload.as_object_mut().unwrap().remove("favorite");
        }
    }

    if !is_login {
        if input.username.is_some() || input.password.is_some() || input.uris.is_some() {
            return Err(
                "Username, password, and URIs can only be set on login ciphers.".to_string(),
            );
        }
        payload.as_object_mut().unwrap().remove("username");
        payload.as_object_mut().unwrap().remove("password");
        payload.as_object_mut().unwrap().remove("uri");
        payload.as_object_mut().unwrap().remove("login");
    }

    Ok(payload)
}
/// Dispatches a create or update through the shared daemon and maps the
/// receipt. The daemon answers `{"ok": true, "outcome": ..., "item": {...}}`;
/// a non-ok reply carries its own `error`. `None` means no daemon answered.
fn real_mutate(input: CipherMutationInput, id: Option<String>) -> CipherMutationOutcomeView {
    let payload = match build_mutation_payload(&input, id.as_deref()) {
        Ok(payload) => payload,
        Err(error) => {
            return CipherMutationOutcomeView {
                ok: false,
                outcome: String::new(),
                id: None,
                name: None,
                revision_date: None,
                error: Some(error),
            };
        }
    };
    let response = crate::daemon(payload);
    map_mutation_response(response, id.as_deref())
}

/// Dispatches a delete through the shared daemon.
fn real_delete(id: String, permanent: bool) -> CipherMutationOutcomeView {
    let payload = json!({
        "action": "cipher_delete",
        "id": id,
        "permanent": permanent,
    });
    let response = crate::daemon(payload);
    map_mutation_response(response, Some(id.as_str()))
}

/// Resolves a target by name or id through the daemon's `cipher_resolve`.
///
/// The daemon returns `{"ok": true, "item": {...}}` for an exact match and
/// `{"ok": false, "ambiguous": true, "candidates": [...]}` for several. The
/// GUI shows the candidates in a selection menu; it never mutates blind.
fn real_resolve_target(target: String) -> CipherTargetResolvedView {
    let trimmed = target.trim();
    if trimmed.is_empty() {
        return CipherTargetResolvedView {
            ok: false,
            item: None,
            candidates: Vec::new(),
            error: Some("Target cipher cannot be empty.".to_string()),
        };
    }
    let response = crate::daemon(json!({
        "action": "cipher_resolve",
        "target": trimmed,
    }));
    let Some(response) = response else {
        return CipherTargetResolvedView {
            ok: false,
            item: None,
            candidates: Vec::new(),
            error: Some("The Omawarden daemon is not running.".to_string()),
        };
    };
    if response.get("ok").and_then(|value| value.as_bool()) == Some(true) {
        let item = response.get("item").and_then(candidate_from_value);
        return CipherTargetResolvedView {
            ok: true,
            item,
            candidates: Vec::new(),
            error: None,
        };
    }
    if response.get("ambiguous").and_then(|value| value.as_bool()) == Some(true) {
        let candidates = response
            .get("candidates")
            .and_then(|value| value.as_array())
            .map(|array| array.iter().filter_map(candidate_from_value).collect())
            .unwrap_or_default();
        return CipherTargetResolvedView {
            ok: false,
            item: None,
            candidates,
            error: response
                .get("error")
                .and_then(|value| value.as_str())
                .map(str::to_string),
        };
    }
    CipherTargetResolvedView {
        ok: false,
        item: None,
        candidates: Vec::new(),
        error: response
            .get("error")
            .and_then(|value| value.as_str())
            .map(str::to_string)
            .or_else(|| Some("Cipher not found.".to_string())),
    }
}

/// Maps a daemon mutation reply onto the outcome view.
///
/// The receipt's `item` carries the id the daemon assigned (create) or
/// confirmed (edit/delete). On delete the receipt carries `name` and
/// `permanent`; on create/edit it carries `revisionDate`.
fn map_mutation_response(
    response: Option<Value>,
    fallback_id: Option<&str>,
) -> CipherMutationOutcomeView {
    let Some(response) = response else {
        return CipherMutationOutcomeView {
            ok: false,
            outcome: String::new(),
            id: fallback_id.map(str::to_string),
            name: None,
            revision_date: None,
            error: Some("The Omawarden daemon is not running.".to_string()),
        };
    };
    if response.get("ok").and_then(|value| value.as_bool()) != Some(true) {
        return CipherMutationOutcomeView {
            ok: false,
            outcome: response
                .get("outcome")
                .and_then(|value| value.as_str())
                .unwrap_or("rejected")
                .to_string(),
            id: response
                .get("item")
                .and_then(|item| item.get("id"))
                .and_then(|value| value.as_str())
                .map(str::to_string)
                .or_else(|| fallback_id.map(str::to_string)),
            name: response
                .get("item")
                .and_then(|item| item.get("name"))
                .and_then(|value| value.as_str())
                .map(str::to_string),
            revision_date: response
                .get("item")
                .and_then(|item| item.get("revisionDate"))
                .and_then(|value| value.as_str())
                .map(str::to_string),
            error: response
                .get("error")
                .and_then(|value| value.as_str())
                .map(str::to_string),
        };
    }
    let item = response.get("item");
    CipherMutationOutcomeView {
        ok: true,
        outcome: response
            .get("outcome")
            .and_then(|value| value.as_str())
            .unwrap_or("saved")
            .to_string(),
        id: item
            .and_then(|item| item.get("id"))
            .and_then(|value| value.as_str())
            .map(str::to_string)
            .or_else(|| fallback_id.map(str::to_string)),
        name: item
            .and_then(|item| item.get("name"))
            .and_then(|value| value.as_str())
            .map(str::to_string),
        revision_date: item
            .and_then(|item| item.get("revisionDate"))
            .and_then(|value| value.as_str())
            .map(str::to_string),
        error: None,
    }
}

/// Builds a candidate view from a daemon `cipher_resolve` item value.
fn candidate_from_value(value: &Value) -> Option<CipherTargetCandidateView> {
    let id = value
        .get("id")
        .and_then(|value| value.as_str())?
        .to_string();
    Some(CipherTargetCandidateView {
        id,
        name: value
            .get("name")
            .and_then(|value| value.as_str())
            .unwrap_or("unnamed")
            .to_string(),
        type_name: value
            .get("type")
            .and_then(|value| value.as_str())
            .unwrap_or("login")
            .to_string(),
        sub_title: value
            .get("sub_title")
            .and_then(|value| value.as_str())
            .map(str::to_string),
        organization_id: value
            .get("organization_id")
            .and_then(|value| value.as_str())
            .filter(|value| !value.is_empty())
            .map(str::to_string),
    })
}

// ---------------------------------------------------------------------------
// Mock adapter
// ---------------------------------------------------------------------------

/// Reports the outcome the UI tests assert on, without touching disk or the
/// daemon. The mock mutates its in-memory items directly and reports the same
/// receipt shape the daemon would.
fn mock_mutate(input: CipherMutationInput, id: Option<String>) -> CipherMutationOutcomeView {
    let payload = match build_mutation_payload(&input, id.as_deref()) {
        Ok(payload) => payload,
        Err(error) => {
            return CipherMutationOutcomeView {
                ok: false,
                outcome: String::new(),
                id: None,
                name: None,
                revision_date: None,
                error: Some(error),
            };
        }
    };
    let action = payload
        .get("action")
        .and_then(|value| value.as_str())
        .unwrap_or("cipher_create");
    let item_id = id.clone().unwrap_or_else(|| "mock-cipher".to_string());
    let name = payload
        .get("name")
        .and_then(|value| value.as_str())
        .unwrap_or("unnamed")
        .to_string();
    let username = payload
        .get("username")
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let password = payload
        .get("password")
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let notes = payload
        .get("notes")
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let uri = payload
        .get("uri")
        .and_then(|value| value.as_str())
        .map(str::to_string);
    // A create sends `login.uris` (the full list); an update only carries the
    // first URL in `uri`. Read both shapes so the mock reflects what the daemon
    // would store.
    let uris: Vec<String> = payload
        .get("login")
        .and_then(|login| login.get("uris"))
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|entry| entry.get("uri").and_then(Value::as_str).map(String::from))
                .collect()
        })
        .unwrap_or_else(|| uri.clone().into_iter().collect());
    let folder = payload
        .get("folder_id")
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let favorite = payload.get("favorite").and_then(|value| value.as_bool());
    let is_login = payload
        .get("cipher_type")
        .and_then(|value| value.as_str())
        .map(|value| value.eq_ignore_ascii_case("login"))
        .unwrap_or(true);

    let revision = "2026-11-10T00:00:00Z".to_string();
    let outcome = match action {
        "cipher_update" => "saved",
        _ => "saved",
    };

    let item_id_for_state = item_id.clone();
    let name_for_state = name.clone();
    let applied = crate::with_mock(|state| {
        if action == "cipher_update" {
            if let Some(item) = state
                .items
                .iter_mut()
                .find(|item| item.id == item_id_for_state)
            {
                item.title = name_for_state;
                if let Some(value) = username {
                    item.username = Some(value);
                }
                if let Some(value) = password {
                    item.password = Some(value);
                }
                if let Some(value) = notes {
                    item.notes = Some(value);
                }
                // An update can only replace the first URL, so keep the rest.
                if !uris.is_empty() {
                    let mut merged = item.uris.clone();
                    if merged.is_empty() {
                        merged = uris.clone();
                    } else {
                        merged[0] = uris[0].clone();
                    }
                    item.uris = merged;
                }
                if let Some(value) = folder {
                    item.folder = Some(value);
                }
                if let Some(value) = favorite {
                    item.favorite = value;
                }
            }
        } else {
            let mut item = crate::MockItem::default();
            item.id = item_id_for_state;
            item.title = name_for_state;
            item.category = if is_login {
                crate::ItemCategory::Login
            } else {
                crate::ItemCategory::SecureNote
            };
            item.username = username;
            item.password = password;
            item.notes = notes;
            item.uris = uris;
            item.folder = folder;
            item.favorite = favorite.unwrap_or(false);
            state.items.push(item);
        }
    });

    let _ = applied;
    let receipt = json!({
        "ok": true,
        "outcome": outcome,
        "item": {
            "id": item_id,
            "name": name,
            "revisionDate": revision,
        }
    });
    map_mutation_response(Some(receipt), id.as_deref())
}

fn mock_delete(id: String, permanent: bool) -> CipherMutationOutcomeView {
    let id_owned = id.clone();
    crate::with_mock(|state| {
        state.items.retain(|item| item.id != id_owned);
    });
    let receipt = json!({
        "ok": true,
        "outcome": if permanent { "deleted" } else { "deleted_needs_sync" },
        "item": {
            "id": id,
            "name": "mock-cipher",
            "permanent": permanent,
        }
    });
    map_mutation_response(Some(receipt), Some(id.as_str()))
}

fn mock_resolve_target(target: String) -> CipherTargetResolvedView {
    let trimmed = target.trim();
    if trimmed.is_empty() {
        return CipherTargetResolvedView {
            ok: false,
            item: None,
            candidates: Vec::new(),
            error: Some("Target cipher cannot be empty.".to_string()),
        };
    }
    crate::with_mock(|state| {
        // An exact id or name always wins, matching the CLI's resolution: only
        // when nothing matches exactly does a partial name open the menu.
        let exact: Vec<&MockItem> = state
            .items
            .iter()
            .filter(|item| {
                item.id.eq_ignore_ascii_case(trimmed) || item.title.eq_ignore_ascii_case(trimmed)
            })
            .collect();
        let matches: Vec<&MockItem> = if exact.is_empty() {
            let needle = trimmed.to_lowercase();
            state
                .items
                .iter()
                .filter(|item| item.title.to_lowercase().contains(&needle))
                .collect()
        } else {
            exact
        };
        if matches.len() == 1 {
            let item = matches[0];
            CipherTargetResolvedView {
                ok: true,
                item: Some(CipherTargetCandidateView {
                    id: item.id.clone(),
                    name: item.title.clone(),
                    type_name: match item.category {
                        crate::ItemCategory::SecureNote => "note".to_string(),
                        _ => "login".to_string(),
                    },
                    sub_title: None,
                    organization_id: item.organization.clone(),
                }),
                candidates: Vec::new(),
                error: None,
            }
        } else if matches.len() > 1 {
            CipherTargetResolvedView {
                ok: false,
                item: None,
                candidates: matches
                    .iter()
                    .map(|item| CipherTargetCandidateView {
                        id: item.id.clone(),
                        name: item.title.clone(),
                        type_name: match item.category {
                            crate::ItemCategory::SecureNote => "note".to_string(),
                            _ => "login".to_string(),
                        },
                        sub_title: None,
                        organization_id: item.organization.clone(),
                    })
                    .collect(),
                error: Some(format!(
                    "Multiple ciphers matched '{}'. Specify by ID or narrower name.",
                    trimmed
                )),
            }
        } else {
            CipherTargetResolvedView {
                ok: false,
                item: None,
                candidates: Vec::new(),
                error: Some(format!("Cipher '{}' not found in vault.", trimmed)),
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn login_input() -> CipherMutationInput {
        CipherMutationInput {
            cipher_type: "login".to_string(),
            name: Some("GitHub".to_string()),
            username: Some("octocat".to_string()),
            password: Some("s3cret".to_string()),
            notes: Some("work account".to_string()),
            uris: Some(vec!["https://github.com".to_string()]),
            folder_id: Some("folder-1".to_string()),
            favorite: Some(true),
        }
    }

    #[test]
    fn create_payload_carries_login_fields() {
        let payload = build_mutation_payload(&login_input(), None).expect("valid");
        assert_eq!(payload["action"], "cipher_create");
        assert_eq!(payload["cipher_type"], "login");
        assert_eq!(payload["name"], "GitHub");
        assert_eq!(payload["username"], "octocat");
        assert_eq!(payload["password"], "s3cret");
        assert_eq!(payload["login"]["uris"][0]["uri"], "https://github.com");
        assert_eq!(payload["folder_id"], "folder-1");
        assert_eq!(payload["favorite"], true);
    }

    #[test]
    fn create_payload_sends_every_uri() {
        let mut input = login_input();
        input.uris = Some(vec![
            "https://github.com".to_string(),
            "https://github.com/notifications".to_string(),
        ]);
        let payload = build_mutation_payload(&input, None).expect("valid");
        let uris = payload["login"]["uris"].as_array().expect("uris array");
        assert_eq!(uris.len(), 2);
        assert_eq!(uris[0]["uri"], "https://github.com");
        assert_eq!(uris[1]["uri"], "https://github.com/notifications");
    }

    #[test]
    fn note_create_drops_login_fields() {
        let input = CipherMutationInput {
            cipher_type: "note".to_string(),
            name: Some("Recovery codes".to_string()),
            username: None,
            password: None,
            notes: Some("keep these safe".to_string()),
            uris: None,
            folder_id: None,
            favorite: None,
        };
        let payload = build_mutation_payload(&input, None).expect("valid");
        assert_eq!(payload["cipher_type"], "note");
        assert!(payload.get("username").is_none());
        assert!(payload.get("password").is_none());
        assert!(payload.get("uri").is_none());
        assert!(payload.get("login").is_none());
        assert_eq!(payload["notes"], "keep these safe");
    }

    #[test]
    fn note_create_rejects_login_fields() {
        let mut input = login_input();
        input.cipher_type = "note".to_string();
        let error = build_mutation_payload(&input, None).expect_err("rejected");
        assert!(error.contains("login"));
    }

    #[test]
    fn name_is_required() {
        let mut input = login_input();
        input.name = Some("   ".to_string());
        assert!(build_mutation_payload(&input, None).is_err());
        input.name = None;
        assert!(build_mutation_payload(&input, None).is_err());
    }

    #[test]
    fn unsupported_type_is_rejected() {
        let mut input = login_input();
        input.cipher_type = "card".to_string();
        assert!(build_mutation_payload(&input, None).is_err());
    }

    #[test]
    fn update_omits_unset_fields() {
        let input = CipherMutationInput {
            cipher_type: "login".to_string(),
            name: Some("Renamed".to_string()),
            username: None,
            password: None,
            notes: None,
            uris: None,
            folder_id: None,
            favorite: None,
        };
        let payload = build_mutation_payload(&input, Some("id-1")).expect("valid");
        assert_eq!(payload["action"], "cipher_update");
        assert_eq!(payload["id"], "id-1");
        assert_eq!(payload["name"], "Renamed");
        assert!(payload.get("username").is_none());
        assert!(payload.get("password").is_none());
        assert!(payload.get("uri").is_none());
        assert!(payload.get("favorite").is_none());
    }

    #[test]
    fn update_keeps_cleared_fields() {
        let mut input = login_input();
        input.password = Some(String::new());
        let payload = build_mutation_payload(&input, Some("id-1")).expect("valid");
        assert_eq!(payload["password"], "");
    }

    #[test]
    fn update_replaces_only_the_first_uri() {
        let mut input = login_input();
        input.uris = Some(vec![
            "https://github.com".to_string(),
            "https://github.com/notifications".to_string(),
        ]);
        let payload = build_mutation_payload(&input, Some("id-1")).expect("valid");
        assert_eq!(payload["uri"], "https://github.com");
        assert!(payload.get("login").is_none());
    }

    #[test]
    fn payload_sends_field_values_verbatim() {
        let mut input = login_input();
        input.password = Some("  padded secret  ".to_string());
        input.notes = Some(" line one\nline two ".to_string());
        let payload = build_mutation_payload(&input, None).expect("valid");
        assert_eq!(payload["password"], "  padded secret  ");
        assert_eq!(payload["notes"], " line one\nline two ");
    }

    #[test]
    fn mutation_receipt_maps_the_item() {
        let receipt = json!({
            "ok": true,
            "outcome": "saved",
            "item": {"id": "id-1", "name": "GitHub", "revisionDate": "2026-11-10T00:00:00Z"}
        });
        let outcome = map_mutation_response(Some(receipt), None);
        assert!(outcome.ok);
        assert_eq!(outcome.outcome, "saved");
        assert_eq!(outcome.id.as_deref(), Some("id-1"));
        assert_eq!(outcome.name.as_deref(), Some("GitHub"));
        assert_eq!(
            outcome.revision_date.as_deref(),
            Some("2026-11-10T00:00:00Z")
        );
        assert!(outcome.error.is_none());
    }

    #[test]
    fn mutation_error_maps_the_message() {
        let receipt = json!({
            "ok": false,
            "outcome": "rejected",
            "error": "Unlock the vault before editing a cipher."
        });
        let outcome = map_mutation_response(Some(receipt), Some("id-1"));
        assert!(!outcome.ok);
        assert_eq!(outcome.id.as_deref(), Some("id-1"));
        assert_eq!(
            outcome.error.as_deref(),
            Some("Unlock the vault before editing a cipher.")
        );
    }

    #[test]
    fn missing_daemon_is_reported() {
        let outcome = map_mutation_response(None, Some("id-1"));
        assert!(!outcome.ok);
        assert_eq!(outcome.id.as_deref(), Some("id-1"));
        assert!(outcome.error.is_some());
    }

    #[test]
    fn candidate_view_maps_the_daemon_shape() {
        let value = json!({
            "id": "id-1",
            "name": "GitHub",
            "type": "login",
            "sub_title": "octocat",
            "organization_id": "org-1"
        });
        let candidate = candidate_from_value(&value).expect("candidate");
        assert_eq!(candidate.id, "id-1");
        assert_eq!(candidate.name, "GitHub");
        assert_eq!(candidate.type_name, "login");
        assert_eq!(candidate.sub_title.as_deref(), Some("octocat"));
        assert_eq!(candidate.organization_id.as_deref(), Some("org-1"));
    }

    #[test]
    fn candidate_without_id_is_ignored() {
        assert!(candidate_from_value(&json!({"name": "No id"})).is_none());
    }
}
