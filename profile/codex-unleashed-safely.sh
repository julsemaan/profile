#!/bin/bash

set -euo pipefail

IMAGE="codex-unleashed-safely:latest"
MNT="$PWD"
WORKDIR="$PWD"
REBUILD=0

usage() {
  cat <<'USAGE'
Usage: codex-unleashed-safely.sh [--mount PATH] [--workdir PATH] [--rebuild]

Arguments:
  -m, --mount PATH    Host path to bind-mount into the container.
                      Defaults to the current working directory.
  -w, --workdir PATH  Working directory inside the container.
                      Defaults to the current working directory.
  -r, --rebuild       Rebuild the Docker image before running.
  -h, --help          Show this help text.

Examples:
  ./codex-unleashed-safely.sh
  ./codex-unleashed-safely.sh --rebuild --mount /home/julien/src
  ./codex-unleashed-safely.sh --mount /home/julien/src --workdir /home/julien/src/profile
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
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
    *)
      echo "Error: unknown argument: $1" >&2
      usage >&2
      exit 1
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
FROM node:20-bookworm

RUN npm i -g @openai/codex

ENTRYPOINT ["codex", "--dangerously-bypass-approvals-and-sandbox"]
EOF

docker run --rm -it \
  -e OPENAI_API_KEY \
  -e CODEX_APPROVALS=never \
  -e CODEX_HOME=/codex \
  -v "$HOME/.codex:/codex" \
  -v "$MNT:$MNT" -w "$WORKDIR" \
  "$IMAGE"
