//! The inspector: masked and revealed fields for one cipher.
//!
//! [`InspectorEngine`] is the seam. [`InProcess`] reads the cached or daemon
//! item; [`Mock`] reads the seeded item. Both build the same view, so a field
//! is masked, revealed, and labelled in one place.

use omawarden::totp::generate_totp;
use omawarden::vault::VaultItem;
use serde_json::{Value, json};

use crate::projection::category_of;
use crate::vault;
use crate::{
    AttachmentView, CardView, CustomFieldView, IdentityView, InspectorView, ItemCategory,
    MetadataView, MockItem, MockState, PasswordHistoryEntryView, RevealStateInput, SshKeyView,
    TotpLiveView, UriView, daemon, format_card_number_for, format_expiration, format_size,
    mask_card_number_for, mask_secret, with_mock,
};

/// The inspector capabilities the bridge exposes.
pub(crate) trait InspectorEngine {
    /// Builds the inspector for `cipher_id` with `reveal` applied.
    fn inspect(&self, cipher_id: String, reveal: RevealStateInput) -> InspectorView;

    /// Returns the live TOTP code for `cipher_id`.
    fn totp(&self, cipher_id: String) -> TotpLiveView;
}

/// The real adapter: the cache and the daemon.
pub(crate) struct InProcess;

impl InspectorEngine for InProcess {
    fn inspect(&self, cipher_id: String, reveal: RevealStateInput) -> InspectorView {
        real_inspect(cipher_id, reveal)
    }

    fn totp(&self, cipher_id: String) -> TotpLiveView {
        real_totp(cipher_id)
    }
}

/// The mock adapter: the seeded mock items.
pub(crate) struct Mock;

impl InspectorEngine for Mock {
    fn inspect(&self, cipher_id: String, reveal: RevealStateInput) -> InspectorView {
        with_mock(|state| mock_inspect(state, cipher_id, reveal))
    }

    fn totp(&self, cipher_id: String) -> TotpLiveView {
        with_mock(|state| mock_totp(state, cipher_id))
    }
}

/// Builds the TOTP view for a seed.
pub(crate) fn totp_view(seed: Option<&str>) -> Option<TotpLiveView> {
    let seed = seed?.trim();
    if seed.is_empty() {
        return None;
    }
    match generate_totp(seed, None, 6, 30) {
        Some(result) => Some(TotpLiveView {
            valid: true,
            code: result.code.clone(),
            formatted: format!(
                "{} {}",
                &result.code[..3.min(result.code.len())],
                &result.code[3.min(result.code.len())..]
            ),
            remaining: result.ttl as u32,
            period: result.period as u32,
            error: None,
        }),
        None => Some(TotpLiveView {
            valid: false,
            code: String::new(),
            formatted: String::new(),
            remaining: 0,
            period: 30,
            error: Some("Item has an invalid TOTP configuration".to_string()),
        }),
    }
}

