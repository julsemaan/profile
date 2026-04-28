#!/usr/bin/env bash

set -eu

session="$1"

if [ "$(tmux show-options -v -t "$session" @normalized 2>/dev/null || true)" = "1" ]; then
  exit 0
fi

windows="$(tmux show-options -v -t "$session" @normalize-windows 2>/dev/null || true)"
if [ -z "$windows" ]; then
  exit 0
fi

layout_to_ops() {
  awk '
    function first_leaf(csv, parts) {
      split(csv, parts, ",")
      return parts[1]
    }

    function parse_number(  start) {
      start = pos
      while (substr(layout, pos, 1) ~ /[0-9]/) {
        pos++
      }
      return substr(layout, start, pos - start)
    }

    function expect(char) {
      if (substr(layout, pos, 1) != char) {
        exit 1
      }
      pos++
    }

    function parse_node(  width, height, branch, close_char, id, child_count, child_id, i) {
      width = parse_number()
      expect("x")
      height = parse_number()
      expect(",")
      parse_number()
      expect(",")
      parse_number()

      branch = substr(layout, pos, 1)
      if (branch == "[" || branch == "{") {
        pos++
        id = ++node_count
        node_width[id] = width
        node_height[id] = height
        node_branch[id] = branch
        child_count = 0
        close_char = branch == "[" ? "]" : "}"

        while (1) {
          child_id = parse_node()
          child_count++
          node_child[id, child_count] = child_id
          node_child_count[id] = child_count

          if (child_count == 1) {
            node_leaves[id] = node_leaves[child_id]
          } else {
            node_leaves[id] = node_leaves[id] "," node_leaves[child_id]
          }

          if (substr(layout, pos, 1) == ",") {
            pos++
            continue
          }

          expect(close_char)
          break
        }

        return id
      }

      expect(",")
      id = ++node_count
      node_width[id] = width
      node_height[id] = height
      node_leaves[id] = parse_number()
      return id
    }

    function emit_node(id,  total_dim) {
      if (!(id in node_branch)) {
        return
      }

      total_dim = node_branch[id] == "[" ? node_height[id] : node_width[id]
      emit_group(id, 1, node_child_count[id], total_dim)
    }

    function emit_group(parent_id, start_idx, end_idx, total_dim,   prefix_id, prefix_dim, rest_dim, rest_leaves, target_leaf, axis, i) {
      if (start_idx > end_idx) {
        return
      }

      if (start_idx == end_idx) {
        emit_node(node_child[parent_id, start_idx])
        return
      }

      prefix_id = node_child[parent_id, start_idx]
      prefix_dim = node_branch[parent_id] == "[" ? node_height[prefix_id] : node_width[prefix_id]
      rest_leaves = ""

      for (i = start_idx + 1; i <= end_idx; i++) {
        if (rest_leaves == "") {
          rest_leaves = node_leaves[node_child[parent_id, i]]
        } else {
          rest_leaves = rest_leaves "," node_leaves[node_child[parent_id, i]]
        }
      }

      target_leaf = first_leaf(node_leaves[prefix_id])
      axis = node_branch[parent_id] == "[" ? "y" : "x"
      print axis "|" prefix_dim "|" total_dim "|" node_leaves[prefix_id] "|" rest_leaves "|" target_leaf

      emit_node(prefix_id)

      rest_dim = total_dim - prefix_dim - 1
      emit_group(parent_id, start_idx + 1, end_idx, rest_dim)
    }

    BEGIN {
      layout = ENVIRON["LAYOUT_STRING"]
      sub(/^[^,]+,/, "", layout)
      pos = 1
      root_id = parse_node()
      emit_node(root_id)
    }
  '
}

pane_span() {
  local window_name="$1"
  local axis="$2"
  local csv="$3"
  local ids id line pane_id pane_top pane_left pane_width pane_height
  local min max start end

  IFS=',' read -r -a ids <<< "$csv"
  min=
  max=

  while IFS= read -r line; do
    set -- $line
    pane_id="$1"
    pane_top="$2"
    pane_left="$3"
    pane_width="$4"
    pane_height="$5"

    for id in "${ids[@]}"; do
      if [ "$pane_id" != "%$id" ]; then
        continue
      fi

      if [ "$axis" = "x" ]; then
        start="$pane_left"
        end=$((pane_left + pane_width))
      else
        start="$pane_top"
        end=$((pane_top + pane_height))
      fi

      if [ -z "$min" ] || [ "$start" -lt "$min" ]; then
        min="$start"
      fi
      if [ -z "$max" ] || [ "$end" -gt "$max" ]; then
        max="$end"
      fi
    done
  done < <(tmux list-panes -t "$session:$window_name" -F '#{pane_id} #{pane_top} #{pane_left} #{pane_width} #{pane_height}')

  echo $((max - min))
}

apply_layout() {
  local window_name="$1"
  local layout="$2"
  local axis numerator denominator left_leaves right_leaves target_leaf all_leaves span size

  while IFS='|' read -r axis numerator denominator left_leaves right_leaves target_leaf; do
    all_leaves="$left_leaves"
    if [ -n "$right_leaves" ]; then
      all_leaves="$all_leaves,$right_leaves"
    fi

    span="$(pane_span "$window_name" "$axis" "$all_leaves")"
    size=$((span * numerator / denominator))
    if [ "$size" -lt 1 ]; then
      size=1
    fi

    tmux resize-pane -t "%$target_leaf" "-$axis" "$size"
  done < <(LAYOUT_STRING="$layout" layout_to_ops)
}

current_window="$(tmux display-message -p -t "$session" '#{window_name}')"

IFS=',' read -r -a windows_array <<< "$windows"
for window_name in "${windows_array[@]}"; do
  tmux select-window -t "$session:$window_name"
done
tmux select-window -t "$session:$current_window"

for window_name in "${windows_array[@]}"; do
  layout="$(tmux show-options -w -v -t "$session:$window_name" @normalize-layout 2>/dev/null || true)"
  if [ -n "$layout" ]; then
    apply_layout "$window_name" "$layout"
  fi
done

tmux set-hook -u -t "$session" client-attached
tmux set-option -t "$session" -q @normalized 1
