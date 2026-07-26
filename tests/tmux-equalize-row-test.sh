#!/usr/bin/env bash
# tests/tmux-equalize-row-test.sh - Regression tests for targeted row equalization
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=tests/lib/assert.sh
source "$REPO_ROOT/tests/lib/assert.sh"

stub_dir=$(mktemp -d)
trap 'rm -rf "$stub_dir"' EXIT
call_log="$stub_dir/calls.log"

cat >"$stub_dir/tmux" <<'STUB'
#!/usr/bin/env bash
printf '%q ' "$@" >>"$TMUX_CALL_LOG"
printf '\n' >>"$TMUX_CALL_LOG"

command=$1
shift
case "$command $*" in
  "display-message -p -t %8 #{window_id}") echo '@2' ;;
  "display-message -p -t %8 #{pane_top}") echo '0' ;;
  "list-panes -t @2 -F #{pane_id} #{pane_top} #{pane_width}") printf '%%8 0 60\n%%9 0 40\n%%10 12 100\n' ;;
  resize-pane*) ;;
  *) echo "unexpected tmux call: $command $*" >&2; exit 1 ;;
esac
STUB
chmod +x "$stub_dir/tmux"
export PATH="$stub_dir:$PATH"
export TMUX_CALL_LOG="$call_log"

if bash "$REPO_ROOT/profile/tmux-equalize-row.sh" 2>/dev/null; then
  test_fail "pane target is required" "script succeeded without target"
else
  test_pass "pane target is required"
fi

: >"$call_log"
bash "$REPO_ROOT/profile/tmux-equalize-row.sh" '%8'
calls=$(<"$call_log")
assert_contains "owning window is resolved from selected pane" "$calls" "display-message -p -t %8"
assert_contains "pane query targets owning window" "$calls" "list-panes -t @2"
assert_contains "first selected-row pane is resized" "$calls" "resize-pane -t %8 -x 50"
assert_contains "second selected-row pane is resized" "$calls" "resize-pane -t %9 -x 50"
assert_not_match "different-row pane is untouched" "resize-pane -t %10" "$calls"
assert_not_match "whole window layout is untouched" "select-layout" "$calls"

binding=$(grep 'bind H' "$REPO_ROOT/profile/.tmux.conf")
assert_contains "binding passes pane_id argument" "$binding" '#{pane_id}'

test_summary
