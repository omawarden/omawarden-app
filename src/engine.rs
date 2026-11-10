//! The adapter seam: one accessor per domain module.
//!
//! Each accessor resolves the adapter once per call, so the bridge methods are
//! one-line delegations and the mock fork lives in exactly one place instead of
//! at the top of every bridge method.

use crate::attachments::{
    AttachmentsEngine, InProcess as InProcessAttachments, Mock as MockAttachments,
};
use crate::auth::{AuthEngine, InProcess as InProcessAuth, Mock as MockAuth};
use crate::cipher_mutation::{CipherEngine, InProcess as InProcessCipher, Mock as MockCipher};
use crate::clipboard::{ClipboardEngine, InProcess as InProcessClipboard, Mock as MockClipboard};
use crate::daemon::{DaemonEngine, InProcess as InProcessDaemon, Mock as MockDaemon};
use crate::diagnostics::{
    DiagnosticsEngine, InProcess as InProcessDiagnostics, Mock as MockDiagnostics,
};
use crate::generator::{GeneratorEngine, InProcess as InProcessGenerator, Mock as MockGenerator};
use crate::inspector::{InProcess as InProcessInspector, InspectorEngine, Mock as MockInspector};
use crate::platform::{InProcess as InProcessPlatform, Mock as MockPlatform, PlatformEngine};
use crate::settings::{InProcess as InProcessSettings, Mock as MockSettings, SettingsEngine};
use crate::ssh::{InProcess as InProcessSsh, Mock as MockSsh, SshEngine};
use crate::ui_prefs::{InProcess as InProcessUiPrefs, Mock as MockUiPrefs, UiPrefsEngine};
use crate::vault::{InProcess as InProcessVault, Mock as MockVault, VaultEngine};

/// The attachments adapter for the current run mode.
pub(crate) fn attachments() -> &'static dyn AttachmentsEngine {
    if crate::with_mock(|state| state.enabled) {
        static MOCK: MockAttachments = MockAttachments;
        &MOCK
    } else {
        static IN_PROCESS: InProcessAttachments = InProcessAttachments;
        &IN_PROCESS
    }
}

/// The auth adapter for the current run mode.
pub(crate) fn auth() -> &'static dyn AuthEngine {
    if crate::with_mock(|state| state.enabled) {
        static MOCK: MockAuth = MockAuth;
        &MOCK
    } else {
        static IN_PROCESS: InProcessAuth = InProcessAuth;
        &IN_PROCESS
    }
}

/// The cipher mutation adapter for the current run mode.
pub(crate) fn cipher() -> &'static dyn CipherEngine {
    if crate::with_mock(|state| state.enabled) {
        static MOCK: MockCipher = MockCipher;
        &MOCK
    } else {
        static IN_PROCESS: InProcessCipher = InProcessCipher;
        &IN_PROCESS
    }
}

/// The clipboard adapter for the current run mode.
pub(crate) fn clipboard() -> &'static dyn ClipboardEngine {
    if crate::with_mock(|state| state.enabled) {
        static MOCK: MockClipboard = MockClipboard;
        &MOCK
    } else {
        static IN_PROCESS: InProcessClipboard = InProcessClipboard;
        &IN_PROCESS
    }
}

/// The generator adapter for the current run mode.
pub(crate) fn generator() -> &'static dyn GeneratorEngine {
    if crate::with_mock(|state| state.enabled) {
        static MOCK: MockGenerator = MockGenerator;
        &MOCK
    } else {
        static IN_PROCESS: InProcessGenerator = InProcessGenerator;
        &IN_PROCESS
    }
}

/// The inspector adapter for the current run mode.
pub(crate) fn inspector() -> &'static dyn InspectorEngine {
    if crate::with_mock(|state| state.enabled) {
        static MOCK: MockInspector = MockInspector;
        &MOCK
    } else {
        static IN_PROCESS: InProcessInspector = InProcessInspector;
        &IN_PROCESS
    }
}

/// The SSH adapter for the current run mode.
pub(crate) fn ssh() -> &'static dyn SshEngine {
    if crate::with_mock(|state| state.enabled) {
        static MOCK: MockSsh = MockSsh;
        &MOCK
    } else {
        static IN_PROCESS: InProcessSsh = InProcessSsh;
        &IN_PROCESS
    }
}

/// The platform adapter for the current run mode.
pub(crate) fn platform() -> &'static dyn PlatformEngine {
    if crate::with_mock(|state| state.enabled) {
        static MOCK: MockPlatform = MockPlatform;
        &MOCK
    } else {
        static IN_PROCESS: InProcessPlatform = InProcessPlatform;
        &IN_PROCESS
    }
}

/// The vault adapter for the current run mode.
pub(crate) fn vault() -> &'static dyn VaultEngine {
    if crate::with_mock(|state| state.enabled) {
        static MOCK: MockVault = MockVault;
        &MOCK
    } else {
        static IN_PROCESS: InProcessVault = InProcessVault;
        &IN_PROCESS
    }
}

/// The daemon adapter for the current run mode.
pub(crate) fn daemon() -> &'static dyn DaemonEngine {
    if crate::with_mock(|state| state.enabled) {
        static MOCK: MockDaemon = MockDaemon;
        &MOCK
    } else {
        static IN_PROCESS: InProcessDaemon = InProcessDaemon;
        &IN_PROCESS
    }
}

/// The diagnostics adapter for the current run mode.
pub(crate) fn diagnostics() -> &'static dyn DiagnosticsEngine {
    if crate::with_mock(|state| state.enabled) {
        static MOCK: MockDiagnostics = MockDiagnostics;
        &MOCK
    } else {
        static IN_PROCESS: InProcessDiagnostics = InProcessDiagnostics;
        &IN_PROCESS
    }
}

/// The settings adapter for the current run mode.
pub(crate) fn settings() -> &'static dyn SettingsEngine {
    if crate::with_mock(|state| state.enabled) {
        static MOCK: MockSettings = MockSettings;
        &MOCK
    } else {
        static IN_PROCESS: InProcessSettings = InProcessSettings;
        &IN_PROCESS
    }
}

/// The UI preferences adapter for the current run mode.
pub(crate) fn ui_prefs() -> &'static dyn UiPrefsEngine {
    if crate::with_mock(|state| state.enabled) {
        static MOCK: MockUiPrefs = MockUiPrefs;
        &MOCK
    } else {
        static IN_PROCESS: InProcessUiPrefs = InProcessUiPrefs;
        &IN_PROCESS
    }
}
