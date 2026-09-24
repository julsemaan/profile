#!/usr/bin/env bash
# tests/pi-config-test.sh - Regression test for Pi settings deployment
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=tests/lib/assert.sh
source "$SCRIPT_DIR/lib/assert.sh"

settings_json="$REPO_ROOT/.pi/settings.json"
models_json="$REPO_ROOT/.pi/models.json"
legacy_global_json="$REPO_ROOT/.pi/settings.global.json"
install_file="$REPO_ROOT/install"

# 1. The single settings file exists
if [[ -f "$settings_json" ]]; then
  test_pass ".pi/settings.json exists"
else
  test_fail ".pi/settings.json exists" "file not found: $settings_json"
fi

# 2. The abandoned split file must not come back
if [[ -e "$legacy_global_json" ]]; then
  test_fail ".pi/settings.global.json is removed" "found legacy file: $legacy_global_json"
else
  test_pass ".pi/settings.global.json is removed"
fi

# 3. install deploys .pi/settings.json to ~/.pi/agent/settings.json
if grep -q 'exact_sync_files=.*settings\.json' "$install_file"; then
  test_pass "install syncs settings.json to ~/.pi/agent"
else
  test_fail "install syncs settings.json to ~/.pi/agent" "settings.json not in exact_sync_files"
fi

# 4. Model default and managed packages live in settings.json
if grep -q '"defaultModel": "gpt-6-luna"' "$settings_json"; then
  test_pass ".pi/settings.json defaults to gpt-6-luna"
else
  test_fail ".pi/settings.json defaults to gpt-6-luna" "defaultModel is not gpt-6-luna"
fi

for pkg in "npm:pi-web-access" "npm:@earendil-works/pi-tui" "npm:pi-mcp-adapter" "npm:agent-status-pi" "https://github.com/DietrichGebert/ponytail@v4.7.0"; do
  if grep -qF "$pkg" "$settings_json"; then
    test_pass ".pi/settings.json contains $pkg"
  else
    test_fail ".pi/settings.json contains $pkg" "missing: $pkg"
  fi
done

# 5. settings.json parses as valid JSON
if command -v node >/dev/null 2>&1; then
  if node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" "$settings_json" 2>/dev/null; then
    test_pass ".pi/settings.json parses as valid JSON (node)"
  else
    test_fail ".pi/settings.json parses as valid JSON (node)" "invalid JSON"
  fi
elif command -v python3 >/dev/null 2>&1; then
  if python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$settings_json" 2>/dev/null; then
    test_pass ".pi/settings.json parses as valid JSON (python3)"
  else
    test_fail ".pi/settings.json parses as valid JSON (python3)" "invalid JSON"
  fi
elif command -v jq >/dev/null 2>&1; then
  if jq empty "$settings_json" 2>/dev/null; then
    test_pass ".pi/settings.json parses as valid JSON (jq)"
  else
    test_fail ".pi/settings.json parses as valid JSON (jq)" "invalid JSON"
  fi
else
  test_fail "JSON parsing check" "no parser available (node, python3, jq)"
fi

# 6. models.json parses as JSON and keeps a providers object (pi rejects {})
if command -v node >/dev/null 2>&1; then
  if node -e "const c=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); if(typeof c.providers!=='object'||c.providers===null||Array.isArray(c.providers)) process.exit(1)" "$models_json" 2>/dev/null; then
    test_pass ".pi/models.json has a providers object (node)"
  else
    test_fail ".pi/models.json has a providers object (node)" "missing providers or invalid JSON"
  fi
elif command -v python3 >/dev/null 2>&1; then
  if python3 -c "import json,sys; c=json.load(open(sys.argv[1])); assert isinstance(c.get('providers'), dict)" "$models_json" 2>/dev/null; then
    test_pass ".pi/models.json has a providers object (python3)"
  else
    test_fail ".pi/models.json has a providers object (python3)" "missing providers or invalid JSON"
  fi
elif command -v jq >/dev/null 2>&1; then
  if jq -e '.providers | type == "object"' "$models_json" >/dev/null 2>&1; then
    test_pass ".pi/models.json has a providers object (jq)"
  else
    test_fail ".pi/models.json has a providers object (jq)" "missing providers or invalid JSON"
  fi
else
  test_fail "models.json schema check" "no parser available (node, python3, jq)"
fi

test_summary
