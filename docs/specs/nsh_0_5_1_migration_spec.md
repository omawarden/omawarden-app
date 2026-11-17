# NSH 0.5.1 Migration Specification

This document specifies the migration of `omawarden-app` from Native Shell (NSH)
0.4.0 to NSH 0.5.1: the framework version, the app version, the local and CI
toolchain, the version literals in code and tests, and the repository
documentation. It also records every 0.5.0 breaking change that was checked
against the codebase and found **not** to apply, and the three 0.5 capabilities
the app deliberately does not adopt.

---

## 1. Two versions, not one

| | Before | After | Where |
| --- | --- | --- | --- |
| **NSH Version** | 0.4.0 | **0.5.1** | `nsh` CLI pin, `nsh-core` / `nsh-base` |
| **App Version** | 0.4.0 | **0.5.0** | `Cargo.toml [package] version`, `nsh.json version` |

The two numbers were briefly equal by coincidence. They are independent: the NSH
Version moves when the framework moves, the App Version when the app ships. The
distinction is now defined in `GLOSSARY.md` as `App Version` and `NSH Version`,
because `Cargo.toml` puts the two `version` lines within ten lines of each other
and the next reader will assume they are one thing.

The app version moves here because this upgrade is the notable change in the
release, and the artifact filenames, the rolling `dev` tag's SemVer string and
the AUR `pkgver` all follow it (`release-dev.yml`, `packaging/generate-aur-pkgbuild.sh`).

## 2. Objectives & Scope

1. **Framework & App version**: `nsh-core`/`nsh-base` → `0.5.1`; `Cargo.toml` and
   `nsh.json` → `0.5.0`; `Cargo.lock` re-resolved.
2. **Toolchain pin**: `mise.toml` and both GitHub workflows install `nsh` `0.5.1`.
3. **CI simplification**: one `install.sh` step for both matrix legs (see §3.4).
4. **Version literals**: the mock/fixture strings that follow the app version.
5. **Documentation**: this spec, `docs/adr/0002-...`, and the NSH references in
   `README.md`, `ARCHITECTURE.md`, `GLOSSARY.md`.
6. **Validation**: `nsh check` (0 errors, 0 warnings), `nsh test` (100%),
   `cargo fmt --all --check`, `scripts/check_privacy.py`, `scripts/check_aur_pkgbuild.sh`.

**Out of scope**, recorded in §5: `focusVisibleStyle`, index keys outside the
vault list, and `window.minSize`. The change ports the app to 0.5.1 and takes
the one 0.5 affordance the list of ciphers was missing — row identity (§3.6) —
and adds no product behavior.

## 3. File-level changes

### 3.1 Rust and manifest

- `Cargo.toml`:
  - `version = "0.5.0"`.
  - `nsh-core = "0.5.1"`, `nsh-base = "0.5.1"`.
  - A comment on `nsh-base`: it is declared but named nowhere in the crate's
    source, and stays pinned so the app builds against the same base the host
    resolves.
- `nsh.json`: `"version": "0.5.0"`. No other key changes: the app declares no
  `window` block, no `macos.infoPlist`, and its `capabilities` stay as they are
  (`host: true`, `network.hosts: ["*"]`, see §4.2).
- `Cargo.lock`: re-resolved. Beyond the `nsh-*` crates moving to 0.5.1, 0.5.1's
  dependency graph adds `nsh-updater`, `rust-i18n`, `serde-saphyr`, `zip`, `tar`,
  `onig`, `rustls-platform-verifier` and others.

### 3.2 Version literals in code and tests

The running app version is `env!("CARGO_PKG_VERSION")`, so bumping
`Cargo.toml` changes the app version **at runtime**, and fixtures that hardcode
the old value go stale or fail:

- `src/diagnostics.rs` — `mock_updates()`: the mock release's `version`,
  `title`, and `url` literals.
- `src/lib.rs` — `mock_ssh_prompt_and_update`: the `latest_version` assertion
  that reads that mock.
