# Tmuxifier helpers assume the new window is current. Detached creation must
# bypass them and address every command by the returned pane ID.
if [ "${T_WIN_BACKGROUND:-0}" = 1 ]; then
  coding_editor=$(tmuxifier-tmux new-window -d -P -F '#{pane_id}' \
    -t "$session:" -c "$T_WIN_ROOT" \
    -n "${T_WIN_NAME:-$(basename "$T_WIN_ROOT")}") || return 1
  tmuxifier-tmux set-option -t "$coding_editor" allow-rename off || return 1
  tmuxifier-tmux send-keys -t "$coding_editor" -l 'nvim' || return 1
  tmuxifier-tmux send-keys -t "$coding_editor" Enter || return 1
  coding_bottom=$(tmuxifier-tmux split-window -d -P -F '#{pane_id}' \
    -t "$coding_editor" -c "$T_WIN_ROOT" -v -l 25%) || return 1
  tmuxifier-tmux send-keys -t "$coding_bottom" -l 'devbox shell' || return 1
  tmuxifier-tmux send-keys -t "$coding_bottom" Enter || return 1
  coding_right=$(tmuxifier-tmux split-window -d -P -F '#{pane_id}' \
    -t "$coding_bottom" -c "$T_WIN_ROOT" -h -l 50%) || return 1
  tmuxifier-tmux send-keys -t "$coding_right" -l 'devbox shell' || return 1
  tmuxifier-tmux send-keys -t "$coding_right" Enter || return 1
  tmuxifier-tmux split-window -d -P -F '#{pane_id}' \
    -t "$coding_editor" -c "$T_WIN_ROOT" -h -l 50% || return 1
  return 0
fi

# Set window root path. Default is `$session_root`.
# Must be called before `new_window`.
window_root "$T_WIN_ROOT"

# Create new window using an explicit name or the basename of `T_WIN_ROOT`.
new_window "${T_WIN_NAME:-$(basename "$T_WIN_ROOT")}"
run_cmd "nvim"
split_v 25
run_cmd "devbox shell"
split_h 50
run_cmd "devbox shell"
select_pane 1
split_h 50