/// Builds the mock item's inspector view with the requested fields revealed.
fn mock_item_inspector(item: &MockItem, reveal: &RevealStateInput) -> InspectorView {
    let password_masked = mask_secret(item.password.as_deref().unwrap_or(""));
    let password = if reveal.reveal_password {
        item.password.clone()
    } else {
        None
    };
    let card = item.card.as_ref().map(|card| CardView {
        cardholder_name: card.cardholder_name.clone(),
        brand: card.brand.clone(),
        number: if reveal.reveal_card_number {
            format_card_number_for(&card.number, &card.brand)
        } else {
            mask_card_number_for(&card.number, &card.brand)
        },
        number_masked: mask_card_number_for(&card.number, &card.brand),
        exp_month: card.exp_month.clone(),
        exp_year: card.exp_year.clone(),
        expiration: format_expiration(&card.exp_month, &card.exp_year),
        cvv: if reveal.reveal_cvv {
            card.code.clone()
        } else {
            mask_secret(&card.code)
        },
        cvv_masked: mask_secret(&card.code),
    });
    let identity = item.identity.as_ref().map(|identity| IdentityView {
        full_name: identity.full_name.clone(),
        username: identity.username.clone(),
        company: identity.company.clone(),
        email: identity.email.clone(),
        phone: identity.phone.clone(),
        ssn: identity.ssn.clone(),
        passport_number: identity.passport_number.clone(),
        license_number: identity.license_number.clone(),
        address1: identity.address1.clone(),
        address2: identity.address2.clone(),
        address3: identity.address3.clone(),
        city: identity.city.clone(),
        state: identity.state.clone(),
        postal_code: identity.postal_code.clone(),
        country: identity.country.clone(),
    });
    let ssh = item.ssh.as_ref().map(|ssh| SshKeyView {
        key_type: ssh.key_type.clone(),
        fingerprint: ssh.fingerprint.clone(),
        public_key: ssh.public_key.clone(),
        private_key: if reveal.reveal_private_key {
            ssh.private_key.clone()
        } else {
            mask_secret(&ssh.private_key)
        },
        private_key_masked: mask_secret(&ssh.private_key),
    });
    let fields = item
        .fields
        .iter()
        .enumerate()
        .map(|(index, field)| {
            let index = index as u32;
            let hidden = field.kind == "hidden";
            let revealed = !hidden || reveal.reveal_fields.contains(&index);
            CustomFieldView {
                index,
                name: field.name.clone(),
                kind: field.kind.clone(),
                value: if revealed {
                    field.value.clone()
                } else {
                    mask_secret(&field.value)
                },
                value_masked: mask_secret(&field.value),
            }
        })
        .collect();
    let uris = item
        .uris
        .iter()
        .map(|uri| UriView {
            uri: uri.clone(),
            host: url::Url::parse(uri)
                .ok()
                .and_then(|parsed| parsed.host_str().map(str::to_string))
                .unwrap_or_else(|| uri.clone()),
        })
        .collect();
    InspectorView {
        id: item.id.clone(),
        title: item.title.clone(),
        category: item.category,
        favorite: item.favorite,
        notes: item.notes.clone(),
        username: item.username.clone(),
        password,
        password_masked,
        totp: mock_item_totp(item),
        uris,
        card,
        identity,
        ssh,
        fields,
        attachments: item.attachments.clone(),
        password_history: item.password_history.clone(),
        metadata: MetadataView {
            folder: item.folder.clone().unwrap_or_default(),
            organization: item.organization.clone().unwrap_or_default(),
            created_at: String::new(),
            updated_at: String::new(),
        },
        reprompt: item.reprompt,
        error: None,
    }
}

/// The mock TOTP view, honouring the test's remaining/period overrides.
fn mock_item_totp(item: &MockItem) -> Option<TotpLiveView> {
    let mut view = totp_view(item.totp.as_deref())?;
    if let Some(period) = item.totp_period {
        view.period = period;
    }
    if let Some(remaining) = item.totp_remaining {
        view.remaining = remaining;
    }
    Some(view)
}
/// Answers an inspect call from the mock items.
fn mock_inspect(
    state: &mut MockState,
    cipher_id: String,
    reveal: RevealStateInput,
) -> InspectorView {
    match state.items.iter().find(|item| item.id == cipher_id) {
        Some(item) => {
            state.selected_cipher_id = Some(cipher_id.clone());
            mock_item_inspector(item, &reveal)
        }
        None => empty_inspector(&cipher_id, format!("Item '{cipher_id}' was not found.")),
    }
}

/// Answers a TOTP refresh from the mock items.
fn mock_totp(state: &mut MockState, cipher_id: String) -> TotpLiveView {
    let Some(item) = state.items.iter().find(|item| item.id == cipher_id) else {
        return TotpLiveView {
            valid: false,
            code: String::new(),
            formatted: String::new(),
            remaining: 0,
            period: 30,
            error: Some("Item has no TOTP configured.".to_string()),
        };
    };
    let mut view = totp_view(item.totp.as_deref()).unwrap_or_else(|| TotpLiveView {
        valid: false,
        code: String::new(),
        formatted: String::new(),
        remaining: 0,
        period: 30,
        error: Some("Item has no TOTP configured.".to_string()),
    });
    // A seeded period makes the auto-refresh deterministic in tests:
    // the next code starts a fresh period.
    if let Some(period) = item.totp_period {
        view.period = period;
        view.remaining = period;
    }
    view
}

/// Reads the item from the cache, or asks the daemon.
fn real_inspect(cipher_id: String, reveal: RevealStateInput) -> InspectorView {
    if let Ok(guard) = vault::cached_vault().lock() {
        if let Some(cached) = guard.as_ref() {
            if let Some(item) = cached.item(&cipher_id) {
                return vault_item_inspector(item, &reveal, cached.reprompt(&cipher_id));
            }
        }
    }
    let response = daemon(json!({ "action": "get_item", "query": cipher_id, "touch": false }));
    let Some(response) = response else {
        return empty_inspector(
            &cipher_id,
            "The Omawarden daemon is not running.".to_string(),
        );
    };
    if response.get("ok").and_then(|value| value.as_bool()) != Some(true) {
        return empty_inspector(
            &cipher_id,
            response
                .get("error")
                .and_then(|value| value.as_str())
                .unwrap_or("Item not found.")
                .to_string(),
        );
    }
    let reprompt = response
        .get("item")
        .and_then(|item| item.get("reprompt"))
        .and_then(Value::as_u64)
        .unwrap_or(0) as u32;
    match response
        .get("item")
        .cloned()
        .and_then(|value| serde_json::from_value::<VaultItem>(value).ok())
    {
        Some(item) => vault_item_inspector(&item, &reveal, reprompt),
        None => empty_inspector(&cipher_id, "Could not read the vault item.".to_string()),
    }
}

