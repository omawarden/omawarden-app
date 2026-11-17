# Omawarden App: Logging & Diagnostics Boundary Specification

> **Target Repository**: `omawarden/omawarden-app`
> **Status**: Ready for Implementation
> **Related ADR**: [0001-logging-diagnostics-boundary](../adr/0001-logging-diagnostics-boundary.md)
> **Glossary Terms**: `Log Pipeline`, `Log Viewer`, `Diagnostic Report`

---

## Problem Statement

The Omarchy Bitwarden plugin (`omarchy-bitwarden`) implemented a dual-channel structured logging subsystem (upstream ADR 0004) that captured both CLI/daemon stderr and QML `StdioCollector` subprocess output into a 500-entry ring buffer with level filters, counters, and a Markdown diagnostics report.

The NSH app (`omawarden-app`) was mandated to achieve 100% functional, UX, and security parity with the plugin. However, two architectural constraints made the plugin's log capture approach infeasible:

1. **Process architecture**: The app links the `omawarden` crate in-process and delegates daemon lifecycle to `omawarden::daemon::ensure_daemon_running()`. The engine spawns `omawarden daemon` with `Stdio::null()` and discards the child handle. The app never spawns the daemon; it only connects to the shared Unix socket. The daemon may already be running from the Overlay, CLI, or a service (ADR 0028 coexistence).

2. **Privacy invariants**: `AGENTS.md` and `scripts/check_privacy.py` forbid real hostnames, emails, absolute home directories, account identifiers, and vault item content in any tracked file. Runtime logs must not create new leakage surfaces.

