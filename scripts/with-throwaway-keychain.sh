#!/usr/bin/env bash
# Runs a command on a throwaway keychain (macOS) so the login keychain is never touched or unlocked.
# Mirrors the "Use a throwaway keychain" step in .github/workflows/ci.yml; keychains are restored on exit.
# Usage: scripts/with-throwaway-keychain.sh <command> [args...]
set -euo pipefail

if [ "$(uname)" != "Darwin" ]; then
  exec "$@"
fi

KEYCHAIN="$(mktemp -d)/e2e.keychain-db"
PREV_DEFAULT="$(security default-keychain -d user | tr -d ' "')"
PREV_LIST=()
while IFS= read -r k; do PREV_LIST+=("$(echo "$k" | tr -d ' "')"); done < <(security list-keychains -d user)

restore() {
  security default-keychain -d user -s "$PREV_DEFAULT" || true
  security list-keychains -d user -s "${PREV_LIST[@]}" || true
  security delete-keychain "$KEYCHAIN" || true
  rm -rf "$(dirname "$KEYCHAIN")"
}
trap restore EXIT

security create-keychain -p e2e "$KEYCHAIN"
security set-keychain-settings -lut 3600 "$KEYCHAIN"
security unlock-keychain -p e2e "$KEYCHAIN"
security list-keychains -d user -s "$KEYCHAIN"
security default-keychain -d user -s "$KEYCHAIN"

"$@"
