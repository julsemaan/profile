#!/usr/bin/env bash
set -u

for dev in /dev/v4l/by-id/*; do
  # Check device exists and supports the control
  if /usr/bin/v4l2-ctl -d "$dev" --list-ctrls 2>/dev/null | grep -q '^ *focus_automatic_continuous '; then
    
    # Extract current value
    current=$(/usr/bin/v4l2-ctl -d "$dev" --list-ctrls 2>/dev/null \
      | awk '/focus_automatic_continuous/ {for(i=1;i<=NF;i++) if($i ~ /^value=/){split($i,a,"="); print a[2]}}')

    if [ "$current" != "0" ]; then
      echo "[$dev] autofocus is $current → disabling"
      /usr/bin/v4l2-ctl -d "$dev" --set-ctrl=focus_automatic_continuous=0 || \
        echo "[$dev] failed to set control"
    else
      echo "[$dev] autofocus already disabled"
    fi
  fi
done