- `App.test.tsx` — the `appVersion` fixtures and the assertions
  `App Version: …`, `Latest: …`, `Omawarden …`, `v…`, and `Engine …`.
  The `Engine` expectation comes from the mock settings' `engine_version`, which
  is `env!("CARGO_PKG_VERSION")` in mock mode.

### 3.3 Local toolchain

- `mise.toml`: `"github:longbridge/nsh" = "0.5.1"`.
- The GPUI task's comment now says 0.5.1 and notes that NSH installs the GPUI
  component on first use (`nsh component add gpui` when offline).
- `rust-toolchain.toml` is unchanged: 0.5.1's MSRV is 1.97 and the pin is 1.99.1.

### 3.4 CI and release workflows

- `.github/workflows/ci.yml`: the install step downloads `install.sh` for
  `v0.5.1` with `NSH_VERSION=v0.5.1`. Its comment now says the Linux archive
  carries *this platform's* runtimes, since 0.5 archives carry no other
  platform's runtime.
- `.github/workflows/release-dev.yml`: the x86_64 and aarch64 install steps are
  replaced by **one** step for both legs. The old aarch64 branch built the CLI
  from a source checkout because 0.4.0 had no aarch64 prebuilt; v0.5.1 publishes
  `nsh-linux-arm64.tar.gz` and its `install.sh` maps `Linux/aarch64` to it, so
  the workaround is deleted.

### 3.5 Scripts, packaging, and docs

- `scripts/check_ci.sh`: the "Install NSH …" message names 0.5.1.
- `packaging/build-appimage.sh`: the usage example's filename becomes
  `omawarden-app-0.5.0-dev-x86_64-unknown-linux-gnu.AppImage` — version examples
  are current-state, so they move with the app version.
- `README.md`: the `nsh` prerequisite, the GPUI note, and the Rust version,
  which was stale (`1.98.0` against a `1.99.1` pin).
- `ARCHITECTURE.md`: the `nsh` version in §1 and in the toolchain paths.
- `GLOSSARY.md`: new `App Version` and `NSH Version` terms; `Dev Release`
  rephrased to `<App Version>-dev.<short-sha>`; `Minimum Window Gate` rewritten
  for the 0.5 situation and pointing at ADR 0002.
- `docs/adr/0002-keep-the-app-level-minimum-window-gate.md`: the decision not to
  adopt `window.minSize`.
- Historical documents are left alone: `docs/PERFORMANCE.md`'s measured rows and
  the older `docs/specs/*` files are records of what was true when they were
  written, not statements about the current tree.

### 3.6 Vault rows are keyed by the cipher

`components/VaultItemList.tsx` listed `store.visibleItems()` with
`key="index"`, so NSH kept a row's views with the slot: a cipher that moved
under a filter, a sync, or a favourite redrew into whatever slot it landed in.
The list is now keyed by `item.id`, so NSH keeps the row's views with the
cipher and moves the row — which is what 0.5's row identity is for.

The row's action id moves with it: `cipher-row-slot-<index>` becomes
`cipher-row-<cipher id>`. `store.actionOrder` is the app's own Tab ring and
holds first-registration order, so an action named by its slot would be spliced
out and appended to the end of the ring every time a reorder moved its row; a
cipher-named action re-registers under the id it already has and the ring holds.

The row still reads `index()` for selection and for a press: the app's
selection is `store.selectedIndex()`, and a keyed row's `index()` follows its
cipher to the cipher's new position, so pressing a row still selects that
cipher.

## 4. Verified unaffected

0.5.0's breaking changes were checked one by one against the tree. These do not
apply, and no code change was needed:

