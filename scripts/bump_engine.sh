#!/usr/bin/env bash
# Move the engine pin to a revision, and the sibling checkout with it.
#
# The pin is a 40-hex commit in `Cargo.toml`, a comment above it that has to
# explain *why* that revision, the sibling checkout that local builds compile
# through `.cargo/config.toml`, and the verdict `scripts/check_engine_pin.sh`
# prints. Nothing ties those four together, which is how they drift — so this
# does the mechanical part and refuses to guess at the part it cannot know.
#
# What it does NOT do, on purpose:
#   * write the comment. It cannot know why a revision is worth pinning, and a
#     comment invented by a script is worse than none. It prints the block to
#     paste and says so in its output.
#   * decide that a revision *should* be pinned. A ref that exists is not a
#     release; the caller makes that judgement.
#
# Usage:
#   mise run bump-engine <ref> [--no-sibling]
#
#   <ref>          a revision, branch or tag in the sibling checkout, resolved
#                  to a full 40-character SHA before anything is written.
#   --no-sibling   leave the sibling checkout where it is. The result is a pin
#                  that local builds may already contain, and the script says
#                  whether they do.
#
# Deliberately not `git switch` in the sibling: that checkout is often another
# session's working tree. The pin is a fact in this repository; moving someone
# else's branch is not this script's business.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
CARGO_TOML=$ROOT/Cargo.toml

REF=${1:-}
NO_SIBLING=0
while [ $# -gt 0 ]; do
  case "$1" in
    --no-sibling) NO_SIBLING=1 ;;
    -h|--help) sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --*) echo "unknown option: $1" >&2; exit 2 ;;
    *) [ -z "$REF" ] && REF=$1 ;;
  esac
  shift
done

if [ -z "$REF" ]; then
  echo "usage: mise run bump-engine <ref> [--no-sibling]" >&2
  exit 2
fi

