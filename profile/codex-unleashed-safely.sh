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
FROM node:25-bookworm

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

RUN /bin/bash -euo pipefail -c '\
  GO_VERSION="$(curl -fsSL https://go.dev/VERSION?m=text | head -n1)"; \
  ARCH="$(dpkg --print-architecture)"; \
  case "$ARCH" in \
    amd64|arm64) GO_ARCH="$ARCH" ;; \
    *) echo "Unsupported architecture for Go: $ARCH" >&2; exit 1 ;; \
  esac; \
  curl -fsSL "https://go.dev/dl/${GO_VERSION}.linux-${GO_ARCH}.tar.gz" -o /tmp/go.tgz; \
  rm -rf /usr/local/go; \
  tar -C /usr/local -xzf /tmp/go.tgz; \
  rm /tmp/go.tgz; \
  ln -sf /usr/local/go/bin/go /usr/local/bin/go; \
  ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt \
'

RUN /bin/bash -euo pipefail -c '\
  ARCH="$(dpkg --print-architecture)"; \
  case "$ARCH" in \
    amd64) KUBE_ARCH="amd64"; RG_ARCH="x86_64-unknown-linux-musl" ;; \
    arm64) KUBE_ARCH="arm64"; RG_ARCH="aarch64-unknown-linux-musl" ;; \
    *) echo "Unsupported architecture for kubectl/rg: $ARCH" >&2; exit 1 ;; \
  esac; \
  KUBE_VERSION="$(curl -fsSL https://dl.k8s.io/release/stable.txt)"; \
  curl -fsSL "https://dl.k8s.io/release/${KUBE_VERSION}/bin/linux/${KUBE_ARCH}/kubectl" -o /usr/local/bin/kubectl; \
  chmod +x /usr/local/bin/kubectl; \
  RG_VERSION="$(curl -fsSL -o /dev/null -w "%{url_effective}" https://github.com/BurntSushi/ripgrep/releases/latest | sed -n "s#.*/tag/##p")"; \
  curl -fsSL "https://github.com/BurntSushi/ripgrep/releases/download/${RG_VERSION}/ripgrep-${RG_VERSION#v}-${RG_ARCH}.tar.gz" -o /tmp/rg.tgz; \
  tar -C /tmp -xzf /tmp/rg.tgz; \
  rm /tmp/rg.tgz; \
  RG_DIR="/tmp/ripgrep-${RG_VERSION#v}-${RG_ARCH}"; \
  install -m 0755 "${RG_DIR}/rg" /usr/local/bin/rg; \
  rm -rf "${RG_DIR}" \
'

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

docker run --rm $DOCKER_TTY_FLAGS \
  $DOCKER_NO_TTY_ENV_FLAGS \
  -e OPENAI_API_KEY \
  -e CODEX_APPROVALS=never \
  -e CODEX_HOME=/codex \
  -e HOME=/codex \
  -u "$(id -u):$(id -g)" \
  -v "$HOME/.codex:/codex" \
  -v "$MNT:$MNT" -w "$WORKDIR" \
  "$IMAGE" "${CODEX_ARGS[@]}"
