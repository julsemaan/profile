#!/usr/bin/env bash
# Equalize widths of panes sharing selected pane's top coordinate.
# Usage: tmux-equalize-row.sh pane_id

set -euo pipefail

pane_target="${1:?pane target required}"
window_target=$(tmux display-message -p -t "$pane_target" '#{window_id}')
current_top=$(tmux display-message -p -t "$pane_target" '#{pane_top}')

panes_in_row=()
total_width=0
while IFS=' ' read -r pane_id pane_top pane_width; do
  if [[ "$pane_top" == "$current_top" ]]; then
    panes_in_row+=("$pane_id")
    total_width=$((total_width + pane_width))
  fi
done < <(tmux list-panes -t "$window_target" -F '#{pane_id} #{pane_top} #{pane_width}')

count=${#panes_in_row[@]}
if ((count <= 1)); then
  exit 0
fi

equal_width=$(((total_width + count - 1) / count))
for pane_id in "${panes_in_row[@]}"; do
  tmux resize-pane -t "$pane_id" -x "$equal_width"
done
