session_root src/

if initialize_session "kubex"; then
  session_root src/automation-operator
  new_window "operator"
  run_cmd "nvim"
  split_v 1
  run_cmd "devbox shell"
  split_h 50
  run_cmd "devbox shell"
  select_pane 1
  split_h 25
  run_cmd "codex"

  session_root src/automation-director
  new_window "dad"
  run_cmd "nvim"
  split_v 1
  split_h 50
  select_pane 1
  split_h 25
  run_cmd "codex"

  session_root src/charts
  new_window "dad"
  run_cmd "nvim"
  split_v 1
  split_h 50
  select_pane 1
  split_h 25
  run_cmd "codex"

  session_root src/architecture
  new_window "arch"
  run_cmd "nvim"
  split_v 1
  split_h 50
  select_pane 1
  split_h 25
  run_cmd "codex"

  select_window 1
  select_pane 1
fi