/// Reads the live TOTP from the cache, or asks the daemon.
fn real_totp(cipher_id: String) -> TotpLiveView {
    if let Ok(guard) = vault::cached_vault().lock() {
        if let Some(cached) = guard.as_ref() {
            if let Some(item) = cached.item(&cipher_id) {
                let seed = item
                    .login
                    .as_ref()
                    .and_then(|login| login.get("totp"))
                    .and_then(|value| value.as_str());
                return totp_view(seed).unwrap_or_else(|| TotpLiveView {
                    valid: false,
                    code: String::new(),
                    formatted: String::new(),
                    remaining: 0,
                    period: 30,
                    error: Some("Item has no TOTP configured.".to_string()),
                });
            }
        }
    }
    let response = daemon(json!({ "action": "totp", "query": cipher_id, "touch": false }));
    let Some(response) = response else {
        return TotpLiveView {
            valid: false,
            code: String::new(),
            formatted: String::new(),
            remaining: 0,
            period: 30,
            error: Some("The Omawarden daemon is not running.".to_string()),
        };
    };
    if response.get("ok").and_then(|value| value.as_bool()) != Some(true) {
        return TotpLiveView {
            valid: false,
            code: String::new(),
            formatted: String::new(),
            remaining: 0,
            period: 30,
            error: response
                .get("error")
                .and_then(|value| value.as_str())
                .map(str::to_string)
                .or_else(|| Some("No TOTP code is available.".to_string())),
        };
    }
    let code = response
        .get("code")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_string();
    TotpLiveView {
        valid: !code.is_empty(),
        formatted: format!(
            "{} {}",
            &code[..3.min(code.len())],
            &code[3.min(code.len())..]
        ),
        code,
        remaining: response
            .get("ttl")
            .and_then(|value| value.as_u64())
            .unwrap_or(0) as u32,
        period: response
            .get("period")
            .and_then(|value| value.as_u64())
            .unwrap_or(30) as u32,
        error: None,
    }
}

