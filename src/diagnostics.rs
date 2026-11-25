//! Diagnostics: dependency checks, system health, update checks, and the log
//! ring.
//!
//! [`DiagnosticsEngine`] is the seam. [`InProcess`] calls the linked engine and
//! the daemon socket; [`Mock`] serves the headless UI tests from the
//! process-wide mock state. `engine::diagnostics()` picks one adapter per call,
//! so the bridge methods never fork on mock mode.

use std::collections::VecDeque;
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};

use omawarden::health::check_system_health;
use omawarden::logging::sanitize_log_message;
use serde_json::{Value, json};

use crate::host::Host;
use crate::{
    DependencyStatusView, HealthCheckView, HealthSnapshotView, PackageStatusView, ReleaseNotesView,
    UpdateStatusView, daemon, load_config, sanitize_server_url, with_mock,
};

/// The diagnostics capabilities the bridge exposes.
pub(crate) trait DiagnosticsEngine {
    /// Re-checks the required and optional system packages.
    fn dependencies(&self) -> DependencyStatusView;

    /// Opens a terminal that installs `packages`.
    fn install_missing(&self, packages: Vec<String>) -> bool;

    /// Runs the system health checks.
    fn health(&self) -> HealthSnapshotView;

    /// Checks the release feed for a newer version.
    fn updates(&self, force: bool) -> UpdateStatusView;
}

/// The real adapter: the linked engine plus the daemon socket.
pub(crate) struct InProcess;

impl DiagnosticsEngine for InProcess {
    fn dependencies(&self) -> DependencyStatusView {
        real_dependencies()
    }

    fn install_missing(&self, packages: Vec<String>) -> bool {
        if !install_offered(Host::current()) {
            return false;
        }
        let safe = sanitize_packages(packages);
        if safe.is_empty() {
            return false;
        }
        let command = format!("sudo pacman -S --noconfirm {}", safe.join(" "));
        for terminal in [
            "omarchy-launch-floating-terminal-with-presentation",
            "alacritty",
            "foot",
            "kitty",
        ] {
            let Ok(path) = which::which(terminal) else {
                continue;
            };
            let mut process = Command::new(path);
            if terminal == "omarchy-launch-floating-terminal-with-presentation" {
                process.arg("sh").arg("-c").arg(&command);
            } else {
                process.arg("-e").arg("sh").arg("-c").arg(&command);
            }
            if process.stdin(Stdio::null()).spawn().is_ok() {
                return true;
            }
        }
        false
    }

    fn health(&self) -> HealthSnapshotView {
        real_health()
    }

    fn updates(&self, force: bool) -> UpdateStatusView {
        real_updates(force)
    }
}

/// The mock adapter: the process-wide mock state.
pub(crate) struct Mock;

impl DiagnosticsEngine for Mock {
    fn dependencies(&self) -> DependencyStatusView {
        with_mock(|state| {
            mock_dependencies(
                state.host,
                &state.dependencies_missing,
                &state.daemon_source,
            )
        })
    }

    fn install_missing(&self, packages: Vec<String>) -> bool {
        with_mock(|state| install_offered(state.host) && !sanitize_packages(packages).is_empty())
    }

    fn health(&self) -> HealthSnapshotView {
        with_mock(|state| mock_health(state.host, &state.settings.server_url))
    }

    fn updates(&self, _force: bool) -> UpdateStatusView {
        with_mock(|state| mock_updates(state.update_available))
    }
}

/// Keeps only package names that are safe to interpolate into a shell command.
fn sanitize_packages(packages: Vec<String>) -> Vec<String> {
    packages
        .into_iter()
        .filter(|package| {
            !package.is_empty()
                && package
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '+'))
        })
        .collect()
}

/// Whether this host offers a package-install action.
///
/// The action drives the Arch/Omarchy package manager in a terminal. macOS has
/// no equivalent the app may run, so it is refused rather than opening a
/// terminal that cannot work, and the interface hides the button.
fn install_offered(host: Host) -> bool {
    match host {
        Host::Linux => true,
        Host::MacOs => false,
    }
}

