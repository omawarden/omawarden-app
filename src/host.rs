//! The host platform: which system this build runs on, and the one command
//! that opens a URL or a file with it.
//!
//! Platform differences are values, not conditional compilation. [`Host`] is
//! data with two possible values, so the macOS branch is exercised by the tests
//! on any host, and `cfg!` is read in exactly one place: [`Host::current`].
//! Branching with `cfg!` rather than `#[cfg]` keeps both arms typechecked on
//! every target, which matters because this repository's CI cannot compile for
//! macOS.

use std::ffi::OsStr;
use std::process::{Command, Stdio};

/// The system this build runs on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Host {
    /// Linux, including the Omarchy desktop the app is packaged for.
    Linux,
    /// macOS.
    MacOs,
}

impl Host {
    /// Answers the host this binary was compiled for.
    pub(crate) fn current() -> Self {
        if cfg!(target_os = "macos") {
            Host::MacOs
        } else {
            Host::Linux
        }
    }

    /// The command that opens a URL or a file in the user's default application.
    pub(crate) fn opener_command(self) -> &'static str {
        match self {
            Host::Linux => "xdg-open",
            Host::MacOs => "open",
        }
    }
}

/// Opens `target` with this host's launcher, detached from the app.
///
/// The one place that decides how a URL or a file leaves the app: the URL
/// launcher and the attachment opener both come through here, so the two cannot
/// drift apart again. A failure to spawn is reported as `false`; a launcher that
/// exits non-zero later is not, because the app does not wait for it.
pub(crate) fn open_with(host: Host, target: &OsStr) -> bool {
    Command::new(host.opener_command())
        .arg(target)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_answers_the_host_it_was_compiled_for() {
        let expected = if cfg!(target_os = "macos") {
            Host::MacOs
        } else {
            Host::Linux
        };
        assert_eq!(Host::current(), expected);
    }

    #[test]
    fn each_host_names_its_own_opener() {
        assert_eq!(Host::Linux.opener_command(), "xdg-open");
        assert_eq!(Host::MacOs.opener_command(), "open");
    }
}
