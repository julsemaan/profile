#!/bin/bash

set -euo pipefail

IMAGE="pi-unleashed-safely:latest"
MNT="$PWD"
WORKDIR="$PWD"
REBUILD=0
USE_TTY=1
MOUNT_HOME_PI=1

# Extra npm packages to install and register as pi extensions.
EXTRA_PI_PACKAGES=("pi-subagents")

usage() {
  cat <<'USAGE'
Usage: pi-unleashed-safely.sh [--mount PATH] [--workdir PATH] [--rebuild] [--no-tty] [--no-home-pi-mount] [-- <pi args...>]

Arguments:
  -m, --mount PATH    Host path to bind-mount into the container.
                      Defaults to the current working directory.
  -w, --workdir PATH  Working directory inside the container.
                      Defaults to the current working directory.
  -r, --rebuild       Rebuild the Docker image before running.
  --no-tty            Disable TTY allocation (useful to avoid carriage returns).
  --no-home-pi-mount  Do not bind-mount ~/.pi from the host.
  -h, --help          Show this help text.

Environment:
  PI_NPM_PACKAGE        NPM package name to install for the CLI.
                        Defaults to "@mariozechner/pi-coding-agent".
  Pi state persistence  Persists ~/.pi across runs for settings,
                        auth, packages, and sessions unless disabled.
  Clipboard forwarding  Forwards terminal (TERM/TMUX/etc) and Wayland/X11
                        settings when available for clipboard integration.

Examples:
  ./pi-unleashed-safely.sh
  ./pi-unleashed-safely.sh --rebuild --mount /home/julien/src
  ./pi-unleashed-safely.sh --mount /home/julien/src --workdir /home/julien/src/profile
  ./pi-unleashed-safely.sh -- --help
USAGE
}

PI_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      PI_ARGS+=("$@")
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
    --no-home-pi-mount)
      MOUNT_HOME_PI=0
      shift
      ;;
    *)
      PI_ARGS+=("$1")
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

HOST_PI_HOME="$HOME/.pi"
HOST_PI_AUTH="$HOST_PI_HOME/agent/auth.json"
CONTAINER_HOME="$HOME"
PI_NPM_PACKAGE="${PI_NPM_PACKAGE:-@mariozechner/pi-coding-agent}"
PI_EXTRA_PACKAGES="$(printf '%s ' "${EXTRA_PI_PACKAGES[@]}")"

if [[ $MOUNT_HOME_PI -eq 1 ]]; then
  mkdir -p "$HOST_PI_HOME"
fi

if [[ $REBUILD -eq 1 ]]; then
  REBUILD_DOCKER_ARG="--no-cache"
else
  REBUILD_DOCKER_ARG=""
fi

docker build $REBUILD_DOCKER_ARG -t "$IMAGE" --build-arg PI_NPM_PACKAGE="$PI_NPM_PACKAGE" --build-arg PI_EXTRA_PACKAGES="$PI_EXTRA_PACKAGES" - <<'EOF'
FROM julsemaan/codex-dev-img:latest

ARG PI_NPM_PACKAGE
ARG PI_EXTRA_PACKAGES
RUN npm i -g "$PI_NPM_PACKAGE"

