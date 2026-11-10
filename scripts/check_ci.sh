#!/usr/bin/env bash
# Run the checks from .github/workflows/ci.yml before pushing.
#
# CI removes the [patch] section of .cargo/config.toml and builds against the
# git dependency. Locally the patch stays, so this runs against the sibling
# omawarden checkout; every check below is the same one CI runs.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if ! command -v nsh >/dev/null 2>&1; then
  echo "nsh is not on PATH. Install NSH v0.4.0 first." >&2
  exit 1
fi

step() {
  printf '\n==> %s\n' "$1"
}

step "Verify version consistency"
cargo_version=$(grep '^version = ' Cargo.toml | head -1 | cut -d'"' -f2)
nsh_version=$(grep '"version":' nsh.json | head -1 | cut -d'"' -f4)
echo "Cargo.toml: $cargo_version, nsh.json: $nsh_version"
if [ "$cargo_version" != "$nsh_version" ]; then
  echo "Cargo.toml and nsh.json versions differ." >&2
  exit 1
fi

step "Reject private details"
python3 scripts/check_privacy.py

step "Check the AUR PKGBUILD"
bash scripts/check_aur_pkgbuild.sh

step "Check Rust formatting"
cargo fmt --all --check

step "TypeScript type-check"
nsh check

step "Headless tests"
nsh test

printf '\nAll CI checks passed.\n'
