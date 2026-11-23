#!/usr/bin/env bash
# Guard the engine pin.
#
# The app links the engine crate and, at release time, builds the bundled
# daemon from the same commit. A branch or tag pin would let the two drift
# apart silently, and the tag is not even available for the current
# development line. So the dependency must name a 40-character revision.
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

echo "Engine pin: $REV"
