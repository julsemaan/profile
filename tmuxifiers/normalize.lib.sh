NORMALIZE_SCRIPT="$(dirname "${BASH_SOURCE[0]}")/normalize.sh"
NORMALIZE_WINDOWS=""

normalize_track_window() {
  local window_name="${1:-$window}"
  local layout

  layout="$(tmux display-message -p -t "$session:$window_name" '#{window_layout}')"
  tmux set-option -w -t "$session:$window_name" -q @normalize-layout "$layout"

  case ",$NORMALIZE_WINDOWS," in
    *",$window_name,"*)
      ;;
    *)
      NORMALIZE_WINDOWS="${NORMALIZE_WINDOWS:+$NORMALIZE_WINDOWS,}$window_name"
      ;;
  esac
}

normalize_enable() {
  if [ -z "$NORMALIZE_WINDOWS" ]; then
    return
  fi

  tmux set-option -t "$session" -q @normalize-windows "$NORMALIZE_WINDOWS"
  tmux set-hook -t "$session" client-attached \
    "run-shell 'bash \"$NORMALIZE_SCRIPT\" \"$session\"'"
}