/// Checks one package.
fn package_status(
    binary: &str,
    name: &str,
    description: &str,
    required: bool,
) -> PackageStatusView {
    let installed_path = which::which(binary).ok();
    let installed = installed_path.is_some();
    let version = installed_path.and_then(|path| {
        Command::new(path)
            .arg("--version")
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
            .ok()
            .and_then(|output| String::from_utf8(output.stdout).ok())
            .map(|text| text.lines().next().unwrap_or_default().trim().to_string())
            .filter(|text| !text.is_empty())
    });
    PackageStatusView {
        name: name.to_string(),
        description: description.to_string(),
        required,
        installed,
        version,
        unsupported: None,
    }
}

/// The real dependency check.
fn real_dependencies() -> DependencyStatusView {
    let daemon_source = crate::daemon_source::view();
    let packages = dependency_rows(
        Host::current(),
        &PackageStatusView {
            name: "omawarden".to_string(),
            description: "Omawarden daemon".to_string(),
            required: true,
            installed: daemon_source.resolved_path.is_some(),
            version: daemon_source.resolved_version.clone(),
            unsupported: None,
        },
        &package_status,
    );
    // A package no install can provide is not "missing": listing it would put
    // an unsatisfiable name in front of the installer, and the mock has to
    // agree with the real path or the two views diverge.
    let missing_packages: Vec<String> = packages
        .iter()
        .filter(|package| !package.installed && package.unsupported.is_none())
        .map(|package| package.name.clone())
        .collect();
    let missing_required: Vec<String> = packages
        .iter()
        .filter(|package| package.required && !package.installed)
        .map(|package| package.name.clone())
        .collect();
    DependencyStatusView {
        all_required_installed: missing_required.is_empty(),
        install_available: install_offered(Host::current()),
        packages,
        missing_packages,
        missing_required,
        daemon_source,
    }
}

/// The dependency rows this host actually needs.
///
/// A macOS keyring and pasteboard are platform frameworks, not packages, so
/// macOS lists neither `secret-tool` nor `wl-copy`; a working install would
/// otherwise report two missing requirements it can never satisfy. The daemon
/// is required on both, and the security-key tool is always optional.
fn dependency_rows(
    host: Host,
    daemon: &PackageStatusView,
    probe: &dyn Fn(&str, &str, &str, bool) -> PackageStatusView,
) -> Vec<PackageStatusView> {
    let mut rows = vec![daemon.clone()];
    if host == Host::Linux {
        rows.push(probe(
            "secret-tool",
            "libsecret",
            "Secret Service keyring bridge",
            true,
        ));
        rows.push(probe("wl-copy", "wl-clipboard", "Wayland clipboard", true));
    }
    let mut fido2 = probe(
        "fido2-token",
        "libfido2",
        "FIDO2 security keys (optional)",
        false,
    );
    // The engine discovers keys by parsing `fido2-token -L` and requiring the
    // device node to start with `/dev/hidraw`, and macOS has no such node: a
    // macOS port would need IOKit's HID manager, not this CLI. So the row stays
    // — hiding it would leave the Diagnose view quietly incomplete — but it
    // says why no install can satisfy it, instead of reporting a missing
    // package whose suggested fix does nothing.
    if host == Host::MacOs {
        fido2.unsupported = Some(
            "The engine discovers security keys through /dev/hidraw, which macOS does not have."
                .to_string(),
        );
    }
    rows.push(fido2);
    rows
}

/// The mock dependency check.
fn mock_dependencies(
    host: Host,
    missing: &[String],
    stored: &crate::daemon_source::DaemonSource,
) -> DependencyStatusView {
    let daemon_missing = missing.iter().any(|entry| entry == "omawarden");
    let daemon_source = crate::daemon_source::mock_view(stored, daemon_missing);
    let daemon = PackageStatusView {
        name: "omawarden".to_string(),
        description: "Omawarden daemon".to_string(),
        required: true,
        installed: !daemon_missing,
        version: Some("mock".to_string()),
        unsupported: None,
    };
    let packages = dependency_rows(host, &daemon, &|_binary, name, description, required| {
        PackageStatusView {
            name: name.to_string(),
            description: description.to_string(),
            required,
            installed: !missing.iter().any(|entry| entry == name),
            version: Some("mock".to_string()),
            unsupported: None,
        }
    });
    let missing_packages: Vec<String> = packages
        .iter()
        .filter(|package| !package.installed && package.unsupported.is_none())
        .map(|package| package.name.clone())
        .collect();
    let missing_required: Vec<String> = packages
        .iter()
        .filter(|package| package.required && !package.installed)
        .map(|package| package.name.clone())
        .collect();
    DependencyStatusView {
        all_required_installed: missing_required.is_empty(),
        install_available: install_offered(host),
        packages,
        missing_packages,
        missing_required,
        daemon_source,
    }
}

