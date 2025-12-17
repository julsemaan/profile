session_root src/

if initialize_session "kubex"; then

  new_window "dad"
  run_cmd "cd automation-director"
  split_v 1
  run_cmd "cd automation-director"

  new_window "operator"
  run_cmd "cd automation-operator"
  split_v 1
  run_cmd "cd automation-operator"

  new_window "charts"
  run_cmd "cd densify-dev-helm-charts"
  split_v 1
  run_cmd "cd densify-dev-helm-charts"

  new_window "arch"
  run_cmd "cd architecture"
  split_v 1
  run_cmd "cd architecture"

  select_window 1
  select_pane 1
fi

finalize_and_go_to_session
