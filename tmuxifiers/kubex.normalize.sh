#!/usr/bin/env bash

set -eu

session="$1"

if [ "$(tmux show-options -v -t "$session" @kubex-normalized 2>/dev/null || true)" = "1" ]; then
  exit 0
fi

current_window="$(tmux display-message -p -t "$session" '#{window_name}')"

# With `window-size latest`, non-active windows do not pick up the attached
# client size until they are first selected.
tmux select-window -t "$session:controller"
tmux select-window -t "$session:charts"
tmux select-window -t "$session:reviews"
tmux select-window -t "$session:$current_window"

resize_window() {
  local window_name="$1"
  local height width bottom_height top_right_width bottom_right_width
  local top_right_pane bottom_left_pane bottom_right_pane
  local pane_id pane_top pane_left

  height="$(tmux display-message -p -t "$session:$window_name" '#{window_height}')"
  width="$(tmux display-message -p -t "$session:$window_name" '#{window_width}')"

  bottom_height=$((height * 25 / 100))
  top_right_width=$((width * 30 / 100))
  bottom_right_width=$((width * 50 / 100))

  [ "$bottom_height" -lt 1 ] && bottom_height=1
  [ "$top_right_width" -lt 1 ] && top_right_width=1
  [ "$bottom_right_width" -lt 1 ] && bottom_right_width=1

  while IFS=' ' read -r pane_id pane_top pane_left; do
    if [ "$pane_top" -eq 0 ] && [ "$pane_left" -gt 0 ]; then
      top_right_pane="$pane_id"
    elif [ "$pane_top" -gt 0 ] && [ "$pane_left" -eq 0 ]; then
      bottom_left_pane="$pane_id"
    elif [ "$pane_top" -gt 0 ] && [ "$pane_left" -gt 0 ]; then
      bottom_right_pane="$pane_id"
    fi
  done < <(tmux list-panes -t "$session:$window_name" -F '#{pane_id} #{pane_top} #{pane_left}')

  tmux resize-pane -t "$bottom_left_pane" -y "$bottom_height"
  tmux resize-pane -t "$top_right_pane" -x "$top_right_width"
  tmux resize-pane -t "$bottom_right_pane" -x "$bottom_right_width"
}

resize_window controller
resize_window charts

tmux set-option -t "$session" -q @kubex-normalized 1
