# SSH Key Vault Write

## Problem Statement

Saving an SSH key to the Bitwarden vault from the app does not work. The app sends the daemon the legacy `ssh_key_create` action, which the current upstream daemon rejects with "Update the CLI to create SSH keys safely." The safe action is `ssh_key_create_v2`, which the app never sends. As a result no type-5 SSH cipher is ever created through the app, and the private key is empty when the user later tries to decrypt or reveal it.

## Solution

Send `ssh_key_create_v2` instead of `ssh_key_create`, carrying the same payload shape the daemon expects: name, notes, and the encrypted `sshKey` block (privateKey, publicKey, keyFingerprint). The daemon rejects the action when the vault is locked, so the app must only offer Save to Vault when the vault is unlocked.

## User Stories

1. As a user, I want to create an SSH key and save it to the vault, so that the key is stored encrypted like every other item.
2. As a user, I want to import an SSH key and save it to the vault, so that an existing key is preserved.
3. As a user, I want the saved key to show up in the SSH key category, so that I can find it later.
4. As a user, I want to reveal the private key of a saved SSH key, so that I can copy it to ~/.ssh.
5. As a user, I want the app to tell me when the vault is locked before I try to save, so that I do not get a confusing rejection.
6. As a user, I want export to ~/.ssh to keep working, so that I can still write keys straight to disk.

## Implementation Decisions

- The Rust bridge's SSH save path sends the daemon action `ssh_key_create_v2` with the existing payload fields (name, private_key, public_key, fingerprint, notes, touch).
- The daemon reply shape stays the same: ok, message, item_id, error. The new action returns a receipt with `id` and `revisionDate` on success.
- Save to vault is only offered when the daemon reports the vault unlocked; the UI already gates on `saveToVault`.
- The export-to-~/.ssh path is unchanged.

## Testing Decisions

- Unit test the bridge's SSH save path against a daemon stub that rejects `ssh_key_create` and accepts `ssh_key_create_v2`.
- Headless UI test: create a key, save to vault, reopen the inspector, reveal the private key, assert it is non-empty and matches the preview.

## Out of Scope

- Org-owned SSH key creation.
- Re-encryption or rotation of existing keys.
- Changes to the upstream omawarden CLI.

## Further Notes

The upstream daemon's type-5 decryption path is already correct and tested; the app only needs to use the write action it supports.