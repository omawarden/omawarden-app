#!/usr/bin/env bash
# Guard the engine pin.
#
# The app links the engine crate and, at release time, builds the bundled
# daemon from the same commit. A branch or tag pin would let the two drift
# apart silently, and the tag is not even available for the current
# development line. So the dependency must name a 40-character revision.
#
# The pin is also a contract between two toolchains, and nothing in Cargo ties
# them together:
#
#   * locally, `.cargo/config.toml` patches the dependency to a sibling
#     checkout, so the revision in Cargo.toml is only a note;
#   * in CI, that patch is removed and Cargo fetches the revision.
#
# This compares the facts and fails on disagreement, so a developer cannot
# build against an engine the release will never ship. `--locked` is
# deliberately not used: under the patch Cargo records no `source` for the
# engine, while CI's resolution needs a git source line, and one lock entry
# cannot hold both shapes. The immutable revision is what makes the build
# reproducible, so that is what is compared.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
LINE=$(grep -E '^omawarden[[:space:]]*=[[:space:]]*\{.*git[[:space:]]*=' "$ROOT/Cargo.toml" || true)

if [ -z "$LINE" ]; then
  echo "::error::Cargo.toml has no omawarden git dependency to pin" >&2
  exit 1
fi

if printf '%s\n' "$LINE" | grep -qE '(branch|tag)[[:space:]]*='; then
  echo "::error::pin the engine by rev, not branch or tag: $LINE" >&2
  exit 1
fi

REV=$(printf '%s\n' "$LINE" | sed -n 's/.*rev[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p')

if ! printf '%s\n' "$REV" | grep -qE '^[0-9a-f]{40}$'; then
  echo "::error::the engine pin is not a 40-character commit revision: '${REV:-<missing>}'" >&2
  exit 1
fi

# The sibling checkout the local patch points at, when there is one. CI has
# none: it removes the patch and lets Cargo fetch the pin, which is accepted
# as-is below.
CHECKOUT=""
PATCH_PATH=$(sed -n 's/^omawarden[[:space:]]*=[[:space:]]*{[[:space:]]*path[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$ROOT/.cargo/config.toml" 2>/dev/null | head -1)
if [ -z "$PATCH_PATH" ]; then
  PATCH_PATH="../omarchy-bitwarden/omawarden"
fi
case "$PATCH_PATH" in
  /*) CANDIDATE=$PATCH_PATH ;;
  *) CANDIDATE=$ROOT/$PATCH_PATH ;;
esac
if [ -d "$CANDIDATE" ]; then
  CHECKOUT=$(cd "$CANDIDATE" && pwd)
fi

if [ -z "$CHECKOUT" ]; then
  # CI has no sibling checkout, but Cargo still fetches the pinned revision into
  # its own checkout directory. Look there before giving up: the macOS Keychain
  # check below is the whole point of this script for a macOS build, and the
  # "no sibling" path used to return success without ever running it — a green
  # tick over a check that never happened.
  for candidate in "${CARGO_HOME:-$HOME/.cargo}"/git/checkouts/omarchy-bitwarden-*/"$(printf '%s' "$REV" | cut -c1-7)"; do
    # `CHECKOUT` means the crate directory, as it does for the sibling branch
    # below, and the checkout is the repository root with the crate one level
    # down.
    if [ -d "$candidate/omawarden/src" ]; then
      CHECKOUT=$candidate/omawarden
      FROM_CARGO_CHECKOUT=1
      break
    fi
  done
fi

if [ -z "$CHECKOUT" ]; then
  echo "Engine pin: $REV (no checkout available; Cargo fetches the pin)"
  # Locally this is a missing convenience: run `cargo fetch` if you want the
  # provider check. In CI it is a hole in the job, because the step exists to
  # run that check and a warning lets the build pass without it — the exact
  # shape of failure this script was supposed to stop printing green ticks over.
  if [ -n "${CI:-}" ]; then
    echo "::error::could not inspect the pinned engine, so the macOS Keychain provider check did not run. Run \`cargo fetch\` before this script." >&2
    exit 1
  fi
  echo "::warning::could not inspect the pinned engine, so the macOS Keychain provider check did not run"
  exit 0
fi

# The sibling branch compares against the working tree; a Cargo checkout is
# named after the revision it holds, so there is nothing to compare there.
if [ "${FROM_CARGO_CHECKOUT:-0}" != "1" ]; then
  REPO=$(cd "$CHECKOUT" && git rev-parse --show-toplevel 2>/dev/null || true)
  if [ -z "$REPO" ]; then
    echo "Engine pin: $REV (sibling checkout is not a git work tree; nothing to compare)"
    exit 0
  fi

  HEAD_REV=$(git -C "$REPO" rev-parse HEAD)

  if [ "$HEAD_REV" != "$REV" ]; then
    echo "::error::the engine pin has drifted from the sibling checkout" >&2
    echo "  pinned in Cargo.toml: $REV" >&2
    echo "  sibling HEAD:         $HEAD_REV  ($REPO)" >&2
    echo "  Local builds compile the sibling HEAD, because .cargo/config.toml patches the dependency, while the release compiles the pin. Move the pin, or check the sibling out at it, before relying on either build." >&2
    exit 1
  fi
fi

# A Linux-only engine builds fine, stores nothing on macOS, and falls back to
# the Secret Service provider, so it must not pass as a cross-platform one.
if ! grep -rqs 'MacOsKeychainProvider' "$CHECKOUT/src/keyring.rs" "$CHECKOUT/src/keyring"; then
  echo "::error::the pinned engine has no macOS Keychain provider" >&2
  echo "  checkout: $CHECKOUT" >&2
  echo "  Expected MacOsKeychainProvider (the pluggable Keyring Provider architecture). Without it, a macOS build compiles, silently stores no credentials, and falls back to the Secret Service provider, which macOS does not have: signing in appears to work and nothing survives the process. Move the pin to a revision that has it." >&2
  exit 1
fi

if [ "${FROM_CARGO_CHECKOUT:-0}" = "1" ]; then
  echo "Engine pin: $REV (macOS Keychain provider present, inspected in Cargo's checkout)"
else
  echo "Engine pin: $REV (sibling HEAD matches; macOS Keychain provider present)"
fi
