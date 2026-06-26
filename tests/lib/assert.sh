# tests/lib/assert.sh - Minimal assertion helpers for shell smoke tests
# shellcheck disable=SC2148
#
# Provides: assert_success, assert_fail, assert_eq, assert_match, assert_fn_exists,
#           assert_alias_exists, assert_contains, test_pass, test_fail, test_summary

_ASSERT_PASS=0
_ASSERT_FAIL=0

test_pass() {
  printf "  PASS: %s\n" "$1"
  _ASSERT_PASS=$((_ASSERT_PASS + 1))
}

test_fail() {
  printf "  FAIL: %s - %s\n" "$1" "$2"
  _ASSERT_FAIL=$((_ASSERT_FAIL + 1))
}

assert_success() {
  local desc="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    test_pass "$desc"
  else
    test_fail "$desc" "expected success but got exit $?"
  fi
}

assert_fail() {
  local desc="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    test_fail "$desc" "expected failure but succeeded"
  else
    test_pass "$desc"
  fi
}

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [ "$expected" = "$actual" ]; then
    test_pass "$desc"
  else
    test_fail "$desc" "expected='$expected' actual='$actual'"
  fi
}

assert_match() {
  local desc="$1" pattern="$2" actual="$3"
  if printf '%s' "$actual" | grep -qE "$pattern"; then
    test_pass "$desc"
  else
    test_fail "$desc" "pattern '$pattern' not found in '$actual'"
  fi
}

assert_fn_exists() {
  local desc="$1" fn="$2"
  if declare -F "$fn" >/dev/null 2>&1; then
    test_pass "$desc"
  else
    test_fail "$desc" "function '$fn' not defined"
  fi
}

assert_alias_exists() {
  local desc="$1" name="$2"
  if alias "$name" >/dev/null 2>&1; then
    test_pass "$desc"
  else
    test_fail "$desc" "alias '$name' not defined"
  fi
}

assert_contains() {
  local desc="$1" haystack="$2" needle="$3"
  case "$haystack" in
  *"$needle"*) test_pass "$desc" ;;
  *) test_fail "$desc" "'$needle' not found in output" ;;
  esac
}

test_summary() {
  local total=$((_ASSERT_PASS + _ASSERT_FAIL))
  printf "\n=== Results: %d passed, %d failed, %d total ===\n" \
    "$_ASSERT_PASS" "$_ASSERT_FAIL" "$total"
  if [ "$_ASSERT_FAIL" -gt 0 ]; then
    return 1
  fi
  return 0
}
