# What the daemon exposes that this app does not reach

Answer to [#72](https://github.com/omawarden/omawarden-app/issues/72), read from the
engine source at `../omarchy-bitwarden`. Every claim below names the revision it was
read at:

- **`57f8679`** — the pin in `Cargo.toml:32`
  (`rev = "57f86792201697230474978873974a3a9ec9e0a8"`), engine `0.12.2`.
- **`ac88555`** — the engine's `develop` HEAD at the time of this survey. Its parent
  is exactly `57f8679`; it is one commit ahead.

Reproduce with `git show <rev>:omawarden/src/<file>`. Local builds compile the
sibling checkout rather than the pin (`scripts/check_engine_pin.sh` reports the
drift), so anything read from the working tree is called out separately and never
presented as shipped.

---

## 1. The `ping` contract

`handle_client` builds the reply at `omawarden/src/daemon/handlers.rs` (`"ping" =>`
arm). Both revisions return the same keys except for `capabilities`.

| key | `57f8679` | `ac88555` | value |
| --- | --- | --- | --- |
| `ok` | yes | yes | `true` |
| `pong` | yes | yes | `true` |
| `protocol_version` | yes | yes | `1` (`CURRENT_PROTOCOL_VERSION`, `protocol.rs:149`) |
| `schema_version` | yes | yes | `3` (`CURRENT_SCHEMA_VERSION`, `protocol.rs:155`) |
| `capabilities` | **absent** | yes | `["cipher_mutation_v3","folder_crud","login_totp_uri_match","vault_get"]` |
| `ssh_write_receipt` | yes | yes | `true` |
| `account_activation_v1` | yes | yes | `true` |
| `unlock_context` | yes | yes | opaque session string |
| `version` | yes | yes | `env!("CARGO_PKG_VERSION")` → `0.12.2` at both |
| `commit` | yes | yes | `env!("GIT_HASH")`, stamped at build time |
| `unlocked` | yes | yes | `bool` |
| `quick_unlock` | yes | yes | `bool` |
| `quick_unlock_enabled` | yes | yes | `bool`, the daemon's cached setting |
| `memory_locked` | yes | yes | `!mlock_fallback_active()` |

`caps` are ordered exactly as listed: `DAEMON_CAPABILITIES` in
`omawarden/src/daemon/protocol.rs` at `ac88555`:

```rust
pub const CAPABILITY_VAULT_GET: &str = "vault_get";
pub const DAEMON_CAPABILITIES: &[&str] = &[
    "cipher_mutation_v3",
    "folder_crud",
    "login_totp_uri_match",
    CAPABILITY_VAULT_GET,
];
```

`protocol.rs` at `57f8679` has no capability constants at all; the only occurrence of
the word is a doc comment on `CURRENT_SCHEMA_VERSION` ("schema capabilities"). ADR 0037
does not exist at the pin.

**Confirmation of the map's assertion.** `vault_get` and `ping.capabilities` arrive
only in `ac88555`. `git log -S'DAEMON_CAPABILITIES' -- omawarden/src/daemon/protocol.rs`
finds two commits: `1179170` (on the abandoned branch
`feat/446-vault-get-and-daemon-capabilities`, not an ancestor of `ac88555`) and
`ac88555` itself. `57f8679` has no `vault_get` arm and no `capabilities` key. The map
is correct.

Every reply the daemon writes — not just `ping` — also gets `protocol_version`
injected if absent (`map.entry("protocol_version").or_insert_with(...)`, handlers
`57f8679:742`, `ac88555:796`).

---

## 2. Action inventory

The `match action` block's arms, enumerated from `handlers.rs` at each revision.

**Engine handles at `57f8679` — 36 actions:**

`ping`, `stop`, `status`, `ssh_agent_apply`, `ssh_agent_status`, `ssh_agent_pending`,
`ssh_agent_reply`, `unlock`, `quick_unlock`, `wipe_quick_unlock`, `set_quick_unlock`,
`lock`, `sync`, `list`, `search`, `ssh_key_create`, `ssh_key_create_v2`,
`cipher_create`, `cipher_update`, `cipher_delete`, `cipher_delete_trash`,
`cipher_restore`, `folder_list`, `folder_resolve`, `folder_create`, `folder_update`,
`folder_delete`, `cipher_resolve`, `get_item`, `get_ssh_key`, `get_attachment_key`,
`totp`, `copy`, `generate_password`, `set_auto_lock`, `server_capabilities`.

**At `ac88555` — 37:** the above plus `vault_get`.

Three further wire names exist *before* the match block and so are not in the list:
`prepare_account_login` (delegates to `account_activation::serve`), `activate_account`
(the second message of that session), and `output_generation` (a one-line keepalive
the engine's own client uses to read the lock generation). `prepare_account_login` and
`output_generation` are handled at both revisions; `activate_account` is answered
inside `activate_account*::serve`.

### What this app calls today

Directly from `src/`, by literal `"action": "<name>"` (17 names):

`ping`, `get_item`, `totp`, `status`, `ssh_agent_pending`, `list`, `sync`,
`ssh_key_create_v2`, `ssh_agent_reply`, `server_capabilities`, `quick_unlock`,
`cipher_create`, `cipher_update`, `cipher_delete`, `cipher_delete_trash`,
`cipher_restore`, `cipher_resolve`.

Plus, reached indirectly because the app calls *engine library* functions that own the
IPC themselves (the app never writes these action names):

| action | reached through |
| --- | --- |
| `unlock`, `lock`, `wipe_quick_unlock` | `omawarden::auth::AuthManager` — `unlock`, `lock`, `logout` |
| `set_quick_unlock` | `omawarden::config::ConfigManager::update_config` |
| `stop` | `ConfigManager::update_config` on a server/account change |
| `get_attachment_key` | `omawarden::attachment::get_attachment` |
| `prepare_account_login`, `activate_account` | `AuthManager::login_password` → `account_activation::LoginConnection` |
| `output_generation` | engine lock-generation polling inside `attachment`, `clipboard` |

Two engine actions are answered in-process instead, so the IPC is never used:
`generate_password` (`omawarden::generator::generate_password`) and `copy`
(`omawarden::clipboard::ClipboardManager`). The engine exposes them over IPC for
other clients; this app calls the same code directly.

### Set difference — never called by any path

`search`, `get_ssh_key`, `ssh_key_create`, `ssh_agent_apply`, `ssh_agent_status`,
`set_auto_lock`, `copy`, `generate_password`, `folder_list`, `folder_resolve`,
`folder_create`, `folder_update`, `folder_delete`.

At `ac88555` add `vault_get` to the missed list. (`ssh_key_create` is a tombstone:
it returns `{"ok":false,"outcome":"rejected","error":"Update the CLI to create SSH
keys safely."}` and is superseded by `ssh_key_create_v2`, which the app does call.)

Two of the misses are behavioural, not cosmetic:

- **`set_auto_lock` is never sent.** `src/settings.rs` writes `auto_lock_minutes` to
  `config.json` and stops there. The running daemon takes its duration once, at
  startup (`main.rs:1477-1497`). The engine's own CLI sends
  `{"action":"set_auto_lock","auto_lock_minutes":n}` after a config write
  (`main.rs:1687`). So changing auto-lock in Settings has no effect until restart.
- **`ssh_agent_apply` is never sent.** Same shape: `ssh_agent_enabled` and
  `ssh_agent_confirm` are persisted, and the running daemon is never told
  (`main.rs:1683` is what the CLI does). Toggling the SSH agent changes nothing until
  restart.

---

## 3. Capability gating

### The daemon does not enforce anything

Searching `ac88555` for `capabilities` in `daemon/handlers.rs` finds three hits:
the `ping` reply, the `ignore_server_capabilities` flag on `ssh_agent_apply`, and the
`server_capabilities` action. None of them gates dispatch. `should_touch_activity` and
the privileged-action list do not consult it either.

`ping_has_capability` exists in `protocol.rs` and is called from exactly one place in
the whole engine: `omawarden/src/main.rs:4928` and `:4944`, inside
`ensure_daemon_capability`. It is a **CLI** helper, not a daemon check and not a
library gate. An application that links `omawarden` inherits the constants and the
predicate but no gate.

Consequences:

- Calling an action the running daemon knows **succeeds regardless of `capabilities`**.
  `folder_list` works on `57f8679`, which advertises no capabilities at all.
- Calling an action an older daemon does not know falls through to the catch-all arm
  (`handlers.rs:738` at the pin, `:792` at `ac88555`):
  `{"ok": false, "error": "Unknown action: <name>", "protocol_version": 1}`.
  So on the pin, `vault_get` answers `Unknown action: vault_get` — not a
  capability-shaped error.

### What the CLI does instead

`ensure_daemon_capability(capability)` at `main.rs:4911`, per ADR 0037's fail-closed
rule:

1. `ensure_daemon_running()`; an incompatible protocol version is returned as an error.
2. `ping`.
3. `ping_has_capability(&ping, capability)` → return the ping.
4. Absent: send `{"action":"stop","admin":true}`.
   - If `stop` is accepted: sleep 50 ms, `ensure_daemon_running()`, re-`ping`,
     re-check. Still absent →
     `"The running daemon was restarted, but still does not advertise required capability '<c>'. Check OMA_DAEMON_BIN or update your installation."`
   - If `stop` is refused (in-process host, ADR 0028) →
     `"The running daemon does not support required capability '<c>' and could not be restarted (it may be hosted in-process). Restart the daemon or its host application to apply the update."`

`CAPABILITY_VAULT_GET` at `main.rs:5504` is the only caller.

### Which un-called actions are actually gated

| action | advertised capability | gated by anything today |
| --- | --- | --- |
| `vault_get` | `vault_get` | the CLI, yes. Daemon, no. |
| `folder_list`, `folder_resolve`, `folder_create`, `folder_update`, `folder_delete` | `folder_crud` | no. Present and working at `57f8679`. |
| card / identity / custom-field / TOTP / URI-match mutations | `cipher_mutation_v3` | no — see below. |
| `search`, `get_ssh_key`, `ssh_key_create`, `ssh_agent_apply`, `ssh_agent_status`, `set_auto_lock`, `copy`, `generate_password` | none | n/a |

So of the 13 missed shipped actions, **none** is gated by a `capabilities` identifier.
Three of the four advertised strings name behaviour the daemon has had since before
the pin; they are a description, not a lock.

The real gate on the mutation surface is `schema_version`, and it too lives in the
CLI: `cipher_mutation_required_schema_version` (`main.rs:143`) returns 3 for the
`folder_*` family and for a card/identity type, a login `totp`, or any URI entry
carrying `match`; 2 for `fields`/`remove_fields`/`uris`/`add_uris`/`clear_uris` on an
edit or top-level `uris` on a create; 1 otherwise. `submit_cipher_mutation`
(`main.rs:5609`) stops and restarts the daemon when the running `schema_version` is
too low, then fails closed with
`"The running daemon does not support <label>. Restart the daemon or its host application to apply the update."`
That function is **byte-identical at `57f8679` and `ac88555`**, and it is CLI code.

At both revisions `CURRENT_SCHEMA_VERSION` is `3`, so every payload in section 4 is
already supported by the pinned daemon. Nothing there needs a capability or a version
bump.

---

## 4. Wire payloads for the unreached surface

All shapes below are identical at `57f8679` and `ac88555`: `cipher_write.rs`,
`folder_write.rs`, `ssh_write.rs`, `attachment.rs` and `auth.rs` are byte-identical
between the two revisions.

### 4.0 Envelope, validation, type resolution

- **Mutation nesting.** Every mutating handler does
  `request.get("mutation").unwrap_or(&request)`, so the payload may be the request
  itself or a `"mutation"` object inside it.
- **`deny_unknown_fields`.** `CipherCreateDraft`, `CipherUpdateDraft`, `CardDraft` and
  `IdentityDraft` all deny unknown keys. One stray key fails the whole write with
  `"Invalid cipher fields."` (create) or `"Invalid cipher update fields."` (update).
  `LoginDraft`, `CipherFieldDraft` and `LoginUriDraft` do not.
- **Create is `cipher_create`.** `name` is required (`String`, no default).
  `action` and `client` are accepted and ignored.
- **Update is `cipher_update`.** `id` or `target` is required; neither →
  `"Missing cipher target."`. Everything is optional and a field that is absent stays
  untouched — an empty string clears (`folder_id: ""` → `folderId: null`).
- **`type` / `cipher_type`.** `CipherTypeField` is untagged numeric-or-named. Accepted:
  `1`/`2`/`3`/`4`, or `"login"`, `"note"`, `"secure_note"`, `"securenote"`, `"card"`,
  `"identity"`. Anything else is
  `"Unsupported cipher type '<x>'. Supported types are login (1), secure note (2), card (3), and identity (4)."`
  With neither key, the type is inferred: `card` → identity → login (login object or
  username/password/totp) → note (notes present) → default login.
- **Type/field mismatch.** Card fields on a non-card, identity fields on a
  non-identity, login fields on a non-login → `"Card fields can only be set on card ciphers."`
  (or `updated on card ciphers.`), and the equivalents for identity and login.
- **Organization ciphers are rejected outright**, at both revisions, with
  `"Organization ciphers are read-only."` — on create when `organization_id`,
  `collection_id` or `collection_ids` is non-empty (snake or camel), on every other
  write when the resolved item carries an `organizationId`.
- **Locked daemon.** Privileged actions are rejected before dispatch with
  action-specific text — `"Unlock the vault before creating a cipher."`,
  `"…editing a cipher."`, `"…deleting a cipher."`,
  `"…permanently deleting a cipher from trash."`, `"…restoring a cipher."`,
  `"Unlock the vault before <deleting|editing|restoring> a cipher."` (from
  `cipher_resolve`'s `purpose`), and
  `"Vault is locked. Please unlock the vault first."` for anything else. The envelope
  carries `"outcome": "rejected"` for the cipher verbs.

### 4.1 Card — `cipher_create` (`type` 3)

```jsonc
{
  "action": "cipher_create",
  "type": 3,                 // or "card"
  "name": "Example Card",
  "notes": "…",              // optional
  "folder_id": "<uuid>",     // or "folderId"; optional
  "favorite": false,         // optional
  "fields": [ … ],           // optional, see 4.3
  "card": {
    "cardholderName": "…",   // alias cardholder_name
    "brand": "…",
    "number": "…",
    "expMonth": "08",        // alias exp_month
    "expYear": "2029",       // alias exp_year
    "code": "…"
  }
}
```

Every card value is encrypted with the cipher key before the HTTP write. Empty or
absent → `null` on the wire. `expMonth` is validated as digits-only and `1..=12`
(so `"1"` and `"01"` both pass) and `expYear` as exactly four digits; failures are
`"Expiration month must be between 01 and 12 (e.g. 08 or 12)."` and
`"Expiration year must be a 4-digit number (e.g. 2029)."`

### 4.2 Card — `cipher_update`

Same `card` object, inside `cipher_update` with `id` or `target`. Semantics differ:
`apply_card_updates` uses `apply_optional_encrypted_field`, so an absent key leaves
the stored value alone and an empty string writes `null` (clears). The card object
only applies to a cipher whose stored `type` is 3.

### 4.3 Identity — `cipher_create` (`type` 4) and `cipher_update`

```jsonc
"identity": {
  "title": "…", "firstName": "…", "middleName": "…", "lastName": "…",
  "address1": "…", "address2": "…", "address3": "…",
  "city": "…", "state": "…", "postalCode": "…", "country": "…",
  "company": "…", "email": "…", "phone": "…", "ssn": "…",
  "username": "…", "passportNumber": "…", "licenseNumber": "…"
}
```

Eighteen optional strings, each with a camelCase key and a snake_case alias
(`first_name`, `middle_name`, `last_name`, `postal_code`, `passport_number`,
`license_number`). Same encrypt-on-create / absent-means-untouched-on-update
semantics as the card object; update requires the stored type to be 4.

### 4.4 Custom fields — `fields[]` and `remove_fields[]`

```jsonc
"fields": [
  { "name": "Recovery code", "value": "…", "type": 0 }
]
```

`type` is Bitwarden's field type: `0` Text, `1` Hidden, `2` Boolean, `3` Linked.
Defaults to `0`. `name` and `value` are both required and both encrypted.

- On **create** the array is encrypted and attached as-is.
- On **update** `fields` is an **upsert keyed by name**: for each entry the daemon
  decrypts every existing field name, replaces the first exact match, falls back to a
  case-insensitive match, and appends when neither matches. `remove_fields` is a list
  of **plaintext names**:

```jsonc
"remove_fields": ["Recovery code"]
```

  Removal matches decrypted names exactly, then case-insensitively. A name that
  matches nothing aborts the whole write:

  `"No custom field named 'X' on this cipher (available fields: a, b)."`

  or `"… (this cipher has no custom fields)."` when the list is empty. `fields` and
  `remove_fields` may be combined in one request; removals are applied first.
- A request that changes nothing is rejected:
  `"No fields specified to edit. Provide at least one field to update (e.g. --password)."`

### 4.5 Login `totp`

```jsonc
// on create, either placement works
{ "action": "cipher_create", "type": 1, "name": "…", "totp": "JBSWY3DPEHPK3PXP" }
{ "action": "cipher_create", "type": 1, "name": "…", "login": { "totp": "otpauth://totp/…" } }
```

On update it is a top-level `totp` only (there is no `login` object in
`CipherUpdateDraft`). The seed is validated by `crate::totp::validate_totp_seed`,
which accepts a bare base32 secret or an `otpauth://` / `otpauth-migration://` URI
(and rejects a `digits`/`period` query param that will not parse). An **empty string
clears** the stored seed (`login.totp` → `null`); any other value is encrypted before
the write.

### 4.6 `uris[]`, `add_uris[]`, `clear_uris`, `uri`, and per-entry `match`

`LoginUriDraft` is untagged, so an entry is either a plain string or an object:

```jsonc
"uris": [
  "https://vault.example.com",
  { "uri": "https://identity.example.com", "match": 0 }
]
```

`match` is `Option<u32>`. Accepted: absent or `null` (Default), or `0..=5`. Anything
else is
`"Invalid URI match rule '7'. Expected 0 (Base Domain) through 5 (Never), or null for Default."`
The engine validates the range only; the meaning of 1–4 is Bitwarden's and the
engine's own text names just the two ends.

Placement and precedence:

| verb | accepted keys | behaviour |
| --- | --- | --- |
| `cipher_create` | `login.uris`, then top-level `uris`; fallback `login.uri` / `uri` | whole list, each entry encrypted with its `match`; empty strings dropped |
| `cipher_update` | `clear_uris: true` | `login.uris` → `[]` |
| | `uris` | **replaces** the whole list. Plain-string entries inherit the `match` of the URL they replace (looked up by decrypted plaintext); object entries use their own `match`. |
| | `add_uris` | **appends**. `match` comes only from the entry itself, since there is no existing rule to inherit. |
| | `uri` | replaces the **first** entry's URL, preserving that entry's `match`; `""` clears the list |

Precedence is `clear_uris` → `uris` → `add_uris` → `uri`; only the first one present
is applied (it is an `if`/`else if` chain in `update_cipher`). On update the top-level
`uris` is the only form — a `login` object is not a field of `CipherUpdateDraft`.

Because URI handling sits on `cipher_update` directly, an app can change a match rule
without touching anything else; `{"uris":[{"uri":"…","match":4}]}` alone is a valid,
complete mutation.

### 4.7 The `folder_*` family

All five are plain reads/writes over the daemon's local folder cache and the
server's `/api/folders`.

**`folder_list`** — no arguments.

```jsonc
{"ok": true, "folders": [{"id": "<uuid>", "name": "Work", "count": 3}]}
```

Folders come from storage, names are decrypted with the user key, `count` is the
number of non-trashed ciphers in that folder, and the list is sorted by lowercase
name, then name, then id. Locked → `{"ok": false, "error": "Vault is locked."}`.

**`folder_resolve`** — `target` (also read from a nested `mutation`).

```jsonc
{"ok": true, "folder": {"id": "<uuid>", "name": "Work", "count": 3}}
```

Resolution order: exact UUID, exact name, then case-insensitive name. Two matches at
the same level →
`"Multiple folders matched 'Work': [Work (uuid), work (uuid)]. Specify the folder by its UUID."`
No match → `"Folder 'Work' not found."` Empty → `"Missing folder target."`

**`folder_create`** — `name` (trimmed; empty → `"Folder name cannot be empty."`).

```jsonc
{"ok": true, "outcome": "saved", "folder": {"id": "…", "name": "Work", "count": 0, "revisionDate": "…"}}
```

`outcome` is `saved` when the local cache accepted the new folder and
`saved_needs_sync` when it did not (the server write still succeeded).

**`folder_update`** — `id` or `target`, plus `name`.

```jsonc
{"ok": true, "outcome": "saved", "folder": {"id": "…", "name": "Renamed", "count": 3, "revisionDate": "…"}}
```

`count` is the resolved folder's cipher count. Server failures surface as
`"Server rejected the folder (HTTP …)"` or `"Server communication failed: …"`.

**`folder_delete`** — `id` or `target`.

```jsonc
{"ok": true, "outcome": "deleted", "folder": {"id": "…", "name": "Work", "unassigned_count": 3}}
```

`unassigned_count` is how many ciphers were in it; on success the cached ciphers in
that folder have `folderId` set to `null`. `outcome` is `deleted` or
`deleted_needs_sync`.

For the app, `target` accepting a name matters: the app only knows folder names
(`folder:<Name>` in `src/projection.rs`), and `folder_update`/`folder_delete` accept a
name as `target`, so rename and delete are reachable without first learning UUIDs.

### 4.8 Receipts for the cipher verbs the app does use

Unchanged between the revisions, and worth recording because a later ticket will
parse them:

| action | success envelope |
| --- | --- |
| `cipher_create`, `cipher_update` | `{"ok":true,"outcome":"saved"\|"saved_needs_sync","item":{"id","revisionDate"(,"name")}}` |
| `cipher_delete` | `{"ok":true,"outcome":"deleted"\|"deleted_needs_sync","item":{"id","name","permanent"(,"deleted_at")}}` |
| `cipher_delete_trash` | `{"ok":true,"outcome":"deleted","item":{…,"permanent":true},"permanent":true}` |
| `cipher_restore` | `{"ok":true,"outcome":"restored","item":{"id","name"}}` |

Failures are `{"ok":false,"outcome":"rejected","error":"…"}` for a refusal and
`{"ok":false,"outcome":"unknown","error":"Could not confirm the write. Sync the vault before trying again."}`
when the write could not be confirmed.

---

## 5. The delta, `57f8679` → `ac88555`

**One commit.** `git rev-list --count 57f8679..ac88555` is 1, and the parent of
`ac88555` is `57f8679`.

```
GLOSSARY.md                                        |    6 +-
docs/adr/0037-…-three-tier-protocol-evolution.md   |   43 +
omawarden/src/daemon/handlers.rs                   |   58 +-
omawarden/src/daemon/protocol.rs                   |   19 +
omawarden/src/daemon/state.rs                      |    1 +
omawarden/src/daemon/tests.rs                      |   32 +
omawarden/src/main.rs                              |  796 ++++
omawarden/src/vault.rs                             |   90 ++
omawarden/tests/vault_get_cli.rs                   | 1124 ++++
```

What each file actually changes:

- **`protocol.rs`** — adds `CAPABILITY_VAULT_GET`, `DAEMON_CAPABILITIES`,
  `ping_has_capability`. `CURRENT_PROTOCOL_VERSION` stays `1`, `CURRENT_SCHEMA_VERSION`
  stays `3`.
- **`handlers.rs`** — adds `"capabilities": DAEMON_CAPABILITIES` to the `ping` reply
  (one line), adds the `"vault_get" =>` arm, and adds `vault_get` to the
  `reads_plaintext` list that decides the privileged/lock check. The `Unknown action`
  arm is untouched. Nothing else in the file moves.
- **`state.rs`** — one line: `vault_get` added to `should_touch_activity`.
- **`vault.rs`** — adds `resolve_cipher_target_for_get`; no existing function changes.
- **`main.rs`** — the `vault get` CLI: `ensure_daemon_capability`,
  `handle_vault_get`, `resolve_vault_get_field`, `lookup_custom_field`,
  `render_vault_get_summary_card`, error emission. `submit_cipher_mutation` and
  `cipher_mutation_required_schema_version` are byte-identical to the pin.
- **`cipher_write.rs`, `folder_write.rs`, `ssh_write.rs`, `attachment.rs`, `auth.rs`,
  `api.rs`, `totp.rs`, `generator.rs`, `clipboard/mod.rs`** — byte-identical. Every
  payload shape in section 4 is therefore exactly as it is at the pin.

### Does taking `ac88555` change anything the app already calls?

**No.** The 17 action names the app sends are all present and unchanged, their
request shapes are in files that did not move, their receipts are unchanged, and the
`ping` keys the app reads (`unlocked`, `quick_unlock`, `memory_locked`) are unchanged
and still `0.12.2`. The one-line lock-check addition names only `vault_get`.

Taking the revision adds surface the app does not use:

- `ping.capabilities`, so a capability gate becomes *possible*;
- the `vault_get` action and its CLI.

So moving the pin is a safe, additive step — it does not fix the two settings bugs in
section 2, and it does not change any UI-visible behaviour on its own.

---

## 6. What this means for the app

- **There is no capability gate in the app, and none is needed today.** `src/` reads
  `ping` only for `unlocked`, `quick_unlock`, `memory_locked`; it never reads
  `protocol_version`, `schema_version` or `capabilities`. The only version check is
  `DaemonClient::ping()`'s internal `check_protocol_version`. The one gate that looks
  like a capability gate, `ssh_key_capability_block` in `src/ssh.rs`, is an *upstream
  server* matrix check via `server_capabilities` — a different concept entirely.
- **Every payload in section 4 is already understood by the pinned daemon.** The
  blocker for card, identity, custom fields, TOTP seeds, per-URI match and folders is
  not the engine. It is `build_mutation_payload` in `src/cipher_mutation.rs`, which
  hard-rejects anything but `login`/`note`, refuses username/password/URIs on a note,
  and sends a single `uri` instead of a list on update.
- **A stale comment.** `src/cipher_mutation.rs:100` says "`CipherUpdateDraft` has no
  `uris`". It does — `uris`, `add_uris`, `clear_uris`, plus `card`, `identity`,
  `fields` and `remove_fields`. The claim dates from before schema v2/v3 landed.
- **Folders are read locally, never from the daemon.** `src/projection.rs` derives
  `FolderOptionView` from `row.folder` (which is `item.folder_name`) and counts rows
  per name. Folder CRUD is unreachable, so folders cannot be created, renamed or
  deleted in the app at all, and an empty folder cannot appear.

---

## 7. Engine work in progress — not shipped

The engine checkout on this machine is on `feat/452-org-permissions-partial-writes`
with a dirty tree. It is **not** on any revision this app can pin, and none of the
following is in `57f8679` or `ac88555`:

- ADR 0038 (organization/collection write boundary) as an untracked file.
- An `org_list` action and its handler arm.
- `CAPABILITY_ORG_WRITE` (`"org_write"`) as a fifth `DAEMON_CAPABILITIES` entry.
- `is_partial_only` and a `PUT /ciphers/{id}/partial` path that lets an organization
  cipher change only `favorite` and `folder`, plus the `edit` / `viewPassword` /
  `delete` / `restore` permission flags on items.

At both surveyed revisions the rule is absolute and unconditional: any organization
cipher write is refused with `"Organization ciphers are read-only."` There is no
partial path and no per-item permission flag. Treat all of the above as unshipped:
it is advertised in a branch's constants ahead of the writes that would honour it, so
a client reading `org_write` today would over-estimate the feature.
