#!/usr/bin/env bash
# Point git at the hooks in `.githooks`.
#
# The hooks live in the tree so they are reviewed and versioned; git only reads
# `.git/hooks` unless `core.hooksPath` says otherwise. Run this once per clone.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

chmod +x .githooks/*
git config core.hooksPath .githooks

echo "core.hooksPath = .githooks"
echo "Installed: $(ls .githooks | tr '\n' ' ')"
