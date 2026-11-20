//! Daemon source: which `omawarden` executable the app starts when no daemon
//! is answering the shared socket.
//!
//! The choice is an execution decision, not a presentation preference, so it
//! lives in its own `daemon.json` beside the engine's `config.json` with its own
//! seam. [`InProcess`] reads and writes the file; [`Mock`] serves the headless
//! UI tests from the process-wide mock state.
//!
//! Resolution is a pure function over paths: `OMA_DAEMON_BIN`, then the stored
//! source, then a development fallback, then `PATH`. A `system` or `custom`
//! source that is gone is a hard error — silently launching a different daemon
//! would make the setting a lie. Only `bundled` falls through.
//!
//! An already-running daemon is never consulted here. The engine pings before
//! it resolves anything, and the app never sends `stop` to take the socket.

use std::collections::HashSet;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use nsh_core::prelude::*;
use omawarden::fs_util::{atomic_write_str, create_secure_dir_all};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{config_manager, with_mock};

/// The executable name the engine and the packaging both use.
const DAEMON_BINARY: &str = "omawarden";

/// How long a candidate's `-V` may take before it is treated as unparseable.
///
/// Candidates come from `PATH` and are not trusted to be well behaved; the
/// settings dialog must not hang on one of them.
const VERSION_PROBE_TIMEOUT: Duration = Duration::from_millis(1000);

/// Where the app looks for the daemon executable.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PropEnum, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DaemonSourceMode {
    /// The executable shipped beside the app binary.
    #[default]
    Bundled,
    /// A daemon the OS package installed, or another binary on `PATH`.
    System,
    /// A binary the user pointed at.
    Custom,
}

impl DaemonSourceMode {
    /// The lowercase form stored in `daemon.json`.
    fn as_str(self) -> &'static str {
        match self {
            Self::Bundled => "bundled",
            Self::System => "system",
            Self::Custom => "custom",
        }
    }

    /// The label the interface shows.
    fn label(self) -> &'static str {
        match self {
            Self::Bundled => "Bundled",
            Self::System => "System",
            Self::Custom => "Custom",
        }
    }

    /// Parses the stored form, tolerating unknown values.
    fn parse(raw: &str) -> Self {
        match raw.trim().to_ascii_lowercase().as_str() {
            "system" => Self::System,
            "custom" => Self::Custom,
            _ => Self::Bundled,
        }
    }
}

/// The stored choice.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct DaemonSource {
    /// Which kind of binary to launch.
    pub mode: DaemonSourceMode,
    /// The `system` or `custom` path; ignored for `bundled`.
    pub path: Option<String>,
}

/// The daemon source shown in settings and diagnostics.
#[derive(Clone, Debug, JsObject)]
pub struct DaemonSourceView {
    /// The stored mode.
    pub mode: DaemonSourceMode,
    /// The stored path, when there is one.
    pub configured_path: Option<String>,
    /// The binary the app would launch, when the chain resolves.
    pub resolved_path: Option<String>,
    /// That binary's version, when `-V` parses.
    pub resolved_version: Option<String>,
    /// That binary's commit, when `-V` parses.
    pub resolved_commit: Option<String>,
    /// The engine revision the app pins, for comparison.
    pub pinned_rev: String,
    /// Whether the resolved binary was built from the pinned revision.
    pub matches_pinned: bool,
    /// The daemon that answers right now, if any.
    pub running_version: Option<String>,
    /// That daemon's commit, when it reports one.
    pub running_commit: Option<String>,
    /// A fallback the resolution had to take, if any.
    pub note: Option<String>,
    /// Why the chain failed, when it did.
    pub problem: Option<String>,
}

/// The daemon source to change.
#[derive(Clone, Debug, JsObject)]
pub struct DaemonSourceUpdateInput {
    /// The mode to store.
    pub mode: DaemonSourceMode,
    /// The path for `system` / `custom`.
    pub path: Option<String>,
}

/// Which list an entry came from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PropEnum)]
pub enum DaemonCandidateKind {
    /// The executable shipped with the app.
    Bundled,
    /// A binary found on `PATH`.
    Path,
    /// The user's custom path.
    Custom,
}

/// One launchable candidate.
#[derive(Clone, Debug, JsObject)]
pub struct DaemonCandidateView {
    /// The full path.
    pub path: String,
    /// Where the entry came from.
    pub kind: DaemonCandidateKind,
    /// The version `-V` reported.
    pub version: Option<String>,
    /// The commit `-V` reported.
    pub commit: Option<String>,
    /// Whether the commit is the one the app pins.
    pub matches_pinned: bool,
    /// Whether the user may select it. An unparseable `-V` clears this.
    pub selectable: bool,
}

