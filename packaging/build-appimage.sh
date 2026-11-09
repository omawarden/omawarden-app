#!/usr/bin/env bash
# Build a standalone AppImage from an `nsh package --target linux` directory.
#
# Usage: build-appimage.sh <package-dir> <output-dir> <output-name> <arch>
#   <package-dir>  e.g. dist-pkg/Omawarden
#   <output-dir>   e.g. dist
#   <output-name>  e.g. omawarden-app-0.4.0-dev-x86_64-unknown-linux-gnu.AppImage
#   <arch>         x86_64 or aarch64
set -euo pipefail

if [ "$#" -ne 4 ]; then
  echo "usage: $0 <package-dir> <output-dir> <output-name> <arch>" >&2
  exit 2
fi

PKG_DIR=$1
OUT_DIR=$2
OUT_NAME=$3
ARCH=$4

if [ ! -d "$PKG_DIR" ]; then
  echo "package directory not found: $PKG_DIR" >&2
  exit 1
fi
if [ ! -d "$PKG_DIR/nsh" ]; then
  echo "package directory has no nsh/ bundle: $PKG_DIR" >&2
  exit 1
fi

# The runner's name is derived from nsh.json's display name; accept the
# current name and the older spellings a package may still carry.
EXE=""
for candidate in "$PKG_DIR/Omawarden" "$PKG_DIR/omawardenApp" "$PKG_DIR/omawardenapp"; do
  if [ -x "$candidate" ]; then
    EXE=$candidate
    break
  fi
done
if [ -z "$EXE" ]; then
  EXE=$(find "$PKG_DIR" -maxdepth 1 -type f -perm -u+x ! -name '*.desktop' | head -n 1)
fi
if [ -z "$EXE" ] || [ ! -x "$EXE" ]; then
  echo "no executable found in $PKG_DIR" >&2
  exit 1
fi
EXE_NAME=$(basename "$EXE")

DESKTOP=$(find "$PKG_DIR" -maxdepth 1 -type f -name '*.desktop' | head -n 1)
ICON=$(find "$PKG_DIR" -maxdepth 1 -type f -name '*.png' | head -n 1)
if [ -z "$DESKTOP" ] || [ -z "$ICON" ]; then
  echo "package directory needs a .desktop file and a .png icon: $PKG_DIR" >&2
  exit 1
fi

ICON_NAME=$(sed -n 's/^Icon=//p' "$DESKTOP" | head -n 1)
ICON_NAME=${ICON_NAME:-com.icyleaf.omawarden}
DESKTOP_NAME=$(basename "$DESKTOP")

mkdir -p "$OUT_DIR"
OUT_DIR=$(cd "$OUT_DIR" && pwd)

WORK=$(mktemp -d "${TMPDIR:-/tmp}/omawarden-appimage.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
APPDIR="$WORK/AppDir"
mkdir -p "$APPDIR/usr/bin" \
  "$APPDIR/usr/share/applications" \
  "$APPDIR/usr/share/icons/hicolor/1024x1024/apps"

install -m 755 "$EXE" "$APPDIR/usr/bin/$EXE_NAME"
cp -a "$PKG_DIR/nsh" "$APPDIR/usr/bin/nsh"

install -m 644 "$DESKTOP" "$APPDIR/$DESKTOP_NAME"
install -m 644 "$DESKTOP" "$APPDIR/usr/share/applications/$DESKTOP_NAME"
install -m 644 "$ICON" "$APPDIR/$ICON_NAME.png"
install -m 644 "$ICON" "$APPDIR/.DirIcon"
install -m 644 "$ICON" "$APPDIR/usr/share/icons/hicolor/1024x1024/apps/$ICON_NAME.png"

cat > "$APPDIR/AppRun" <<EOF
#!/bin/sh
set -eu
APPDIR="\$(CDPATH= cd -- "\$(dirname -- "\$0")" && pwd)"
export PATH="\$APPDIR/usr/bin:\$PATH"
exec "\$APPDIR/usr/bin/$EXE_NAME" "\$@"
EOF
chmod 755 "$APPDIR/AppRun"

TOOL=${APPIMAGETOOL:-}
if [ -z "$TOOL" ] && command -v appimagetool >/dev/null 2>&1; then
  TOOL=$(command -v appimagetool)
fi
if [ -z "$TOOL" ]; then
  CACHE_DIR="${XDG_CACHE_HOME:-$HOME/.cache}/omawarden-app"
  TOOL="$CACHE_DIR/appimagetool-$ARCH.AppImage"
  if [ ! -x "$TOOL" ]; then
    mkdir -p "$CACHE_DIR"
    echo "downloading appimagetool ($ARCH)…"
    curl -fsSL --retry 3 \
      "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-$ARCH.AppImage" \
      -o "$TOOL"
    chmod 755 "$TOOL"
  fi
fi
if [ ! -x "$TOOL" ]; then
  echo "appimagetool is not executable: $TOOL" >&2
  exit 1
fi

OUT="$OUT_DIR/$OUT_NAME"
rm -f "$OUT"
ARCH="$ARCH" APPIMAGE_EXTRACT_AND_RUN=1 "$TOOL" --no-appstream "$APPDIR" "$OUT"
chmod 755 "$OUT"
echo "built $OUT"
