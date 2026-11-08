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
   - Generates for each architecture, under one stable name per target:
     - `omawarden-app-<version>-dev-<target>.tar.gz`, containing the native runner, bundle, desktop entry, app icon, Polkit action policy, and install helper.
     - `omawarden-app-<version>-dev-<target>.AppImage`.
   - Combines and verifies checksums (`SHA256SUMS`).
   - Updates rolling GitHub tag `dev` and replaces the single GitHub Pre-release on that tag. The release title is the publish time and the body carries the version, commit, publish date and the commits since the previous build; the previous build's assets are deleted before the new ones are uploaded, so the channel holds exactly one build.
   - Publishes `omawarden-app-dev-bin` to the Arch User Repository (AUR) if `secrets.AUR_KEY` is present; gracefully skips if absent.

---

## 2. Workspace & Dependency Alignment

### 2.1 Version Number Alignment
- `nsh.json` and `Cargo.toml` both carry the current version (`0.4.0`).
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
      - 'App.tsx'
      - 'assets/**'
      - 'src/**'
      - 'components/**'
      - 'store/**'
      - 'theme/**'
      - 'packaging/**'
      - 'build.rs'
      - 'Cargo.toml'
      - 'Cargo.lock'
      - 'nsh.json'
      - 'rust-toolchain.toml'
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

      # See ci.yml: CI has no sibling engine checkout, so let Cargo use the
      # git dependency instead of the developer's local path patch.
      - name: Use the git dependency in CI
        run: |
          python3 - <<'PY'
          from pathlib import Path

          path = Path(".cargo/config.toml")
          lines = path.read_text().splitlines()
          output = []
          skipping = False
          for line in lines:
              if line.startswith("[patch."):
                  skipping = True
                  continue
              if skipping and line.startswith("[") and not line.startswith("[patch."):
                  skipping = False
              if not skipping:
                  output.append(line)
          path.write_text("\n".join(output).rstrip() + "\n")
          PY

      - name: Install Rust toolchain
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.target }}

      - name: Install Linux build dependencies
        run: |
          sudo apt-get update
          sudo apt-get install -y clang llvm libclang-dev pkg-config \
            libgtk-4-dev libwebkitgtk-6.0-dev libssl-dev libxcb1-dev libsecret-1-dev \
            libzstd-dev file wget

      # The release tarball carries the Linux release runner next to `bin/nsh`.
      - name: Install nsh CLI (x86_64)
        if: matrix.arch == 'x86_64'
        run: |
          curl -fsSL https://github.com/longbridge/nsh/releases/download/v0.4.0/install.sh | NSH_VERSION=v0.4.0 sh
          echo "$HOME/.local/bin" >> "$GITHUB_PATH"
          export PATH="$HOME/.local/bin:$PATH"
          nsh --version

      # v0.4.0 has no aarch64 prebuilt. Build the CLI from a checkout (as the
      # installer's --source mode does) so it can also build the aarch64
      # release runner from that same checkout.
      - name: Install nsh CLI (aarch64)
        if: matrix.arch == 'aarch64'
        # nsh's toolchain file lists its mobile targets; the host's stable
        # toolchain is all this build needs.
        env:
          RUSTUP_TOOLCHAIN: stable
        run: |
          git clone --depth 1 --branch v0.4.0 https://github.com/longbridge/nsh.git "$HOME/.nsh-src"
          cargo build --release --locked --manifest-path "$HOME/.nsh-src/Cargo.toml" -p nsh-cli
          mkdir -p "$HOME/.nsh/bin" "$HOME/.local/bin"
          ln -sf "$HOME/.nsh-src/target/release/nsh" "$HOME/.nsh/bin/nsh"
          ln -sf "$HOME/.nsh/bin/nsh" "$HOME/.local/bin/nsh"
          echo "$HOME/.local/bin" >> "$GITHUB_PATH"
          export PATH="$HOME/.local/bin:$PATH"
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
          # One stable name per target: the channel suffix and the target, never
          # the commit SHA. The version only changes on a version bump, so a
          # published filename stays put across dev builds and the AUR source
          # URL and the release's asset list stay valid between publishes.
          CARGO_VER=$(grep '^version = ' Cargo.toml | head -1 | cut -d'"' -f2)
          PKG_NAME="omawarden-app-${CARGO_VER}-dev-${TARGET}"
          PKG_DIR="dist-pkg/omawardenApp"
          if [ ! -d "$PKG_DIR" ]; then
            PKG_DIR=$(find dist-pkg -mindepth 1 -maxdepth 1 -type d | head -n 1)
          fi
          mkdir -p "dist/${PKG_NAME}"
          cp -r "$PKG_DIR"/* "dist/${PKG_NAME}/"
          cp packaging/org.omarchy.plugin.icyleaf.omarchy-bitwarden.policy "dist/${PKG_NAME}/"
          cp packaging/omawarden-policy.install "dist/${PKG_NAME}/"
          cp README.md "dist/${PKG_NAME}/"

          # 1. Archive tar.gz
          cd dist
          tar -czvf "${PKG_NAME}.tar.gz" "${PKG_NAME}"
          sha256sum "${PKG_NAME}.tar.gz" > "${PKG_NAME}.tar.gz.sha256"
          cd ..

          # 2. Build AppImage
          bash packaging/build-appimage.sh "$PKG_DIR" "dist" "${PKG_NAME}.AppImage" "$ARCH"
          cd dist
          if [ -f "${PKG_NAME}.AppImage" ]; then
            sha256sum "${PKG_NAME}.AppImage" > "${PKG_NAME}.AppImage.sha256"
          fi
          cd ..

      - name: Attest build provenance
        uses: actions/attest-build-provenance@v4
        with:
          subject-path: |
            dist/*.tar.gz
            dist/*.AppImage

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
    env:
      AUR_KEY: ${{ secrets.AUR_KEY }}
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

      # The changelog is the range between the last published build and this
      # one, and the rolling tag is the only record of what "last published"
      # means. Read it before the tag moves.
      - name: Collect release metadata
        id: meta
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          set -euo pipefail
          version=$(grep '^version = ' Cargo.toml | head -1 | cut -d'"' -f2)
          short_sha=$(git rev-parse --short HEAD)
          subject=$(git log -1 --pretty=%s)
          date=$(date -u +'%Y-%m-%d %H:%M UTC')
          local_date=$(TZ=Asia/Shanghai date +'%Y-%m-%d %H:%M +08')

          previous=$(gh api "repos/${{ github.repository }}/git/ref/tags/dev" \
            --jq .object.sha 2>/dev/null || true)
          if [ -n "$previous" ]; then
            previous=$(git rev-parse --verify --quiet "${previous}^{commit}" || true)
          fi

          changelog="First dev build on this channel."
          if [ -n "$previous" ] && [ "$previous" != "$GITHUB_SHA" ]; then
            count=$(git rev-list --count --no-merges "$previous..$GITHUB_SHA")
            if [ "$count" -gt 0 ]; then
              changelog=$(git log -n 20 --no-merges \
                --pretty='- `%h` %s' "$previous..$GITHUB_SHA")
              if [ "$count" -gt 20 ]; then
                changelog="$changelog"$'\n'"- …and $((count - 20)) more"
              fi
            else
              changelog="No new commits since the previous dev build."
            fi
            changelog="$changelog"$'\n\n'"[Full diff](https://github.com/${{ github.repository }}/compare/${previous}..$GITHUB_SHA)"
          fi

          {
            echo "version=$version"
            echo "short_sha=$short_sha"
            echo "subject=$subject"
            echo "date=$date"
            echo "local_date=$local_date"
            echo "changelog<<CHANGELOG_EOF"
            echo "$changelog"
            echo "CHANGELOG_EOF"
          } >> "$GITHUB_OUTPUT"

      # GITHUB_TOKEN cannot push a commit or tag that changes a workflow file
      # (GitHub rejects it with "refusing to allow a GitHub App to create or
      # update workflow ... without `workflows` permission"). Update the rolling
      # tag through the API instead of `git push`, which does not carry file
      # changes and therefore is not subject to that restriction.
      - name: Update rolling dev tag
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          if gh api "repos/${{ github.repository }}/git/ref/tags/dev" >/dev/null 2>&1; then
            gh api --method PATCH "repos/${{ github.repository }}/git/refs/tags/dev" \
              -f sha="${{ github.sha }}" -F force=true >/dev/null
          else
            gh api --method POST "repos/${{ github.repository }}/git/refs" \
              -f ref="refs/tags/dev" -f sha="${{ github.sha }}" >/dev/null
          fi

      # The dev channel carries one build at a time. Assets are removed before
      # the upload rather than after it: a failed upload then leaves an empty
      # release, which is obviously broken, instead of a mix of two builds that
      # looks fine until someone downloads a mismatched tarball and AppImage.
      - name: Remove the previous build's assets
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          set -euo pipefail
          release_id=$(gh api "repos/${{ github.repository }}/releases/tags/dev" \
            --jq .id 2>/dev/null || true)
          if [ -z "$release_id" ]; then
            echo "No dev release yet; nothing to remove."
            exit 0
          fi
          gh api --paginate "repos/${{ github.repository }}/releases/$release_id/assets" \
            --jq '.[].id' | while read -r asset_id; do
              gh api --method DELETE \
                "repos/${{ github.repository }}/releases/assets/$asset_id"
            done

      - name: Publish GitHub Pre-release
        uses: softprops/action-gh-release@v3
        with:
          tag_name: dev
          name: "${{ steps.meta.outputs.date }}"
          prerelease: true
          make_latest: false
          body: |
            ## Omawarden App (dev)

            - **Version**: `${{ steps.meta.outputs.version }}-dev.${{ steps.meta.outputs.short_sha }}`
            - **Commit**: [`${{ steps.meta.outputs.short_sha }}`](https://github.com/${{ github.repository }}/commit/${{ github.sha }}) — ${{ steps.meta.outputs.subject }}
            - **Published**: ${{ steps.meta.outputs.date }} (${{ steps.meta.outputs.local_date }})
            - **Branch**: `${{ github.ref_name }}`
            - **Runners**: `ubuntu-24.04` (x86_64), `ubuntu-24.04-arm` (aarch64)

            ### Changes since the previous dev build

            ${{ steps.meta.outputs.changelog }}

            ### Artifacts

            | Asset | Architecture |
            | --- | --- |
            | `omawarden-app-${{ steps.meta.outputs.version }}-dev-x86_64-unknown-linux-gnu.tar.gz` | x86_64 |
            | `omawarden-app-${{ steps.meta.outputs.version }}-dev-aarch64-unknown-linux-gnu.tar.gz` | aarch64 |
            | `omawarden-app-${{ steps.meta.outputs.version }}-dev-x86_64-unknown-linux-gnu.AppImage` | x86_64 |
            | `omawarden-app-${{ steps.meta.outputs.version }}-dev-aarch64-unknown-linux-gnu.AppImage` | aarch64 |
            | `SHA256SUMS` | both |

            Verify a download with `sha256sum --check SHA256SUMS`.
          files: |
            dist/*

      - name: Generate AUR PKGBUILD (omawarden-app-dev-bin)
        id: aur
        if: env.AUR_KEY != ''
        env:
          GITHUB_REPOSITORY: ${{ github.repository }}
        run: |
          bash packaging/generate-aur-pkgbuild.sh
          echo "pkgver=$(cat dist/aur/pkgver)" >> "$GITHUB_OUTPUT"

      - name: Publish AUR package
        if: env.AUR_KEY != ''
        uses: KSXGitHub/github-actions-deploy-aur@2ac5a4c1d7035885d46b10e3193393be8460b6f1 # v4.1.1
        with:
          pkgname: omawarden-app-dev-bin
          pkgbuild: ./dist/aur/PKGBUILD
          assets: ./dist/aur/omawarden-policy.install
          commit_username: ${{ secrets.AUR_USERNAME }}
          commit_email: ${{ secrets.AUR_EMAIL }}
          ssh_private_key: ${{ secrets.AUR_KEY }}
          commit_message: "upgpkg: omawarden-app-dev-bin ${{ steps.aur.outputs.pkgver }}"
          ssh_keyscan_types: rsa,ecdsa,ed25519
```

---

## 4. Verification & Validation Steps

1. `nsh.json` and `Cargo.toml` must match (`0.4.0`).
2. `nsh check` and `nsh test` must pass cleanly.
3. `packaging/build-appimage.sh` must be executable and handle AppDir creation.
4. `packaging/generate-aur-pkgbuild.sh` must correctly substitute the version into the stable dev asset name, the `pkgver`, and the checksums.
