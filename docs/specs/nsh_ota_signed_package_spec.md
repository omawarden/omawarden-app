# OTA Signed Package Update Research

> **Target Repository**: `omawarden/omawarden-app`
> **Status**: Not adopted. Research only.
> **Primary Goal**: Decide whether to enable NSH signed-package over-the-air
> updates for `omawarden-app`, and record the decision and its triggers.

---

## 1. What NSH OTA Is

A signed package (`.nshpkg`) is how a host app runs NSH code it did not ship
with. It holds **TSX, QuickJS bytecode, source maps and assets**. The host
app's Rust code is part of the host app itself and is delivered with it; a
package's TSX imports it by specifier, as any TSX does.

This is the critical boundary for `omawarden-app`: **a package cannot change
the Rust bridge.** `OmawardenBridge`, the daemon seam, the vault cache, the
clipboard guard and the inspector are all Rust and ship in the installed
binary. A package can only change `App.tsx`, `components/`, `store/`, `theme/`
and assets.

### Verification chain

A device checks, in order:

1. the certificate's signature by a trusted root;
2. that the release key is not revoked;
3. the package's signature by the release key;
4. that the certificate covers the app id and the signing time;
5. the minimum runtime the package needs;
6. that the file table covers the data exactly and each file matches its hash;
7. that the package itself is not revoked;
8. that its build is not older than the highest build accepted (rollback
   protection).

### Two key levels

- A **root key** stays offline. Host apps trust its public key; several roots
  can be trusted, which is how a root is rotated.
- A root **certifies release keys**: a certificate names the release key, the
  app ids it may sign for and a time window.
- **Packages are signed by a release key** and carry its certificate.

`nsh.json` declares `updater.packages.roots` as base64 public keys. The device
refuses any package whose chain does not end in one of those roots.

### noop's release flow (reference)

`huacnlee/noop`'s `release.yml` signs the package in CI with
`NSH_PACKAGE_KEY` / `NSH_PACKAGE_CERT` secrets, writes `latest.json`, and
ships it alongside the GitHub release. `nsh/updater` downloads and verifies in
the background; a restart applies it. A release needing a newer NSH runtime
comes as a whole app instead.

## 2. Current State of `omawarden-app`

`nsh.json` has no `updater` section. `release-dev.yml` packages a native Linux
runner, bundles a tarball and an AppImage, publishes to a rolling `dev` GitHub
release, and generates an AUR PKGBUILD. There is no signing step and no
package manifest.

`docs/specs/ci_and_dev_release_workflow_spec.md` governs this pipeline. OTA
would be an addition to it, not a replacement: the native runner and the AUR
package stay, and a signed UI package rides alongside.

### What OTA would change

- `nsh.json` gains an `updater` block with `packages.roots`.
- CI gains a signing step using two secrets (release key + certificate).
- A `latest.json` manifest is published with each dev build.
- The running app checks, downloads, verifies and applies the package on
  restart.

### What OTA would *not* change

- The Rust bridge, the daemon seam, the vault cache, the clipboard guard, the
  inspector, the log sanitizer, the scrubbing added in `6988563`.
- The AUR package or the tarball: those still ship the full app.
- The minimum engine version gate, which lives in the engine's
  `DependencyCheckView` and is enforced before unlock.

## 3. Why It Is Not Adopted

### 3.1 A package cannot fix the thing that most needs fixing

`docs/specs/secret_locality_spec.md` (Status: Deferred) records that the UI
process caches the whole decrypted vault as `Vec<VaultItem>` for the length of
an unlocked session. Its primary goal is "Keep decrypted secrets in the
daemon. The UI process keeps rows, never the vault."

That change lives in Rust — in `src/vault.rs`, `src/projection.rs`,
`src/clipboard.rs` and `src/inspector.rs`. **A signed package cannot touch any
of those files.** Enabling OTA would let the UI iterate while the memory
design stays frozen, which makes the deferred spec harder to land, not easier:
the projection, the cache shape and the three readers would all be moving
targets inside a hot-update loop.

This is the dependency that was flagged in the design-tree round and is the
first reason to wait.

### 3.2 Trust explosion radius

A signed package is trusted arbitrary TSX running in an app that:

- holds a plaintext copy of the decrypted vault in `CachedVault`;
- declares `network: { hosts: ["*"] }`;
- can open file dialogs, launch URLs and write the clipboard.

A compromised release key therefore means an attacker can ship a package that
reads the unlocked vault and exfiltrates it. That is a materially worse
exposure than a compromised GitHub release tarball, because the attack reaches
every installed app silently and survives restarts.

noop accepts this because its app holds no secrets. `omawarden-app` does not
have that luxury.

### 3.3 The verification chain is only as strong as the offline root

The root key is the single point of trust and is intentionally offline. For
`omawarden-app` the honest question is who controls it. If it lives in CI
secrets, CI can sign anything. If one person holds it, that person can sign
anything. There is no third option in NSH's model today, and picking one is a
governance decision, not a technical one.

### 3.4 The benefit is small right now

The dev channel already publishes on every push to `main`. The gap OTA
closes — "I built a new version, you should restart" — is already covered by
the rolling GitHub release and the AUR `pkgver`. The UI is stable enough that
package-level updates are not currently the bottleneck.

## 4. Triggers for Reopening

Either of these reopens it:

1. **`secret_locality_spec` lands.** Once the UI process no longer holds
   `Vec<VaultItem>` at steady state — rows only, one item fetched on demand —
   the vault exposure radius of a compromised package shrinks from the entire
   vault to the single item on screen. That is the precondition that makes
   3.2 acceptable.

2. **Network capability is scoped.** If `nsh.json` narrows
   `network: { hosts: ["*"] }` to the server URLs the app actually needs (the
   configured Bitwarden/Vaultwarden instance), a compromised package can no
   longer exfiltrate to an arbitrary host. This pairs with trigger 1.

3. **The governance question is answered.** Who holds the root key, under what
   controls, and what the revocation procedure is. Without an answer to this,
   adding roots to `nsh.json` is premature regardless of the security posture.

## 5. What Does Not Change Today

- No changes to `nsh.json`, `release-dev.yml`, `ci.yml` or the Cargo sources.
- `docs/specs/ci_and_dev_release_workflow_spec.md` is authoritative for the
  current pipeline.
- The scrubbing improvement shipped in `6988563` is independent of this
  decision and is not rolled back.

## 6. Relationship to Other Specs

| Spec | Relationship |
|---|---|
| `secret_locality_spec.md` (Deferred) | Primary prerequisite. OTA waits for it. |
| `ci_and_dev_release_workflow_spec.md` | The current pipeline. OTA would extend it, not replace it. |
| `daemon_lock_tick_spec.md` (Ready) | Independent. Ships before this is reconsidered. |

## 7. Source Material

- NSH signed-packages spec: `https://nsh.dev/docs/signed-packages.md`
- Reference implementation: `huacnlee/noop`, `app/update.ts`,
  `.github/workflows/release.yml`
- `nsh.json` `updater.packages.roots` format: noop's `app/nsh.json`
- This spec supersedes informal notes in the design session of 2026-11-09.