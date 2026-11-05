//! The filter projection: turning vault items into the rows a snapshot shows.
//!
//! These are pure functions, so this module needs no adapter seam: the
//! interface is the functions themselves. The bridge's cache and the mock both
//! project through [`build_snapshot`], which keeps the counts, scopes, folders,
//! and sort order in one place.

use std::collections::HashMap;

use omawarden::vault::{VaultItem, is_fuzzy_match};
use serde_json::Value;

use crate::{
    AppPhase, CategoryCountsView, CipherRowView, FolderOptionView, ItemCategory, ScopeOptionView,
    SshPromptView, TwoFactorChallengeView, VaultFilterInput, VaultSnapshotView,
    mask_card_number_for,
};

/// Maps a cipher to its UI category.
pub(crate) fn category_of(item: &VaultItem) -> ItemCategory {
    if item.ssh_key.is_some() || item.item_type == 5 {
        return ItemCategory::SshKey;
    }
    match item.item_type {
        1 => ItemCategory::Login,
        2 => ItemCategory::SecureNote,
        3 => ItemCategory::Card,
        4 => ItemCategory::Identity,
        _ => ItemCategory::Login,
    }
}

/// A simple fuzzy score: higher for tighter matches; `None` when it misses.
pub(crate) fn fuzzy_score(pattern: &str, text: &str) -> Option<i32> {
    if pattern.is_empty() {
        return Some(0);
    }
    let pattern = pattern.to_lowercase();
    let text = text.to_lowercase();
    if !is_fuzzy_match(&pattern, &text) {
        return None;
    }
    if text == pattern {
        return Some(1000);
    }
    if text.starts_with(&pattern) {
        return Some(800 - text.len().min(100) as i32);
    }
    if let Some(index) = text.find(&pattern) {
        return Some(600 - index.min(100) as i32);
    }
    Some(300 - text.len().min(200) as i32)
}

/// Parses the daemon's item array and the per-item re-prompt flags.
pub(crate) fn parse_items(value: &Value) -> (Vec<VaultItem>, HashMap<String, u32>) {
    let mut reprompts = HashMap::new();
    if let Some(entries) = value.as_array() {
        for entry in entries {
            if let Some(id) = entry.get("id").and_then(Value::as_str) {
                let reprompt = entry.get("reprompt").and_then(Value::as_u64).unwrap_or(0) as u32;
                reprompts.insert(id.to_string(), reprompt);
            }
        }
    }
    (
        serde_json::from_value::<Vec<VaultItem>>(value.clone()).unwrap_or_default(),
        reprompts,
    )
}