fn vault_item_inspector(
    item: &VaultItem,
    reveal: &RevealStateInput,
    reprompt: u32,
) -> InspectorView {
    let login = item.login.as_ref();
    let username = login
        .and_then(|value| value.get("username"))
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let password = login
        .and_then(|value| value.get("password"))
        .and_then(|value| value.as_str())
        .map(str::to_string);
    let totp_seed = login
        .and_then(|value| value.get("totp"))
        .and_then(|value| value.as_str());
    let uris = login
        .and_then(|value| value.get("uris"))
        .and_then(|value| value.as_array())
        .map(|array| {
            array
                .iter()
                .filter_map(|entry| entry.get("uri").and_then(|value| value.as_str()))
                .map(|uri| UriView {
                    uri: uri.to_string(),
                    host: url::Url::parse(uri)
                        .ok()
                        .and_then(|parsed| parsed.host_str().map(str::to_string))
                        .unwrap_or_else(|| uri.to_string()),
                })
                .collect()
        })
        .unwrap_or_default();
    let password_history = login
        .and_then(|value| value.get("passwordHistory"))
        .and_then(|value| value.as_array())
        .map(|array| {
            array
                .iter()
                .map(|entry| PasswordHistoryEntryView {
                    password: entry
                        .get("password")
                        .and_then(|value| value.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    changed_at: entry
                        .get("lastUsedDate")
                        .and_then(|value| value.as_str())
                        .unwrap_or_default()
                        .to_string(),
                })
                .collect()
        })
        .unwrap_or_default();
    let card = item.card.as_ref().map(|card| {
        let field = |name: &str| {
            card.get(name)
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string()
        };
        let number = field("number");
        let brand = field("brand");
        let code = field("code");
        CardView {
            cardholder_name: field("cardholderName"),
            brand: brand.clone(),
            number: if reveal.reveal_card_number {
                format_card_number_for(&number, &brand)
            } else {
                mask_card_number_for(&number, &brand)
            },
            number_masked: mask_card_number_for(&number, &brand),
            exp_month: field("expMonth"),
            exp_year: field("expYear"),
            expiration: format_expiration(&field("expMonth"), &field("expYear")),
            cvv: if reveal.reveal_cvv {
                code.clone()
            } else {
                mask_secret(&code)
            },
            cvv_masked: mask_secret(&code),
        }
    });
    let identity = item.identity.as_ref().map(|identity| {
        let field = |name: &str| {
            identity
                .get(name)
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string()
        };
        IdentityView {
            full_name: field("firstName").trim().to_string() + " " + field("lastName").trim(),
            username: field("username"),
            company: field("company"),
            email: field("email"),
            phone: field("phone"),
            ssn: field("ssn"),
            passport_number: field("passportNumber"),
            license_number: field("licenseNumber"),
            address1: field("address1"),
            address2: field("address2"),
            address3: field("address3"),
            city: field("city"),
            state: field("state"),
            postal_code: field("postalCode"),
            country: field("country"),
        }
    });
    let ssh = item.ssh_key.as_ref().map(|ssh| SshKeyView {
        key_type: ssh.key_type.clone(),
        fingerprint: ssh.fingerprint.clone().unwrap_or_default(),
        public_key: ssh.public_key.clone().unwrap_or_default(),
        private_key: if reveal.reveal_private_key {
            ssh.private_key.clone().unwrap_or_default()
        } else {
            mask_secret(ssh.private_key.as_deref().unwrap_or(""))
        },
        private_key_masked: mask_secret(ssh.private_key.as_deref().unwrap_or("")),
    });
    let fields = item
        .fields
        .iter()
        .enumerate()
        .map(|(index, field)| {
            let index = index as u32;
            let name = field
                .get("name")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string();
            let value = field
                .get("value")
                .and_then(|value| value.as_str())
                .unwrap_or_default()
                .to_string();
            let field_type = field
                .get("type")
                .and_then(|value| value.as_u64())
                .unwrap_or(0);
            let kind = match field_type {
                1 => "hidden",
                2 => "boolean",
                3 => "linked",
                _ => "text",
            };
            let hidden = kind == "hidden";
            let revealed = !hidden || reveal.reveal_fields.contains(&index);
            CustomFieldView {
                index,
                name,
                kind: kind.to_string(),
                value: if revealed {
                    value.clone()
                } else {
                    mask_secret(&value)
                },
                value_masked: mask_secret(&value),
            }
        })
        .collect();
    let attachments = item
        .attachments
        .iter()
        .map(|attachment| {
            let size = attachment
                .get("size")
                .and_then(|value| value.as_u64())
                .unwrap_or(0);
            AttachmentView {
                id: attachment
                    .get("id")
                    .and_then(|value| value.as_str())
                    .unwrap_or_default()
                    .to_string(),
                filename: attachment
                    .get("fileName")
                    .and_then(|value| value.as_str())
                    .unwrap_or_default()
                    .to_string(),
                size,
                size_label: format_size(size),
            }
        })
        .collect();
    InspectorView {
        id: item.id.clone(),
        title: item.name.clone(),
        category: category_of(item),
        favorite: item.favorite,
        notes: item.notes.clone(),
        username,
        password: if reveal.reveal_password {
            password.clone()
        } else {
            None
        },
        password_masked: mask_secret(password.as_deref().unwrap_or("")),
        totp: totp_view(totp_seed),
        uris,
        card,
        identity,
        ssh,
        fields,
        attachments,
        password_history,
        metadata: MetadataView {
            folder: item.folder_name.clone().unwrap_or_default(),
            organization: item.organization_name.clone().unwrap_or_default(),
            created_at: item.created_at.clone().unwrap_or_default(),
            updated_at: item.updated_at.clone().unwrap_or_default(),
        },
        reprompt,
        error: None,
    }
}

/// An empty inspector carrying an error.
fn empty_inspector(cipher_id: &str, error: String) -> InspectorView {
    InspectorView {
        id: cipher_id.to_string(),
        title: String::new(),
        category: ItemCategory::Login,
        favorite: false,
        notes: None,
        username: None,
        password: None,
        password_masked: String::new(),
        totp: None,
        uris: Vec::new(),
        card: None,
        identity: None,
        ssh: None,
        fields: Vec::new(),
        attachments: Vec::new(),
        password_history: Vec::new(),
        metadata: MetadataView {
            folder: String::new(),
            organization: String::new(),
            created_at: String::new(),
            updated_at: String::new(),
        },
        reprompt: 0,
        error: Some(error),
    }
}