/// The persistence seam.
pub(crate) trait DaemonSourceEngine {
    /// Reads the stored choice, falling back to `bundled`.
    fn get(&self) -> DaemonSource;

    /// Stores `source`.
    fn store(&self, source: DaemonSource) -> Result<(), String>;
}

/// The real adapter: `daemon.json`.
pub(crate) struct InProcess;

impl DaemonSourceEngine for InProcess {
    fn get(&self) -> DaemonSource {
        read_source(&daemon_source_path())
    }

    fn store(&self, source: DaemonSource) -> Result<(), String> {
        write_source(&daemon_source_path(), &source).map_err(|error| error.to_string())
    }
}

/// The mock adapter: the process-wide mock state.
pub(crate) struct Mock;

impl DaemonSourceEngine for Mock {
    fn get(&self) -> DaemonSource {
        with_mock(|state| state.daemon_source.clone())
    }

    fn store(&self, source: DaemonSource) -> Result<(), String> {
        with_mock(|state| {
            state.daemon_source = source;
            Ok(())
        })
    }
}

/// The path of the source file, beside the engine's `config.json`.
pub(crate) fn daemon_source_path() -> PathBuf {
    config_manager().config_path.with_file_name("daemon.json")
}

/// The on-disk shape. Every field is optional so a partial file still loads,
/// and unknown keys are ignored.
#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(default)]
struct SourceFile {
    /// The stored mode, as a string so an unknown value falls back.
    mode: Option<String>,
    /// The stored path.
    path: Option<String>,
}

/// Reads the file, yielding `bundled` when it is missing or unreadable.
fn read_source(path: &Path) -> DaemonSource {
    let Ok(content) = std::fs::read_to_string(path) else {
        return DaemonSource::default();
    };
    let Ok(file) = serde_json::from_str::<SourceFile>(&content) else {
        return DaemonSource::default();
    };
    DaemonSource {
        mode: file
            .mode
            .as_deref()
            .map(DaemonSourceMode::parse)
            .unwrap_or_default(),
        path: file.path.filter(|value| !value.trim().is_empty()),
    }
}

/// Writes the file atomically with mode `0600`, as the engine writes its config.
fn write_source(path: &Path, source: &DaemonSource) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        create_secure_dir_all(parent, 0o700)?;
    }
    let file = SourceFile {
        mode: Some(source.mode.as_str().to_string()),
        path: source.path.clone(),
    };
    let content = serde_json::to_string_pretty(&file)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error.to_string()))?;
    atomic_write_str(path, &content, 0o600)
}

/// A binary the app would launch, and why it chose it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Resolution {
    /// The executable.
    pub path: PathBuf,
    /// A fallback the chain had to take, if any.
    pub note: Option<String>,
}

/// Why the resolution chain could not produce a binary.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum ResolveError {
    /// `OMA_DAEMON_BIN` is set to something that is not a file.
    EnvMissing(PathBuf),
    /// `system` or `custom` is selected with no path.
    NotConfigured(DaemonSourceMode),
    /// The configured path is gone.
    ConfiguredMissing {
        /// The mode that named the path.
        mode: DaemonSourceMode,
        /// The path that is gone.
        path: PathBuf,
    },
    /// Nothing was found anywhere.
    NotFound(Vec<PathBuf>),
}

impl ResolveError {
    /// The message shown to the user.
    pub(crate) fn message(&self) -> String {
        match self {
            Self::EnvMissing(path) => format!(
                "OMA_DAEMON_BIN points at {}, which is not a file.",
                path.display()
            ),
            Self::NotConfigured(mode) => format!(
                "No {} daemon is selected. Pick one in Settings → Engine.",
                mode.label()
            ),
            Self::ConfiguredMissing { mode, path } => format!(
                "The {} daemon at {} is gone. Pick another source in Settings → Engine, \
                 or reinstall omawarden-bin.",
                mode.label(),
                path.display()
            ),
            Self::NotFound(probed) => {
                let probed = probed
                    .iter()
                    .map(|path| path.display().to_string())
                    .collect::<Vec<_>>()
                    .join(", ");
                format!(
                    "No omawarden daemon found. Install omawarden-bin, or pick a source in \
                     Settings → Engine. Probed: {probed}."
                )
            }
        }
    }
}