/// The real health snapshot.
fn real_health() -> HealthSnapshotView {
    let config = load_config();
    let status = check_system_health(&config.server_url);
    let memory_locked = daemon(json!({ "action": "ping", "touch": false }))
        .and_then(|value| value.get("memory_locked").and_then(|value| value.as_bool()))
        .unwrap_or(false);
    let mut checks = vec![
        HealthCheckView {
            name: "Engine Installed".to_string(),
            ok: status.installed,
            detail: status
                .version
                .clone()
                .unwrap_or_else(|| "unknown".to_string()),
        },
        HealthCheckView {
            name: "Server Reachable".to_string(),
            ok: status.server_reachable,
            detail: sanitize_server_url(&status.server_url),
        },
    ];
    checks.extend(provider_rows(
        Host::current(),
        status.keyring_available,
        status.clipboard_available,
    ));
    checks.push(HealthCheckView {
        name: "Memory Locked".to_string(),
        ok: memory_locked,
        detail: if memory_locked {
            "mlock is active".to_string()
        } else {
            "mlock is not active".to_string()
        },
    });
    HealthSnapshotView {
        engine_installed: status.installed,
        engine_version: status.version.unwrap_or_default(),
        server_reachable: status.server_reachable,
        keyring_available: status.keyring_available,
        clipboard_available: status.clipboard_available,
        memory_locked,
        checks,
        error: status.error,
    }
}

/// The keyring and clipboard rows, named for what this host really uses.
///
/// The `ok` flags are the engine's values verbatim: the engine is the only
/// thing that knows which provider resolved, so the app never re-derives
/// availability from a tool it guesses at. Only the vocabulary changes.
fn provider_rows(
    host: Host,
    keyring_available: bool,
    clipboard_available: bool,
) -> Vec<HealthCheckView> {
    let (keyring_name, keyring_present, keyring_missing) = match host {
        Host::Linux => (
            "Secret Service Keyring",
            "secret-tool is available",
            "secret-tool is missing",
        ),
        Host::MacOs => (
            "macOS Keychain",
            "Security.framework is available",
            "Security.framework did not answer",
        ),
    };
    let (clipboard_name, clipboard_present, clipboard_missing) = match host {
        Host::Linux => (
            "Wayland Clipboard",
            "wl-copy is available",
            "wl-copy is missing",
        ),
        Host::MacOs => (
            "Clipboard",
            "the pasteboard is available",
            "the pasteboard is unavailable",
        ),
    };
    vec![
        HealthCheckView {
            name: keyring_name.to_string(),
            ok: keyring_available,
            detail: if keyring_available {
                keyring_present
            } else {
                keyring_missing
            }
            .to_string(),
        },
        HealthCheckView {
            name: clipboard_name.to_string(),
            ok: clipboard_available,
            detail: if clipboard_available {
                clipboard_present
            } else {
                clipboard_missing
            }
            .to_string(),
        },
    ]
}

/// The mock health snapshot.
pub(crate) fn mock_health(host: Host, server_url: &str) -> HealthSnapshotView {
    let mut checks = vec![
        HealthCheckView {
            name: "Engine Installed".to_string(),
            ok: true,
            detail: "omawarden engine is available".to_string(),
        },
        HealthCheckView {
            name: "Server Reachable".to_string(),
            ok: true,
            detail: sanitize_server_url(server_url),
        },
    ];
    checks.extend(provider_rows(host, true, true));
    checks.push(HealthCheckView {
        name: "Memory Locked".to_string(),
        ok: true,
        detail: "mlock is active".to_string(),
    });
    HealthSnapshotView {
        engine_installed: true,
        engine_version: env!("CARGO_PKG_VERSION").to_string(),
        server_reachable: true,
        keyring_available: true,
        clipboard_available: true,
        memory_locked: true,
        checks,
        error: None,
    }
}

