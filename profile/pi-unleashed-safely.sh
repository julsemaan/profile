#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

IMAGE="pi-unleashed-safely:latest"
MNT="$PWD"
WORKDIR="$PWD"
REBUILD=0
USE_TTY=1
HIDE_HOME_PI_EXTENSIONS=0

# Extra npm packages to install into image.
# `pi-caveman` currently imports `@earendil-works/pi-tui` without declaring it,
# so install it explicitly to keep extension loadable.
PI_NPM_INSTALL_PACKAGES=("pi-web-access" "pi-caveman" "@earendil-works/pi-tui" "pi-mcp-adapter")

# Pi runtime package sources to register in settings.json.
PI_RUNTIME_PACKAGE_SOURCES=(
  "npm:pi-web-access"
  "npm:pi-caveman"
  "npm:@earendil-works/pi-tui"
  "npm:pi-mcp-adapter"
  "https://github.com/DietrichGebert/ponytail@v4.7.0"
  "https://github.com/julsemaan/astatus@main"
)

usage() {
  cat <<'USAGE'
Usage: pi-unleashed-safely.sh [--mount PATH] [--workdir PATH] [--rebuild] [--no-tty] [--dev] [-- <pi args...>]

Arguments:
  -m, --mount PATH    Host path to bind-mount into the container.
                      Defaults to the current working directory.
  -w, --workdir PATH  Working directory inside the container.
                      Defaults to the current working directory.
  -r, --rebuild       Rebuild the Docker image before running.
  --no-tty            Disable TTY allocation (useful to avoid carriage returns).
  --dev               Mask ~/.pi/agent/extensions and prompts from the host
                      (sessions, settings, auth, packages persist).
                      Warning: can hide host-installed integrations like
                      Herdr `herdr-agent-state.ts`.
  -h, --help          Show this help text.

Environment:
  PI_NPM_PACKAGE        NPM package name to install for the CLI.
                        Defaults to "@mariozechner/pi-coding-agent".
  Pi state persistence  Persists ~/.pi across runs for settings,
                        auth, packages, and sessions.
                        Use --dev to isolate extensions and prompts.
  Clipboard forwarding  Forwards terminal (TERM/TMUX/etc) and Wayland/X11
                        settings when available for clipboard integration.
  Herdr forwarding      Forwards `HERDR_*` runtime vars when present and
                        bind-mounts `HERDR_SOCKET_PATH` parent dir so
                        container path matches host path.
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
    --dev)
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

