//! UI preferences: the theme and text size the interface persists.
//!
//! These are presentation preferences, so they live beside the engine's
//! `config.json` in their own file rather than in the engine's `Config`.
//! [`UiPrefsEngine`] is the seam. [`InProcess`] reads and writes
//! `ui.json`; [`Mock`] serves the headless UI tests from the process-wide mock
//! state.

use std::path::{Path, PathBuf};

use nsh_core::prelude::*;
use omawarden::fs_util::{atomic_write_str, create_secure_dir_all};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{ThemeAppearance, config_manager, with_mock};

/// The smallest text size factor the app accepts.
pub(crate) const MIN_FONT_SCALE: f64 = 1.0;

/// The largest text size factor the app accepts.
pub(crate) const MAX_FONT_SCALE: f64 = 4.0;

/// The default text size factor.
pub(crate) const DEFAULT_FONT_SCALE: f64 = 1.0;

/// The interface preferences shown to the UI.
#[derive(Clone, Debug, JsObject)]
pub struct UiPrefsView {
    /// The appearance preset.
    pub theme: ThemeAppearance,
    /// The app's text size factor.
    pub font_scale: f64,
}

impl Default for UiPrefsView {
    fn default() -> Self {
        Self {
            theme: ThemeAppearance::Dark,
            font_scale: DEFAULT_FONT_SCALE,
        }
    }
}

/// The interface preferences to change.
#[derive(Clone, Debug, JsObject)]
pub struct UiPrefsUpdateInput {
    /// The appearance preset.
    pub theme: Option<ThemeAppearance>,
    /// The app's text size factor.
    pub font_scale: Option<f64>,
}

impl UiPrefsUpdateInput {
    /// Applies this patch, clamping the text size factor on the way in.
    fn apply_to(self, prefs: &mut UiPrefsView) {
        if let Some(theme) = self.theme {
            prefs.theme = theme;
        }
        if let Some(font_scale) = self.font_scale {
            prefs.font_scale = clamp_font_scale(font_scale);
        }
    }
}

/// The preferences capabilities the bridge exposes.
pub(crate) trait UiPrefsEngine {
    /// Reads the stored preferences, falling back to the defaults.
    fn get(&self) -> UiPrefsView;

    /// Applies `input`, writes the result, and returns it.
    fn update(&self, input: UiPrefsUpdateInput) -> UiPrefsView;
}

/// The real adapter: the preferences file.
pub(crate) struct InProcess;

impl UiPrefsEngine for InProcess {
    fn get(&self) -> UiPrefsView {
        read_prefs(&ui_prefs_path())
    }

    fn update(&self, input: UiPrefsUpdateInput) -> UiPrefsView {
        let path = ui_prefs_path();
        let mut prefs = read_prefs(&path);
        input.apply_to(&mut prefs);
        if let Err(error) = write_prefs(&path, &prefs) {
            eprintln!("omawarden ui preferences were not saved: {error}");
        }
        prefs
    }
}

/// The mock adapter: the process-wide mock state.
pub(crate) struct Mock;

impl UiPrefsEngine for Mock {
    fn get(&self) -> UiPrefsView {
        with_mock(|state| state.ui_prefs.clone())
    }

    fn update(&self, input: UiPrefsUpdateInput) -> UiPrefsView {
        with_mock(|state| {
            input.apply_to(&mut state.ui_prefs);
            state.ui_prefs.clone()
        })
    }
}

/// The path of the preferences file, beside the engine's `config.json`.
pub(crate) fn ui_prefs_path() -> PathBuf {
    config_manager().config_path.with_file_name("ui.json")
}

/// Clamps a text size factor to the range the app supports.
pub(crate) fn clamp_font_scale(font_scale: f64) -> f64 {
    if font_scale.is_finite() {
        font_scale.clamp(MIN_FONT_SCALE, MAX_FONT_SCALE)
    } else {
        DEFAULT_FONT_SCALE
    }
}

/// Applies a test's `uiPrefs` JSON to the mock state.
pub(crate) fn apply_mock_json(prefs: &mut UiPrefsView, value: &Value) {
    let Ok(file) = serde_json::from_value::<PrefsFile>(value.clone()) else {
        return;
    };
    if let Some(theme) = file.theme {
        prefs.theme = theme;
    }
    if let Some(font_scale) = file.font_scale {
        prefs.font_scale = clamp_font_scale(font_scale);
    }
}

