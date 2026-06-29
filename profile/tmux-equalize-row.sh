#!/usr/bin/env bash
# Equalize width of all panes in the current row (tmux pane with same top coordinate)

set -euo pipefail

# Get current pane ID
current_pane=$(tmux display-message -p '#{pane_id}')

# Get current pane's top (y) coordinate and width
current_top=$(tmux display-message -p -t "$current_pane" '#{pane_top}')
current_width=$(tmux display-message -p -t "$current_pane" '#{pane_width}')
window_width=$(tmux display-message -p '#{window_width}')

# Find all panes in the same row (same pane_top)
# tmux list-panes -F '#{pane_id} #{pane_top} #{pane_width}'
panes_in_row=()
while IFS=' ' read -r pid ptop pwidth; do
    if [[ "$ptop" == "$current_top" ]]; then
        panes_in_row+=("$pid")
    fi
done < <(tmux list-panes -F '#{pane_id} #{pane_top} #{pane_width}')

# Calculate equal width for each pane in this row
count=${#panes_in_row[@]}
if (( count <= 1 )); then
    exit 0
fi

equal_width=$(( window_width / count ))

# Resize each pane in the row
for pid in "${panes_in_row[@]}"; do
    tmux resize-pane -t "$pid" -x "$equal_width"
done