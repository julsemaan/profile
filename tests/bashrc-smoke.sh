#!/usr/bin/env bash
# tests/bashrc-smoke.sh - Lightweight regression tests for jprofile bashrc fragments
# shellcheck disable=SC2016
#
# Run: bash tests/bashrc-smoke.sh
# Or:  BASHRC_FRAGMENTS_DIR=/path/to/bashrc.d bash tests/bashrc-smoke.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Where to find the bashrc fragments (default: repo profile/bashrc.d/)
# shellcheck disable=SC2034
FRAGMENTS_DIR="${BASHRC_FRAGMENTS_DIR:-$REPO_ROOT/profile/bashrc.d}"

# Where the loader script lives (default: repo profile/.bashrc_append)
LOADER="${BASHRC_LOADER:-$REPO_ROOT/profile/.bashrc_append}"

# Where test stubs live
FIXTURES_DIR="$SCRIPT_DIR/fixtures/bin"

# Source assert helpers
# shellcheck source=tests/lib/assert.sh
source "$SCRIPT_DIR/lib/assert.sh"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Run a command in an interactive bash shell with a clean HOME.
# Usage: _run_interactive <path_prefix> <code>
# <path_prefix> is prepended to PATH (optional, pass "" for no prefix).
# <code> is the bash code to run.
# Prints stdout; returns exit code.
function _run_interactive {
  local path_prefix="$1"
  shift
  local code="$*"
  local _tmp_home
  _tmp_home="$(mktemp -d)"
  local _path_export=""
  if [ -n "$path_prefix" ]; then
    _path_export="export PATH=\"$path_prefix:\$PATH\";"
  fi
  HOME="$_tmp_home" bash -i -c "${_path_export}${code}" 2>/dev/null
  local rc=$?
  rm -rf "$_tmp_home"
  return $rc
}

# Run gcoto-model with tty-backed single-key input.
# Usage: _run_gcoto_model_tty <input_bytes>
function _run_gcoto_model_tty {
  local input_bytes="$1"
  local _tmp_home
  _tmp_home="$(mktemp -d)"
  printf 'source %q\n' "$LOADER" >"$_tmp_home/.bashrc"

  local output
  output=$(printf '%s' "$input_bytes" | script -qfec \
    "env HOME=$_tmp_home bash -i -c 'gcoto-model; rc=\$?; printf \"__RC=%s__\\n\" \"\$rc\"; printf \"__MODEL=%s__\\n\" \"\${_GCOTO_MODEL:-<unset>}\"'" \
    /dev/null 2>/dev/null)
  local rc=$?

  rm -rf "$_tmp_home"
  printf '%s' "$output"
  return $rc
}

# ---------------------------------------------------------------------------
# Scenario 1 - Minimal environment (no optional tools)
# ---------------------------------------------------------------------------
echo "=== Scenario 1: Minimal environment (no optional tools on PATH) ==="

