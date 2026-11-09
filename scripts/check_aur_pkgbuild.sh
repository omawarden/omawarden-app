#!/usr/bin/env bash
# Guard the generated AUR PKGBUILD against the two mistakes that are cheap to
# make here and expensive to discover at install time:
#
# 1. Installing the polkit action. It belongs to the daemon, which is its
#    subject, and omawarden-bin already installs it; shipping it in the app
#    package makes pacman abort with "conflicting files".
# 2. Pointing the source URLs at a filename the release does not publish. The
#    dev channel uses one stable name per target, with no commit SHA.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
VERSION=$(grep '^version = ' "$ROOT/Cargo.toml" | head -1 | cut -d'"' -f2)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/omawarden-aur-check.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/dist"
for arch in x86_64 aarch64; do
  printf 'placeholder\n' \
    > "$WORK/dist/omawarden-app-${VERSION}-dev-${arch}-unknown-linux-gnu.tar.gz"
done

DIST_DIR="$WORK/dist" OUT_DIR="$WORK/out" \
  bash "$ROOT/packaging/generate-aur-pkgbuild.sh" >/dev/null

status=0
if grep -q 'polkit-1/actions' "$WORK/out/PKGBUILD"; then
  echo "::error::the app package installs the polkit action, which omawarden-bin owns"
  status=1
fi
for arch in x86_64 aarch64; do
  if ! grep -q "omawarden-app-${VERSION}-dev-${arch}-unknown-linux-gnu.tar.gz" \
    "$WORK/out/PKGBUILD"; then
    echo "::error::the $arch source URL is not the stable dev asset name"
    status=1
  fi
done

if [ "$status" -eq 0 ]; then
  echo "AUR PKGBUILD is clean."
fi
exit "$status"
