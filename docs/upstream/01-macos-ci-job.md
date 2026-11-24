# Engine follow-up: run the engine's macOS-gated code in CI

**Repository**: `icyleaf/omarchy-bitwarden`
**Blocks**: any trustworthy claim that `omawarden-app` works on macOS

## Symptom

`omawarden-app` now ships a macOS bundle that stores session tokens through the
engine's `MacOsKeychainProvider` (Security.framework). None of that code has
ever been compiled, let alone run, by the engine's CI.

The engine's workflow runs `ubuntu-latest` only. Every block behind
`#[cfg(target_os = "macos")]` — the Security.framework FFI in
`src/keyring/macos.rs`, the pasteboard FFI in `src/clipboard/macos.rs`, and the
platform-specific device identity — is unverified. A typo in a selector name, a
wrong `objc_msgSend` signature or a missing framework link would only surface on
a user's machine, as a sign-in that silently stores nothing.

Cross-compiling from Linux is not an option: it needs a macOS SDK and a cross
toolchain, and neither is present.

## What to add

A `macos-latest` job that:

1. builds the workspace (at least `omawarden` and its tests),
2. runs the macOS-gated unit tests, including the provider-resolution tests
   that assert `resolve_provider(Some("macos"), None).name() == "macos"`,
3. runs the macOS CLI test file that already exists
   (`omawarden/tests/macos_clipboard_cli.rs`).

A compile-only job is already worth having; the pasteboard and Keychain tests
need a logged-in session, so if they cannot run unattended, mark only those
`#[ignore]` and record why in the job.

## Why it belongs in this repository

`omawarden-app` can assert what `Host::MacOs` *decides*, but it cannot prove the
engine's macOS provider works. That proof lives where the FFI lives.