/// Everything the resolution needs, injected so it stays testable.
#[derive(Clone, Debug, Default)]
pub(crate) struct ResolveInputs {
    /// The directory holding the app binary.
    pub app_dir: PathBuf,
    /// `OMA_DAEMON_BIN`, when set to a non-blank value.
    pub env_bin: Option<PathBuf>,
    /// The sibling engine checkout, in development builds only.
    pub dev_root: Option<PathBuf>,
    /// The `PATH` lookup result.
    pub path_lookup: Option<PathBuf>,
}

/// Resolves the binary to launch, or explains why there is none.
pub(crate) fn resolve(
    source: &DaemonSource,
    inputs: &ResolveInputs,
) -> Result<Resolution, ResolveError> {
    if let Some(path) = inputs.env_bin.as_ref() {
        if path.is_file() {
            return Ok(Resolution {
                path: path.clone(),
                note: Some("launched from OMA_DAEMON_BIN".to_string()),
            });
        }
        return Err(ResolveError::EnvMissing(path.clone()));
    }

    match source.mode {
        DaemonSourceMode::Bundled => {
            let bundled = inputs.app_dir.join(DAEMON_BINARY);
            if bundled.is_file() {
                return Ok(Resolution {
                    path: bundled,
                    note: None,
                });
            }
        }
        DaemonSourceMode::System | DaemonSourceMode::Custom => {
            let Some(raw) = source
                .path
                .as_deref()
                .map(str::trim)
                .filter(|p| !p.is_empty())
            else {
                return Err(ResolveError::NotConfigured(source.mode));
            };
            let path = PathBuf::from(raw);
            if path.is_file() {
                return Ok(Resolution { path, note: None });
            }
            return Err(ResolveError::ConfiguredMissing {
                mode: source.mode,
                path,
            });
        }
    }

    // Only `bundled` reaches here: a release artifact without its daemon, or a
    // development tree that never packaged one.
    let mut probed = vec![inputs.app_dir.join(DAEMON_BINARY)];
    if let Some(root) = inputs.dev_root.as_ref() {
        for profile in ["debug", "release"] {
            let path = root
                .join("omawarden")
                .join("target")
                .join(profile)
                .join(DAEMON_BINARY);
            if path.is_file() {
                return Ok(Resolution {
                    path,
                    note: Some("development fallback".to_string()),
                });
            }
            probed.push(path);
        }
    }
    if let Some(path) = inputs.path_lookup.clone() {
        return Ok(Resolution {
            path,
            note: Some("PATH fallback".to_string()),
        });
    }
    probed.push(PathBuf::from(format!("{DAEMON_BINARY} (PATH)")));
    Err(ResolveError::NotFound(probed))
}

/// `OMA_DAEMON_BIN`, when set to a non-blank value.
pub(crate) fn env_daemon_bin() -> Option<PathBuf> {
    let raw = std::env::var_os("OMA_DAEMON_BIN")?;
    let text = raw.to_string_lossy();
    let trimmed = text.trim();
    (!trimmed.is_empty()).then(|| PathBuf::from(trimmed))
}

/// The sibling engine checkout, in development builds only.
///
/// Gated on `debug_assertions` so a released binary never carries the build
/// machine's absolute path.
#[cfg(debug_assertions)]
fn dev_engine_root() -> Option<PathBuf> {
    let manifest = option_env!("CARGO_MANIFEST_DIR")?;
    let root = Path::new(manifest).parent()?.join("omarchy-bitwarden");
    root.is_dir().then_some(root)
}

/// Release builds have no development fallback.
#[cfg(not(debug_assertions))]
fn dev_engine_root() -> Option<PathBuf> {
    None
}

/// The inputs for the current process.
fn live_inputs() -> ResolveInputs {
    ResolveInputs {
        app_dir: std::env::current_exe()
            .ok()
            .and_then(|path| path.parent().map(Path::to_path_buf))
            .unwrap_or_default(),
        env_bin: env_daemon_bin(),
        // Tests must never launch a real daemon. The engine guards its own
        // `PATH` lookup the same way (`cfg!(test)` in `daemon/client.rs`), so
        // the boot path keeps failing exactly where it used to.
        dev_root: if cfg!(test) { None } else { dev_engine_root() },
        path_lookup: if cfg!(test) {
            None
        } else {
            which::which(DAEMON_BINARY).ok()
        },
    }
}

