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
        with_mock(|state| mock_dependencies(&state.dependencies_missing))
    }

    fn install_missing(&self, packages: Vec<String>) -> bool {
        !sanitize_packages(packages).is_empty()
    }

    fn health(&self) -> HealthSnapshotView {
        with_mock(|state| mock_health(&state.settings.server_url))
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
    }
}

/// The real dependency check.
fn real_dependencies() -> DependencyStatusView {
    let packages = vec![
        package_status(
            "omawarden",
            "omawarden",
            "Omawarden engine and daemon",
            true,
        ),
        package_status(
            "secret-tool",
            "libsecret",
            "Secret Service keyring bridge",
            true,
        ),
        package_status("wl-copy", "wl-clipboard", "Wayland clipboard", true),
        package_status(
            "fido2-token",
            "libfido2",
            "FIDO2 security keys (optional)",
            false,
        ),
    ];
    let missing_packages: Vec<String> = packages
        .iter()
        .filter(|package| !package.installed)
        .map(|package| package.name.clone())
        .collect();
    let missing_required: Vec<String> = packages
        .iter()
        .filter(|package| package.required && !package.installed)
        .map(|package| package.name.clone())
        .collect();
    DependencyStatusView {
        all_required_installed: missing_required.is_empty(),
        packages,
        missing_packages,
        missing_required,
    }
}

/// The mock dependency check.
fn mock_dependencies(missing: &[String]) -> DependencyStatusView {
    let packages = vec![
        ("omawarden", "Omawarden engine and daemon", true),
        ("libsecret", "Secret Service keyring bridge", true),
        ("wl-clipboard", "Wayland clipboard", true),
        ("libfido2", "FIDO2 security keys (optional)", false),
    ]
    .into_iter()
    .map(|(name, description, required)| PackageStatusView {
        name: name.to_string(),
        description: description.to_string(),
        required,
        installed: !missing.iter().any(|entry| entry == name),
        version: Some("mock".to_string()),
    })
    .collect::<Vec<_>>();
    let missing_packages: Vec<String> = packages
        .iter()
        .filter(|package| !package.installed)
        .map(|package| package.name.clone())
        .collect();
    let missing_required: Vec<String> = packages
        .iter()
        .filter(|package| package.required && !package.installed)
        .map(|package| package.name.clone())
        .collect();
    DependencyStatusView {
        all_required_installed: missing_required.is_empty(),
        packages,
        missing_packages,
        missing_required,
    }
}

/// The real health snapshot.
fn real_health() -> HealthSnapshotView {
    let config = load_config();
    let status = check_system_health(&config.server_url);
    let memory_locked = daemon(json!({ "action": "ping", "touch": false }))
        .and_then(|value| value.get("memory_locked").and_then(|value| value.as_bool()))
        .unwrap_or(false);
    let checks = vec![
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
        HealthCheckView {
            name: "Secret Service Keyring".to_string(),
            ok: status.keyring_available,
            detail: if status.keyring_available {
                "secret-tool is available".to_string()
            } else {
                "secret-tool is missing".to_string()
            },
        },
        HealthCheckView {
            name: "Wayland Clipboard".to_string(),
            ok: status.clipboard_available,
            detail: if status.clipboard_available {
                "wl-copy is available".to_string()
            } else {
                "wl-copy is missing".to_string()
            },
        },
        HealthCheckView {
            name: "Memory Locked".to_string(),
            ok: memory_locked,
            detail: if memory_locked {
                "mlock is active".to_string()
            } else {
                "mlock is not active".to_string()
            },
        },
    ];
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

/// The mock health snapshot.
pub(crate) fn mock_health(server_url: &str) -> HealthSnapshotView {
    let checks = vec![
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
        HealthCheckView {
            name: "Secret Service Keyring".to_string(),
            ok: true,
            detail: "secret-tool is available".to_string(),
        },
        HealthCheckView {
            name: "Wayland Clipboard".to_string(),
            ok: true,
            detail: "wl-copy is available".to_string(),
        },
        HealthCheckView {
            name: "Memory Locked".to_string(),
            ok: true,
            detail: "mlock is active".to_string(),
        },
    ];
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
                push_log("update check: the release response had no tag");
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
            push_log(format!(
                "update check: current {current_version}, latest {tag}, available {available}"
            ));
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
            push_log(format!("update check failed: {error}"));
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
        version: "0.4.0".to_string(),
        title: "Omawarden 0.4.0".to_string(),
        notes: "## What's new\n\n- Faster fuzzy search\n- Quick unlock improvements\n- SSH agent polish".to_string(),
        url: "https://github.com/omawarden/omawarden-app/releases/tag/v0.4.0".to_string(),
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

/// A bounded, sanitized ring of recent app diagnostics.
static LOG_RING: OnceLock<Mutex<VecDeque<String>>> = OnceLock::new();

/// Records a sanitized diagnostic line.
pub(crate) fn push_log(line: impl Into<String>) {
    let line = sanitize_log_message(&line.into());
    let ring = LOG_RING.get_or_init(|| Mutex::new(VecDeque::new()));
    if let Ok(mut guard) = ring.lock() {
        guard.push_back(format!("[app] {line}"));
        while guard.len() > 40 {
            guard.pop_front();
        }
    }
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

/// The process's resident set size in MiB, from `/proc/self/statm`.
pub(crate) fn process_rss_mb() -> f64 {
    let Ok(statm) = std::fs::read_to_string("/proc/self/statm") else {
        return 0.0;
    };
    let pages = statm
        .split_whitespace()
        .nth(1)
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    let page_size = 4096_u64;
    (pages.saturating_mul(page_size) as f64) / (1024.0 * 1024.0)
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

    #[test]
    fn version_comparison_detects_newer_releases() {
        assert!(version_is_newer("1.0.0", "1.0.1"));
        assert!(version_is_newer("v1.2.3", "1.3.0"));
        assert!(version_is_newer("1.0", "1.0.1"));
        assert!(!version_is_newer("1.2.3", "1.2.3"));
        assert!(!version_is_newer("2.0.0", "1.9.9"));
        assert!(!version_is_newer("1.0.0", "1.0.0-beta.2"));
    }
}
