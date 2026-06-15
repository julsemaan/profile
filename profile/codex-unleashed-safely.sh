#!/bin/bash

set -euo pipefail

IMAGE="codex-unleashed-safely:latest"
MNT="$PWD"
WORKDIR="$PWD"
REBUILD=0
USE_TTY=1

usage() {
  cat <<'USAGE'
Usage: codex-unleashed-safely.sh [--mount PATH] [--workdir PATH] [--rebuild] [--no-tty] [-- <codex args...>]

Arguments:
  -m, --mount PATH    Host path to bind-mount into the container.
                      Defaults to the current working directory.
  -w, --workdir PATH  Working directory inside the container.
                      Defaults to the current working directory.
  -r, --rebuild       Rebuild the Docker image before running.
  --no-tty            Disable TTY allocation (useful to avoid carriage returns).
  -h, --help          Show this help text.

Environment:
  Herdr forwarding    Forwards `HERDR_*` runtime vars when present and
                      bind-mounts `HERDR_SOCKET_PATH` parent dir so
                      container path matches host path.

Examples:
  ./codex-unleashed-safely.sh
  ./codex-unleashed-safely.sh --rebuild --mount /home/julien/src
  ./codex-unleashed-safely.sh --mount /home/julien/src --workdir /home/julien/src/profile
  ./codex-unleashed-safely.sh -- --help
USAGE
}

CODEX_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      CODEX_ARGS+=("$@")
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
      CODEX_ARGS+=("$1")
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

if [[ $REBUILD -eq 1 ]]; then
  REBUILD_DOCKER_ARG="--no-cache"
else
  REBUILD_DOCKER_ARG=""
fi

docker build $REBUILD_DOCKER_ARG -t "$IMAGE" - <<'EOF'
FROM julsemaan/code-sandbox-img:latest

RUN npm i -g @openai/codex

ENTRYPOINT ["codex", "--dangerously-bypass-approvals-and-sandbox"]
EOF

if [[ $USE_TTY -eq 1 ]]; then
  DOCKER_TTY_FLAGS="-it"
  DOCKER_NO_TTY_ENV_FLAGS=""
else
  DOCKER_TTY_FLAGS="-i"
  DOCKER_NO_TTY_ENV_FLAGS="-e NO_COLOR=1 -e TERM=dumb"
fi

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

if [[ -n "${HERDR_SOCKET_PATH:-}" ]]; then
  HERDR_SOCKET_DIR="$(dirname "$HERDR_SOCKET_PATH")"
  if [[ -d "$HERDR_SOCKET_DIR" ]]; then
    HERDR_DOCKER_FLAGS+=(-v "$HERDR_SOCKET_DIR:$HERDR_SOCKET_DIR")
  fi
fi

docker run --rm $DOCKER_TTY_FLAGS \
  $DOCKER_NO_TTY_ENV_FLAGS \
  "${HERDR_DOCKER_FLAGS[@]}" \
  -e OPENAI_API_KEY \
  -e CODEX_APPROVALS=never \
  -e CODEX_HOME=/codex \
  -e HOME=/codex \
  -u "$(id -u):$(id -g)" \
  -v "$HOME/.codex:/codex" \
  -v "$MNT:$MNT" -w "$WORKDIR" \
  "$IMAGE" "${CODEX_ARGS[@]}"