/// The real update check.
fn real_updates(force: bool) -> UpdateStatusView {
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let _ = force;
    match fetch_latest_release() {
        Ok(release) => {
            let tag = release
                .get("tag_name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim_start_matches(['v', 'V'])
                .to_string();
            if tag.is_empty() {
                push_log(
                    LogLevel::Warn,
                    "app:diagnostics",
                    "update check: the release response had no tag",
                );
                return UpdateStatusView {
                    checked: true,
                    available: false,
                    current_version,
                    latest_version: None,
                    release: None,
                    error: Some("No published release was found.".to_string()),
                };
            }
            let available = version_is_newer(&current_version, &tag);
            push_log(
                LogLevel::Info,
                "app:diagnostics",
                &format!(
                    "update check: current {current_version}, latest {tag}, available {available}"
                ),
            );
            let notes = ReleaseNotesView {
                version: tag.clone(),
                title: release
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("Omawarden release")
                    .to_string(),
                notes: release
                    .get("body")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                url: release
                    .get("html_url")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
                published_at: release
                    .get("published_at")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string(),
            };
            UpdateStatusView {
                checked: true,
                available,
                current_version,
                latest_version: Some(tag),
                release: Some(notes),
                error: None,
            }
        }
        Err(error) => {
            push_log(
                LogLevel::Error,
                "app:diagnostics",
                &format!("update check failed: {error}"),
            );
            UpdateStatusView {
                checked: true,
                available: false,
                current_version,
                latest_version: None,
                release: None,
                error: Some(error),
            }
        }
    }
}

/// The mock update check.
fn mock_updates(update_available: bool) -> UpdateStatusView {
    let release = update_available.then(|| ReleaseNotesView {
        version: "0.6.0".to_string(),
        title: "Omawarden 0.6.0".to_string(),
        notes: "## What's new\n\n- Faster fuzzy search\n- Quick unlock improvements\n- SSH agent polish".to_string(),
        url: "https://github.com/omawarden/omawarden-app/releases/tag/v0.6.0".to_string(),
        published_at: "2026-10-01".to_string(),
    });
    UpdateStatusView {
        checked: true,
        available: update_available,
        current_version: env!("CARGO_PKG_VERSION").to_string(),
        latest_version: release.as_ref().map(|release| release.version.clone()),
        release,
        error: None,
    }
}

/// Log level for the app's in-process diagnostic ring.
/// Only three levels are exposed; the engine crate's `debug`/`trace` are not used.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum LogLevel {
    Error,
    Warn,
    Info,
}

impl LogLevel {
    /// Returns the uppercase token used in log lines.
    fn as_token(&self) -> &'static str {
        match self {
            LogLevel::Error => "ERROR",
            LogLevel::Warn => "WARN",
            LogLevel::Info => "INFO",
        }
    }
}

/// How many lines the Log Viewer keeps. Oldest entries are dropped first.
pub(crate) const LOG_RING_CAPACITY: usize = 40;

/// A bounded, sanitized ring of recent app diagnostics.
static LOG_RING: OnceLock<Mutex<VecDeque<String>>> = OnceLock::new();

/// Empties the ring.
///
/// Tests take `crate::test_state::lock()`, which calls this so each one starts
/// from an empty ring instead of inheriting the lines the test before it left.
#[cfg(test)]
pub(crate) fn clear_log_ring() {
    let ring = LOG_RING.get_or_init(|| Mutex::new(VecDeque::new()));
    ring.lock()
        .unwrap_or_else(|error| error.into_inner())
        .clear();
}

static PRIVATE_IP_RE: OnceLock<regex::Regex> = OnceLock::new();
static LOCAL_PATH_RE: OnceLock<regex::Regex> = OnceLock::new();

/// Records a sanitized diagnostic line with level and source.
pub(crate) fn push_log(level: LogLevel, source: &str, message: &str) {
    let line = format_log_line(level, source, message);
    let ring = LOG_RING.get_or_init(|| Mutex::new(VecDeque::new()));
    if let Ok(mut guard) = ring.lock() {
        guard.push_back(line);
        while guard.len() > LOG_RING_CAPACITY {
            guard.pop_front();
        }
    }
}