/// The on-disk shape. Every field is optional so a partial file still loads,
/// and unknown keys are ignored.
#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(default)]
struct PrefsFile {
    /// The appearance preset.
    theme: Option<ThemeAppearance>,
    /// The app's text size factor.
    #[serde(rename = "fontScale")]
    font_scale: Option<f64>,
}

/// Reads the file, yielding the defaults when it is missing or unreadable.
fn read_prefs(path: &Path) -> UiPrefsView {
    let Ok(content) = std::fs::read_to_string(path) else {
        return UiPrefsView::default();
    };
    let Ok(file) = serde_json::from_str::<PrefsFile>(&content) else {
        return UiPrefsView::default();
    };
    UiPrefsView {
        theme: file.theme.unwrap_or(ThemeAppearance::Dark),
        font_scale: clamp_font_scale(file.font_scale.unwrap_or(DEFAULT_FONT_SCALE)),
    }
}

/// Writes the file atomically with mode `0600`, as the engine writes its config.
fn write_prefs(path: &Path, prefs: &UiPrefsView) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        create_secure_dir_all(parent, 0o700)?;
    }
    let file = PrefsFile {
        theme: Some(prefs.theme),
        font_scale: Some(prefs.font_scale),
    };
    let content = serde_json::to_string_pretty(&file)
        .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error.to_string()))?;
    atomic_write_str(path, &content, 0o600)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;
    use std::sync::Mutex;

    /// Serializes the tests that change the process-wide config environment.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

    /// Points the config environment at a temporary directory, then restores it.
    struct ConfigHome {
        xdg: Option<OsString>,
        config_dir: Option<OsString>,
        _guard: std::sync::MutexGuard<'static, ()>,
    }

    impl ConfigHome {
        fn new(path: &std::path::Path) -> Self {
            let guard = ENV_LOCK.lock().unwrap_or_else(|error| error.into_inner());
            let xdg = std::env::var_os("XDG_CONFIG_HOME");
            let config_dir = std::env::var_os("OMAWARDEN_CONFIG_DIR");
            // SAFETY: `ENV_LOCK` keeps every test that touches these variables
            // from running at the same time.
            unsafe {
                std::env::set_var("XDG_CONFIG_HOME", path);
                std::env::remove_var("OMAWARDEN_CONFIG_DIR");
            }
            Self {
                xdg,
                config_dir,
                _guard: guard,
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

    #[test]
    fn real_adapter_round_trips_through_xdg_config_home() {
        let dir = tempfile::tempdir().unwrap();
        let _home = ConfigHome::new(dir.path());
        let path = ui_prefs_path();
        assert_eq!(path, dir.path().join("omawarden").join("ui.json"));

        let missing = InProcess.get();
        assert_eq!(missing.theme, ThemeAppearance::Dark);
        assert_eq!(missing.font_scale, 1.0);

        let updated = InProcess.update(UiPrefsUpdateInput {
            theme: Some(ThemeAppearance::Light),
            font_scale: Some(1.5),
        });
        assert_eq!(updated.theme, ThemeAppearance::Light);
        assert_eq!(updated.font_scale, 1.5);

        let read_back = InProcess.get();
        assert_eq!(read_back.theme, ThemeAppearance::Light);
        assert_eq!(read_back.font_scale, 1.5);

        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.contains("\"fontScale\": 1.5"));

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600, "the preferences file must be private");
        }

        std::fs::write(&path, "{not json").unwrap();
        let malformed = InProcess.get();
        assert_eq!(malformed.theme, ThemeAppearance::Dark);
        assert_eq!(malformed.font_scale, 1.0);
    }

    #[test]
    fn real_adapter_ignores_unknown_keys_and_clamps_the_scale() {
        let dir = tempfile::tempdir().unwrap();
        let _home = ConfigHome::new(dir.path());
        let path = ui_prefs_path();
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(
            &path,
            r#"{"theme": "light", "fontScale": 9.0, "unknown": true}"#,
        )
        .unwrap();

        let read = InProcess.get();
        assert_eq!(read.theme, ThemeAppearance::Light);
        assert_eq!(read.font_scale, MAX_FONT_SCALE);

        let updated = InProcess.update(UiPrefsUpdateInput {
            theme: None,
            font_scale: Some(0.5),
        });
        assert_eq!(updated.theme, ThemeAppearance::Light);
        assert_eq!(updated.font_scale, MIN_FONT_SCALE);
    }
}