/// Resolves against the real machine.
pub(crate) fn resolve_live() -> Result<Resolution, ResolveError> {
    let source = crate::engine::daemon_source().get();
    resolve(&source, &live_inputs())
}

/// The source, resolution, and comparison as the interface sees them.
pub(crate) fn view() -> DaemonSourceView {
    if crate::with_mock(|state| state.enabled) {
        // Headless UI tests script a source and candidates; the real chain
        // would probe the test machine's `PATH` and the host binary's folder.
        return with_mock(|state| mock_view(&state.daemon_source, false));
    }
    build_view(
        crate::engine::daemon_source().get(),
        resolve_live().map_err(|error| error.message()),
    )
}

/// Builds the view from a stored source and a resolution result.
fn build_view(source: DaemonSource, resolution: Result<Resolution, String>) -> DaemonSourceView {
    let pinned_rev = env!("ENGINE_REV").to_string();
    let (resolved_path, note, problem, version, commit) = match resolution {
        Ok(resolution) => {
            let probed = probe_version(&resolution.path);
            (
                Some(resolution.path.display().to_string()),
                resolution.note,
                None,
                probed.as_ref().map(|info| info.version.clone()),
                probed.as_ref().and_then(|info| info.commit.clone()),
            )
        }
        Err(problem) => (None, None, Some(problem), None, None),
    };
    let matches_pinned = commit
        .as_deref()
        .map(|commit| commit_matches(commit, &pinned_rev))
        .unwrap_or(false);
    let (running_version, running_commit) = running_daemon();
    DaemonSourceView {
        mode: source.mode,
        configured_path: source.path,
        resolved_path,
        resolved_version: version,
        resolved_commit: commit,
        pinned_rev,
        matches_pinned,
        running_version,
        running_commit,
        note,
        problem,
    }
}

/// The daemon answering the socket right now, if any.
///
/// This is the `ping` the app already relies on, not a second probe: a daemon
/// this process did not start still answers here, and the app only reads its
/// version — it never takes the socket or stops it.
fn running_daemon() -> (Option<String>, Option<String>) {
    if crate::with_mock(|state| state.enabled) {
        return (
            Some("mock".to_string()),
            Some(env!("ENGINE_REV_SHORT").to_string()),
        );
    }
    let Ok(response) = omawarden::daemon::DaemonClient::new().ping() else {
        return (None, None);
    };
    (
        response
            .get("version")
            .and_then(|value| value.as_str())
            .map(str::to_string),
        response
            .get("commit")
            .and_then(|value| value.as_str())
            .map(|commit| commit.to_ascii_lowercase()),
    )
}

/// Stores the choice, rejecting a path that cannot be launched.
pub(crate) fn set(input: DaemonSourceUpdateInput) -> DaemonSourceView {
    let candidate = DaemonSource {
        mode: input.mode,
        path: input
            .path
            .map(|path| path.trim().to_string())
            .filter(|path| !path.is_empty()),
    };

    if crate::with_mock(|state| state.enabled) {
        // Mock paths are scripted, not files on the test machine, so the
        // file check only applies to the real adapter.
        let store_error = crate::engine::daemon_source().store(candidate).err();
        let mut view = self::view();
        if let Some(problem) = store_error {
            view.problem = Some(problem);
        }
        return view;
    }

    let rejection = validate(&candidate);
    let store_error = if rejection.is_none() {
        crate::engine::daemon_source().store(candidate).err()
    } else {
        None
    };

    let mut view = self::view();
    if let Some(problem) = rejection.or(store_error) {
        view.problem = Some(problem);
    }
    view
}

/// Why a stored choice cannot be launched, if it cannot.
fn validate(source: &DaemonSource) -> Option<String> {
    match source.mode {
        DaemonSourceMode::Bundled => None,
        DaemonSourceMode::System | DaemonSourceMode::Custom => match source.path.as_deref() {
            None => Some(ResolveError::NotConfigured(source.mode).message()),
            Some(raw) if !Path::new(raw).is_absolute() => {
                Some("Pick an absolute path to the daemon binary.".to_string())
            }
            Some(raw) if !Path::new(raw).is_file() => Some(
                ResolveError::ConfiguredMissing {
                    mode: source.mode,
                    path: PathBuf::from(raw),
                }
                .message(),
            ),
            Some(_) => None,
        },
    }
}