_result=$(_run_interactive "" '
  echo "source '"$LOADER"'" > "$HOME/.bashrc"
  source "$HOME/.bashrc"
  echo "__PROFILE_SOURCED_OK__"
')
assert_match "sourcing succeeds with no tools" "__PROFILE_SOURCED_OK__" "$_result"

# ---------------------------------------------------------------------------
# Scenario 2 - Stubbed optional tools
# ---------------------------------------------------------------------------
echo ""
echo "=== Scenario 2: Stubbed optional tools present ==="

_result=$(_run_interactive "$FIXTURES_DIR" '
  echo "source '"$LOADER"'" > "$HOME/.bashrc"
  source "$HOME/.bashrc"
  echo "__PROFILE_SOURCED_OK__"

  # Check key functions exist
  declare -F jprofile_prompt_hook >/dev/null && echo "__FN_jprofile_prompt_hook__"
  declare -F parse_git_branch >/dev/null && echo "__FN_parse_git_branch__"
  declare -F parse_git_dirty >/dev/null && echo "__FN_parse_git_dirty__"
  declare -F trigger-bashrc-reload >/dev/null && echo "__FN_trigger_bashrc_reload__"
  declare -F gchjira >/dev/null && echo "__FN_gchjira__"
  declare -F gom >/dev/null && echo "__FN_gom__"
  declare -F gtagpush >/dev/null && echo "__FN_gtagpush__"
  declare -F gcoto >/dev/null && echo "__FN_gcoto__"
  declare -F gcoto-model >/dev/null && echo "__FN_gcoto_model__"
  declare -F gacp >/dev/null && echo "__FN_gacp__"
  declare -F gcoto-commit-with-model >/dev/null && echo "__FN_gcoto_commit_with_model__"
  declare -F gcoto-openai >/dev/null && echo "__FN_gcoto_openai__"
  declare -F gcoto-deepseek >/dev/null && echo "__FN_gcoto_deepseek__"
  declare -F gcoto-free >/dev/null && echo "__FN_gcoto_free__"
  declare -F add_alias >/dev/null && echo "__FN_add_alias__"
  declare -F jprofile_path_prepend >/dev/null && echo "__FN_jprofile_path_prepend__"

  # Check key aliases
  alias gpush >/dev/null 2>&1 && echo "__AL_gpush__"
  alias gs >/dev/null 2>&1 && echo "__AL_gs__"
  alias grh >/dev/null 2>&1 && echo "__AL_grh__"
  alias gfo >/dev/null 2>&1 && echo "__AL_gfo__"
  alias gpoh >/dev/null 2>&1 && echo "__AL_gpoh__"
  alias ll >/dev/null 2>&1 && echo "__AL_ll__"
  alias rm >/dev/null 2>&1 && echo "__AL_rm__"
  alias sbrc >/dev/null 2>&1 && echo "__AL_sbrc__"
  alias rbrc-all >/dev/null 2>&1 && echo "__AL_rbrc_all__"
  alias qco >/dev/null 2>&1 && echo "__AL_qco__"
  alias qpush >/dev/null 2>&1 && echo "__AL_qpush__"
  alias k >/dev/null 2>&1 && echo "__AL_k__"
')

assert_match "sourcing with stubs succeeds" "__PROFILE_SOURCED_OK__" "$_result"
assert_match "jprofile_prompt_hook exists" "__FN_jprofile_prompt_hook__" "$_result"
assert_match "parse_git_branch exists" "__FN_parse_git_branch__" "$_result"
assert_match "parse_git_dirty exists" "__FN_parse_git_dirty__" "$_result"
assert_match "trigger-bashrc-reload exists" "__FN_trigger_bashrc_reload__" "$_result"
assert_match "gchjira exists" "__FN_gchjira__" "$_result"
assert_match "gom exists" "__FN_gom__" "$_result"
assert_match "gtagpush exists" "__FN_gtagpush__" "$_result"
assert_match "gcoto exists" "__FN_gcoto__" "$_result"
assert_match "gcoto-model exists" "__FN_gcoto_model__" "$_result"
assert_match "gacp exists" "__FN_gacp__" "$_result"
assert_match "gcoto-commit-with-model exists" "__FN_gcoto_commit_with_model__" "$_result"
assert_match "gcoto-openai exists" "__FN_gcoto_openai__" "$_result"
assert_match "gcoto-deepseek exists" "__FN_gcoto_deepseek__" "$_result"
assert_match "gcoto-free exists" "__FN_gcoto_free__" "$_result"
assert_match "add_alias exists" "__FN_add_alias__" "$_result"
assert_match "jprofile_path_prepend exists" "__FN_jprofile_path_prepend__" "$_result"

assert_match "gpush alias" "__AL_gpush__" "$_result"
assert_match "gs alias" "__AL_gs__" "$_result"
assert_match "grh alias" "__AL_grh__" "$_result"
assert_match "gfo alias" "__AL_gfo__" "$_result"
assert_match "gpoh alias" "__AL_gpoh__" "$_result"
assert_match "ll alias" "__AL_ll__" "$_result"
assert_match "rm alias" "__AL_rm__" "$_result"
assert_match "sbrc alias" "__AL_sbrc__" "$_result"
assert_match "rbrc-all alias" "__AL_rbrc_all__" "$_result"
assert_match "qco alias" "__AL_qco__" "$_result"
assert_match "qpush alias" "__AL_qpush__" "$_result"
assert_match "k alias (with kubectl stub)" "__AL_k__" "$_result"

# ---------------------------------------------------------------------------
# Scenario 3 - Repeated source does not duplicate PROMPT_COMMAND hook
# ---------------------------------------------------------------------------
echo ""
echo "=== Scenario 3: Repeated source does not duplicate PROMPT_COMMAND ==="

_result=$(_run_interactive "" '
  echo "source '"$LOADER"'" > "$HOME/.bashrc"
  source "$HOME/.bashrc"
  source "$HOME/.bashrc"
  source "$HOME/.bashrc"

  count=$(printf "%s" "$PROMPT_COMMAND" | grep -o "jprofile_prompt_hook" | wc -l)
  echo "HOOK_COUNT=$count"

  mkdir -p "$HOME/bin"
  jprofile_path_prepend "$HOME/bin"
  jprofile_path_prepend "$HOME/bin"
  path_count=$(printf "%s" "$PATH" | tr : "\n" | grep -c "^$HOME/bin$")
  echo "PATH_COUNT=$path_count"
')

assert_match "single hook after re-source" "HOOK_COUNT=1" "$_result"
assert_match "path prepend is idempotent" "PATH_COUNT=1" "$_result"

# ---------------------------------------------------------------------------
# Scenario 4 - Helper command sanity
# ---------------------------------------------------------------------------
echo ""
echo "=== Scenario 4: Helper command sanity ==="

# Test gchjira error paths
_result=$(_run_interactive "" '
  echo "source '"$LOADER"'" > "$HOME/.bashrc"
  source "$HOME/.bashrc"

  # No args -> usage error
  if gchjira 2>&1; then
    echo "GCHJIRA_NO_ARGS_FAIL"
  else
    echo "GCHJIRA_NO_ARGS_OK"
  fi

  # Invalid URL -> extraction error
  if gchjira "not-a-jira-url" 2>&1; then
    echo "GCHJIRA_INVALID_FAIL"
  else
    echo "GCHJIRA_INVALID_OK"
  fi

  # Missing JIRA key in URL
  if gchjira "https://example.com/browse/" 2>&1; then
    echo "GCHJIRA_EMPTY_KEY_FAIL"
  else
    echo "GCHJIRA_EMPTY_KEY_OK"
  fi

  # Test gtagpush usage
  if gtagpush 2>&1; then
    echo "GTAGPUSH_NO_ARGS_FAIL"
  else
    echo "GTAGPUSH_NO_ARGS_OK"
  fi
')

assert_match "gchjira no-args returns error" "GCHJIRA_NO_ARGS_OK" "$_result"
assert_match "gchjira invalid URL returns error" "GCHJIRA_INVALID_OK" "$_result"
assert_match "gchjira empty key returns error" "GCHJIRA_EMPTY_KEY_OK" "$_result"
assert_match "gtagpush no-args returns error" "GTAGPUSH_NO_ARGS_OK" "$_result"

# Test gom error path (no git repo)
_result=$(_run_interactive "" '
  echo "source '"$LOADER"'" > "$HOME/.bashrc"
  source "$HOME/.bashrc"
  if cd /tmp && gom 2>&1; then
    echo "GOM_NO_GIT_FAIL"
  else
    echo "GOM_NO_GIT_OK"
  fi
')
assert_match "gom outside git repo returns error" "GOM_NO_GIT_OK" "$_result"

# Test gch picker propagates fzf failures in non-interactive contexts
_result=$(_run_interactive "" '
  echo "source '"$LOADER"'" > "$HOME/.bashrc"
  source "$HOME/.bashrc"
  if gch 2>&1; then
    echo "GCH_PICKER_FAIL"
  else
    echo "GCH_PICKER_OK"
  fi
')
assert_match "gch picker failure returns error" "GCH_PICKER_OK" "$_result"

# Test genCommitMsg refuses to run without staged changes before invoking an agent
_result=$(_run_interactive "" '
  echo "source '"$LOADER"'" > "$HOME/.bashrc"
  source "$HOME/.bashrc"
  mkdir "$HOME/repo"
  cd "$HOME/repo" || exit 1
  git init >/dev/null 2>&1
  if genCommitMsg openai-codex/gpt-5.4-mini 2>&1; then
    echo "GEN_NO_STAGED_FAIL"
  else
    echo "GEN_NO_STAGED_OK"
  fi
')
assert_match "genCommitMsg without staged changes returns error" "GEN_NO_STAGED_OK" "$_result"

# Test klogs_deploy usage
_result=$(_run_interactive "$FIXTURES_DIR" '
  echo "source '"$LOADER"'" > "$HOME/.bashrc"
  source "$HOME/.bashrc"
  if klogs_deploy 2>&1; then
    echo "KDEPLOY_NO_ARGS_FAIL"
  else
    echo "KDEPLOY_NO_ARGS_OK"
  fi
')
assert_match "klogs_deploy no-args returns error" "KDEPLOY_NO_ARGS_OK" "$_result"

# ---------------------------------------------------------------------------
# Scenario 5 - gcoto-model interactive tty selection
# ---------------------------------------------------------------------------
echo ""
echo "=== Scenario 5: gcoto-model tty single-key selection ==="

_result=$(_run_gcoto_model_tty '1')
assert_match "gcoto-model selects openai on single keypress" "__MODEL=openai-codex/gpt-5.4-mini__" "$_result"
assert_match "gcoto-model interactive success exits zero" "__RC=0__" "$_result"

_result=$(_run_gcoto_model_tty 'x2')
assert_match "gcoto-model invalid key reports error" "Invalid choice" "$_result"
assert_match "gcoto-model retries until valid key" "__MODEL=deepseek/deepseek-v4-flash__" "$_result"
assert_match "gcoto-model invalid then valid exits zero" "__RC=0__" "$_result"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
test_summary
