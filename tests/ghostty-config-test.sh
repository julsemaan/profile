#!/usr/bin/env bash
# tests/ghostty-config-test.sh - Ghostty must not downgrade modified keys pi binds natively
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=tests/lib/assert.sh
source "$SCRIPT_DIR/lib/assert.sh"

ghostty_config="$REPO_ROOT/utils/config.ghostty"

if [[ -f "$ghostty_config" ]]; then
  test_pass "utils/config.ghostty exists"
else
  test_fail "utils/config.ghostty exists" "file not found: $ghostty_config"
  test_summary
  exit 1
fi

# pi binds ctrl+home and ctrl+end to the transcript top/bottom jumps. A Ghostty
# `csi:H` / `csi:F` override sends the unmodified `home` / `end` sequence instead,
# so pi parses a plain home/end press and the binding never fires.
for key in ctrl+home ctrl+end; do
  overrides="$(grep -E '^[[:space:]]*keybind[[:space:]]*=' "$ghostty_config" | grep -F "$key=" || true)"
  if [[ -z "$overrides" ]]; then
    test_pass "config.ghostty sends ${key} through to the terminal"
  else
    test_fail "config.ghostty sends ${key} through to the terminal" "overridden by: $overrides"
  fi
done

test_summary
