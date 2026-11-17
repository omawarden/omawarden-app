# 0001: Logging, Diagnostics, and Cross-Process Boundaries

**Status**: Accepted
**Date**: 2026-11-13
**Deciders**: (this session)

## Context

The Omarchy Bitwarden plugin (`omarchy-bitwarden`) implemented a dual-channel structured logging subsystem (ADR 0004, Accepted) with:
- CLI/daemon structured stderr logs (5 levels, `OMA_LOG_LEVEL`/`RUST_LOG`/config/GUI selector)
- QML `StdioCollector` capturing CLI subprocess stderr at 17 call sites
- 500-entry in-memory ring with level filters, counters, and Clear Logs
- Clipboard Markdown diagnostics report with environment metadata + last 50 lines
- Zero-knowledge redaction for tokens, passwords, 2FA codes, PEM keys, custom/private URLs

The NSH app (`omawarden-app`) was built to achieve 100% functional/UX/security parity (`frontend_feature_parity_spec.md:5`), but the parity spec ticket P2-4 (`:171-179`) called for "real system RSS memory and stderr ring-buffer logs" — i.e. the plugin's daemon log capture.

Two constraints collided:

1. **Architecture**: the app links the `omawarden` crate in-process and delegates daemon launch to `omawarden::daemon::ensure_daemon_running()` (`src/lib.rs:798-812`). The engine's client code spawns `omawarden daemon` with `Stdio::null()` for stdin/stdout/stderr and discards the `Child` handle (`omawarden/omawarden/src/daemon/client.rs:364-375`). The app never spawns the daemon; it only connects to the shared Unix socket. The daemon may already be running from the Overlay, a terminal, or a service (ADR 0028 coexistence).

2. **Privacy**: `AGENTS.md:17-21` and `scripts/check_privacy.py` forbid real hostnames, emails, absolute home directories, account identifiers, and vault item content in any tracked file. Runtime logs must not create new leakage surfaces.

## Decision

We define three distinct terms in `GLOSSARY.md` and scope them as follows:

- **Log Pipeline** — app-process event source. Records **state transitions and failures only** (auth success/failure, unlock/lock, sync start/end, cipher write rejections). Three levels: `error`, `warn`, `info`. No per-action INFO "telemetry". Entries sanitized by `sanitize_log_message` before entering the ring.
- **Log Viewer** — bounded in-memory ring displayed in Diagnose. Timestamps, level badges, level filtering. Not persisted, not streamed, not sent over network.
- **Diagnostic Report** — user-triggered clipboard snapshot. Contains: app/engine version, commit, build date, sanitized server URL, health verdicts, RSS, Log Viewer contents. **Explicitly excludes** daemon stderr logs and any absolute paths/local filenames. Report header declares the collection scope.

Cross-process log channel (app ↔ daemon): **not built**. Options evaluated:

| Option | Daemon change? | Works for foreign daemon? | Privacy risk |
|--------|----------------|---------------------------|--------------|
| A. App-side stderr pipe into ring | Engine `client.rs` only (new `omawarden` build) | No — `client.rs:332-334` short-circuits on live ping | Medium (sanitization gaps: paths, item titles, custom URLs, socket paths, PIDs) |
| B. New socket action (`logs`/`recent_logs`) | Yes (daemon + protocol bump) | Yes, if new build | Medium (new IPC surface readable by any same-UID process) |
| C. CLI call (`omawarden logs`) | Yes (new subcommand + B underneath) | No logs exist to return | Low–medium |
| D. journald read | No | Only if daemon started under systemd (not default) | High (persisted, outside sanitization) |
| **E. Nothing (status quo)** | **No** | N/A | **Lowest** |

We choose **E**. The daemon's structured stderr remains in the daemon (or `/dev/null`, as `omawarden/src/locked.rs:32-35` documents); the app's `Log Pipeline` boundary is the app process itself. This is recorded as a known deviation from plugin feature parity.

## Consequences

### Positive
- Zero new leakage surface; no runtime logs escape the app's sanitization boundary.
- No daemon protocol change, no engine rebuild required, no risk of EPIPE panic on a shared `setsid`-detached daemon.
- Diagnose tab and diagnostic report remain pure in-process, clipboard-only, user-triggered.
- Security invariant tightened: `ARCHITECTURE.md` now forbids absolute paths and local filenames in log lines. The former `src/attachments.rs:379` deviation (absolute download path in the ring) has been remediated.

### Negative
- GitHub issues will not contain daemon logs. The `Diagnostic Report` header states the scope so reporters know what is missing.
- Parity spec P2-4 is **intentionally narrowed**: "stderr ring-buffer logs" means the app's own ring, not the daemon's. Parity is redefined as **behavioral and security-invariant parity**, not implementation-for-implementation log capture parity.
- Upstream ADR 0004 remains `Accepted`; we do not supersede it. Our ADR references it and records the documented drift: `CONTEXT.md` → `GLOSSARY.md` migration (`c95a48e`) dropped the "Observability & Diagnostics" term, and ADR 0004:32 claims the report includes OS/Quickshell/commit SHA which the plugin's `copyDiagnostics()` does not.

### Known Deviation (Resolved)
`src/attachments.rs:379` previously pushed an absolute download path into the log ring. The engine's `sanitize_log_message` does not redact local paths, so the line was changed to log only `"attachment saved"` and the destination path is no longer recorded. The ADR 0001 boundary invariant (no absolute paths / local filenames in log lines) now holds without exception.

## References

- Upstream: `omarchy-bitwarden/docs/adr/0004-structured-logging-and-diagnostics.md` (Accepted)
- Upstream: `omarchy-bitwarden/docs/adr/0028-daemon-wire-protocol-versioning-and-decoupled-lifecycle.md` (coexistence)
- App: `GLOSSARY.md` — `Log Pipeline`, `Log Viewer`, `Diagnostic Report`
- App: `ARCHITECTURE.md` §3 (Security & Domain Invariants)
- App: `docs/specs/frontend_feature_parity_spec.md` — P2-4 and parity scope
- App: `src/diagnostics.rs:415-440` (log ring implementation)
- App: `components/SettingsModal.tsx:325-410` (Diagnose tab)
- App: `store/appStore.ts:1519-1531` (Copy Diagnostic Report)