//! The adapter seam: one accessor per domain module.
//!
//! Each accessor resolves the adapter once per call, so the bridge methods are
//! one-line delegations and the mock fork lives in exactly one place instead of
//! at the top of every bridge method.

use crate::diagnostics::{
    DiagnosticsEngine, InProcess as InProcessDiagnostics, Mock as MockDiagnostics,
};

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
