#!/usr/bin/env bash
# tests/run-ci-checks.sh - Run all CI checks locally (best-effort)
set -euo pipefail
cd "$(dirname "$(dirname "${BASH_SOURCE[0]}")")"

failures=0
run_check() {
  local label="$1"; shift
  echo "=== $label ==="
  if "$@" 2>&1; then echo "  PASS"; else failures=$((failures+1)); fi; echo
}

run_check "bash -n" bash -n install setup profile/.bashrc_append profile/bashrc.d/*.bash profile/*.sh utils/*.sh tmuxifiers/*.sh tests/bashrc-smoke.sh tests/lib/assert.sh
run_check "function syntax" bash tests/check-function-syntax.sh
run_check "smoke tests" bash tests/bashrc-smoke.sh

if command -v shellcheck >/dev/null 2>&1; then
  run_check "shellcheck" shellcheck -x profile/.bashrc_append profile/bashrc.d/*.bash tests/bashrc-smoke.sh tests/lib/assert.sh
else
  echo "FAIL: shellcheck not installed — install it to proceed" >&2
  failures=$((failures+1))
fi

if command -v shfmt >/dev/null 2>&1; then
  run_check "shfmt" shfmt -i 2 -d profile/.bashrc_append profile/bashrc.d/*.bash tests/bashrc-smoke.sh tests/lib/assert.sh
else
  echo "FAIL: shfmt not installed — install it to proceed" >&2
  failures=$((failures+1))
fi

echo "=== $failures failure(s) ==="
[ "$failures" -eq 0 ] || exit 1
