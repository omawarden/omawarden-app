# Engine follow-up: compile and run the macOS-gated code in CI

**Repository**: `icyleaf/omarchy-bitwarden`
**Issue**: icyleaf/omarchy-bitwarden#432
**Blocks**: any trustworthy claim that `omawarden-app` works on macOS

## Symptom

`omawarden-app` now ships a macOS bundle that stores session tokens through the
engine's `MacOsKeychainProvider` (Security.framework). The parts of that path
that need a real Mac have never been compiled by the engine's CI.

Every workflow in this repository runs on `ubuntu-latest`, including
`.github/workflows/ci.yml` (`backend`, `frontend`) and both release matrices
(`x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`). So these blocks are
never compiled anywhere except a developer's Mac:

- `omawarden/src/keyring/macos.rs` — the `security_ffi` module, behind
  `#[cfg(target_os = "macos")]`, including the `SecItemAdd`/`SecItemUpdate`
  declarations.
- `omawarden/src/clipboard/macos.rs` — the `pasteboard_ffi` module, which links
  `AppKit` and `objc` and calls `objc_msgSend` for `changeCount`.
- `omawarden/src/keyring/provider.rs` and `omawarden/src/clipboard/provider.rs`
  — the `#[cfg(target_os = "macos")]` arms of provider resolution.

A typo in a selector name, a wrong `objc_msgSend` signature or a missing
framework link would only surface on a user's machine, as a sign-in that
silently stores nothing.

Cross-compiling from Linux is not an option: it needs a macOS SDK and a cross
toolchain, and neither is available.

## What is already covered on Linux

Worth stating so the new job is not asked to duplicate it:

- `omawarden/tests/macos_clipboard_cli.rs` has one test that is **not**
  cfg-gated, `test_macos_clipboard_holder_with_explicit_provider`, and it runs
  and passes on Linux today by driving a mock `pbcopy` through
  `--provider macos --binary-path`. Only the second test in that file,
  `test_macos_real_cli_copy_and_pasteboard`, is `#[cfg(target_os = "macos")]`.
- Both provider-resolution tests run on Linux:
  `clipboard::tests::test_provider_resolution` and
  `keyring::tests::test_provider_resolution_precedence`, which assert that
  `resolve_provider(Some("macos"), None).name() == "macos"` and that
  `"keychain"` is an alias.
- `keyring::macos::tests::*` (attribute mapping, lifecycle, scoped-slot erasure)
  and `clipboard::macos::tests::test_macos_provider_unavailable` also run on
  Linux, because they drive the provider through a mock backend and do not
  touch `security_ffi` / `pasteboard_ffi`.

What Linux cannot exercise is the FFI itself, and the two tests that are
already `#[cfg(target_os = "macos")]`:
`test_macos_real_system_keychain_roundtrip` and
`test_macos_real_system_pasteboard_changecount`.

## What to add

A `macos-latest` job in `.github/workflows/ci.yml` that:

1. checks out the repository and installs the Rust toolchain the other jobs
   use,
2. runs `cargo build --all-targets` in `omawarden`, which is what compiles the
   two `*_ffi` modules and the macOS arms of provider resolution for the first
   time,
3. runs `cargo test --all-targets`, which on macOS picks up
   `test_macos_real_system_keychain_roundtrip`,
   `test_macos_real_system_pasteboard_changecount` and
   `test_macos_real_cli_copy_and_pasteboard`,
4. runs `cargo clippy --all-targets -- -D warnings` and `cargo fmt --check`,
   matching the `backend` job, so the macOS arms cannot rot into warnings.

Step 2 is the minimum that pays off: it compiles the FFI declarations, so a
wrong `extern "C"` signature, a mangled framework link or a type mismatch fails
the job, and it needs no desktop session. Step 3 is still worth having, because
what compiles can still be wrong at runtime: a mis-spelled Objective-C selector
is a byte string, not a symbol, so `sel_registerName(b"changeCount")` compiles
and returns null. A compile job narrows the risk substantially; it does not
remove it.

The three `real_system_*` tests need a live login session (Keychain access and
a pasteboard). On a CI runner they may fail for that reason rather than a code
reason; if that happens, `#[ignore]` only those three with a recorded reason.
They live in three different files — `omawarden/src/keyring/macos.rs`,
`omawarden/src/clipboard/macos.rs` and `omawarden/tests/macos_clipboard_cli.rs`
— so the unit is "ignore this one test", never "ignore the file" and never
"skip the crate". Do not let a skipped test count as coverage.

## Why it belongs in this repository

`omawarden-app` can assert what `Host::MacOs` *decides*, but it cannot prove the
engine's macOS provider works. That proof lives where the FFI lives, and a
`macos-latest` runner here is the only way to get it: the alternative, building
the engine's macOS targets from a machine that is not a Mac, needs a macOS SDK
and a cross toolchain that neither this repository nor CI has.

Two of the three `real_system_*` tests already self-skip when the provider is
unavailable — `test_macos_real_system_pasteboard_changecount` returns early on
`if !provider.is_available()`, and `test_macos_real_cli_copy_and_pasteboard`
returns early when the built binary is not where it expects. On a macOS runner
both should run. If they skip instead, that is a signal worth failing on rather
than a green check: a job that passes because the tests declined to look is the
same false confidence this request exists to remove.
