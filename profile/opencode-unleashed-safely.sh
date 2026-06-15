#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

IMAGE="opencode-unleashed-safely:latest"
MNT="$PWD"
WORKDIR="$PWD"
REBUILD=0
USE_TTY=1
SYSTEM_OPENCODE_CONFIG="/usr/local/etc/opencode/opencode.json"
SYSTEM_OPENCODE_TUI_CONFIG="/usr/local/etc/opencode/tui.json"
SYSTEM_OPENCODE_AGENT_DIR="/usr/local/etc/opencode/agent"
SYSTEM_OPENCODE_PLUGIN_DIR="/usr/local/etc/opencode/plugins"

usage() {
  cat <<'USAGE'
Usage: opencode-unleashed-safely.sh [--mount PATH] [--workdir PATH] [--rebuild] [--no-tty] [-- <opencode args...>]

Arguments:
  -m, --mount PATH    Host path to bind-mount into the container.
                      Defaults to the current working directory.
  -w, --workdir PATH  Working directory inside the container.
                      Defaults to the current working directory.
  -r, --rebuild       Rebuild the Docker image before running.
  --no-tty            Disable TTY allocation (useful to avoid carriage returns).
  -h, --help          Show this help text.

Environment:
  OPENCODE_NPM_PACKAGE  NPM package name to install for the CLI.
                        Defaults to "opencode-ai".
  Config install        Copies /usr/local/etc/opencode/opencode.json to
                        ~/.config/opencode/opencode.json before launch,
                        copies /usr/local/etc/opencode/tui.json to
                        ~/.config/opencode/tui.json, copies
                        /usr/local/etc/opencode/agent/*.md to
                        ~/.config/opencode/agent/, and copies
                        /usr/local/etc/opencode/plugins/* to
                        ~/.config/opencode/plugins/.
  Clipboard forwarding  Forwards terminal (TERM/TMUX/etc) and Wayland/X11
                        settings when available for clipboard integration.
  Herdr forwarding      Forwards `HERDR_*` runtime vars when present and
                        bind-mounts `HERDR_SOCKET_PATH` parent dir so
                        container path matches host path.

Examples:
  ./opencode-unleashed-safely.sh
  ./opencode-unleashed-safely.sh --rebuild --mount /home/julien/src
  ./opencode-unleashed-safely.sh --mount /home/julien/src --workdir /home/julien/src/profile
  ./opencode-unleashed-safely.sh -- --help
USAGE
}

OPENCODE_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      OPENCODE_ARGS+=("$@")
      break
      ;;
    -m|--mount)
      if [[ -z "${2:-}" ]]; then
        echo "Error: --mount requires a path argument." >&2
        exit 1
      fi
      MNT="$2"
      shift 2
      ;;
    -w|--workdir)
      if [[ -z "${2:-}" ]]; then
        echo "Error: --workdir requires a path argument." >&2
        exit 1
      fi
      WORKDIR="$2"
      shift 2
      ;;
    -r|--rebuild)
      REBUILD=1
      shift
      ;;
    --no-tty)
      USE_TTY=0
      shift
      ;;
    *)
      OPENCODE_ARGS+=("$1")
      shift
      ;;
  esac
done

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker is required but not found in PATH." >&2
  exit 1
fi

if [[ ! -d "$MNT" ]]; then
  echo "Error: mount path does not exist: $MNT" >&2
  exit 1
fi

if [[ ! -d "$WORKDIR" ]]; then
  echo "Error: workdir path does not exist: $WORKDIR" >&2
  exit 1
fi

# --- Host identity resolution (sudo-safe) ---
RESOLVED_UID=""
RESOLVED_GID=""
RESOLVED_USER=""
RESOLVED_HOME=""

if [[ -n "${SUDO_UID:-}" && -n "${SUDO_GID:-}" && -n "${SUDO_USER:-}" ]]; then
  RESOLVED_UID="$SUDO_UID"
  RESOLVED_GID="$SUDO_GID"
  RESOLVED_USER="$SUDO_USER"
  RESOLVED_HOME="$(getent passwd "$SUDO_USER" 2>/dev/null | cut -d: -f6 || true)"
  if [[ -z "$RESOLVED_HOME" ]]; then
    echo "Error: unable to resolve home directory for sudo user '$SUDO_USER'" >&2
    exit 1
  fi
else
  RESOLVED_UID="$(id -u)"
  RESOLVED_GID="$(id -g)"
  RESOLVED_USER="$(id -un)"
  RESOLVED_HOME="$HOME"
fi

# Safe host-dir creation: mkdir -p + chown if running as root-for-other-user
ensure_host_dir() {
  local dir="$1"
  mkdir -p "$dir"
  if [[ $EUID -eq 0 && "$RESOLVED_UID" != "0" ]]; then
    chown "$RESOLVED_UID:$RESOLVED_GID" "$dir"
  fi
}

HOST_OPENCODE_HOME="$RESOLVED_HOME/.opencode"
HOST_OPENCODE_CONFIG="${XDG_CONFIG_HOME:-$RESOLVED_HOME/.config}/opencode"
HOST_OPENCODE_CACHE="${XDG_CACHE_HOME:-$RESOLVED_HOME/.cache}/opencode"
HOST_OPENCODE_DATA="${XDG_DATA_HOME:-$RESOLVED_HOME/.local/share}/opencode"
HOST_OPENCODE_STATE="${XDG_STATE_HOME:-$RESOLVED_HOME/.local/state}/opencode"
CONTAINER_HOME="$RESOLVED_HOME"
CONTAINER_XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-$CONTAINER_HOME/.config}"
CONTAINER_XDG_CACHE_HOME="${XDG_CACHE_HOME:-$CONTAINER_HOME/.cache}"
CONTAINER_XDG_DATA_HOME="${XDG_DATA_HOME:-$CONTAINER_HOME/.local/share}"
CONTAINER_XDG_STATE_HOME="${XDG_STATE_HOME:-$CONTAINER_HOME/.local/state}"
HOST_OPENCODE_CONFIG_FILE="$HOST_OPENCODE_CONFIG/opencode.json"
HOST_OPENCODE_TUI_CONFIG_FILE="$HOST_OPENCODE_CONFIG/tui.json"
HOST_OPENCODE_AGENT_DIR="$HOST_OPENCODE_CONFIG/agent"
HOST_OPENCODE_PLUGIN_DIR="$HOST_OPENCODE_CONFIG/plugins"

if [[ ! -f "$SYSTEM_OPENCODE_CONFIG" ]]; then
  echo "Error: installed opencode config not found: $SYSTEM_OPENCODE_CONFIG" >&2
  exit 1
fi

ensure_host_dir "$HOST_OPENCODE_HOME"
ensure_host_dir "$HOST_OPENCODE_CONFIG"
ensure_host_dir "$HOST_OPENCODE_CACHE"
ensure_host_dir "$HOST_OPENCODE_DATA"
ensure_host_dir "$HOST_OPENCODE_STATE"
cp "$SYSTEM_OPENCODE_CONFIG" "$HOST_OPENCODE_CONFIG_FILE"

if [[ -f "$SYSTEM_OPENCODE_TUI_CONFIG" ]]; then
  cp "$SYSTEM_OPENCODE_TUI_CONFIG" "$HOST_OPENCODE_TUI_CONFIG_FILE"
fi

if [[ -d "$SYSTEM_OPENCODE_AGENT_DIR" ]]; then
  ensure_host_dir "$HOST_OPENCODE_AGENT_DIR"
  cp "$SYSTEM_OPENCODE_AGENT_DIR"/*.md "$HOST_OPENCODE_AGENT_DIR"/ 2>/dev/null || true
fi

if [[ -d "$SYSTEM_OPENCODE_PLUGIN_DIR" ]]; then
  ensure_host_dir "$HOST_OPENCODE_PLUGIN_DIR"
  cp "$SYSTEM_OPENCODE_PLUGIN_DIR"/* "$HOST_OPENCODE_PLUGIN_DIR"/ 2>/dev/null || true
fi

if [[ $REBUILD -eq 1 ]]; then
  REBUILD_DOCKER_ARG="--no-cache"
else
  REBUILD_DOCKER_ARG=""
fi

OPENCODE_NPM_PACKAGE="${OPENCODE_NPM_PACKAGE:-opencode-ai}"

docker pull julsemaan/code-sandbox-img:latest
docker build $REBUILD_DOCKER_ARG -t "$IMAGE" --build-arg OPENCODE_NPM_PACKAGE="$OPENCODE_NPM_PACKAGE" -f- "$SCRIPT_DIR" <<'EOF'
FROM julsemaan/code-sandbox-img:latest

ARG OPENCODE_NPM_PACKAGE
RUN npm i -g "$OPENCODE_NPM_PACKAGE"

ENV EDITOR=vim

ENTRYPOINT ["opencode"]
EOF

if [[ $USE_TTY -eq 1 ]]; then
  DOCKER_TTY_FLAGS="-it"
  DOCKER_NO_TTY_ENV_FLAGS=""
else
  DOCKER_TTY_FLAGS="-i"
  DOCKER_NO_TTY_ENV_FLAGS="-e NO_COLOR=1 -e TERM=dumb"
fi

TERMINAL_DOCKER_FLAGS=()
TERMINAL_ENV_VARS=(
  TERM
  COLORTERM
  TERM_PROGRAM
  TERM_PROGRAM_VERSION
  TERM_SESSION_ID
  TMUX
  TMUX_PANE
  ZELLIJ
  KITTY_WINDOW_ID
  KITTY_PID
  WEZTERM_PANE
  WEZTERM_UNIX_SOCKET
  WT_SESSION
  VTE_VERSION
  SSH_TTY
)

for var_name in "${TERMINAL_ENV_VARS[@]}"; do
  if [[ "$var_name" == "TERM" && $USE_TTY -eq 0 ]]; then
    continue
  fi

  if [[ -n "${!var_name:-}" ]]; then
    TERMINAL_DOCKER_FLAGS+=(-e "$var_name")
  fi
done

HERDR_DOCKER_FLAGS=()
HERDR_ENV_VARS=(
  HERDR_ENV
  HERDR_SOCKET_PATH
  HERDR_PANE_ID
  HERDR_TAB_ID
  HERDR_WORKSPACE_ID
)

for var_name in "${HERDR_ENV_VARS[@]}"; do
  if [[ -n "${!var_name:-}" ]]; then
    HERDR_DOCKER_FLAGS+=(-e "$var_name")
  fi
done

CLIPBOARD_DOCKER_FLAGS=()
HOME_DOCKER_FLAGS=(--tmpfs "$CONTAINER_HOME:rw,exec,uid=$RESOLVED_UID,gid=$RESOLVED_GID")

if [[ -n "${TMUX:-}" ]]; then
  TMUX_SOCKET_PATH="${TMUX%%,*}"
  if [[ -S "$TMUX_SOCKET_PATH" ]]; then
    TMUX_SOCKET_DIR="$(dirname "$TMUX_SOCKET_PATH")"
    CLIPBOARD_DOCKER_FLAGS+=(-v "$TMUX_SOCKET_DIR:$TMUX_SOCKET_DIR")
  fi
fi

if [[ -n "${HERDR_SOCKET_PATH:-}" ]]; then
  HERDR_SOCKET_DIR="$(dirname "$HERDR_SOCKET_PATH")"
  if [[ -d "$HERDR_SOCKET_DIR" ]]; then
    HERDR_DOCKER_FLAGS+=(-v "$HERDR_SOCKET_DIR:$HERDR_SOCKET_DIR")
  fi
fi

if [[ -n "${DISPLAY:-}" ]]; then
  CLIPBOARD_DOCKER_FLAGS+=(-e DISPLAY)

  if [[ -d /tmp/.X11-unix ]]; then
    CLIPBOARD_DOCKER_FLAGS+=(-v /tmp/.X11-unix:/tmp/.X11-unix)
  fi

  HOST_XAUTHORITY="${XAUTHORITY:-$RESOLVED_HOME/.Xauthority}"
  if [[ -f "$HOST_XAUTHORITY" ]]; then
    CLIPBOARD_DOCKER_FLAGS+=(-e XAUTHORITY="$HOST_XAUTHORITY")
    CLIPBOARD_DOCKER_FLAGS+=(-v "$HOST_XAUTHORITY:$HOST_XAUTHORITY:ro")
  fi
fi

if [[ -n "${WAYLAND_DISPLAY:-}" && -n "${XDG_RUNTIME_DIR:-}" && -S "$XDG_RUNTIME_DIR/$WAYLAND_DISPLAY" ]]; then
  CLIPBOARD_DOCKER_FLAGS+=(-e WAYLAND_DISPLAY)
  CLIPBOARD_DOCKER_FLAGS+=(-e XDG_RUNTIME_DIR)
  CLIPBOARD_DOCKER_FLAGS+=(-v "$XDG_RUNTIME_DIR:$XDG_RUNTIME_DIR")
fi

docker run --rm $DOCKER_TTY_FLAGS \
  $DOCKER_NO_TTY_ENV_FLAGS \
  "${TERMINAL_DOCKER_FLAGS[@]}" \
  "${CLIPBOARD_DOCKER_FLAGS[@]}" \
  "${HERDR_DOCKER_FLAGS[@]}" \
  "${HOME_DOCKER_FLAGS[@]}" \
  -e OPENAI_API_KEY \
  -e ANTHROPIC_API_KEY \
  -e BB_MCP_TOKEN \
  -e GH_MCP_TOKEN \
  -e HOME="$CONTAINER_HOME" \
  -e XDG_CONFIG_HOME="$CONTAINER_XDG_CONFIG_HOME" \
  -e XDG_CACHE_HOME="$CONTAINER_XDG_CACHE_HOME" \
  -e XDG_DATA_HOME="$CONTAINER_XDG_DATA_HOME" \
  -e XDG_STATE_HOME="$CONTAINER_XDG_STATE_HOME" \
  -u "$RESOLVED_UID:$RESOLVED_GID" \
  -v "$HOST_OPENCODE_HOME:$CONTAINER_HOME/.opencode" \
  -v "$HOST_OPENCODE_CONFIG:$CONTAINER_XDG_CONFIG_HOME/opencode" \
  -v "$HOST_OPENCODE_CACHE:$CONTAINER_XDG_CACHE_HOME/opencode" \
  -v "$HOST_OPENCODE_DATA:$CONTAINER_XDG_DATA_HOME/opencode" \
  -v "$HOST_OPENCODE_STATE:$CONTAINER_XDG_STATE_HOME/opencode" \
  -v "$MNT:$MNT" -w "$WORKDIR" \
  "$IMAGE" "${OPENCODE_ARGS[@]}"