/// Formats one Log Pipeline line: `[RFC3339] [LEVEL] [source] message`.
///
/// The app's sanitizer runs on top of the engine's: the engine redacts
/// tokens, passwords, secrets, codes and PEM keys, while the app also removes
/// private addresses and local paths, which must never reach a Diagnostic
/// Report.
pub(crate) fn format_log_line(level: LogLevel, source: &str, message: &str) -> String {
    format!(
        "[{}] [{}] [{}] {}",
        format_rfc3339_now(),
        level.as_token(),
        sanitize_source(source),
        sanitize_log_line(message),
    )
}

/// Keeps source labels to a single, parseable token.
fn sanitize_source(source: &str) -> String {
    source
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, ':' | '-' | '_' | '.') {
                character
            } else {
                '_'
            }
        })
        .collect()
}

/// Sanitizes a log message for the Log Viewer and the Diagnostic Report.
fn sanitize_log_line(message: &str) -> String {
    let secrets = sanitize_log_message(message);
    let no_ips = PRIVATE_IP_RE
        .get_or_init(|| {
            regex::Regex::new(
                r"\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b",
            )
            .unwrap()
        })
        .replace_all(&secrets, "<REDACTED IP>");
    LOCAL_PATH_RE
        .get_or_init(|| {
            regex::Regex::new(
                // `/Users` covers macOS home paths, but macOS's real temporary
                // directory is `/private/var/folders/…`, and a bundle's own
                // paths live under `/Applications`, `/Library` and `/Volumes`.
                // Without them a macOS path reaches the Log Viewer and the
                // Diagnostic Report intact.
                r#"(?:~/[^\s"'`]+|/(?:home|Users|private|Library|Applications|Volumes|root|tmp|var|run|mnt|media|srv|opt|usr|etc|lib|bin|sbin|proc|dev)/[^\s"'`]*)"#,
            )
            .unwrap()
        })
        .replace_all(&no_ips, "<REDACTED PATH>")
        .into_owned()
}

/// Returns the recent diagnostic lines, oldest first.
pub(crate) fn recent_logs() -> Vec<String> {
    LOG_RING
        .get()
        .and_then(|ring| {
            ring.lock()
                .ok()
                .map(|guard| guard.iter().cloned().collect())
        })
        .unwrap_or_default()
}

/// Formats the current UTC time as RFC3339 with millisecond precision.
fn format_rfc3339_now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// The process's resident set size in MiB.
pub(crate) fn process_rss_mb() -> f64 {
    process_rss_mb_for(Host::current())
}

/// The process's resident set size in MiB, read the way `host` provides it.
fn process_rss_mb_for(host: Host) -> f64 {
    match host {
        Host::Linux => rss_mb_from_proc(),
        Host::MacOs => rss_mb_from_ps(),
    }
}

/// Reads `/proc/self/statm`, where the second number is resident pages.
fn rss_mb_from_proc() -> f64 {
    let Ok(statm) = std::fs::read_to_string("/proc/self/statm") else {
        return 0.0;
    };
    let pages = rss_pages(&statm).unwrap_or(0);
    (pages.saturating_mul(4096) as f64) / (1024.0 * 1024.0)
}

