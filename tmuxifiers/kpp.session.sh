session_root src/app-platform

source "$(dirname "${BASH_SOURCE[0]}")/normalize.lib.sh"

if initialize_session "kpp"; then

  new_window "app-platform"
  split_v 1
  normalize_track_window app-platform

  new_window "tuns"
  split_h 50
  normalize_track_window tuns

  new_window "kpp-services"
  run_cmd "cd ../kpp-services"
  split_v 1
  run_cmd "cd ../kpp-services"
  normalize_track_window kpp-services

  new_window "cli"
  run_cmd "cd ../kpp-jusemaa-tst"
  split_v 1
  normalize_track_window cli

  new_window "tilt"
  run_cmd "cd ../kpp-services/src/core/operator"
  normalize_track_window tilt

  new_window "wipe"
  run_cmd "cd scripts/"
  normalize_track_window wipe

  normalize_enable

  select_window 1
  select_pane 1
fi

finalize_and_go_to_session
