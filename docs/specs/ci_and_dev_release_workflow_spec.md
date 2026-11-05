# CI and Dev Release Workflow Specification

This document specifies the continuous integration, multi-architecture packaging, and distribution pipelines for `omawarden-app`. It is modeled after the release patterns in `huacnlee/omasend` and `omarchy-bitwarden`.

---

## 1. Objectives & Scope

1. **Continuous Integration (`.github/workflows/ci.yml`)**:
   - Triggered on pull requests and pushes to `main`.
   - Validates Rust code formatting (`cargo fmt`).
   - Verifies version consistency between `nsh.json` and `Cargo.toml`.
   - Runs TypeScript Native Compiler type checks (`nsh check`).
   - Runs the complete headless test suite (`nsh test`, 72 tests).

2. **Dev Pre-Release Pipeline (`.github/workflows/release-dev.yml`)**:
   - Triggered on push to `main` (when relevant files change) and via `workflow_dispatch`.
   - Builds for **Linux Desktop** (`x86_64-unknown-linux-gnu` on `ubuntu-24.04`, `aarch64-unknown-linux-gnu` on `ubuntu-24.04-arm`).
   - Extensible target matrix structure ready for future OS additions (macOS / Windows).
   - Generates for each architecture:
     - `.tar.gz` archive containing the native runner, bundle, desktop entry, app icon, Polkit action policy, and install helper.
     - Standalone `.AppImage` executable.
   - Combines and verifies checksums (`SHA256SUMS`).
   - Updates rolling GitHub tag `dev` and publishes/overwrites GitHub Pre-release **Omawarden App (dev)**.
   - Publishes `omawarden-app-dev-bin` to the Arch User Repository (AUR) if `secrets.AUR_KEY` is present; gracefully skips if absent.

---

## 2. Workspace & Dependency Alignment

### 2.1 Version Number Alignment
- `nsh.json`: change `"version": "1.0.0"` to `"version": "0.3.0"`.
- `Cargo.toml`: keep `"version": "0.3.0"`.
- Both files must strictly match.

### 2.2 In-Process Engine (`omawarden`) Git Dependency
In `Cargo.toml`:
```toml
omawarden = { git = "https://github.com/icyleaf/omarchy-bitwarden.git", branch = "develop" }
```
In `.cargo/config.toml` (for local development override):
```toml
[patch."https://github.com/icyleaf/omarchy-bitwarden.git"]
omawarden = { path = "../omarchy-bitwarden/omawarden" }
```
This ensures CI builds cleanly from GitHub without requiring a sibling checkout, while local development automatically resolves to the local clone.

### 2.3 Packaging Artifacts (`packaging/`)
Create `packaging/` directory in `omawarden-app`:
1. `packaging/org.omarchy.plugin.icyleaf.omarchy-bitwarden.policy`: Polkit authorization rules for Quick Unlock.
2. `packaging/omawarden-policy.install`: Pacman/system post-install scriptlet.
3. `packaging/build-appimage.sh`: Helper script to package `.nsh/out/omawardenApp` into `.AppImage` using `appimagetool`.
4. `packaging/generate-aur-pkgbuild.sh`: Generates PKGBUILD for `omawarden-app-dev-bin`.

---

## 3. Workflow Specifications