/// Builds a row from a vault item.
pub(crate) fn row_from_item(item: &VaultItem, reprompt: u32) -> CipherRowView {
    let category = category_of(item);
    let has_totp = item
        .login
        .as_ref()
        .and_then(|login| login.get("totp"))
        .and_then(|value| value.as_str())
        .is_some_and(|seed| !seed.trim().is_empty());
    let has_password_history = item
        .login
        .as_ref()
        .and_then(|login| login.get("passwordHistory"))
        .and_then(|value| value.as_array())
        .is_some_and(|history| !history.is_empty());
    let uris = item
        .login
        .as_ref()
        .and_then(|login| login.get("uris"))
        .and_then(|value| value.as_array())
        .map(|array| {
            array
                .iter()
                .filter_map(|entry| entry.get("uri").and_then(|value| value.as_str()))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let card_brand = item
        .card
        .as_ref()
        .and_then(|card| card.get("brand"))
        .and_then(|value| value.as_str())
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    let card_mask = item.card.as_ref().map(|card| {
        let number = card
            .get("number")
            .and_then(|value| value.as_str())
            .unwrap_or_default();
        mask_card_number_for(number, card_brand.as_deref().unwrap_or(""))
    });
    CipherRowView {
        id: item.id.clone(),
        title: item.name.clone(),
        subtitle: if item.sub_title.is_empty() {
            item.type_name.clone()
        } else {
            item.sub_title.clone()
        },
        category,
        favorite: item.favorite,
        attachment_count: item.attachments.len() as u32,
        organization: item.organization_name.clone(),
        folder: item.folder_name.clone(),
        has_totp,
        has_password_history,
        uris,
        reprompt,
        card_brand,
        card_mask,
    }
}

/// Whether a row belongs to the active scope.
fn row_in_scope(row: &CipherRowView, active_scope: &str) -> bool {
    match active_scope {
        "all" | "" => true,
        "personal" => row.organization.is_none(),
        scope => match scope.strip_prefix("org:") {
            Some(name) => row.organization.as_deref() == Some(name),
            None => true,
        },
    }
}

/// Whether a row belongs to the active folder.
fn row_in_folder(row: &CipherRowView, folder: Option<&String>) -> bool {
    match folder {
        Some(folder) => {
            let name = folder.strip_prefix("folder:").unwrap_or(folder);
            row.folder.as_deref() == Some(name)
        }
        None => true,
    }
}

/// Whether a row matches the fuzzy search query.
fn row_matches_search(row: &CipherRowView, search: &str) -> bool {
    let haystack = format!(
        "{} {} {} {}",
        row.title,
        row.subtitle,
        row.organization.clone().unwrap_or_default(),
        row.folder.clone().unwrap_or_default()
    );
    fuzzy_score(search, &haystack).is_some()
}

/// Builds a snapshot from rows and a filter.
#[allow(clippy::too_many_arguments)]
pub(crate) fn build_snapshot(
    phase: AppPhase,
    email: String,
    server_url: String,
    identity_url: Option<String>,
    quick_unlock_ready: bool,
    quick_unlock_usable: bool,
    two_factor: Option<TwoFactorChallengeView>,
    error: Option<String>,
    all_rows: Vec<CipherRowView>,
    filter: &VaultFilterInput,
    last_sync: Option<String>,
    selected_cipher_id: Option<String>,
    ssh_prompt: Option<SshPromptView>,
    engine_version: Option<String>,
) -> VaultSnapshotView {
    let total_count = all_rows.len() as u32;
    let active_scope = filter.scope_id.clone().unwrap_or_else(|| "all".to_string());
    let mut counts = CategoryCountsView {
        all: 0,
        logins: 0,
        cards: 0,
        identities: 0,
        secure_notes: 0,
        ssh_keys: 0,
    };
    for row in &all_rows {
        if !row_in_scope(row, &active_scope)
            || !row_in_folder(row, filter.folder_id.as_ref())
            || !row_matches_search(row, &filter.search)
        {
            continue;
        }
        counts.all += 1;
        match row.category {
            ItemCategory::Login => counts.logins += 1,
            ItemCategory::Card => counts.cards += 1,
            ItemCategory::Identity => counts.identities += 1,
            ItemCategory::SecureNote => counts.secure_notes += 1,
            ItemCategory::SshKey => counts.ssh_keys += 1,
            ItemCategory::All => {}
        }
    }

    let mut scopes = vec![
        ScopeOptionView {
            id: "all".to_string(),
            name: "All Vaults".to_string(),
            kind: "all".to_string(),
            count: total_count,
        },
        ScopeOptionView {
            id: "personal".to_string(),
            name: "My Vault".to_string(),
            kind: "personal".to_string(),
            count: all_rows
                .iter()
                .filter(|row| row.organization.is_none())
                .count() as u32,
        },
    ];
    let mut organizations: Vec<(String, u32)> = Vec::new();
    let mut folders: Vec<FolderOptionView> = Vec::new();
    for row in &all_rows {
        if let Some(org) = &row.organization {
            if let Some(entry) = organizations.iter_mut().find(|(name, _)| name == org) {
                entry.1 += 1;
            } else {
                organizations.push((org.clone(), 1));
            }
        }
        if let Some(folder) = &row.folder {
            if let Some(entry) = folders.iter_mut().find(|entry| &entry.name == folder) {
                entry.count += 1;
            } else {
                folders.push(FolderOptionView {
                    id: format!("folder:{folder}"),
                    name: folder.clone(),
                    count: 1,
                });
            }
        }
    }
    for (name, count) in organizations {
        scopes.push(ScopeOptionView {
            id: format!("org:{name}"),
            name: name.clone(),
            kind: "organization".to_string(),
            count,
        });
    }

    let all_items = all_rows.clone();
    let mut filtered: Vec<(i32, CipherRowView)> = all_rows
        .into_iter()
        .filter(|row| match filter.category {
            ItemCategory::All => true,
            category => row.category == category,
        })
        .filter(|row| row_in_scope(row, &active_scope))
        .filter(|row| row_in_folder(row, filter.folder_id.as_ref()))
        .filter_map(|row| {
            let haystack = format!(
                "{} {} {} {}",
                row.title,
                row.subtitle,
                row.organization.clone().unwrap_or_default(),
                row.folder.clone().unwrap_or_default()
            );
            fuzzy_score(&filter.search, &haystack).map(|score| (score, row))
        })
        .collect();
    filtered.sort_by(|(score_a, row_a), (score_b, row_b)| {
        score_b
            .cmp(score_a)
            .then_with(|| row_b.favorite.cmp(&row_a.favorite))
            .then_with(|| row_a.title.to_lowercase().cmp(&row_b.title.to_lowercase()))
    });
    let items = filtered.into_iter().map(|(_, row)| row).collect();

    VaultSnapshotView {
        phase,
        email,
        server_url,
        identity_url,
        quick_unlock_ready,
        quick_unlock_usable,
        unlocked: phase == AppPhase::Unlocked,
        syncing: false,
        two_factor,
        error,
        items,
        all_items,
        total_count,
        category_counts: counts,
        scopes,
        folders,
        active_scope,
        active_folder: filter.folder_id.clone(),
        search: filter.search.clone(),
        category: filter.category,
        last_sync,
        selected_cipher_id,
        ssh_prompt,
        engine_version,
    }
}