HOST_PI_HOME="$RESOLVED_HOME/.pi"
HOST_AGENT_STATUS="$RESOLVED_HOME/.local/state/agent-status"
CONTAINER_HOME="$RESOLVED_HOME"
CONTAINER_AGENT_STATUS="$CONTAINER_HOME/.local/state/agent-status"
PI_NPM_PACKAGE="${PI_NPM_PACKAGE:-@earendil-works/pi-coding-agent}"
PI_UNLEASHED_NPM_INSTALL_PACKAGES_JSON="[]"
if [[ ${#PI_NPM_INSTALL_PACKAGES[@]} -gt 0 ]]; then
  PI_UNLEASHED_NPM_INSTALL_PACKAGES_JSON="[$(printf '"%s",' "${PI_NPM_INSTALL_PACKAGES[@]}") ]"
  PI_UNLEASHED_NPM_INSTALL_PACKAGES_JSON="${PI_UNLEASHED_NPM_INSTALL_PACKAGES_JSON/, ]/]}"
fi
PI_UNLEASHED_RUNTIME_PI_PACKAGES_JSON="[]"
if [[ ${#PI_RUNTIME_PACKAGE_SOURCES[@]} -gt 0 ]]; then
  PI_UNLEASHED_RUNTIME_PI_PACKAGES_JSON="[$(printf '"%s",' "${PI_RUNTIME_PACKAGE_SOURCES[@]}") ]"
  PI_UNLEASHED_RUNTIME_PI_PACKAGES_JSON="${PI_UNLEASHED_RUNTIME_PI_PACKAGES_JSON/, ]/]}"
fi

ensure_host_dir "$HOST_PI_HOME"
ensure_host_dir "$HOST_AGENT_STATUS"

# Ownership preflight: detect and repair existing root-owned state
# in host ~/.pi before container starts.
if [[ -d "$HOST_PI_HOME" ]]; then
  BROKEN_FILES=$(find "$HOST_PI_HOME" -not -user "$RESOLVED_UID" -print -quit 2>/dev/null || true)
  if [[ -n "$BROKEN_FILES" ]]; then
    if [[ $EUID -eq 0 ]]; then
      echo "Fixing ownership of $HOST_PI_HOME (running as root)..."
      chown -R "$RESOLVED_UID:$RESOLVED_GID" "$HOST_PI_HOME"
    else
      echo "Error: Some files in $HOST_PI_HOME are not owned by you ($RESOLVED_USER)." >&2
      echo "Run this to repair:" >&2
      echo "  sudo chown -R \"$(id -u):$(id -g)\" \"$HOST_PI_HOME\"" >&2
      exit 1
    fi
  fi
fi

# Go cache discovery for private module reuse in container builds.
# Discovers host Go paths, creates cache dirs, and builds bind-mount flags.
# No credentials (SSH, git, netrc) are forwarded -- container sees only
# already-downloaded module files.
GO_DOCKER_FLAGS=()
if command -v go >/dev/null 2>&1; then
  HOST_GOMODCACHE=$(go env GOMODCACHE 2>/dev/null || true)
  HOST_GOCACHE=$(go env GOCACHE 2>/dev/null || true)

  [[ -n "$HOST_GOMODCACHE" ]] && mkdir -p "$HOST_GOMODCACHE" && GO_DOCKER_FLAGS+=(-v "$HOST_GOMODCACHE:$HOST_GOMODCACHE:rw")
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
docker build $REBUILD_DOCKER_ARG -t "$IMAGE" \
  --build-arg PI_NPM_PACKAGE="$PI_NPM_PACKAGE" \
  --build-arg PI_NPM_INSTALL_PACKAGES_JSON="$PI_UNLEASHED_NPM_INSTALL_PACKAGES_JSON" \
  --build-arg PI_RUNTIME_PI_PACKAGES_JSON="$PI_UNLEASHED_RUNTIME_PI_PACKAGES_JSON" \
  -f- "$SCRIPT_DIR" <<'EOF'
FROM julsemaan/code-sandbox-img:latest

ARG PI_NPM_PACKAGE
ARG PI_NPM_INSTALL_PACKAGES_JSON
ARG PI_RUNTIME_PI_PACKAGES_JSON
RUN npm i -g "$PI_NPM_PACKAGE"

RUN node -e 'const pkgs = JSON.parse(process.env.PI_NPM_INSTALL_PACKAGES_JSON || "[]"); if (pkgs.length) require("child_process").execFileSync("npm", ["i", "-g", ...pkgs], { stdio: "inherit" });'

ENV PI_UNLEASHED_RUNTIME_PI_PACKAGES_JSON "$PI_RUNTIME_PI_PACKAGES_JSON"


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
  'const managedPackages = JSON.parse(process.env.PI_UNLEASHED_RUNTIME_PI_PACKAGES_JSON || "[]");' \
  'const normalizeStringPackageEntry = entry => entry.split(/\\s+/).filter(Boolean).map(pkg => {' \
  '  if (/^(npm:|git:|https:\/\/|ssh:\/\/|\.{1,2}\/|\/|~\/)/.test(pkg)) return pkg;' \
  '  return "npm:" + pkg;' \
  '});' \
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
  '  if (entry && typeof entry === "object") {' \
  '    addPackage(entry);' \
  '  }' \
  '}' \
  'managedPackages.flatMap(entry => typeof entry === "string" ? normalizeStringPackageEntry(entry.trim()) : [entry]).forEach(addPackage);' \
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
PI_HOME_DOCKER_FLAGS=(-v "$HOST_PI_HOME:$CONTAINER_HOME/.pi")
if [[ $HIDE_HOME_PI_EXTENSIONS -eq 1 ]]; then
  mkdir -p "$HOST_PI_HOME/agent/extensions"
  mkdir -p "$HOST_PI_HOME/agent/prompts"
  PI_HOME_DOCKER_FLAGS+=(--tmpfs "$CONTAINER_HOME/.pi/agent/extensions:rw,exec,uid=$RESOLVED_UID,gid=$RESOLVED_GID")
  PI_HOME_DOCKER_FLAGS+=(--tmpfs "$CONTAINER_HOME/.pi/agent/prompts:rw,exec,uid=$RESOLVED_UID,gid=$RESOLVED_GID")
fi

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
  -u "$RESOLVED_UID:$RESOLVED_GID" \
  "${PI_HOME_DOCKER_FLAGS[@]}" \
  -v "$HOST_AGENT_STATUS:$CONTAINER_AGENT_STATUS" \
  "${GO_DOCKER_FLAGS[@]}" \
  -e GOFLAGS="$GOFLAGS_VALUE" \
  -v "$MNT:$MNT" -w "$WORKDIR" \
  "$IMAGE" "${PI_ARGS[@]}"
