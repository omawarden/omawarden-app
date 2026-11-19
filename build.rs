//! Supplies the build identity shown in the diagnostics report.

use std::path::Path;
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=.git/HEAD");
    println!("cargo:rerun-if-changed=.git/refs");
    println!("cargo:rerun-if-changed=Cargo.toml");

    let hash = Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "unknown".to_string());
    println!("cargo:rustc-env=GIT_HASH={hash}");

    let date = Command::new("date")
        .args(["-u", "+%Y-%m-%dT%H:%M:%SZ"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "unknown".to_string());
    println!("cargo:rustc-env=BUILD_DATE={date}");

    let rev = engine_rev();
    println!("cargo:rustc-env=ENGINE_REV={rev}");
    println!("cargo:rustc-env=ENGINE_REV_SHORT={}", &rev[..7]);
}

/// The engine revision the app links, read from the `omawarden` git dependency.
///
/// The pin is a revision, not a branch: the release builds the bundled daemon
/// from this commit and compares every external daemon against it, so a moving
/// dependency would make that comparison meaningless. Failing the build here
/// keeps the invariant from being dropped silently when the manifest is edited.
fn engine_rev() -> String {
    let manifest = Path::new(&std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"))
        .join("Cargo.toml");
    let text = std::fs::read_to_string(&manifest).expect("read Cargo.toml");
    for line in text.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("omawarden") || !trimmed.contains("git =") {
            continue;
        }
        let Some(start) = trimmed.find("rev = \"") else {
            continue;
        };
        let rest = &trimmed[start + "rev = \"".len()..];
        let Some(end) = rest.find('"') else {
            continue;
        };
        let rev = &rest[..end];
        if rev.len() == 40 && rev.chars().all(|c| c.is_ascii_hexdigit()) {
            return rev.to_ascii_lowercase();
        }
        panic!(
            "the omawarden pin is not a 40-character commit revision: {rev:?}\n\
             pin it with `rev = \"<sha>\"` in Cargo.toml"
        );
    }
    panic!(
        "Cargo.toml must pin the omawarden git dependency by a 40-character `rev`; \
         a branch or tag pin makes the bundled daemon unreproducible"
    );
}