# The sibling checkout is the only thing that can resolve a ref to a commit: it
# holds the engine's history, and this repository has only the pin.
PATCH_PATH=$(sed -n 's/^omawarden[[:space:]]*=[[:space:]]*{[[:space:]]*path[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$ROOT/.cargo/config.toml" 2>/dev/null | head -1)
if [ -z "$PATCH_PATH" ]; then
  PATCH_PATH="../omarchy-bitwarden/omawarden"
fi
case "$PATCH_PATH" in
  /*) CANDIDATE=$PATCH_PATH ;;
  *) CANDIDATE=$ROOT/$PATCH_PATH ;;
esac

if [ ! -d "$CANDIDATE" ]; then
  echo "error: no engine checkout at $CANDIDATE, so '$REF' cannot be resolved to a commit." >&2
  echo "  A branch or tag name is not a pin, and guessing would write a ref that Cargo cannot use." >&2
  echo "  Point .cargo/config.toml's patch at a checkout, or pass a full 40-character revision." >&2
  exit 1
fi

REPO=$(git -C "$CANDIDATE" rev-parse --show-toplevel 2>/dev/null || true)
if [ -z "$REPO" ]; then
  echo "error: $CANDIDATE is not a git work tree, so '$REF' cannot be resolved." >&2
  exit 1
fi

# Resolve before writing anything: a typo must leave the manifest untouched.
if ! NEW_REV=$(git -C "$REPO" rev-parse --verify --quiet "$REF^{commit}"); then
  echo "error: '$REF' does not resolve to a commit in $REPO." >&2
  exit 1
fi

if ! printf '%s' "$NEW_REV" | grep -qE '^[0-9a-f]{40}$'; then
  echo "error: '$REF' resolved to '$NEW_REV', which is not a 40-character revision." >&2
  exit 1
fi

OLD_REV=$(sed -n 's/.*rev[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$CARGO_TOML" | head -1)
if [ "$OLD_REV" = "$NEW_REV" ]; then
  echo "The pin is already $NEW_REV; nothing to do."
  exit 0
fi

OLD_SHORT=$(printf '%s' "$OLD_REV" | cut -c1-7)
NEW_SHORT=$(printf '%s' "$NEW_REV" | cut -c1-7)

echo "Engine pin: $OLD_SHORT -> $NEW_SHORT ($NEW_REV)"

# Rewrite only the `rev` of the omawarden dependency line. `perl -pi` would be
# shorter, but this keeps the failure loud if the line is not the shape the
# script expects, instead of silently writing nothing.
if ! grep -qE '^omawarden[[:space:]]*=[[:space:]]*\{.*rev[[:space:]]*=' "$CARGO_TOML"; then
  echo "error: Cargo.toml has no omawarden dependency line with a rev to rewrite." >&2
  exit 1
fi
TMP=$(mktemp)
sed "s/\(^omawarden[[:space:]]*=[[:space:]]*{.*rev[[:space:]]*=[[:space:]]*\"\)[^\"]*\(\"\)/\1$NEW_REV\2/" "$CARGO_TOML" > "$TMP"
mv "$TMP" "$CARGO_TOML"

# Cargo records a git dependency's revision in Cargo.lock *unless* the local
# patch is in play, in which case the engine is a path dependency and no
# `source` line exists. So only refresh the lock when there is a revision to
# refresh: `cargo update -p omawarden` under the patch re-resolves unrelated
# transitive crates instead, which is churn this script must not introduce.
if [ -f "$ROOT/Cargo.lock" ] && grep -q 'source = "git+.*omarchy-bitwarden' "$ROOT/Cargo.lock"; then
  cargo update --manifest-path "$ROOT/Cargo.toml" -p omawarden >/dev/null 2>&1 || \
    echo "warning: could not refresh Cargo.lock; run 'cargo update -p omawarden' before committing." >&2
fi

# Move the sibling, unless asked not to. `git checkout` a detached revision is
# safe for a clean tree; this refuses when the checkout has work in progress,
# because those edits are not this script's to strand.
SIBLING_NOTE=""
HEAD_REV=$(git -C "$REPO" rev-parse HEAD)
if [ "$NO_SIBLING" = "1" ]; then
  if [ "$HEAD_REV" = "$NEW_REV" ]; then
    SIBLING_NOTE="sibling left alone, and it is already at the new pin"
  elif git -C "$REPO" merge-base --is-ancestor "$NEW_REV" "$HEAD_REV" 2>/dev/null; then
    SIBLING_NOTE="sibling left alone; it is ahead of the new pin, so local builds still contain it"
  else
    SIBLING_NOTE="sibling left alone and does NOT contain the new pin; local builds diverge from the release"
  fi
else
  if [ -n "$(git -C "$REPO" status --porcelain)" ]; then
    SIBLING_NOTE="sibling has uncommitted work, so it was NOT moved; commit or stash it, then check it out at $NEW_SHORT"
  elif [ "$HEAD_REV" = "$NEW_REV" ]; then
    SIBLING_NOTE="sibling is already at the new pin"
  else
    git -C "$REPO" checkout --quiet --detach "$NEW_REV"
    SIBLING_NOTE="sibling moved to $NEW_SHORT"
  fi
fi

# Report, rather than assume. A red script after a successful bump is the one
# outcome that would teach the caller to ignore it.
echo
echo "Done:"
echo "  Cargo.toml  rev = $NEW_REV"
echo "  $SIBLING_NOTE"
if [ -f "$ROOT/Cargo.lock" ] && ! grep -q 'source = "git+.*omarchy-bitwarden' "$ROOT/Cargo.lock"; then
  echo "  Cargo.lock untouched: under the local patch the engine has no git source"
  echo "    to record, so there is no revision in it to refresh."
fi
echo
echo "Still yours to write, because a script cannot know it:"
echo "  The comment above the dependency in Cargo.toml explains why *this*"
echo "  revision. Replace the '$OLD_SHORT' reasoning with why '$NEW_SHORT' is worth"
echo "  pinning; scripts/check_engine_pin.sh documents that the two move together."
echo "  Worth checking, too, whether this revision changes anything the app calls."
echo
if [ "$SIBLING_NOTE" = "sibling left alone and does NOT contain the new pin; local builds diverge from the release" ]; then
  echo "The pin check will fail until the sibling contains $NEW_SHORT." >&2
  exit 1
fi

bash "$ROOT/scripts/check_engine_pin.sh"