| 0.5.0 change | Why it does not apply |
| --- | --- |
| Window API replaced (`WindowRef`, `<Window>`, window kinds) | The app opens no secondary windows and has no window config. It reads `windowSize` (the surface size, unchanged in 0.5) in `store/windowGate.ts`, `components/MinimumWindowGate.tsx`, and `components/VaultItemList.tsx`. |
| `capabilities` grants for media loading | The only local media is a bundler asset import (`assets/icon.png` in `components/AuthView.tsx`); asset imports are the app's own files and need no grant. Other images are remote favicons or `data:` URLs. `host` and `network.hosts` are unchanged. |
| `focus-visible:` follows keyboard focus only | The app uses no `focus-visible:` / `focus:` classes; it styles focus with the `focusStyle` / `focusWithinStyle` props, whose meaning is unchanged. |
| `macos.infoPlist` refuses `LSUIElement` | `nsh.json` has no `macos` block. |
| List-at-start insert behavior | Rows above the visible ones no longer move them. The vault row list is keyed by cipher id (§3.6); the remaining `Each` lists are keyed by index, which 0.5 still supports (§5.2). |
| Tab order with popovers; file drops; `scrollbar={false}`; history/back; animation parameter sanitizing | The app re-implements its own Tab ring; has no `onFileDrop`, no `scrollbar` prop, no navigation stack; and its one animation (`components/FooterBar.tsx`) passes finite parameters. |
| Rust API renames/retypes (`Theme::from_json_lenient`, `DataTableColumn::fixed`, `LayoutCurve::Spring`, `Command::Haptic`, `#[non_exhaustive]` types, new struct fields, `Registry::tokens*`) | None appear. The Rust side uses only `nsh_core::prelude::*` — `Registry`, `#[native_module]`, `#[module]`, `JsObject`, `PropEnum`, `#[prop]` — and no platform crate. |
| Perf line moved to `nsh::fps`, `--fps` only with `-v` | The app and its docs never reference `nsh::perf` or `--fps`. |
| Platform runtimes became components | Linux is not a component: the Linux archive bundles its own runtime, so `nsh package --target linux` needs no `nsh component add`. Components cover the other platforms, including `gpui` and `web`. |

`nsh check` and `nsh test` still exist in 0.5.1 and behave as before.

### 4.1 One pre-existing warning that is not ours

`nsh test` prints, before every test:

```
warn the status bar is not granted: add `"statusBar": true` to capabilities in nsh.json
```

Every app's bootstrap pushes its `nsh.json` `statusBar` default to the engine
(`nsh-js`'s bootstrap emits `Command::SetStatusBar`), and the engine denies it
when `capabilities.statusBar` is false. The app never touches the status bar,
and 0.4.0's `nsh-js` pushes the same command from the same place, so the line
predates this upgrade. Granting `"statusBar": true` would silence it by handing
the app an API it never calls, so `capabilities` is left alone. It is not a
`nsh check` diagnostic: `nsh check` reports 0 warnings.

## 5. Deliberately not adopted

### 5.1 `focusVisibleStyle`

0.5 adds `focusVisibleStyle` (the `focus-visible:` state: keyboard-originated
focus, or an input that edits). The app's 13 `focusStyle` sites are unchanged and
behave exactly as they did on 0.4.0. Switching would stop a mouse press from
showing the ring — a behavior change, so it is left to a change of its own. The
one `focusWithinStyle` site (`components/SettingsModal.tsx`, the Appearance tab's
text-size slider) stays too: 0.5 has no `focus-visible` variant of it.

### 5.2 Index keys elsewhere

The other 21 `Each` lists keep `key="index"`. They list fixed sets or strings —
settings tabs, scope and folder names, password history, the palette's commands
— where a row *is* a slot whose text changes, which is what `key="index"`
expresses. `store/Icons.ts` is written to hold under that recycling: one
failure signal per domain, so a row reused for another item of the same domain
still falls back to the category glyph. The one list of ciphers, the vault rows,
is now keyed by cipher (§3.6).

### 5.3 `window.minSize`

See ADR 0002. The app keeps its own minimum-window gate.

## 6. Validation

Run from the repository root, with `nsh` 0.5.1 on `PATH`:

```sh
nsh check                        # 0 errors, 0 warnings
nsh test                         # cargo tests + headless App.test.tsx, all pass
cargo fmt --all --check
python3 scripts/check_privacy.py
bash scripts/check_aur_pkgbuild.sh
./scripts/check_ci.sh            # the same checks as CI, in CI's order
```

The CI itself (`.github/workflows/ci.yml`) installs `nsh` 0.5.1 and runs the same
sequence, so a green `check_ci.sh` means the push should pass.
