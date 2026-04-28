#!/usr/bin/env bash

set -eu

session="$1"

if [ "$(tmux show-options -v -t "$session" @kubex-normalized 2>/dev/null || true)" = "1" ]; then
  exit 0
fi

resize_window() {
  local window_name="$1"
  local height width bottom_height top_right_width bottom_right_width

  height="$(tmux display-message -p -t "$session:$window_name" '#{window_height}')"
  width="$(tmux display-message -p -t "$session:$window_name" '#{window_width}')"

  bottom_height=$((height * 25 / 100))
  top_right_width=$((width * 30 / 100))
  bottom_right_width=$((width * 50 / 100))

  [ "$bottom_height" -lt 1 ] && bottom_height=1
  [ "$top_right_width" -lt 1 ] && top_right_width=1
  [ "$bottom_right_width" -lt 1 ] && bottom_right_width=1

  tmux resize-pane -t "$session:$window_name.2" -y "$bottom_height"
  tmux resize-pane -t "$session:$window_name.4" -x "$top_right_width"
  tmux resize-pane -t "$session:$window_name.3" -x "$bottom_right_width"
}

resize_window controller
resize_window charts

tmux set-option -t "$session" -q @kubex-normalized 1
