#!/usr/bin/env bash
# Runs the e2e on a throwaway keychain (macOS); see with-throwaway-keychain.sh.
set -euo pipefail
exec "$(dirname "$0")/with-throwaway-keychain.sh" npx playwright test "$@"