/// Reads `ps -o rss= -p <pid>`, which reports KiB on macOS.
fn rss_mb_from_ps() -> f64 {
    let pid = std::process::id().to_string();
    let Ok(output) = Command::new("ps")
        .args(["-o", "rss=", "-p", &pid])
        .stdin(Stdio::null())
        .output()
    else {
        return 0.0;
    };
    if !output.status.success() {
        return 0.0;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let kib = parse_rss_kib(&text).unwrap_or(0);
    (kib as f64) / 1024.0
}

/// The resident pages in a `/proc/self/statm` line: total, then resident.
fn rss_pages(statm: &str) -> Option<u64> {
    statm.split_whitespace().nth(1)?.parse::<u64>().ok()
}

/// The KiB a `ps -o rss=` reading reports, or `None` when it is not a number.
fn parse_rss_kib(text: &str) -> Option<u64> {
    text.split_whitespace().next()?.parse::<u64>().ok()
}

/// Compares two dotted versions, ignoring a leading `v` and pre-release tags.
fn version_is_newer(current: &str, latest: &str) -> bool {
    fn parts(version: &str) -> Vec<u64> {
        version
            .trim()
            .trim_start_matches(['v', 'V'])
            .split(['-', '+'])
            .next()
            .unwrap_or_default()
            .split('.')
            .map(|part| part.parse::<u64>().unwrap_or(0))
            .collect()
    }
    let current = parts(current);
    let latest = parts(latest);
    let length = current.len().max(latest.len());
    for index in 0..length {
        let left = current.get(index).copied().unwrap_or(0);
        let right = latest.get(index).copied().unwrap_or(0);
        if right != left {
            return right > left;
        }
    }
    false
}

/// Fetches the latest GitHub release JSON for this repository.
fn fetch_latest_release() -> Result<Value, String> {
    let output = Command::new("curl")
        .args([
            "-fsSL",
            "--max-time",
            "10",
            "-H",
            "Accept: application/vnd.github+json",
            "https://api.github.com/repos/omawarden/omawarden-app/releases/latest",
        ])
        .stdin(Stdio::null())
        .output()
        .map_err(|error| format!("Could not run curl: {error}"))?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if message.is_empty() {
            "No published release was found.".to_string()
        } else {
            message
        });
    }
    serde_json::from_slice::<Value>(&output.stdout)
        .map_err(|error| format!("Could not read the release response: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A probe that reports every binary as installed, so row composition can
    /// be asserted without touching the machine.
    fn all_installed(
        binary: &str,
        name: &str,
        description: &str,
        required: bool,
    ) -> PackageStatusView {
        PackageStatusView {
            name: name.to_string(),
            description: description.to_string(),
            required,
            installed: true,
            version: Some(binary.to_string()),
            unsupported: None,
        }
    }

    fn daemon_row() -> PackageStatusView {
        all_installed("omawarden", "omawarden", "Omawarden daemon", true)
    }

    fn row_names(rows: &[PackageStatusView]) -> Vec<&str> {
        rows.iter().map(|row| row.name.as_str()).collect()
    }

    #[test]
    fn linux_lists_both_runtime_packages_as_required() {
        let rows = dependency_rows(Host::Linux, &daemon_row(), &all_installed);
        assert_eq!(
            row_names(&rows),
            vec!["omawarden", "libsecret", "wl-clipboard", "libfido2"]
        );
        assert!(
            rows.iter()
                .any(|row| row.name == "libsecret" && row.required)
        );
        assert!(
            rows.iter()
                .any(|row| row.name == "wl-clipboard" && row.required)
        );
    }

    #[test]
    fn macos_lists_neither_secret_tool_nor_wl_copy() {
        let rows = dependency_rows(Host::MacOs, &daemon_row(), &all_installed);
        assert_eq!(row_names(&rows), vec!["omawarden", "libfido2"]);
        assert!(!rows.iter().any(|row| row.name == "libsecret"));
        assert!(!rows.iter().any(|row| row.name == "wl-clipboard"));
    }

    #[test]
    fn the_daemon_row_is_required_on_both_hosts() {
        for host in [Host::Linux, Host::MacOs] {
            let rows = dependency_rows(host, &daemon_row(), &all_installed);
            let daemon = rows.iter().find(|row| row.name == "omawarden").unwrap();
            assert!(daemon.required, "{host:?} dropped the required daemon row");
        }
    }

    #[test]
    fn the_security_key_row_is_never_required() {
        for host in [Host::Linux, Host::MacOs] {
            let rows = dependency_rows(host, &daemon_row(), &all_installed);
            let key = rows.iter().find(|row| row.name == "libfido2").unwrap();
            assert!(!key.required, "{host:?} made the optional row required");
        }
    }

    /// The row stays on macOS, and says why installing it would not help.
    ///
    /// Hiding it would make the Diagnose view quietly incomplete, and reporting
    /// it as merely missing would tell the user to install a package that
    /// changes nothing: the engine looks for `/dev/hidraw`, which macOS does
    /// not have.
    #[test]
    fn macos_marks_the_security_key_row_unsupported_rather_than_missing() {
        let rows = dependency_rows(Host::MacOs, &daemon_row(), &all_installed);
        let key = rows.iter().find(|row| row.name == "libfido2").unwrap();
        assert!(
            key.unsupported.is_some(),
            "macOS left the FIDO2 row looking installable"
        );
        assert!(key.unsupported.as_deref().unwrap().contains("/dev/hidraw"));
    }

    #[test]
    fn linux_leaves_the_security_key_row_supported() {
        let rows = dependency_rows(Host::Linux, &daemon_row(), &all_installed);
        let key = rows.iter().find(|row| row.name == "libfido2").unwrap();
        assert!(
            key.unsupported.is_none(),
            "Linux wrongly marked an installable package unsupported"
        );
    }

    #[test]
    fn the_rows_carry_the_daemon_state_they_were_given() {
        let mut daemon = daemon_row();
        daemon.installed = false;
        daemon.version = None;
        let rows = dependency_rows(Host::MacOs, &daemon, &all_installed);
        assert!(!rows[0].installed);
        assert_eq!(rows[0].version, None);
    }

    #[test]
    fn the_install_action_is_offered_on_linux_and_refused_on_macos() {
        assert!(install_offered(Host::Linux));
        assert!(!install_offered(Host::MacOs));
    }

    #[test]
    fn install_names_are_sanitized_on_every_host() {
        // The platform refusal does not replace the guard: a name that would
        // reach the install path is filtered on any host.
        let packages = sanitize_packages(vec![
            "libsecret; rm -rf /".to_string(),
            "wl-clipboard".to_string(),
            String::new(),
        ]);
        assert_eq!(packages, vec!["wl-clipboard".to_string()]);
    }

    #[test]
    fn each_host_names_its_own_keyring_and_clipboard() {
        let linux = provider_rows(Host::Linux, true, true);
        assert_eq!(linux[0].name, "Secret Service Keyring");
        assert_eq!(linux[0].detail, "secret-tool is available");
        assert_eq!(linux[1].name, "Wayland Clipboard");
        assert_eq!(linux[1].detail, "wl-copy is available");

        let macos = provider_rows(Host::MacOs, true, true);
        assert_eq!(macos[0].name, "macOS Keychain");
        assert!(macos[0].detail.contains("Security.framework"));
        assert_eq!(macos[1].name, "Clipboard");
        assert!(macos[1].detail.contains("pasteboard"));
    }

    #[test]
    fn an_unavailable_provider_is_reported_in_the_hosts_own_words() {
        let linux = provider_rows(Host::Linux, false, false);
        assert_eq!(linux[0].detail, "secret-tool is missing");
        assert_eq!(linux[1].detail, "wl-copy is missing");

        let macos = provider_rows(Host::MacOs, false, false);
        assert!(!macos[0].detail.contains("secret-tool"));
        assert!(!macos[1].detail.contains("wl-copy"));
        assert!(macos[0].detail.contains("Security.framework"));
        assert!(macos[1].detail.contains("pasteboard"));
    }

    #[test]
    fn the_ok_flag_is_the_engines_value_verbatim() {
        for (keyring, clipboard) in [(true, true), (true, false), (false, true), (false, false)] {
            for host in [Host::Linux, Host::MacOs] {
                let rows = provider_rows(host, keyring, clipboard);
                assert_eq!(rows[0].ok, keyring, "{host:?} re-derived the keyring flag");
                assert_eq!(
                    rows[1].ok, clipboard,
                    "{host:?} re-derived the clipboard flag"
                );
            }
        }
    }

    #[test]
    fn the_proc_reading_parses_and_tolerates_garbage() {
        assert_eq!(rss_pages("1234 567 89 0 0 0 0"), Some(567));
        assert_eq!(rss_pages("not a statm line"), None);
        assert_eq!(rss_pages(""), None);
    }

    #[test]
    fn the_ps_reading_parses_and_tolerates_garbage() {
        assert_eq!(parse_rss_kib("  24680\n"), Some(24680));
        assert_eq!(parse_rss_kib("24680 extra"), Some(24680));
        assert_eq!(parse_rss_kib(""), None);
        assert_eq!(parse_rss_kib("garbage"), None);
    }

    #[test]
    fn a_zero_reading_never_panics() {
        assert_eq!(
            rss_pages("0 0 0 0 0 0 0").map(|pages| pages as f64),
            Some(0.0)
        );
        assert_eq!(parse_rss_kib("0").map(|kib| kib as f64), Some(0.0));
    }

    #[test]
    fn version_comparison_detects_newer_releases() {
        assert!(version_is_newer("1.0.0", "1.0.1"));
        assert!(version_is_newer("v1.2.3", "1.3.0"));
        assert!(version_is_newer("1.0", "1.0.1"));
        assert!(!version_is_newer("1.2.3", "1.2.3"));
        assert!(!version_is_newer("2.0.0", "1.9.9"));
        assert!(!version_is_newer("1.0.0", "1.0.0-beta.2"));
    }

    #[test]
    fn log_line_carries_a_timestamp_level_and_source() {
        let line = format_log_line(LogLevel::Warn, "app:vault", "sync failed");
        let shape = regex::Regex::new(
            r"^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] \[WARN\] \[app:vault\] sync failed$",
        )
        .unwrap();
        assert!(shape.is_match(&line), "unexpected log line: {line}");
    }

    #[test]
    fn all_three_levels_have_distinct_tokens() {
        let error = format_log_line(LogLevel::Error, "app:auth", "failure");
        let warn = format_log_line(LogLevel::Warn, "app:auth", "warning");
        let info = format_log_line(LogLevel::Info, "app:auth", "success");
        assert!(error.contains("[ERROR]"));
        assert!(warn.contains("[WARN]"));
        assert!(info.contains("[INFO]"));
    }

    #[test]
    fn log_line_sanitizes_the_source_label() {
        let line = format_log_line(LogLevel::Info, "app:auth\n[ERROR] leaked", "ok");
        assert!(!line.contains('\n'));
        assert!(!line.contains("[ERROR]"));
        assert!(line.contains("[app:auth_"));
    }

    #[test]
    fn log_line_redacts_secrets_ips_and_absolute_paths() {
        let line = format_log_line(
            LogLevel::Error,
            "app:vault",
            "Bearer abc.def at 192.168.1.7 with {\"password\":\"hunter2\"} from /home/user/Downloads/notes.txt",
        );
        assert!(!line.contains("abc.def"));
        assert!(!line.contains("hunter2"));
        assert!(!line.contains("192.168.1.7"));
        assert!(!line.contains("/home/user/Downloads/notes.txt"));
        assert!(line.contains("Bearer <REDACTED>"));
        assert!(line.contains("<REDACTED IP>"));
        assert!(line.contains("<REDACTED PATH>"));
    }

    /// macOS paths do not start with `/home`, and its temporary directory is
    /// `/private/var/folders/…`, so a Linux-only prefix list redacts nothing.
    #[test]
    fn log_line_redacts_macos_paths() {
        for path in [
            "/Users/user/Library/Application Support/omawarden/config.json",
            "/private/var/folders/x9/abc123/T/omawarden-runtime-501/preview.pdf",
            "/Applications/Omawarden.app/Contents/MacOS/Omawarden",
            "/Volumes/External/vault-item.attachment",
        ] {
            let line = format_log_line(LogLevel::Error, "app:vault", &format!("failed at {path}"));
            assert!(!line.contains(path), "{path} survived redaction: {line}");
            assert!(line.contains("<REDACTED PATH>"), "{line}");
        }
    }

    #[test]
    fn ring_keeps_only_the_most_recent_lines_oldest_first() {
        let _guard = crate::test_state::lock();
        for index in 0..(LOG_RING_CAPACITY + 5) {
            push_log(LogLevel::Info, "app:diagnostics", &format!("line {index}"));
        }
        let logs = recent_logs();
        assert_eq!(logs.len(), LOG_RING_CAPACITY);
        assert!(logs[0].ends_with("line 5"), "oldest line: {}", logs[0]);
        assert!(
            logs[LOG_RING_CAPACITY - 1].ends_with(&format!("line {}", LOG_RING_CAPACITY + 4)),
            "newest line: {}",
            logs[LOG_RING_CAPACITY - 1]
        );
    }
}
