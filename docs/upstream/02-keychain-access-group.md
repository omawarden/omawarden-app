# Engine follow-up: Keychain items that survive a re-signed binary

**Repository**: `icyleaf/omarchy-bitwarden`
**Issue**: icyleaf/omarchy-bitwarden#433
**Affects**: `src/keyring/macos.rs` (`MacOsKeychainProvider`)

## Symptom

On macOS, after rebuilding the app (or the daemon), the Keychain may ask the
user to authorize access to the app's own items, and the app and the daemon can
prompt independently.

Nothing is lost, but a password manager that asks for authorization on every
rebuild is not trustworthy-looking, and the prompt is easy to mistake for a
phishing attempt.

## Current implementation

`MacOsKeychainProvider` writes through `SecItemAdd` with
`kSecAttrService`, `kSecAttrAccount` and `kSecAttrLabel`, then updates via
`SecItemUpdate` with the label. It does **not** set
`kSecUseDataProtectionKeychain`, and it does not set `kSecAttrAccessGroup`.
Without the former, `SecItemAdd` on macOS resolves against the legacy file-based
keychain, whose per-item ACL is what produces the prompt.

The service name is deterministic and documented in the module
(`kSecAttrService` is `omarchy-bitwarden-v2.<credential_id>` for scoped v2
credentials) and the account is a canonically sorted percent-encoded pair set,
so the item identity is already stable. Only the access control is not.

## Why it happens

- An ad-hoc signature's designated requirement is its code hash, so it changes
  on every rebuild.
- The legacy file-based keychain's default access control trusts only the
  process that created the item.
- Both processes write credentials: the app in-process, and the daemon through
  the same engine.

## What to change

Set `kSecUseDataProtectionKeychain: true` on the add/match/update/delete
queries so items live in the data-protection keychain, and set
`kSecAttrAccessGroup` when an access group is available. Leave room for a
`keychain-access-groups` entitlement so a Developer ID build can name a stable
group rather than the ad-hoc default, and fall back to today's behaviour when
no group is configured so a locally built app keeps working.

Because both the app and the daemon write, they need the same group for the
prompt to stop appearing twice.

Until this lands, the prompt is a known cost of ad-hoc builds and belongs in the
release notes, not in a bug report.

## Why it belongs in this repository

The access control is set where the item is written, which is the engine's
provider. `omawarden-app` has no Keychain code of its own, and it cannot set an
attribute on a dictionary the engine builds.
