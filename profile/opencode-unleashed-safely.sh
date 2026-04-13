#!/bin/bash

set -euo pipefail
IMAGE="opencode-unleashed-safely:latest"
MNT="$PWD"
WORKDIR="$PWD"
REBUILD=0
USE_TTY=1
SYSTEM_OPENCODE_CONFIG="/usr/local/etc/opencode/opencode.json"
SYSTEM_OPENCODE_AGENT_DIR="/usr/local/etc/opencode/agent"

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
                        and copies /usr/local/etc/opencode/agent/*.md to
                        ~/.config/opencode/agent/.

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

HOST_OPENCODE_HOME="$HOME/.opencode"
HOST_OPENCODE_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/opencode"
HOST_OPENCODE_DATA="${XDG_DATA_HOME:-$HOME/.local/share}/opencode"
HOST_OPENCODE_STATE="${XDG_STATE_HOME:-$HOME/.local/state}/opencode"
HOST_OPENCODE_CONFIG_FILE="$HOST_OPENCODE_CONFIG/opencode.json"
HOST_OPENCODE_AGENT_DIR="$HOST_OPENCODE_CONFIG/agent"

if [[ ! -f "$SYSTEM_OPENCODE_CONFIG" ]]; then
  echo "Error: installed opencode config not found: $SYSTEM_OPENCODE_CONFIG" >&2
  exit 1
fi

mkdir -p "$HOST_OPENCODE_HOME" "$HOST_OPENCODE_CONFIG" "$HOST_OPENCODE_DATA" "$HOST_OPENCODE_STATE"
cp "$SYSTEM_OPENCODE_CONFIG" "$HOST_OPENCODE_CONFIG_FILE"

if [[ -d "$SYSTEM_OPENCODE_AGENT_DIR" ]]; then
  mkdir -p "$HOST_OPENCODE_AGENT_DIR"
  cp "$SYSTEM_OPENCODE_AGENT_DIR"/*.md "$HOST_OPENCODE_AGENT_DIR"/ 2>/dev/null || true
fi

if [[ $REBUILD -eq 1 ]]; then
  REBUILD_DOCKER_ARG="--no-cache"
else
  REBUILD_DOCKER_ARG=""
fi

OPENCODE_NPM_PACKAGE="${OPENCODE_NPM_PACKAGE:-opencode-ai}"

docker build $REBUILD_DOCKER_ARG -t "$IMAGE" --build-arg OPENCODE_NPM_PACKAGE="$OPENCODE_NPM_PACKAGE" - <<'EOF'
FROM julsemaan/codex-dev-img:latest

ARG OPENCODE_NPM_PACKAGE
RUN npm i -g "$OPENCODE_NPM_PACKAGE"

RUN apt-get update && apt-get install -y --no-install-recommends vim && rm -rf /var/lib/apt/lists/*

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

docker run --rm $DOCKER_TTY_FLAGS \
  $DOCKER_NO_TTY_ENV_FLAGS \
  -e OPENAI_API_KEY \
  -e ANTHROPIC_API_KEY \
  -e HOME=/opencode \
  -e XDG_CONFIG_HOME=/opencode/.config \
  -e XDG_DATA_HOME=/opencode/.local/share \
  -e XDG_STATE_HOME=/opencode/.local/state \
  -u "$(id -u):$(id -g)" \
  -v "$HOST_OPENCODE_HOME:/opencode" \
  -v "$HOST_OPENCODE_CONFIG:/opencode/.config/opencode" \
  -v "$HOST_OPENCODE_DATA:/opencode/.local/share/opencode" \
  -v "$HOST_OPENCODE_STATE:/opencode/.local/state/opencode" \
  -v "$MNT:$MNT" -w "$WORKDIR" \
  "$IMAGE" "${OPENCODE_ARGS[@]}"
