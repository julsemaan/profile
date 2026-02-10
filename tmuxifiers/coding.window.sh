# Set window root path. Default is `$session_root`.
# Must be called before `new_window`.
window_root "$T_WIN_ROOT"

# Create new window. If no argument is given, window name will be based on
# layout file name.
new_window "coding"
run_cmd "nvim"
split_v 1
run_cmd "devbox shell"
split_h 50
run_cmd "devbox shell"
select_pane 1
split_h 25
run_cmd "codex-unleashed-safely-src"