### 3.1 CI Workflow (`.github/workflows/ci.yml`)

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test:
    name: Test & Verify (x86_64-linux)
    runs-on: ubuntu-24.04
    timeout-minutes: 30

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Install Rust toolchain
        uses: dtolnay/rust-toolchain@stable
        with:
          components: rustfmt

      - name: Install Linux build dependencies
        run: |
          sudo apt-get update
          sudo apt-get install -y clang pkg-config libgtk-4-dev libssl-dev libxcb1-dev libsecret-1-dev

      - name: Install nsh CLI (v0.3.0)
        run: |
          curl -fsSL https://github.com/longbridge/nsh/releases/download/v0.3.0/nsh-linux-x86_64.tar.gz | sudo tar -xz -C /usr/local/bin
          nsh --version

      - name: Rust cache
        uses: Swatinem/rust-cache@v2
        with:
          key: ci-x86_64

      - name: Verify version consistency
        run: |
          CARGO_VER=$(grep '^version = ' Cargo.toml | head -1 | cut -d'"' -f2)
          NSH_VER=$(grep '"version":' nsh.json | head -1 | cut -d'"' -f4)
          echo "Cargo.toml version: $CARGO_VER, nsh.json version: $NSH_VER"
          if [ "$CARGO_VER" != "$NSH_VER" ]; then
            echo "::error::Cargo.toml ($CARGO_VER) and nsh.json ($NSH_VER) version mismatch!"
            exit 1
          fi

      - name: Check Rust formatting
        run: cargo fmt --all --check

      - name: TypeScript type-check
        run: nsh check

      - name: Headless tests
        run: nsh test
```

### 3.2 Dev Release Workflow (`.github/workflows/release-dev.yml`)

```yaml
name: Release Omawarden App (Dev)

on:
  push:
    branches:
      - main
    paths:
      - 'src/**'
      - 'components/**'
      - 'store/**'
      - 'theme/**'
      - 'packaging/**'
      - 'Cargo.toml'
      - 'Cargo.lock'
      - 'nsh.json'
      - '.github/workflows/release-dev.yml'
  workflow_dispatch:

permissions:
  contents: write
  id-token: write
  attestations: write

concurrency:
  group: release-dev
  cancel-in-progress: false

