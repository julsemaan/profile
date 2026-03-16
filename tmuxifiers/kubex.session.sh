session_root src/

V_SPLIT=25
TOP_H_SPLIT=30
BOTTOM_H_SPLIT=50

if initialize_session "kubex"; then
  session_root src/automation-controller
  new_window "controller"
  run_cmd "nvim"
  split_v $V_SPLIT
  run_cmd "devbox shell"
  split_h $BOTTOM_H_SPLIT
  run_cmd "devbox shell"
  select_pane 1
  split_h $TOP_H_SPLIT
  run_cmd "codex-unleashed-safely-src"

  session_root src/automation-director
  new_window "dad"
  run_cmd "nvim"
  split_v $V_SPLIT
  split_h $BOTTOM_H_SPLIT
  select_pane 1
  split_h $TOP_H_SPLIT
  run_cmd "codex-unleashed-safely-src"

  session_root src/densify-dev-helm-charts
  new_window "charts"
  run_cmd "nvim"
  split_v $V_SPLIT
  split_h $BOTTOM_H_SPLIT
  select_pane 1
  split_h $TOP_H_SPLIT
  run_cmd "codex-unleashed-safely-src"

  session_root src/architecture
  new_window "arch"
  run_cmd "nvim"
  split_v $V_SPLIT
  split_h $BOTTOM_H_SPLIT
  select_pane 1
  split_h $TOP_H_SPLIT
  run_cmd "codex-unleashed-safely-src"

  select_window 1
  select_pane 1
fi

finalize_and_go_to_session