The parity spec ticket P2-4 originally called for "stderr ring-buffer logs" (meaning the daemon's logs), but this cannot be achieved without violating the above constraints.

---

## Solution

Define three distinct, in-process observability capabilities with clear boundaries:

| Term | Responsibility | Boundary |
|------|----------------|----------|
| **Log Pipeline** | Emits sanitized events for state transitions and failures only | App process only; three levels (`error`, `warn`, `info`); no per-action INFO telemetry |
| **Log Viewer** | Bounded in-memory ring with timestamps, level badges, level filtering | Not persisted, not streamed, not sent over network |
| **Diagnostic Report** | User-triggered clipboard snapshot with explicit scope declaration | Excludes daemon logs, absolute paths, local filenames |

**Cross-process log channel (app ↔ daemon): explicitly not built.** The daemon's structured stderr remains in the daemon (or `/dev/null` as documented in `omawarden/src/locked.rs:32-35`). Parity is redefined as **behavioral and security-invariant parity** — the user can trigger a sanitized diagnostic report from the UI — not log-capture implementation parity.

---

## User Stories

1. As a user, I want to open Settings → Logs and see a log viewer showing recent app events with level badges, so that I can understand what the app just did.

2. As a user, I want to filter the log viewer by level (error / warn / info), so that I can focus on failures without noise.

3. As a user, I want to click "Copy Diagnostic Report" and get a sanitized snapshot containing app version, engine version, commit, build date, server URL (redacted), health check results, RSS, and the current log viewer contents, so that I can paste it into a GitHub issue.

4. As a user, I want the diagnostic report to explicitly state what is and is not included (e.g., "daemon logs are not collected"), so that I don't file a bug about missing daemon logs.

5. As a security-conscious user, I want all log lines and the diagnostic report to be sanitized — no tokens, passwords, private IPs, absolute paths, or local filenames — so that pasting a report never leaks sensitive data.

6. As a developer, I want the Log Pipeline to record only state transitions and failures (auth success/failure, unlock/lock, sync start/end, cipher write rejections), not per-action INFO events, so that the log volume stays bounded and the leakage surface stays minimal.

7. As a user running the Overlay and the app simultaneously, I want the app to never restart or pipe the shared daemon's stderr, so that my vault session and SSH agent stay alive.

8. As a CI system, I want `scripts/check_privacy.py` to pass on all tracked files including any new log-related code, so that no private details accidentally enter the repository.

---

## Implementation Decisions

### 1. Log Pipeline (`src/diagnostics.rs`)

- **Seam**: Extend the existing `LOG_RING` (`OnceLock<Mutex<VecDeque<String>>>`) and `push_log()` / `recent_logs()` in `src/diagnostics.rs:415-440`.
- **Entry format**: Each line MUST include an RFC3339 timestamp, a level token (`ERROR`/`WARN`/`INFO`), the sanitized source prefix (e.g., `[app]`, `[app:auth]`), and the sanitized message.
- **Levels**: Only `error`, `warn`, `info`. The engine crate's `debug`/`trace` are not exposed to the app ring.
- **Sanitization**: Every call to `push_log` passes through `omawarden::logging::sanitize_log_message` (already imported at `diagnostics.rs:14`). The app MUST NOT log absolute paths or local filenames. The attachment path is deliberately not logged (see `src/attachments.rs:379`); the log line records only `"attachment saved"`.
- **Event sources (initial)**:
  - Authentication success/failure (`src/auth.rs:240,242`)
  - Unlock/lock transitions
  - Vault sync start/end (`src/vault.rs:68`)
  - Cipher write rejections (422 etc.)
  - Update check results (`src/diagnostics.rs:336,347,383`)
- **Capacity**: Bounded ring (implementation detail, not in spec). Current 40 lines is acceptable; adjustable without spec change.

### 2. Log Viewer (Logs Tab)

The `393f8d4` split gave the viewer its own **Logs** tab; the **Diagnose** tab now
holds only the engine health check cards and their refresh.

- **Seam**: `components/SettingsModal.tsx` Logs tab reads `diagnostics().logs` from `getSettings()` snapshot (`src/lib.rs:1068-1071` → `src/settings.rs:170-184`).
- **Display**: Monospace, selectable lines; each line shows timestamp, level badge (semantic color from `theme/palette.ts`), source, message.
- **Filtering**: Three pills (All / Errors & Warnings / Info) with live counters. Default: All.
- **Refresh**: "Refresh Health" button MUST also refresh the log viewer (currently it only refreshes health; this is a bug to fix).
- **Empty state**: "No logs recorded yet" when ring is empty.

### 3. Diagnostic Report (Copy to Clipboard)

- **Seam**: `store/appStore.ts:1519-1531` `copyDiagnosticReport()` → `OmawardenBridge.copyText`.
- **Report structure (Markdown)**:
  ```
  ### Omawarden Diagnostic Report

  - **Generated At**: <ISO timestamp>
  - **App Version**: <app version>
  - **Engine Version**: <engine version>
  - **Git Commit**: <short commit>
  - **Build Date**: <build date>
  - **Server URL**: <sanitized>
  - **Health**: <5 check results: Engine Installed, Server Reachable, Secret Service, Wayland Clipboard, Memory Locked>
  - **Memory (RSS)**: <MB>

  **Scope**: This report contains the app's in-process diagnostic log ring only.
  The shared daemon's structured stderr logs are not collected.

  #### Recent Logs (N entries):

  ```
  [<timestamp>] [<LEVEL>] [<source>] <message>
  ```
  ```
- **Sanitization**: Server URL via `sanitize_server_url` (`src/config.rs:21-46`); log lines already sanitized by `push_log`.
- **Exclusions**: No daemon logs, no absolute paths, no local filenames, no account IDs, no vault item titles/usernames/URLs.

### 4. Cross-Process Boundary (ADR 0001)

- **Decision**: No app↔daemon log channel. Documented in ADR 0001 with five-option analysis.
- **Consequence**: Parity spec P2-4 narrowed to "app's own sanitized log ring".
- **Upstream references**: ADR 0001 references upstream ADR 0004 (Accepted) and ADR 0028 (coexistence); does not supersede them.

### 5. Security Invariant Update

- **Location**: `ARCHITECTURE.md §3` invariant 2 updated to include "absolute paths, and local filenames".
- **Remediated**: `src/attachments.rs:379` no longer pushes an absolute download path; it logs only `"attachment saved"`. The known deviation from ADR 0001 has been resolved.

---

## Testing Decisions

### What makes a good test

- Test **external behavior only**: the Logs tab renders, filters, copies; the report contains expected fields and exclusions; log lines have timestamps/levels/source; sanitization works.
- Do NOT test internal ring capacity, `VecDeque` mechanics, or `OnceLock` initialization.
- Use the existing headless test infrastructure (`App.test.tsx`, `nsh test`).

### Modules to test

| Module | Test Focus |
|--------|------------|
| `src/diagnostics.rs` (Rust) | `push_log` sanitizes correctly; `recent_logs` returns oldest-first; level tokens present; timestamp format; ring bound respected |
| `components/SettingsModal.tsx` (TSX) | Logs tab renders log lines; filter pills work; "Copy Diagnostic Report" produces expected Markdown structure; scope declaration present; "Refresh Health" also refreshes logs |
| `store/appStore.ts` | `copyDiagnosticReport` builds correct header lines; `refreshHealth` also refreshes logs snapshot |
| `src/settings.rs` | `getSettings()` includes current log ring snapshot |
| Integration (`App.test.tsx`) | End-to-end: unlock → trigger auth failure → open Logs → verify error line appears → filter → copy report → verify structure |

### Prior art

- `App.test.tsx` — existing Settings tab tests (health cards, log viewer, refresh, copy)
- `App.test.tsx:1420-1470` (approx) — favorite toggle tests showing pattern for keyboard + UI assertions
- `src/diagnostics.rs:116-148` — engine crate's logging unit tests (sanitization regexes)
- `src/tests.rs` (engine) — daemon ping/health tests showing `send_daemon_request` patterns

### New tests to add

1. **Rust unit** (`src/diagnostics.rs`): `push_log` redacts bearer token / password / private IP / absolute path; timestamp + level + source prefix present.
2. **Headless** (`App.test.tsx`):
   - "Logs tab shows timestamped, leveled log lines from auth failure"
   - "Filter pills hide/show lines by level"
   - "Copy Diagnostic Report includes scope declaration and excludes daemon logs"
   - "Refresh Health updates both health cards and log viewer"
3. **Privacy**: `scripts/check_privacy.py` must pass (already enforced in CI).

---

## Out of Scope

- **Daemon log capture**: No socket action, no stderr pipe, no journald read, no CLI `omawarden logs` subcommand. (ADR 0001 Option E)
- **Per-action INFO telemetry**: The plugin's "INFO-level telemetry across auth, vault, clipboard, totp, and QML action life-cycle" is not replicated. Only state transitions and failures.
- **Log persistence**: No file, no disk, no survivability across app restarts.
- **Log levels `debug`/`trace`**: Engine crate has them; app ring does not expose them.
- **Structured log formats (JSON, syslog, OpenTelemetry)**: Ring stores formatted strings only.
- **Remote log shipping / crash reporting / analytics**: None.
- **Upstream ADR 0004 modification**: It remains `Accepted`; we only reference it.
- **Remediation of `src/attachments.rs:379`**: Completed — the line now logs only `"attachment saved"`. Does not block this spec.

---

## Further Notes

- **Terminology**: Use `Log Pipeline`, `Log Viewer`, `Diagnostic Report` (GLOSSARY) consistently in code comments, UI strings, and docs. Do not use "telemetry", "instrumentation", "tracing", or "埋点" for these capabilities.
- **Parity definition**: Updated in `frontend_feature_parity_spec.md` Overview and P2-4. Parity = behavioral + security-invariant parity.
- **Future extensibility**: If a cross-process log channel becomes necessary, it would require a new ADR, a daemon protocol bump (ADR 0028), and a privacy review. The current design explicitly leaves that door closed.
- **Migration from plugin**: Users migrating from the Overlay will lose daemon logs in GitHub issues. The report's scope declaration mitigates confusion. No migration tooling needed.
- **Performance**: The ring is bounded and in-memory; `push_log` is a fast mutex + sanitization regex pass. No measurable impact on hot paths.
- **i18n**: Diagnostic report header is English-only (technical artifact for GitHub issues). UI filter pills follow app locale.

---