RUN apt-get update && apt-get install -y --no-install-recommends vim tmux ncurses-term xauth xclip xsel wl-clipboard && rm -rf /var/lib/apt/lists/*

RUN if [ -n "$PI_EXTRA_PACKAGES" ]; then npm i -g $PI_EXTRA_PACKAGES; fi

ENV PI_EXTRA_PACKAGES "$PI_EXTRA_PACKAGES"

RUN cat > /entrypoint.sh << 'ENTRYPOINT_SCRIPT'
#!/bin/bash
set -e

# Ensure extra packages are registered in the runtime settings.json.
# During image build, `pi install` wrote to root's settings, but at
# runtime we use the host user's ~/.pi (bind-mounted), so we must
# re-register the packages here.
node -e "
const fs = require('fs');
const dir = process.env.PI_CODING_AGENT_DIR || (process.env.HOME + '/.pi/agent');
const file = dir + '/settings.json';
fs.mkdirSync(dir, { recursive: true });
let settings = {};
try { settings = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
if (!settings.packages) settings.packages = [];
const extra = (process.env.PI_EXTRA_PACKAGES || '').trim();
if (extra) {
  extra.split(/\\s+/).forEach(pkg => {
    const key = pkg.startsWith('npm:') ? pkg : 'npm:' + pkg;
    if (!settings.packages.includes(key)) {
      settings.packages.push(key);
    }
  });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2));
}
"

exec pi "$@"
ENTRYPOINT_SCRIPT

RUN chmod +x /entrypoint.sh

ENV EDITOR=vim

ENTRYPOINT ["/entrypoint.sh"]
EOF

if [[ $USE_TTY -eq 1 ]]; then
  DOCKER_TTY_FLAGS="-it"
  DOCKER_NO_TTY_ENV_FLAGS=""
else
  DOCKER_TTY_FLAGS="-i"
  DOCKER_NO_TTY_ENV_FLAGS="-e NO_COLOR=1 -e TERM=dumb -e CLICOLOR=0 -e FORCE_COLOR=0 -e CI=1"
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

CLIPBOARD_DOCKER_FLAGS=()
HOME_DOCKER_FLAGS=(--tmpfs "$CONTAINER_HOME:rw,exec,uid=$(id -u),gid=$(id -g)")
PI_HOME_DOCKER_FLAGS=()

if [[ $MOUNT_HOME_PI -eq 1 ]]; then
  PI_HOME_DOCKER_FLAGS=(-v "$HOST_PI_HOME:$CONTAINER_HOME/.pi")
elif [[ -f "$HOST_PI_AUTH" ]]; then
  PI_HOME_DOCKER_FLAGS=(--tmpfs "$CONTAINER_HOME/.pi:rw,exec,uid=$(id -u),gid=$(id -g)")
  PI_HOME_DOCKER_FLAGS+=(-v "$HOST_PI_AUTH:$CONTAINER_HOME/.pi/agent/auth.json")
fi

if [[ -n "${TMUX:-}" ]]; then
  TMUX_SOCKET_PATH="${TMUX%%,*}"
  if [[ -S "$TMUX_SOCKET_PATH" ]]; then
    TMUX_SOCKET_DIR="$(dirname "$TMUX_SOCKET_PATH")"
    CLIPBOARD_DOCKER_FLAGS+=(-v "$TMUX_SOCKET_DIR:$TMUX_SOCKET_DIR")
  fi
fi

if [[ -n "${DISPLAY:-}" ]]; then
  CLIPBOARD_DOCKER_FLAGS+=(-e DISPLAY)

  if [[ -d /tmp/.X11-unix ]]; then
    CLIPBOARD_DOCKER_FLAGS+=(-v /tmp/.X11-unix:/tmp/.X11-unix)
  fi

  HOST_XAUTHORITY="${XAUTHORITY:-$HOME/.Xauthority}"
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
  "${HOME_DOCKER_FLAGS[@]}" \
  -e OPENCODE_API_KEY \
  -e OPENAI_API_KEY \
  -e ANTHROPIC_API_KEY \
  -e GOOGLE_API_KEY \
  -e GEMINI_API_KEY \
  -e XAI_API_KEY \
  -e OPENROUTER_API_KEY \
  -e MISTRAL_API_KEY \
  -e GROQ_API_KEY \
  -e CEREBRAS_API_KEY \
  -e AWS_ACCESS_KEY_ID \
  -e AWS_SECRET_ACCESS_KEY \
  -e AWS_SESSION_TOKEN \
  -e AWS_REGION \
  -e AWS_DEFAULT_REGION \
  -e AZURE_OPENAI_API_KEY \
  -e AZURE_OPENAI_ENDPOINT \
  -e HF_TOKEN \
  -e HUGGINGFACEHUB_API_TOKEN \
  -e PI_CODING_AGENT_DIR="$CONTAINER_HOME/.pi/agent" \
  -e HOME="$CONTAINER_HOME" \
  -u "$(id -u):$(id -g)" \
  "${PI_HOME_DOCKER_FLAGS[@]}" \
  -v "$MNT:$MNT" -w "$WORKDIR" \
  "$IMAGE" "${PI_ARGS[@]}"