/// The view the mock dependency check reports.
pub(crate) fn mock_view(source: &DaemonSource, missing: bool) -> DaemonSourceView {
    let pinned = env!("ENGINE_REV").to_string();
    if missing {
        return DaemonSourceView {
            mode: source.mode,
            configured_path: source.path.clone(),
            resolved_path: None,
            resolved_version: None,
            resolved_commit: None,
            pinned_rev: pinned,
            matches_pinned: false,
            running_version: None,
            running_commit: None,
            note: None,
            problem: Some(
                ResolveError::NotFound(vec![PathBuf::from(format!("{DAEMON_BINARY} (PATH)"))])
                    .message(),
            ),
        };
    }
    let resolved = match (source.mode, source.path.clone()) {
        (DaemonSourceMode::Bundled, _) => "/tmp/omawarden-mock/omawarden".to_string(),
        (_, Some(path)) => path,
        (_, None) => format!("/tmp/omawarden-mock/{DAEMON_BINARY}"),
    };
    DaemonSourceView {
        mode: source.mode,
        configured_path: source.path.clone(),
        resolved_path: Some(resolved),
        resolved_version: Some("mock".to_string()),
        resolved_commit: Some(pinned[..7].to_string()),
        matches_pinned: true,
        running_version: Some("mock".to_string()),
        running_commit: Some(pinned[..7].to_string()),
        note: None,
        problem: None,
        pinned_rev: pinned,
    }
}

/// Lists what the app could launch, deduplicated by real path.
pub(crate) fn candidates() -> Vec<DaemonCandidateView> {
    if crate::with_mock(|state| state.enabled) {
        return with_mock(|state| state.daemon_candidates.clone());
    }

    let app_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .unwrap_or_default();
    let mut seen = HashSet::new();
    let mut out = Vec::new();

    let bundled = app_dir.join(DAEMON_BINARY);
    if bundled.is_file() {
        seen.insert(std::fs::canonicalize(&bundled).unwrap_or_else(|_| bundled.clone()));
        out.push(candidate_for(bundled, DaemonCandidateKind::Bundled));
    }

    if let Ok(paths) = which::which_all(DAEMON_BINARY) {
        for path in paths {
            let key = std::fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
            if seen.insert(key) {
                out.push(candidate_for(path, DaemonCandidateKind::Path));
            }
        }
    }

    let source = crate::engine::daemon_source().get();
    if source.mode == DaemonSourceMode::Custom {
        if let Some(raw) = source.path.as_deref() {
            let path = PathBuf::from(raw);
            if path.is_file() {
                let key = std::fs::canonicalize(&path).unwrap_or_else(|_| path.clone());
                if seen.insert(key) {
                    out.push(candidate_for(path, DaemonCandidateKind::Custom));
                }
            }
        }
    }

    out
}

/// Builds one candidate by probing its `-V`.
fn candidate_for(path: PathBuf, kind: DaemonCandidateKind) -> DaemonCandidateView {
    let probed = probe_version(&path);
    let version = probed.as_ref().map(|info| info.version.clone());
    let commit = probed.as_ref().and_then(|info| info.commit.clone());
    let pinned = env!("ENGINE_REV");
    let selectable = version.is_some() && commit.is_some();
    DaemonCandidateView {
        path: path.display().to_string(),
        kind,
        version,
        commit: commit.clone(),
        matches_pinned: commit
            .as_deref()
            .map(|commit| commit_matches(commit, pinned))
            .unwrap_or(false),
        selectable,
    }
}

/// What `-V` printed.
#[derive(Clone, Debug, PartialEq, Eq)]
struct VersionInfo {
    version: String,
    commit: Option<String>,
}

/// Runs `<path> -V` with a bounded wait. `None` means unparseable or hung.
fn probe_version(path: &Path) -> Option<VersionInfo> {
    let mut child = Command::new(path)
        .arg("-V")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut buffer = String::new();
        let _ = stdout.read_to_string(&mut buffer);
        buffer
    });

    let deadline = Instant::now() + VERSION_PROBE_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let text = reader.join().ok()?;
                return status.success().then(|| parse_version(&text)).flatten();
            }
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader.join();
                return None;
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            Err(_) => {
                let _ = child.kill();
                let _ = reader.join();
                return None;
            }
        }
    }
}

