//! The adapter seam: one accessor per domain module.
//!
//! Each accessor resolves the adapter once per call, so the bridge methods are
//! one-line delegations and the mock fork lives in exactly one place instead of
//! at the top of every bridge method.

use crate::attachments::{
    AttachmentsEngine, InProcess as InProcessAttachments, Mock as MockAttachments,
};
use crate::auth::{AuthEngine, InProcess as InProcessAuth, Mock as MockAuth};
use crate::clipboard::{ClipboardEngine, InProcess as InProcessClipboard, Mock as MockClipboard};
use crate::diagnostics::{
    DiagnosticsEngine, InProcess as InProcessDiagnostics, Mock as MockDiagnostics,
};
use crate::settings::{InProcess as InProcessSettings, Mock as MockSettings, SettingsEngine};
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
