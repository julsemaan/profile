#!/usr/bin/env bash
# Isolated server plus a command guard: temporary focus changes fail too.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
SOCKET="$TMP/tmux.sock"
trap 'tmux -S "$SOCKET" kill-server 2>/dev/null || true; rm -rf "$TMP"' EXIT
mkdir -p "$TMP/root with spaces"
tmux -S "$SOCKET" -f /dev/null new-session -d -s source -x 160 -y 50
session="$(tmux -S "$SOCKET" display-message -p -t source '#{session_id}')"
source_window="$(tmux -S "$SOCKET" display-message -p -t source '#{window_id}')"
source_pane="$(tmux -S "$SOCKET" split-window -P -F '#{pane_id}' -t "$source_window")"
function nothing { :; }
# shellcheck source=profile/bashrc.d/10-tmux.bash
source "$ROOT/profile/bashrc.d/10-tmux.bash"

function tmuxifier-tmux {
  local cmd="$1" arg target='' detached=0 previous=''
  for arg in "$@"; do
    [ "$arg" != -d ] || detached=1
    [ "$previous" != -t ] || target="$arg"
    previous="$arg"
  done
  case "$cmd" in
  new-window) [ "$detached" = 1 ] && [ "$target" = "$session:" ] ;;
  split-window) [ "$detached" = 1 ] && [[ "$target" = %* ]] && [ "$target" != "$source_pane" ] ;;
  send-keys | set-option) [[ "$target" = %* ]] && [ "$target" != "$source_pane" ] ;;
  *)
    echo "Unsafe layout command: $*" >&2
    return 1
    ;;
  esac || return 1
  tmux -S "$SOCKET" "$@" || return 1
  [ "$(tmux -S "$SOCKET" display-message -p -t "$session" '#{window_id}')" = "$source_window" ] || return 1
  [ "$(tmux -S "$SOCKET" display-message -p -t "$source_window" '#{pane_id}')" = "$source_pane" ] || return 1
}
function tmuxifier {
  [ "$*" = 'load-window coding' ]
  source "$ROOT/tmuxifiers/coding.window.sh"
}
empty_pane="$(tmux-new-coding --background "$TMP/root with spaces")"
[[ "$empty_pane" = %* ]]
[ "$(tmux -S "$SOCKET" display-message -p -t "$empty_pane" '#{window_name}')" = 'root with spaces' ]
[ "$(tmux -S "$SOCKET" list-panes -t "$empty_pane" -F '#{pane_id}' | wc -l)" -eq 4 ]
tmux -S "$SOCKET" send-keys -t "$empty_pane" "printf reached > '$TMP/received'" Enter
for ((i = 0; i < 50; i++)); do
  [ ! -f "$TMP/received" ] || break
  sleep 0.1
done
[ "$(<"$TMP/received")" = reached ]
[ "$(tmux -S "$SOCKET" display-message -p -t "$empty_pane" '#{pane_current_path}')" = "$TMP/root with spaces" ]
echo 'Background layout command guard, focus, naming, and shell delivery passed'
