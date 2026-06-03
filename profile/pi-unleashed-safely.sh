#!/bin/bash

set -euo pipefail

IMAGE="pi-unleashed-safely:latest"
MNT="$PWD"
WORKDIR="$PWD"
REBUILD=0
USE_TTY=1
HIDE_HOME_PI_EXTENSIONS=0

# Extra npm packages to install and register as pi extensions.
# `pi-caveman` currently imports `@earendil-works/pi-tui` without declaring it,
# so install it explicitly to keep the extension loadable.
EXTRA_PI_PACKAGES=("pi-web-access" "pi-caveman" "@earendil-works/pi-tui" "pi-mcp-adapter")

usage() {
  cat <<'USAGE'
Usage: pi-unleashed-safely.sh [--mount PATH] [--workdir PATH] [--rebuild] [--no-tty] [--no-home-pi-extensions] [-- <pi args...>]

Arguments:
  -m, --mount PATH    Host path to bind-mount into the container.
                      Defaults to the current working directory.
  -w, --workdir PATH  Working directory inside the container.
                      Defaults to the current working directory.
  -r, --rebuild       Rebuild the Docker image before running.
  --no-tty            Disable TTY allocation (useful to avoid carriage returns).
  --no-home-pi-extensions  Mask ~/.pi/agent/extensions and prompts from the host
                        (sessions, settings, auth, packages persist).
  -h, --help          Show this help text.

Environment:
  PI_NPM_PACKAGE        NPM package name to install for the CLI.
                        Defaults to "@mariozechner/pi-coding-agent".
  Pi state persistence  Persists ~/.pi across runs for settings,
                        auth, packages, and sessions.
                        Use --no-home-pi-extensions to isolate extensions and prompts.
  Clipboard forwarding  Forwards terminal (TERM/TMUX/etc) and Wayland/X11
                        settings when available for clipboard integration.
  Ketch persistence     Installs ketch CLI for web search, code search,
                        scraping, and library docs.
                        Config (~/.config/ketch) and cache (~/.cache/ketch)
                        persist via bind mounts.
  Go cache reuse       Detects Go environment on the host and mounts
                        GOMODCACHE (read-only) and GOCACHE into the container,
                        reusing downloaded Go modules without exposing
                        credentials. Private modules cached on host are
                        available for container builds.
                        Forwarded vars: GOPATH, GOMODCACHE, GOCACHE,
                        GOPRIVATE, GONOPROXY, GONOSUMDB, GOVCS.
                        GOFLAGS defaults to -mod=readonly.
                        For fully offline builds, run 'go mod vendor' on host
                        and use -mod=vendor.

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
    --no-home-pi-extensions)
      HIDE_HOME_PI_EXTENSIONS=1
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
CONTAINER_HOME="$HOME"
PI_NPM_PACKAGE="${PI_NPM_PACKAGE:-@earendil-works/pi-coding-agent}"
PI_UNLEASHED_EXTRA_PACKAGES_JSON="[]"
if [[ ${#EXTRA_PI_PACKAGES[@]} -gt 0 ]]; then
  PI_UNLEASHED_EXTRA_PACKAGES_JSON="[$(printf '"npm:%s",' "${EXTRA_PI_PACKAGES[@]}") ]"
  PI_UNLEASHED_EXTRA_PACKAGES_JSON="${PI_UNLEASHED_EXTRA_PACKAGES_JSON/, ]/]}"
fi

mkdir -p "$HOST_PI_HOME"

HOST_KETCH_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/ketch"
HOST_KETCH_CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/ketch"
mkdir -p "$HOST_KETCH_CONFIG" "$HOST_KETCH_CACHE"

# Go cache discovery for private module reuse in container builds.
# Discovers host Go paths, creates cache dirs, and builds bind-mount flags.
# No credentials (SSH, git, netrc) are forwarded -- container sees only
# already-downloaded module files.
GO_DOCKER_FLAGS=()
if command -v go >/dev/null 2>&1; then
  HOST_GOMODCACHE=$(go env GOMODCACHE 2>/dev/null || true)
  HOST_GOCACHE=$(go env GOCACHE 2>/dev/null || true)

  [[ -n "$HOST_GOMODCACHE" ]] && mkdir -p "$HOST_GOMODCACHE" && GO_DOCKER_FLAGS+=(-v "$HOST_GOMODCACHE:$HOST_GOMODCACHE:ro")
  [[ -n "$HOST_GOCACHE" ]] && mkdir -p "$HOST_GOCACHE" && GO_DOCKER_FLAGS+=(-v "$HOST_GOCACHE:$HOST_GOCACHE:rw")

  # Forward Go env vars (only if set on host)
  for go_env in GOPATH GOMODCACHE GOCACHE GOPRIVATE GONOPROXY GONOSUMDB GOVCS; do
    val=$(go env "$go_env" 2>/dev/null || true)
    [[ -n "$val" ]] && GO_DOCKER_FLAGS+=(-e "$go_env")
  done
fi

# GOFLAGS: default to -mod=readonly unless host overrides
GOFLAGS_VALUE="${GOFLAGS:--mod=readonly}"

if [[ $REBUILD -eq 1 ]]; then
  REBUILD_DOCKER_ARG="--no-cache"
else
  REBUILD_DOCKER_ARG=""
fi

docker pull julsemaan/code-sandbox-img:latest
docker build $REBUILD_DOCKER_ARG -t "$IMAGE" --build-arg PI_NPM_PACKAGE="$PI_NPM_PACKAGE" --build-arg PI_EXTRA_PACKAGES_JSON="$PI_UNLEASHED_EXTRA_PACKAGES_JSON" - <<'EOF'
FROM julsemaan/code-sandbox-img:latest

ARG PI_NPM_PACKAGE
ARG PI_EXTRA_PACKAGES_JSON
RUN npm i -g "$PI_NPM_PACKAGE"

RUN node -e 'const pkgs = JSON.parse(process.env.PI_EXTRA_PACKAGES_JSON || "[]"); if (pkgs.length) require("child_process").execFileSync("npm", ["i", "-g", ...pkgs.map(pkg => pkg.replace(/^npm:/, ""))], { stdio: "inherit" });'

ENV PI_UNLEASHED_EXTRA_PACKAGES_JSON "$PI_EXTRA_PACKAGES_JSON"

RUN /bin/bash -euo pipefail -c '\
KETCH_VERSION="v0.9.3"; \
ARCH="$(dpkg --print-architecture)"; \
case "$ARCH" in \
  amd64) KETCH_ARCH="x86_64" ;; \
  arm64) KETCH_ARCH="arm64" ;; \
  *) echo "Unsupported architecture for ketch: $ARCH" >&2; exit 1 ;; \
esac; \
TARBALL="ketch_${KETCH_VERSION#v}_linux_${KETCH_ARCH}.tar.gz"; \
DOWNLOAD_URL="https://github.com/1broseidon/ketch/releases/download/${KETCH_VERSION}/${TARBALL}"; \
TMPDIR="$(mktemp -d)"; \
trap "rm -rf $TMPDIR" EXIT; \
curl -fL --max-time 120 "$DOWNLOAD_URL" -o "$TMPDIR/ketch.tar.gz"; \
tar -xzf "$TMPDIR/ketch.tar.gz" -C "$TMPDIR"; \
install -m 0755 "$TMPDIR/ketch" /usr/local/bin/ketch; \
'

RUN printf '%s\n' \
  '#!/bin/bash' \
  'set -e' \
  '# Ensure extra packages are registered in the runtime settings.json.' \
  '# During image build, `pi install` wrote to root'\''s settings, but at' \
  '# runtime we use the host user'\''s ~/.pi (bind-mounted), so we must' \
  '# re-register the packages here.' \
  'node <<'\''NODE'\''' \
  'const fs = require("fs");' \
  'const dir = process.env.PI_CODING_AGENT_DIR || (process.env.HOME + "/.pi/agent");' \
  'const file = dir + "/settings.json";' \
  'fs.mkdirSync(dir, { recursive: true });' \
  'let settings = {};' \
  'try { settings = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}' \
  'const managedPackages = JSON.parse(process.env.PI_UNLEASHED_EXTRA_PACKAGES_JSON || "[]");' \
  'const normalizeStringPackageEntry = entry => entry.split(/\\s+/).filter(Boolean).map(pkg => pkg.startsWith("npm:") ? pkg : "npm:" + pkg);' \
  'const normalizedPackages = [];' \
  'const seen = new Set();' \
  'const addPackage = entry => {' \
  '  const key = typeof entry === "string" ? entry : JSON.stringify(entry);' \
  '  if (!seen.has(key)) {' \
  '    seen.add(key);' \
  '    normalizedPackages.push(entry);' \
  '  }' \
  '};' \
  'for (const entry of Array.isArray(settings.packages) ? settings.packages : []) {' \
  '  if (typeof entry === "string") {' \
  '    normalizeStringPackageEntry(entry.trim()).forEach(addPackage);' \
  '    continue;' \
  '  }' \
  '  if (entry && typeof entry === "object" && typeof entry.source === "string") {' \
  '    addPackage({ ...entry, source: entry.source.trim() });' \
  '  }' \
  '}' \
  'managedPackages.forEach(addPackage);' \
  'settings.packages = normalizedPackages;' \
  'fs.writeFileSync(file, JSON.stringify(settings, null, 2));' \
  'NODE' \
  '' \
  'exec pi "$@"' \
  > /entrypoint.sh \
 && chmod +x /entrypoint.sh

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
PI_HOME_DOCKER_FLAGS=(-v "$HOST_PI_HOME:$CONTAINER_HOME/.pi")
if [[ $HIDE_HOME_PI_EXTENSIONS -eq 1 ]]; then
  mkdir -p "$HOST_PI_HOME/agent/extensions"
  mkdir -p "$HOST_PI_HOME/agent/prompts"
  PI_HOME_DOCKER_FLAGS+=(--tmpfs "$CONTAINER_HOME/.pi/agent/extensions:rw,exec,uid=$(id -u),gid=$(id -g)")
  PI_HOME_DOCKER_FLAGS+=(--tmpfs "$CONTAINER_HOME/.pi/agent/prompts:rw,exec,uid=$(id -u),gid=$(id -g)")
fi

KETCH_DOCKER_FLAGS=(
  -v "$HOST_KETCH_CONFIG:$CONTAINER_HOME/.config/ketch"
  -v "$HOST_KETCH_CACHE:$CONTAINER_HOME/.cache/ketch"
)

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
  -e DEEPSEEK_API_KEY \
  -e AWS_ACCESS_KEY_ID \
  -e AWS_SECRET_ACCESS_KEY \
  -e AWS_SESSION_TOKEN \
  -e AWS_REGION \
  -e AWS_DEFAULT_REGION \
  -e AZURE_OPENAI_API_KEY \
  -e AZURE_OPENAI_ENDPOINT \
  -e HF_TOKEN \
  -e HUGGINGFACEHUB_API_TOKEN \
  -e GITHUB_TOKEN \
  -e GH_TOKEN \
  -e BRAVE_API_KEY \
  -e GH_MCP_TOKEN \
  -e BB_MCP_TOKEN \
  -e CONTEXT7_API_KEY \
  -e PI_CODING_AGENT_DIR="$CONTAINER_HOME/.pi/agent" \
  -e HOME="$CONTAINER_HOME" \
  -u "$(id -u):$(id -g)" \
  "${PI_HOME_DOCKER_FLAGS[@]}" \
  "${KETCH_DOCKER_FLAGS[@]}" \
  "${GO_DOCKER_FLAGS[@]}" \
  -e GOFLAGS="$GOFLAGS_VALUE" \
  -v "$MNT:$MNT" -w "$WORKDIR" \
  "$IMAGE" "${PI_ARGS[@]}"
