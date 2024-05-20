session_root src/app-platform

if initialize_session "afn"; then

  new_window "app-platform"
  split_v 1

  new_window "tuns"
  split_h 50

  new_window "kpp-services"
  run_cmd "cd ../kpp-services"
  split_v 1
  run_cmd "cd ../kpp-services"

  new_window "cli"
  run_cmd "cd ../kpp-jusemaa-tst"
  split_v 1

  new_window "tilt"
  run_cmd "cd ../kpp-services/src/core/operator"

  select_window 1
  select_pane 1
fi

finalize_and_go_to_session

