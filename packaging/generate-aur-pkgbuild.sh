#!/usr/bin/env bash
# Generate a PKGBUILD for the rolling `omawarden-app-dev-bin` AUR package.
#
# Inputs (environment):
#   DIST_DIR             artifact directory (default: <repo>/dist)
#   OUT_DIR              where the PKGBUILD goes (default: <DIST_DIR>/aur)
#   VERSION              app version (default: Cargo.toml)
#   SHORT_SHA            commit suffix (default: git rev-parse --short HEAD)
#   PKGVER               full pacman version (default: <VERSION>.dev.<SHORT_SHA>)
#   GITHUB_REPOSITORY    owner/repo (default: omawarden/omawarden-app)
#   RELEASE_TAG          rolling release tag (default: dev)
#
# The dev channel publishes one stable filename per target,
# `omawarden-app-<version>-dev-<target>.tar.gz`, with no commit SHA in it. The
# source URLs below are therefore derived from VERSION, and they change only
# when the app version does.
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
DIST_DIR=${DIST_DIR:-"$ROOT_DIR/dist"}
OUT_DIR=${OUT_DIR:-"$DIST_DIR/aur"}
VERSION=${VERSION:-$(grep '^version = ' "$ROOT_DIR/Cargo.toml" | head -n 1 | cut -d'"' -f2)}
SHORT_SHA=${SHORT_SHA:-$(git -C "$ROOT_DIR" rev-parse --short HEAD)}
# Pacman versions cannot contain hyphens, so the dev suffix uses dots.
PKGVER=${PKGVER:-"${VERSION}.dev.${SHORT_SHA}"}
GITHUB_REPOSITORY=${GITHUB_REPOSITORY:-omawarden/omawarden-app}
RELEASE_TAG=${RELEASE_TAG:-dev}

find_tarball() {
  local arch=$1
  local candidate
  for candidate in \
    "$DIST_DIR/omawarden-app-$VERSION-dev-$arch-unknown-linux-gnu.tar.gz" \
    "$DIST_DIR/omawarden-app-$arch-unknown-linux-gnu.tar.gz" \
    "$DIST_DIR/omawarden-app-$arch.tar.gz"; do
    if [ -f "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  candidate=$(find "$DIST_DIR" -maxdepth 1 -type f -name "omawarden-app-*-$arch*.tar.gz" | head -n 1)
  if [ -n "$candidate" ]; then
    printf '%s\n' "$candidate"
    return 0
  fi
  echo "missing tar.gz for $arch in $DIST_DIR" >&2
  return 1
}

X86_TAR=$(find_tarball x86_64)
AARCH64_TAR=$(find_tarball aarch64)
SHA_X86=$(sha256sum "$X86_TAR" | awk '{print $1}')
SHA_AARCH64=$(sha256sum "$AARCH64_TAR" | awk '{print $1}')

mkdir -p "$OUT_DIR"
cp "$ROOT_DIR/packaging/omawarden-policy.install" "$OUT_DIR/"

cat > "$OUT_DIR/PKGBUILD" <<EOF
# Maintainer: icyleaf <icyleaf.cn at gmail dot com>

pkgname=omawarden-app-dev-bin
pkgver=$PKGVER
pkgrel=1
pkgdesc="Omawarden desktop app for Bitwarden/Vaultwarden (development build)"
arch=('x86_64' 'aarch64')
url="https://github.com/$GITHUB_REPOSITORY"
license=('MIT')
depends=('gtk4' 'webkitgtk-6.0' 'libsecret' 'polkit' 'wl-clipboard')
optdepends=('libfido2: WebAuthn / Passkey / FIDO2 security key support')
provides=('omawarden-app')
conflicts=('omawarden-app')
install='omawarden-policy.install'
source_x86_64=("omawarden-app-x86_64.tar.gz::https://github.com/$GITHUB_REPOSITORY/releases/download/$RELEASE_TAG/omawarden-app-$VERSION-dev-x86_64-unknown-linux-gnu.tar.gz")
sha256sums_x86_64=('$SHA_X86')
source_aarch64=("omawarden-app-aarch64.tar.gz::https://github.com/$GITHUB_REPOSITORY/releases/download/$RELEASE_TAG/omawarden-app-$VERSION-dev-aarch64-unknown-linux-gnu.tar.gz")
sha256sums_aarch64=('$SHA_AARCH64')

package() {
  local appdir
  appdir=\$(find "\${srcdir}" -maxdepth 1 -type d -name 'omawarden-app-*' | head -n 1)
  if [[ -z "\${appdir}" ]]; then
    error "omawarden-app package directory not found"
  fi

  install -Dm755 "\${appdir}/omawardenApp" "\${pkgdir}/usr/lib/omawarden-app/omawardenApp"
  cp -a "\${appdir}/nsh" "\${pkgdir}/usr/lib/omawarden-app/nsh"
  install -d "\${pkgdir}/usr/bin"
  ln -s /usr/lib/omawarden-app/omawardenApp "\${pkgdir}/usr/bin/omawardenApp"

  install -Dm644 "\${appdir}/com.icyleaf.omawarden.desktop" \
    "\${pkgdir}/usr/share/applications/com.icyleaf.omawarden.desktop"
  install -Dm644 "\${appdir}/com.icyleaf.omawarden.png" \
    "\${pkgdir}/usr/share/icons/hicolor/1024x1024/apps/com.icyleaf.omawarden.png"
  install -Dm644 "\${appdir}/org.omarchy.plugin.icyleaf.omarchy-bitwarden.policy" \
    "\${pkgdir}/usr/share/polkit-1/actions/org.omarchy.plugin.icyleaf.omarchy-bitwarden.policy"
  install -Dm644 "\${appdir}/README.md" "\${pkgdir}/usr/share/doc/\${pkgname}/README.md"
}
EOF

printf '%s\n' "$PKGVER" > "$OUT_DIR/pkgver"
echo "generated $OUT_DIR/PKGBUILD (pkgver=$PKGVER)"
echo "  x86_64  sha256 $SHA_X86"
echo "  aarch64 sha256 $SHA_AARCH64"