/// Parses `omawarden <version> (<commit> <date>)`.
fn parse_version(text: &str) -> Option<VersionInfo> {
    static VERSION: OnceLock<Regex> = OnceLock::new();
    let pattern = VERSION.get_or_init(|| {
        Regex::new(r"^omawarden\s+(\S+)(?:\s+\(([^)\s]+))?").expect("the version pattern is valid")
    });
    let line = text.lines().next()?.trim();
    let captures = pattern.captures(line)?;
    let version = captures.get(1)?.as_str().to_string();
    let commit = captures
        .get(2)
        .map(|value| value.as_str().to_ascii_lowercase())
        .filter(|value| {
            (7..=40).contains(&value.len()) && value.chars().all(|ch| ch.is_ascii_hexdigit())
        });
    Some(VersionInfo { version, commit })
}

/// Whether a daemon's short commit is the pinned revision.
fn commit_matches(commit: &str, pinned_rev: &str) -> bool {
    let commit = commit.trim().to_ascii_lowercase();
    if commit.len() < 7 {
        return false;
    }
    pinned_rev.starts_with(&commit) || commit.starts_with(pinned_rev)
}

/// Applies a test's `daemonSource` and `daemonCandidates` JSON to the mock state.
pub(crate) fn apply_mock_json(
    source: &mut DaemonSource,
    candidates: &mut Vec<DaemonCandidateView>,
    value: &Value,
) {
    if let Some(entry) = value.get("daemonSource") {
        if let Some(mode) = crate::json_string(entry, "mode") {
            source.mode = DaemonSourceMode::parse(&mode);
        }
        if let Some(path) = crate::json_string(entry, "path") {
            source.path = Some(path);
        }
    }
    if let Some(items) = value.get("daemonCandidates").and_then(|v| v.as_array()) {
        let pinned = env!("ENGINE_REV");
        *candidates = items
            .iter()
            .filter_map(|item| {
                let path = crate::json_string(item, "path")?;
                let kind = match crate::json_string(item, "kind").as_deref() {
                    Some("bundled") => DaemonCandidateKind::Bundled,
                    Some("custom") => DaemonCandidateKind::Custom,
                    _ => DaemonCandidateKind::Path,
                };
                let version = crate::json_string(item, "version");
                let commit = crate::json_string(item, "commit");
                Some(DaemonCandidateView {
                    path,
                    kind,
                    matches_pinned: commit
                        .as_deref()
                        .map(|commit| commit_matches(commit, pinned))
                        .unwrap_or(false),
                    selectable: version.is_some() && commit.is_some(),
                    version,
                    commit,
                })
            })
            .collect();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    /// Points the config environment at a temporary directory, then restores it.
    struct ConfigHome {
        xdg: Option<OsString>,
        config_dir: Option<OsString>,
        _guard: std::sync::MutexGuard<'static, ()>,
    }

    impl ConfigHome {
        fn new(path: &Path) -> Self {
            let _guard = crate::test_state::lock();
            let xdg = std::env::var_os("XDG_CONFIG_HOME");
            let config_dir = std::env::var_os("OMAWARDEN_CONFIG_DIR");
            // SAFETY: `test_state::lock()` keeps every test that touches these
            // variables from running at the same time.
            unsafe {
                std::env::set_var("XDG_CONFIG_HOME", path);
                std::env::remove_var("OMAWARDEN_CONFIG_DIR");
            }
            Self {
                xdg,
                config_dir,
                _guard,
            }
        }
    }

    impl Drop for ConfigHome {
        fn drop(&mut self) {
            // SAFETY: see `ConfigHome::new`.
            unsafe {
                match &self.xdg {
                    Some(value) => std::env::set_var("XDG_CONFIG_HOME", value),
                    None => std::env::remove_var("XDG_CONFIG_HOME"),
                }
                match &self.config_dir {
                    Some(value) => std::env::set_var("OMAWARDEN_CONFIG_DIR", value),
                    None => std::env::remove_var("OMAWARDEN_CONFIG_DIR"),
                }
            }
        }
    }

    /// A directory tree with stand-in daemon binaries.
    struct Tree {
        root: tempfile::TempDir,
    }

    impl Tree {
        fn new() -> Self {
            Self {
                root: tempfile::tempdir().unwrap(),
            }
        }

        fn dir(&self) -> &Path {
            self.root.path()
        }

        fn file(&self, relative: &str) -> PathBuf {
            let path = self.dir().join(relative);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, b"#!/bin/sh\n").unwrap();
            path
        }
    }

    fn bundled_source() -> DaemonSource {
        DaemonSource::default()
    }

    fn inputs(app_dir: &Path) -> ResolveInputs {
        ResolveInputs {
            app_dir: app_dir.to_path_buf(),
            env_bin: None,
            dev_root: None,
            path_lookup: None,
        }
    }

    #[test]
    fn the_bundled_binary_beside_the_app_wins() {
        let tree = Tree::new();
        let app = tree.file("app/Omawarden");
        let bundled = tree.file("app/omawarden");
        let mut inputs = inputs(app.parent().unwrap());
        inputs.path_lookup = Some(tree.file("bin/omawarden"));

        let resolution = resolve(&bundled_source(), &inputs).unwrap();
        assert_eq!(resolution.path, bundled);
        assert_eq!(resolution.note, None);
    }

    #[test]
    fn the_environment_variable_beats_every_source() {
        let tree = Tree::new();
        let app = tree.file("app/Omawarden");
        let env = tree.file("env/omawarden");
        tree.file("app/omawarden");
        let mut inputs = inputs(app.parent().unwrap());
        inputs.env_bin = Some(env.clone());

        let resolution = resolve(&bundled_source(), &inputs).unwrap();
        assert_eq!(resolution.path, env);
        assert!(resolution.note.unwrap().contains("OMA_DAEMON_BIN"));
    }

    #[test]
    fn a_missing_environment_variable_is_a_hard_error() {
        let tree = Tree::new();
        let app = tree.file("app/Omawarden");
        tree.file("app/omawarden");
        let missing = tree.dir().join("gone/omawarden");
        let mut inputs = inputs(app.parent().unwrap());
        inputs.env_bin = Some(missing.clone());

        assert_eq!(
            resolve(&bundled_source(), &inputs),
            Err(ResolveError::EnvMissing(missing))
        );
    }

    #[test]
    fn a_bundled_miss_falls_through_to_the_development_checkout_then_path() {
        let tree = Tree::new();
        let app = tree.file("app/Omawarden");
        let sibling = tree.dir().join("omarchy-bitwarden");
        let mut inputs = inputs(app.parent().unwrap());
        inputs.dev_root = Some(sibling.clone());
        inputs.path_lookup = Some(tree.file("bin/omawarden"));

        let path_fallback = resolve(&bundled_source(), &inputs).unwrap();
        assert_eq!(path_fallback.note.as_deref(), Some("PATH fallback"));

        let release = tree.file("omarchy-bitwarden/omawarden/target/release/omawarden");
        let development = resolve(&bundled_source(), &inputs).unwrap();
        assert_eq!(development.path, release);
        assert_eq!(development.note.as_deref(), Some("development fallback"));

        let debug = tree.file("omarchy-bitwarden/omawarden/target/debug/omawarden");
        let development = resolve(&bundled_source(), &inputs).unwrap();
        assert_eq!(development.path, debug);
    }

    #[test]
    fn an_exhausted_chain_reports_every_probed_path() {
        let tree = Tree::new();
        let app = tree.file("app/Omawarden");
        let inputs = inputs(app.parent().unwrap());

        let error = resolve(&bundled_source(), &inputs).unwrap_err();
        let message = error.message();
        assert!(message.contains("omawarden-bin"));
        assert!(message.contains("Settings → Engine"));
        assert!(message.contains("omawarden (PATH)"));
    }

    #[test]
    fn a_system_source_that_is_gone_does_not_fall_back() {
        let tree = Tree::new();
        let app = tree.file("app/Omawarden");
        tree.file("app/omawarden");
        let gone = tree.dir().join("usr/bin/omawarden");
        let source = DaemonSource {
            mode: DaemonSourceMode::System,
            path: Some(gone.display().to_string()),
        };
        let mut inputs = inputs(app.parent().unwrap());
        inputs.path_lookup = Some(tree.file("bin/omawarden"));

        assert_eq!(
            resolve(&source, &inputs),
            Err(ResolveError::ConfiguredMissing {
                mode: DaemonSourceMode::System,
                path: gone,
            })
        );
    }

    #[test]
    fn a_system_source_without_a_path_is_rejected() {
        let tree = Tree::new();
        let app = tree.file("app/Omawarden");
        let source = DaemonSource {
            mode: DaemonSourceMode::System,
            path: None,
        };
        let error = resolve(&source, &inputs(app.parent().unwrap())).unwrap_err();
        assert!(matches!(error, ResolveError::NotConfigured(_)));
    }

    #[test]
    fn a_custom_path_is_launched_as_given() {
        let tree = Tree::new();
        let app = tree.file("app/Omawarden");
        let custom = tree.file("opt/omawarden/omawarden");
        let source = DaemonSource {
            mode: DaemonSourceMode::Custom,
            path: Some(custom.display().to_string()),
        };

        let resolution = resolve(&source, &inputs(app.parent().unwrap())).unwrap();
        assert_eq!(resolution.path, custom);
        assert_eq!(resolution.note, None);
    }

    #[test]
    fn the_version_line_is_parsed_with_and_without_a_commit() {
        let info = parse_version("omawarden 0.12.0 (29584b9 2026-11-19)").unwrap();
        assert_eq!(info.version, "0.12.0");
        assert_eq!(info.commit.as_deref(), Some("29584b9"));

        let info = parse_version("omawarden 0.12.0").unwrap();
        assert_eq!(info.version, "0.12.0");
        assert_eq!(info.commit, None);

        assert!(parse_version("not omawarden").is_none());
        assert!(parse_version("").is_none());
        assert!(parse_version("omawarden 0.12.0 (zzz 2026-11-19)").is_some());
        assert!(
            parse_version("omawarden 0.12.0 (zzz 2026-11-19)")
                .unwrap()
                .commit
                .is_none()
        );
    }

    #[test]
    fn the_pinned_revision_is_a_full_commit() {
        let rev = env!("ENGINE_REV");
        assert_eq!(rev.len(), 40, "ENGINE_REV must be the full revision: {rev}");
        assert!(rev.chars().all(|ch| ch.is_ascii_hexdigit()));
        assert_eq!(env!("ENGINE_REV_SHORT"), &rev[..7]);
    }

    #[test]
    fn commits_match_by_prefix_in_either_direction() {
        let rev = env!("ENGINE_REV");
        let short = &rev[..7];
        assert!(commit_matches(short, rev));
        assert!(commit_matches(rev, rev));
        assert!(!commit_matches("deadbee", rev));
        assert!(!commit_matches("dead", rev));
    }

    #[test]
    fn the_real_adapter_round_trips_and_stays_private() {
        let dir = tempfile::tempdir().unwrap();
        let _home = ConfigHome::new(dir.path());
        let path = daemon_source_path();
        assert_eq!(path, dir.path().join("omawarden").join("daemon.json"));

        let missing = InProcess.get();
        assert_eq!(missing.mode, DaemonSourceMode::Bundled);
        assert_eq!(missing.path, None);

        InProcess
            .store(DaemonSource {
                mode: DaemonSourceMode::System,
                path: Some("/usr/bin/omawarden".to_string()),
            })
            .unwrap();
        let read_back = InProcess.get();
        assert_eq!(read_back.mode, DaemonSourceMode::System);
        assert_eq!(read_back.path.as_deref(), Some("/usr/bin/omawarden"));

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600, "the daemon source file must be private");
        }

        std::fs::write(&path, "{not json").unwrap();
        assert_eq!(InProcess.get().mode, DaemonSourceMode::Bundled);
    }

    #[test]
    fn an_unknown_mode_falls_back_to_bundled() {
        let dir = tempfile::tempdir().unwrap();
        let _home = ConfigHome::new(dir.path());
        let path = daemon_source_path();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, r#"{"mode": "carrier-pigeon", "path": "/x"}"#).unwrap();

        let source = InProcess.get();
        assert_eq!(source.mode, DaemonSourceMode::Bundled);
        assert_eq!(source.path.as_deref(), Some("/x"));
    }

    #[test]
    fn a_custom_path_that_is_gone_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("gone/omawarden");
        let rejected = validate(&DaemonSource {
            mode: DaemonSourceMode::Custom,
            path: Some(missing.display().to_string()),
        })
        .expect("a missing path must be rejected");
        assert!(rejected.contains("is gone"), "{rejected}");
        assert!(rejected.contains("Settings → Engine"), "{rejected}");
    }

    #[test]
    fn an_existing_custom_path_is_accepted() {
        let tree = Tree::new();
        let custom = tree.file("opt/omawarden/omawarden");
        let accepted = validate(&DaemonSource {
            mode: DaemonSourceMode::Custom,
            path: Some(custom.display().to_string()),
        });
        assert_eq!(accepted, None);
    }

    #[test]
    fn a_relative_path_is_rejected() {
        let rejected = validate(&DaemonSource {
            mode: DaemonSourceMode::System,
            path: Some("omawarden".to_string()),
        })
        .expect("a relative path must be rejected");
        assert!(rejected.contains("absolute"), "{rejected}");
    }
}
