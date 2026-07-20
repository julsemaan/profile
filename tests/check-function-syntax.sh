#!/usr/bin/env bash
# tests/check-function-syntax.sh - Enforce `function name {` over `name() {`
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

files=(
  "$REPO_ROOT/profile/.bashrc_append"
  "$REPO_ROOT"/profile/bashrc.d/*.bash
)
# Also check all test scripts for POSIX-style definitions
while IFS= read -r -d '' f; do files+=("$f"); done < <(
  find "$REPO_ROOT/tests" -name '*.sh' -print0
)

violations=0
while IFS= read -r match; do
  echo "  $match" >&2
  violations=$((violations + 1))
done < <(
  grep -Hn '^[[:space:]]*[a-zA-Z_][a-zA-Z0-9_]*[[:space:]]*()[[:space:]]*{' "${files[@]}" 2>/dev/null |
    grep -v '^[^:]*:[0-9]*:[[:space:]]*#'
)

if [ "$violations" -gt 0 ]; then
  echo "ERROR: $violations POSIX-style function definition(s). Use 'function name {'." >&2
  exit 1
fi
echo "OK: All functions use 'function name {' syntax."