jobs:
  build:
    name: Build ${{ matrix.target }}
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: ubuntu-24.04
            target: x86_64-unknown-linux-gnu
            arch: x86_64
          - os: ubuntu-24.04-arm
            target: aarch64-unknown-linux-gnu
            arch: aarch64
    runs-on: ${{ matrix.os }}
    timeout-minutes: 60

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Install Rust toolchain
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.target }}

      - name: Install Linux build dependencies
        run: |
          sudo apt-get update
          sudo apt-get install -y clang pkg-config libgtk-4-dev libssl-dev libxcb1-dev libsecret-1-dev file wget

      - name: Install nsh CLI (x86_64)
        if: matrix.arch == 'x86_64'
        run: |
          curl -fsSL https://github.com/longbridge/nsh/releases/download/v0.3.0/nsh-linux-x86_64.tar.gz | sudo tar -xz -C /usr/local/bin
          nsh --version

      - name: Install nsh CLI (aarch64)
        if: matrix.arch == 'aarch64'
        run: |
          cargo install --git https://github.com/longbridge/nsh.git --tag v0.3.0 nsh-cli --root /usr/local || cargo install --git https://github.com/longbridge/nsh.git nsh-cli --root /usr/local
          nsh --version

      - name: Rust cache
        uses: Swatinem/rust-cache@v2
        with:
          key: release-dev-${{ matrix.target }}

      - name: Validate version consistency
        run: |
          CARGO_VER=$(grep '^version = ' Cargo.toml | head -1 | cut -d'"' -f2)
          NSH_VER=$(grep '"version":' nsh.json | head -1 | cut -d'"' -f4)
          if [ "$CARGO_VER" != "$NSH_VER" ]; then
            echo "::error::Cargo.toml ($CARGO_VER) and nsh.json ($NSH_VER) version mismatch!"
            exit 1
          fi

      - name: Package native Linux app via nsh
        run: |
          nsh package --target linux --out dist-pkg

      - name: Bundle release tarball and AppImage
        env:
          TARGET: ${{ matrix.target }}
          ARCH: ${{ matrix.arch }}
        run: |
          SHORT_SHA=$(git rev-parse --short HEAD)
          CARGO_VER=$(grep '^version = ' Cargo.toml | head -1 | cut -d'"' -f2)
          PKG_NAME="omawarden-app-${CARGO_VER}-dev.${SHORT_SHA}-${TARGET}"
          mkdir -p "dist/${PKG_NAME}"
          cp -r dist-pkg/omawardenApp/* "dist/${PKG_NAME}/"
          cp packaging/org.omarchy.plugin.icyleaf.omarchy-bitwarden.policy "dist/${PKG_NAME}/"
          cp packaging/omawarden-policy.install "dist/${PKG_NAME}/"
          cp README.md "dist/${PKG_NAME}/"

          # 1. Archive tar.gz
          cd dist
          tar -czvf "${PKG_NAME}.tar.gz" "${PKG_NAME}"
          sha256sum "${PKG_NAME}.tar.gz" > "${PKG_NAME}.tar.gz.sha256"

          # Generic name for AUR / direct download
          cp "${PKG_NAME}.tar.gz" "omawarden-app-${TARGET}.tar.gz"
          sha256sum "omawarden-app-${TARGET}.tar.gz" > "omawarden-app-${TARGET}.tar.gz.sha256"
          cd ..

          # 2. Build AppImage
          bash packaging/build-appimage.sh "dist-pkg/omawardenApp" "dist" "${PKG_NAME}.AppImage" "$ARCH"
          cd dist
          if [ -f "${PKG_NAME}.AppImage" ]; then
            sha256sum "${PKG_NAME}.AppImage" > "${PKG_NAME}.AppImage.sha256"
            cp "${PKG_NAME}.AppImage" "omawarden-app-${TARGET}.AppImage"
            sha256sum "omawarden-app-${TARGET}.AppImage" > "omawarden-app-${TARGET}.AppImage.sha256"
          fi
          cd ..

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: release-${{ matrix.target }}
          path: |
            dist/*.tar.gz
            dist/*.tar.gz.sha256
            dist/*.AppImage
            dist/*.AppImage.sha256
          if-no-files-found: warn

  publish:
    name: Publish Dev Pre-Release & AUR
    needs: build
    runs-on: ubuntu-24.04
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Download build artifacts
        uses: actions/download-artifact@v4
        with:
          pattern: release-*
          merge-multiple: true
          path: dist

      - name: Generate SHA256SUMS
        run: |
          cd dist
          cat *.sha256 | sort -u -k2 > SHA256SUMS
          rm -f -- *.sha256
          sha256sum --check SHA256SUMS

      - name: Update rolling dev tag
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git tag -f dev
          git push origin dev --force

      - name: Publish GitHub Pre-release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: dev
          name: "Omawarden App (dev)"
          prerelease: true
          body: |
            ## Omawarden App Development Build

            - **Version**: `0.3.0-dev.${{ github.sha }}`
            - **Commit**: [${{ github.sha }}](https://github.com/${{ github.repository }}/commit/${{ github.sha }})
            - **Date**: $(date -u +'%Y-%m-%d %H:%M UTC')

            ### Included Artifacts
            - Native Tarballs: `x86_64-unknown-linux-gnu`, `aarch64-unknown-linux-gnu`
            - Standalone AppImages: `x86_64`, `aarch64`
            - Verified Checksums: `SHA256SUMS`
          files: |
            dist/*

      - name: Generate and publish AUR PKGBUILD (omawarden-app-dev-bin)
        env:
          AUR_KEY: ${{ secrets.AUR_KEY }}
        if: env.AUR_KEY != ''
        run: |
          bash packaging/generate-aur-pkgbuild.sh
        # Uses KSXGitHub/github-actions-deploy-aur when AUR_KEY is configured
```

---

## 4. Verification & Validation Steps

1. `nsh.json` and `Cargo.toml` must match (`0.3.0`).
2. `nsh check` and `nsh test` must pass cleanly.
3. `packaging/build-appimage.sh` must be executable and handle AppDir creation.
4. `packaging/generate-aur-pkgbuild.sh` must correctly substitute version, commit sha, and checksums.
