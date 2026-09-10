#!/usr/bin/env bash
# tests/pi-config-test.sh - Regression test for Pi settings split
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=tests/lib/assert.sh
source "$SCRIPT_DIR/lib/assert.sh"

settings_json="$REPO_ROOT/.pi/settings.json"
global_json="$REPO_ROOT/.pi/settings.global.json"
install_file="$REPO_ROOT/install"

# 1. .pi/settings.json should exist and have no package list
if [[ ! -f "$settings_json" ]]; then
  test_fail ".pi/settings.json exists" "file not found: $settings_json"
else
  test_pass ".pi/settings.json exists"
  if grep -q '"packages"' "$settings_json"; then
    test_fail ".pi/settings.json has no package list" "found packages key in $settings_json"
  else
    test_pass ".pi/settings.json has no package list"
  fi
fi

# 2. .pi/settings.global.json should exist and contain expected packages
if [[ ! -f "$global_json" ]]; then
  test_fail ".pi/settings.global.json exists" "file not found: $global_json"
else
  test_pass ".pi/settings.global.json exists"
  for pkg in "npm:pi-web-access" "npm:@earendil-works/pi-tui" "npm:pi-mcp-adapter" "npm:agent-status-pi" "https://github.com/DietrichGebert/ponytail@v4.7.0"; do
    if grep -qF "$pkg" "$global_json"; then
      test_pass ".pi/settings.global.json contains $pkg"
    else
      test_fail ".pi/settings.global.json contains $pkg" "missing: $pkg"
    fi
  done
fi

# 3. install should map settings.global.json to user's settings.json
if grep -q 'settings\.global\.json.*settings\.json' "$install_file"; then
  test_pass "install maps settings.global.json to user's settings.json"
else
  test_fail "install maps settings.global.json to user's settings.json" "mapping not found in $install_file"
fi

# Ensure install does not copy project settings.json directly as global settings
if grep -q 'exact_sync_files=.*settings\.json' "$install_file"; then
  test_fail "install does not copy .pi/settings.json as global settings" "found settings.json in exact_sync_files"
else
  test_pass "install does not copy .pi/settings.json as global settings"
fi

# 4. Both JSON files should parse successfully
parse_ok=0
if command -v node >/dev/null 2>&1; then
  if node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$settings_json" 2>/dev/null; then
    test_pass ".pi/settings.json parses as valid JSON (node)"
  else
    test_fail ".pi/settings.json parses as valid JSON (node)" "invalid JSON"
  fi
  if node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$global_json" 2>/dev/null; then
    test_pass ".pi/settings.global.json parses as valid JSON (node)"
  else
    test_fail ".pi/settings.global.json parses as valid JSON (node)" "invalid JSON"
  fi
  parse_ok=1
elif command -v python3 >/dev/null 2>&1; then
  if python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$settings_json" 2>/dev/null; then
    test_pass ".pi/settings.json parses as valid JSON (python3)"
  else
    test_fail ".pi/settings.json parses as valid JSON (python3)" "invalid JSON"
  fi
  if python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$global_json" 2>/dev/null; then
    test_pass ".pi/settings.global.json parses as valid JSON (python3)"
  else
    test_fail ".pi/settings.global.json parses as valid JSON (python3)" "invalid JSON"
  fi
  parse_ok=1
elif command -v jq >/dev/null 2>&1; then
  if jq empty "$settings_json" 2>/dev/null; then
    test_pass ".pi/settings.json parses as valid JSON (jq)"
  else
    test_fail ".pi/settings.json parses as valid JSON (jq)" "invalid JSON"
  fi
  if jq empty "$global_json" 2>/dev/null; then
    test_pass ".pi/settings.global.json parses as valid JSON (jq)"
  else
    test_fail ".pi/settings.global.json parses as valid JSON (jq)" "invalid JSON"
  fi
  parse_ok=1
fi

if [[ $parse_ok -eq 0 ]]; then
  test_fail "JSON parsing check" "no parser available (node, python3, jq)"
fi

test_summary
