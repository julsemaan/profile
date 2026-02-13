# Set window root path. Default is `$session_root`.
# Must be called before `new_window`.
window_root "$T_WIN_ROOT"

# Create new window using the basename of `T_WIN_ROOT`.
new_window "$(basename "$T_WIN_ROOT")"
run_cmd "nvim"
split_v 25
run_cmd "devbox shell"
split_h 50
run_cmd "devbox shell"
select_pane 1
split_h 30
run_cmd "codex-unleashed-safely-src"
