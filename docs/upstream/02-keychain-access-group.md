# Engine follow-up: Keychain items that survive a re-signed binary

**Repository**: `icyleaf/omarchy-bitwarden`
**Affects**: `src/keyring/macos.rs` (`MacOsKeychainProvider`)

## Symptom

On macOS, after rebuilding the app (or the daemon), the Keychain may ask the
user to authorize access to the app's own items, and the app and the daemon can
prompt independently.

Nothing is lost, but a password manager that asks for authorization on every
rebuild is not trustworthy-looking, and the prompt is easy to mistake for a
phishing attempt.

## Why it happens

- An ad-hoc signature's designated requirement is its code hash, so it changes
  on every rebuild.
- The default Keychain access control of a file-keychain item trusts only the
  process that created it.
- Both processes write credentials: the app in-process, and the daemon through
  the same engine.

## What to change

Create items in the data-protection keychain with an access group
(`kSecAttrAccessGroup`) rather than the file-based keychain's ACL. Leave room for
a `keychain-access-groups` entitlement so a Developer ID build can name a stable
group, and fall back to the current behaviour when no entitlement is present.

Until this lands, the prompt is a known cost of ad-hoc builds and belongs in the
release notes, not in a bug report.

## Why it belongs in this repository

The access control is set where the item is written, which is the engine's
provider. `omawarden-app` has no Keychain code of its own.
