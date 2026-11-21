#!/usr/bin/env bash
# tests/pi-config-test.sh - Regression test for Pi settings deployment
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=tests/lib/assert.sh
source "$SCRIPT_DIR/lib/assert.sh"

settings_json="$REPO_ROOT/.pi/settings.json"
models_json="$REPO_ROOT/.pi/models.json"
mcp_json="$REPO_ROOT/.pi/mcp.json"
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

for pkg in "npm:pi-web-access" "npm:@earendil-works/pi-tui" "npm:pi-mcp-adapter" "npm:agent-status-pi@0.1.33" "npm:pi-claude-bridge" "https://github.com/DietrichGebert/ponytail@v4.7.0"; do
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

# 7. mcp.json uses portable token headers and disables GitHub write-form deferral
if command -v node >/dev/null 2>&1; then
  if node -e "const c=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); const g=c.mcpServers?.github; if(g?.headers?.['X-MCP-Features']!=='mcp_apps_disable_form_deferral'||g.headers.Authorization!=='Bearer \$env:GH_MCP_TOKEN'||'auth' in g||'bearerTokenEnv' in g) process.exit(1)" "$mcp_json" 2>/dev/null; then
    test_pass ".pi/mcp.json uses compatible GitHub auth and feature headers (node)"
  else
    test_fail ".pi/mcp.json uses compatible GitHub auth and feature headers (node)" "invalid JSON or incompatible GitHub auth or headers"
  fi
elif command -v python3 >/dev/null 2>&1; then
  if python3 -c "import json,sys; c=json.load(open(sys.argv[1])); g=c['mcpServers']['github']; assert g['headers']['X-MCP-Features'] == 'mcp_apps_disable_form_deferral'; assert g['headers']['Authorization'] == 'Bearer \$env:GH_MCP_TOKEN'; assert 'auth' not in g and 'bearerTokenEnv' not in g" "$mcp_json" 2>/dev/null; then
    test_pass ".pi/mcp.json uses compatible GitHub auth and feature headers (python3)"
  else
    test_fail ".pi/mcp.json uses compatible GitHub auth and feature headers (python3)" "invalid JSON or incompatible GitHub auth or headers"
  fi
elif command -v jq >/dev/null 2>&1; then
  if jq -e '.mcpServers.github | .headers["X-MCP-Features"] == "mcp_apps_disable_form_deferral" and .headers.Authorization == "Bearer $env:GH_MCP_TOKEN" and (has("auth") | not) and (has("bearerTokenEnv") | not)' "$mcp_json" >/dev/null 2>&1; then
    test_pass ".pi/mcp.json uses compatible GitHub auth and feature headers (jq)"
  else
    test_fail ".pi/mcp.json uses compatible GitHub auth and feature headers (jq)" "invalid JSON or incompatible GitHub auth or headers"
  fi
else
  test_fail "mcp.json GitHub header check" "no parser available (node, python3, jq)"
fi

# 8. Headless browser: the MCP entry and the image browsers must stay paired
if grep -q '"command": "playwright-mcp"' "$mcp_json" && grep -q '"--headless"' "$mcp_json" && grep -q '"--browser"' "$mcp_json"; then
  test_pass ".pi/mcp.json runs the Playwright MCP headless"
else
  test_fail ".pi/mcp.json runs the Playwright MCP headless" "playwright entry missing headless/browser flags"
fi

if grep -q 'npm i -g "@playwright/mcp' "$REPO_ROOT/code-sandbox/Dockerfile" &&
  grep -q 'PLAYWRIGHT_BROWSERS_PATH' "$REPO_ROOT/code-sandbox/Dockerfile" &&
  grep -q 'install-browser .*chromium' "$REPO_ROOT/code-sandbox/Dockerfile"; then
  test_pass "code-sandbox image installs Playwright browsers"
else
  test_fail "code-sandbox image installs Playwright browsers" "missing playwright install in code-sandbox/Dockerfile"
fi

# Exercise just the installer function against a fake host, without provisioning this machine.
apparmor_test_root="$(mktemp -d)"
trap 'rm -rf "$apparmor_test_root"' EXIT
mkdir -p "$apparmor_test_root/bin" "$apparmor_test_root/etc/apparmor.d/abi" "$apparmor_test_root/sys/module/apparmor/parameters"
printf 'Y\n' >"$apparmor_test_root/sys/module/apparmor/parameters/enabled"
printf '# ABI placeholder\n' >"$apparmor_test_root/etc/apparmor.d/abi/4.0"
cat >"$apparmor_test_root/bin/install" <<'STUB'
#!/bin/bash
set -eu
printf '%s\n' "$@" >>"$APPARMOR_INSTALL_LOG"
cp "${@: -2}"
STUB
cat >"$apparmor_test_root/bin/apparmor_parser" <<'STUB'
#!/bin/bash
printf '%s\n' "$@" >>"$APPARMOR_PARSER_LOG"
exit "${APPARMOR_PARSER_EXIT:-0}"
STUB
chmod +x "$apparmor_test_root/bin/"*
# Rewrite only host paths in the extracted function so the checks and writes stay in the fixture.
# shellcheck disable=SC1090
source <(awk -v root="$apparmor_test_root" '
  /^function install_pi_buildkit_apparmor / { emit=1 }
  emit { gsub(/\/etc\/apparmor\.d/, root "/etc/apparmor.d"); gsub(/\/sys\//, root "/sys/"); print }
  emit && /^}/ { exit }
' "$install_file")
function run_apparmor_install {
  PATH="$apparmor_test_root/bin:$PATH" \
    APPARMOR_INSTALL_LOG="$apparmor_test_root/install.log" \
    APPARMOR_PARSER_LOG="$apparmor_test_root/parser.log" \
    install_pi_buildkit_apparmor "$REPO_ROOT"
}
assert_success "enabled AppArmor 4 installs and loads BuildKit policy" run_apparmor_install
assert_success "installed AppArmor policy matches repository" cmp "$REPO_ROOT/profile/apparmor/pi-buildkit" "$apparmor_test_root/etc/apparmor.d/pi-buildkit"
assert_contains "policy installation sets root ownership and read permissions" "$(<"$apparmor_test_root/install.log")" $'-o\nroot\n-g\nroot\n-m\n0644'
assert_contains "policy is loaded without restarting AppArmor" "$(<"$apparmor_test_root/parser.log")" $'-r\n'
APPARMOR_PARSER_EXIT=1 assert_fail "policy load failure is reported" run_apparmor_install
rm -f "$apparmor_test_root/install.log" "$apparmor_test_root/parser.log"
printf 'N\n' >"$apparmor_test_root/sys/module/apparmor/parameters/enabled"
assert_success "disabled AppArmor skips policy setup" run_apparmor_install
if [[ ! -e "$apparmor_test_root/install.log" && ! -e "$apparmor_test_root/parser.log" ]]; then
  test_pass "disabled AppArmor does not install or load a policy"
else
  test_fail "disabled AppArmor does not install or load a policy" "unexpected command"
fi
printf 'Y\n' >"$apparmor_test_root/sys/module/apparmor/parameters/enabled"
rm "$apparmor_test_root/etc/apparmor.d/abi/4.0"
assert_success "older AppArmor skips policy setup" run_apparmor_install
if [[ ! -e "$apparmor_test_root/install.log" && ! -e "$apparmor_test_root/parser.log" ]]; then
  test_pass "older AppArmor does not install or load a policy"
else
  test_fail "older AppArmor does not install or load a policy" "unexpected command"
fi
assert_contains "profile install invokes policy deployment" "$(<"$install_file")" "install_pi_buildkit_apparmor \"\$d\""

test_summary
