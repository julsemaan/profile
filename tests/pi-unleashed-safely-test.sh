#!/usr/bin/env bash
# tests/pi-unleashed-safely-test.sh - Regression test for the Pi sandbox wrapper
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=tests/lib/assert.sh
source "$SCRIPT_DIR/lib/assert.sh"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

home="$tmp_dir/home"
ssh_dir="$home/.ssh"
stub_dir="$tmp_dir/bin"
docker_run_log="$tmp_dir/docker-run.log"
docker_command_log="$tmp_dir/docker-command.log"
docker_build_log="$tmp_dir/docker-build.log"
go_env_log="$tmp_dir/go-env.log"
go_stub_root="$tmp_dir/go-stub"
node_bin="$(command -v node || true)"
key="$ssh_dir/id_rsa_git"
known_hosts="$ssh_dir/known_hosts"
config="$ssh_dir/config"
unslop_prompt="$home/.pi/agent/UNSLOP.md"
unslop_extension="$home/.pi/agent/always-on-unslop.ts"
mkdir -p "$ssh_dir" "$stub_dir" "$(dirname "$unslop_prompt")"
cp "$REPO_ROOT/.pi/UNSLOP.md" "$unslop_prompt"
cp "$REPO_ROOT/.pi/always-on-unslop.ts" "$unslop_extension"

printf 'private key\n' >"$key"
printf 'known host\n' >"$known_hosts"
printf 'Host git.example.invalid\n  User git\n' >"$config"
chmod 600 "$key"

cat >"$stub_dir/docker" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$@" >>"$DOCKER_COMMAND_LOG"
case "${1:-}" in
inspect)
  if [[ "${DOCKER_BUILDKIT_EXISTS:-0}" != 1 ]] && ! grep -q 'systempaths=unconfined' "$DOCKER_COMMAND_LOG"; then exit 1; fi
  if [[ "${3:-}" == '{{.Config.Image}}' ]]; then
    printf '%s\n' "${DOCKER_BUILDKIT_IMAGE:-moby/buildkit:v0.20.2-rootless}"
  elif [[ "${3:-}" == '{{.AppArmorProfile}}' ]]; then
    if [[ -n "${DOCKER_BUILDKIT_APPARMOR_PROFILE:-}" ]]; then
      printf '%s\n' "$DOCKER_BUILDKIT_APPARMOR_PROFILE"
    else
      grep '^apparmor=' "$DOCKER_COMMAND_LOG" | tail -1 | cut -d= -f2 || echo unconfined
    fi
  elif [[ "${2:-}" == -f ]]; then
    printf '%s\n' "${DOCKER_BUILDKIT_STATUS:-running}"
  fi
  ;;
start | volume | logs)
  ;;
exec)
  exit "${DOCKER_BUILDKIT_READY_EXIT:-0}"
  ;;
pull)
  ;;
build)
  cat >"$DOCKER_BUILD_LOG"
  ;;
create)
  echo "stub-container-id"
  ;;
cp)
  src="$2"
  dst="$3"
  case "$src" in
  stub-container-id:/etc/passwd) cp /etc/passwd "$dst" ;;
  stub-container-id:/etc/group) cp /etc/group "$dst" ;;
  *)
    echo "unexpected docker cp: $src -> $dst" >&2
    exit 1
    ;;
  esac
  ;;
rm)
  ;;
network)
  exit "${DOCKER_KIND_NETWORK_EXIT:-1}"
  ;;
run)
  printf '%s\n' "$@" >"$DOCKER_RUN_LOG"
  if [[ "$*" == *"--name pi-buildkit-"* && "${DOCKER_BUILDKIT_RACE:-0}" == 1 ]]; then
    echo 'Docker: container name is already in use' >&2
    exit 1
  fi
  if [[ "$*" == *"--entrypoint buildctl"* && "${@: -1}" == --version ]]; then
    printf 'buildctl github.com/moby/buildkit %s test\n' "${DOCKER_BUILDCTL_VERSION:-v0.20.2}"
  fi
  if [[ "$*" == *"--entrypoint node"* ]]; then
    for arg in "$@"; do
      if [[ "$arg" == type=bind,src=*,dst=/run/pi-registry/config.json,readonly ]]; then
        export TEST_REGISTRY_CONFIG="${arg#type=bind,src=}"
        TEST_REGISTRY_CONFIG="${TEST_REGISTRY_CONFIG%,dst=*}"
      fi
    done
    "$NODE_BIN" -e '
      const fs = require("fs"), read = fs.readFileSync;
      fs.readFileSync = (p, ...args) => read(p === "/run/pi-registry/config.json" ? process.env.TEST_REGISTRY_CONFIG : p, ...args);
      eval(process.argv[1]);
    ' "${@: -1}"
  fi
  ;;
*)
  echo "unexpected docker command: ${1:-<missing>}" >&2
  exit 1
  ;;
esac
STUB
chmod +x "$stub_dir/docker"

cat >"$stub_dir/go" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' "$*" >>"$GO_ENV_LOG"

printf '%s\n' \
  "$GO_STUB_ROOT/gopath" \
  "$GO_STUB_ROOT/gomodcache" \
  "$GO_STUB_ROOT/gocache" \
  "$GO_STUB_ROOT/goprivate" \
  "$GO_STUB_ROOT/gonoproxy" \
  "$GO_STUB_ROOT/gonosumdb" \
  "$GO_STUB_ROOT/govcs"
STUB
chmod +x "$stub_dir/go"

# Readiness failure tests should not spend 30 seconds sleeping.
printf '#!/bin/bash\nexit 0\n' >"$stub_dir/sleep"
chmod +x "$stub_dir/sleep"

function run_wrapper {
  (
    cd "$REPO_ROOT"
    export HOME="$home"
    export PATH="$stub_dir:/usr/bin:/bin"
    export DOCKER_RUN_LOG="$docker_run_log"
    export DOCKER_COMMAND_LOG="$docker_command_log"
    export DOCKER_BUILD_LOG="$docker_build_log"
    export GO_ENV_LOG="$go_env_log"
    export GO_STUB_ROOT="$go_stub_root"
    export NODE_BIN="$node_bin"
    export PI_SSH_KEY_PATH="$key"
    unset SUDO_UID SUDO_GID SUDO_USER GOFLAGS GOMODCACHE GOCACHE GOPATH
    unset TMUX DISPLAY WAYLAND_DISPLAY XDG_RUNTIME_DIR HERDR_SOCKET_PATH
    bash "${test_wrapper:-$REPO_ROOT/profile/pi-unleashed-safely.sh}" --no-tty "$@"
  )
}

# --- Always-on unslop tests ---
printf '# custom prompt\n' >"$tmp_dir/custom-prompt.md"
run_wrapper --dev -- --no-extensions --no-skills --prompt-template "$tmp_dir/custom-prompt.md"
run_args=$(<"$docker_run_log")
assert_contains "always-on extension is explicitly loaded" "$run_args" "--extension"
assert_contains "explicit extension path points at persisted Pi config" "$run_args" "$home/.pi/agent/always-on-unslop.ts"
assert_contains "isolation flags remain forwarded to Pi" "$run_args" "--no-extensions"
assert_contains "skills isolation flag remains forwarded to Pi" "$run_args" "--no-skills"
assert_contains "custom prompt remains forwarded to Pi" "$run_args" "$tmp_dir/custom-prompt.md"
assert_contains "--dev masks host extensions" "$run_args" "$home/.pi/agent/extensions:rw,exec,uid=$(id -u),gid=$(id -g)"
assert_contains "--dev masks host prompts" "$run_args" "$home/.pi/agent/prompts:rw,exec,uid=$(id -u),gid=$(id -g)"
assert_contains "--dev masks host skills" "$run_args" "$home/.pi/agent/skills:rw,exec,uid=$(id -u),gid=$(id -g)"
assert_contains "gwt is mounted read-only" "$run_args" "type=bind,src=$REPO_ROOT/profile/gwt,dst=/usr/local/bin/gwt,readonly"
assert_contains "primary mount is passed to gwt" "$run_args" "GWT_MOUNT_ROOT=$REPO_ROOT"
assert_contains "MCP browser launches are disabled" "$run_args" $'-e\nMCP_UI_VIEWER=none\n'

no_gwt_wrapper_dir="$tmp_dir/no-gwt-wrapper"
no_gwt_wrapper="$no_gwt_wrapper_dir/pi-unleashed-safely.sh"
mkdir -p "$no_gwt_wrapper_dir"
cp "$REPO_ROOT/profile/pi-unleashed-safely.sh" "$no_gwt_wrapper"
chmod +x "$no_gwt_wrapper"
rm -f "$docker_command_log"
if (
  cd "$REPO_ROOT"
  env -u SUDO_UID -u SUDO_GID -u SUDO_USER \
    HOME="$home" PATH="$stub_dir:/usr/bin:/bin" DOCKER_COMMAND_LOG="$docker_command_log" \
    bash "$no_gwt_wrapper" --no-tty
) >/dev/null 2>"$tmp_dir/no-gwt-wrapper.stderr"; then
  test_fail "missing sibling gwt fails before Docker launches" "wrapper unexpectedly succeeded"
else
  test_pass "missing sibling gwt fails before Docker launches"
fi
assert_contains "missing gwt error names the sibling executable" "$(<"$tmp_dir/no-gwt-wrapper.stderr")" "$no_gwt_wrapper_dir/gwt"
if [[ ! -e "$docker_command_log" ]]; then
  test_pass "missing sibling gwt does not invoke Docker"
else
  test_fail "missing sibling gwt does not invoke Docker" "Docker was invoked"
fi

rm "$unslop_prompt"
rm -f "$docker_command_log"
assert_fail "missing unslop prompt fails closed" run_wrapper
if [[ ! -e "$docker_command_log" ]]; then
  test_pass "missing unslop prompt fails before Docker launches"
else
  test_fail "missing unslop prompt fails before Docker launches" "Docker was invoked"
fi
cp "$REPO_ROOT/.pi/UNSLOP.md" "$unslop_prompt"

rm "$unslop_extension"
rm -f "$docker_command_log"
assert_fail "missing unslop extension fails closed" run_wrapper
if [[ ! -e "$docker_command_log" ]]; then
  test_pass "missing unslop extension fails before Docker launches"
else
  test_fail "missing unslop extension fails before Docker launches" "Docker was invoked"
fi
cp "$REPO_ROOT/.pi/always-on-unslop.ts" "$unslop_extension"

if [[ -z "$node_bin" ]]; then
  test_fail "unslop extension injects the full prompt" "node is required"
else
  if injection_output=$(
    REPO_ROOT="$REPO_ROOT" "$node_bin" --preserve-symlinks --experimental-strip-types --input-type=module <<'NODE'
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.env.REPO_ROOT;
const extensionPaths = [
  path.join(root, ".pi", "always-on-unslop.ts"),
  path.join(root, ".pi", "extensions", "always-on-unslop.ts"),
];
const promptPath = path.join(root, ".pi", "UNSLOP.md");
const extensions = await Promise.all(
  extensionPaths.map(async (extensionPath) => (await import(pathToFileURL(extensionPath).href)).default),
);
const handlers = [];
const pi = {
  on(name, handler) {
    if (name === "before_agent_start") handlers.push(handler);
  },
};

for (const extension of extensions) extension(pi);
if (handlers.length !== 2) throw new Error("expected two before_agent_start handlers");

const event = { systemPrompt: "base system prompt", systemPromptOptions: { sections: {} } };
for (const handler of handlers) {
  const result = await handler(event);
  if (result?.systemPrompt !== undefined) throw new Error("system prompt was replaced");
}
const systemPrompt = Object.values(event.systemPromptOptions.sections).join("\n");

const prompt = fs.readFileSync(promptPath, "utf8");
const marker = "<!-- profile:always-on-unslop -->";
const markerCount = systemPrompt.split(marker).length - 1;
if (!systemPrompt.includes(prompt)) throw new Error("full UNSLOP.md content was not injected");
if (markerCount !== 1) throw new Error(`expected one marker, got ${markerCount}`);

await handlers[0](event);
if (Object.values(event.systemPromptOptions.sections).join("\n") !== systemPrompt) {
  throw new Error("duplicate prompt was injected");
}

process.stdout.write("ok\n");
NODE
  ); then
    assert_eq "unslop extension injects the full prompt once" "ok" "${injection_output//$'\n'/}"
  else
    test_fail "unslop extension injects the full prompt once" "extension runtime check failed"
  fi
fi

# --- Jiti cache and profiling tests ---
run_wrapper
run_args=$(<"$docker_run_log")
if [[ -d "$home/.pi/cache/jiti" ]]; then
  test_pass "Jiti cache directory is created"
else
  test_fail "Jiti cache directory is created" "directory is missing"
fi
assert_contains "Jiti cache path is forwarded" "$run_args" "JITI_FS_CACHE=$home/.pi/cache/jiti"
assert_contains "Jiti temp root is persistent" "$run_args" "TMPDIR=$home/.pi/cache"

PI_FAST_MODE=1 PI_TIMING=1 PI_STARTUP_BENCHMARK=1 run_wrapper
run_args=$(<"$docker_run_log")
assert_contains "PI_FAST_MODE is forwarded without wrapper defaults" "$run_args" $'-e\nPI_FAST_MODE\n'
assert_contains "PI_TIMING reaches the container" "$run_args" "PI_TIMING"
assert_contains "PI_STARTUP_BENCHMARK reaches the container" "$run_args" "PI_STARTUP_BENCHMARK"

# --- Model profile tests ---
PI_DEFAULT_MODEL_PROFILE=deep run_wrapper
assert_contains "PI_DEFAULT_MODEL_PROFILE is forwarded" "$(<"$docker_run_log")" $'-e\nPI_DEFAULT_MODEL_PROFILE=deep\n'
PI_DEFAULT_MODEL_PROFILE=deep run_wrapper --model-profile priv
assert_contains "--model-profile overrides PI_DEFAULT_MODEL_PROFILE" "$(<"$docker_run_log")" $'-e\nPI_DEFAULT_MODEL_PROFILE=priv\n'

# --- Go cache discovery tests ---
rm -f "$go_env_log"
run_wrapper
run_args=$(<"$docker_run_log")
assert_eq "go env is invoked once per wrapper run" "1" "$(wc -l <"$go_env_log" | tr -d ' ')"
assert_contains "GOMODCACHE is bind-mounted read-write" "$run_args" "$go_stub_root/gomodcache:$go_stub_root/gomodcache:rw"
assert_contains "GOCACHE is bind-mounted read-write" "$run_args" "$go_stub_root/gocache:$go_stub_root/gocache:rw"
assert_contains "GOPATH is forwarded to the container" "$run_args" $'-e\nGOPATH'

# --- .gitconfig forwarding tests ---
gitconfig="$home/.gitconfig"
printf '[user]\n  name = Test User\n  email = test@example.com\n' >"$gitconfig"

# First run_wrapper exercises the cold/refresh path (pull, build, identity
# regen into ~/.cache/pi-unleashed-safely); later calls hit the 24h warm path.
run_wrapper
run_args=$(<"$docker_run_log")
assert_contains ".gitconfig mounted read-only" "$run_args" "$gitconfig:$home/.gitconfig:ro"
assert_contains "host .cache bind-mounted (jiti compile cache persists)" "$run_args" "$home/.cache:$home/.cache"
assert_contains "host .claude bind-mounted for pi-claude-bridge" "$run_args" "$home/.claude:$home/.claude"
assert_contains "CLAUDE_CONFIG_DIR points at the mounted .claude dir" "$run_args" $'-e\nCLAUDE_CONFIG_DIR='"$home/.claude"
assert_contains "Claude can skip permissions as root inside the sandbox" "$run_args" $'-e\nIS_SANDBOX=1'

rm "$gitconfig"
run_wrapper
run_args=$(<"$docker_run_log")
assert_not_match "absent .gitconfig is not mounted" "gitconfig" "$run_args"

# --- kind network tests ---
if [[ "$run_args" == *$'--network\nkind'* ]]; then
  test_fail "kind network is skipped when absent" "--network kind unexpectedly passed"
else
  test_pass "kind network is skipped when absent"
fi

DOCKER_KIND_NETWORK_EXIT=0 run_wrapper
run_args=$(<"$docker_run_log")
assert_contains "kind network is attached when present" "$run_args" $'--network\nkind'

# --- SSH key tests ---
run_wrapper
run_args=$(<"$docker_run_log")
expected_command="GIT_SSH_COMMAND=ssh -i $home/.ssh/id_rsa_git -o IdentitiesOnly=yes -o UserKnownHostsFile=$home/.ssh/known_hosts -F $home/.ssh/config"
assert_contains "non-default SSH key is explicit in Git command" "$run_args" "$expected_command"
assert_contains "mounted key uses matching container path" "$run_args" "$key:$home/.ssh/id_rsa_git:ro"
assert_contains "mounted known_hosts uses matching container path" "$run_args" "$known_hosts:$home/.ssh/known_hosts:ro"
assert_contains "mounted config uses matching container path" "$run_args" "$config:$home/.ssh/config:ro"
assert_not_match "strict host-key checking is not disabled" "StrictHostKeyChecking=no" "$run_args"

rm "$config"
run_wrapper
run_args=$(<"$docker_run_log")
expected_command="GIT_SSH_COMMAND=ssh -i $home/.ssh/id_rsa_git -o IdentitiesOnly=yes -o UserKnownHostsFile=$home/.ssh/known_hosts"
assert_contains "config option is omitted when config is absent" "$run_args" "$expected_command"
assert_not_match "absent config is not passed with -F" "GIT_SSH_COMMAND=.*-F" "$run_args"

# --- BuildKit opt-in tests ---
base_dockerfile="$(<"$REPO_ROOT/code-sandbox/Dockerfile")"
companion_version="$(awk -F '"' '/^BUILDKIT_VERSION=/ { print $2 }' "$REPO_ROOT/profile/pi-unleashed-safely.sh")"
assert_contains "base client pin matches the companion pin" "$base_dockerfile" "FROM moby/buildkit:$companion_version-rootless AS buildkit"
assert_contains "base image copies the static buildctl client" "$base_dockerfile" 'COPY --from=buildkit /usr/bin/buildctl /usr/local/bin/buildctl'
assert_contains "base image pins the Docker CLI" "$base_dockerfile" 'DOCKER_VERSION="29.6.2"'
assert_contains "base image sets the editor" "$base_dockerfile" 'ENV EDITOR=vim'
assert_contains "Pi image inherits shared tooling" "$(<"$docker_build_log")" 'FROM julsemaan/code-sandbox-img:latest'
assert_not_match "Pi image does not reinstall shared tooling" 'buildkit|buildctl|DOCKER_VERSION|ENV EDITOR' "$(<"$docker_build_log")"
run_wrapper
run_args=$(<"$docker_run_log")
assert_not_match "BuildKit is absent by default" "BUILDKIT_HOST|pi-buildkit|DOCKER_CONFIG" "$run_args"

rm -f "$docker_command_log"
run_wrapper --buildkit
run_args=$(<"$docker_run_log")
commands=$(<"$docker_command_log")
assert_contains "BuildKit address is a Unix socket" "$run_args" "BUILDKIT_HOST=unix:///run/pi-buildkit/buildkitd.sock"
assert_contains "Pi mounts only the shared socket volume" "$run_args" "src=pi-buildkit-$(id -u)-socket,dst=/run/pi-buildkit,readonly"
assert_not_match "Pi does not mount builder state" "dst=/home/user/.local/share/buildkit" "$run_args"
assert_contains "companion is per resolved UID" "$commands" "pi-buildkit-$(id -u)"
assert_contains "companion security settings are explicit" "$commands" "systempaths=unconfined"
assert_contains "companion is rootless" "$commands" "1000:1000"
assert_not_match "BuildKit never requests privileged execution or TCP" "(--privileged|tcp://|--publish|--pid|--ipc)" "$commands"
assert_contains "matching release is pinned" "$commands" "moby/buildkit:v0.20.2-rootless"
rm -f "$docker_command_log"
PI_BUILDKIT_APPARMOR_PROFILE=pi-buildkit run_wrapper --buildkit
assert_contains "explicit AppArmor profile is applied to companion" "$(<"$docker_command_log")" "apparmor=pi-buildkit"
PI_BUILDKIT_APPARMOR_PROFILE=pi-buildkit DOCKER_BUILDKIT_EXISTS=1 DOCKER_BUILDKIT_APPARMOR_PROFILE=unconfined \
  assert_fail "old companion must be recreated to apply named policy" run_wrapper --buildkit

rm -f "$docker_command_log"
DOCKER_BUILDKIT_EXISTS=1 run_wrapper --buildkit
commands=$(<"$docker_command_log")
assert_not_match "running companion is reused" "seccomp=unconfined" "$commands"
rm -f "$docker_command_log"
DOCKER_BUILDKIT_EXISTS=1 DOCKER_BUILDKIT_STATUS=exited run_wrapper --buildkit
assert_contains "stopped companion is restarted" "$(<"$docker_command_log")" $'start\npi-buildkit-'
DOCKER_BUILDKIT_EXISTS=1 DOCKER_BUILDKIT_IMAGE=other:version assert_fail "incompatible companion fails closed" run_wrapper --buildkit
DOCKER_BUILDCTL_VERSION=v0.1.0 assert_fail "stale buildctl requires --rebuild" run_wrapper --buildkit
rm -f "$docker_command_log"
DOCKER_BUILDKIT_RACE=1 assert_success "concurrent creation loser reuses winning companion" run_wrapper --buildkit

rm -f "$docker_run_log"
if DOCKER_BUILDKIT_READY_EXIT=1 run_wrapper --buildkit >"$tmp_dir/readiness.log" 2>&1; then
  test_fail "BuildKit readiness fails closed" "wrapper succeeded"
else
  test_pass "BuildKit readiness fails closed"
fi
assert_not_match "Pi never launches on failed readiness" 'MCP_UI_VIEWER=none' "$(<"$docker_run_log")"
assert_contains "readiness diagnostics explain failure" "$(<"$tmp_dir/readiness.log")" "BuildKit"
rm -f "$docker_command_log"
DOCKER_BUILDKIT_EXISTS=1 DOCKER_BUILDKIT_STATUS=exited DOCKER_BUILDKIT_READY_EXIT=1 assert_fail "exited companion fails readiness" run_wrapper --buildkit
assert_eq "exited companion is not polled 30 times" "1" "$(grep -c '^exec$' "$docker_command_log")"

registry_config="$tmp_dir/registry credentials"
mkdir -p "$registry_config"
printf '{"auths":{}}\n' >"$registry_config/config.json"
PI_DOCKER_CONFIG_DIR="$registry_config" assert_fail "registry config requires --buildkit" run_wrapper
PI_DOCKER_CONFIG_DIR="$tmp_dir/missing" assert_fail "missing registry config is rejected" run_wrapper --buildkit
PI_DOCKER_CONFIG_DIR="$registry_config" run_wrapper --buildkit
run_args=$(<"$docker_run_log")
assert_contains "only config file is mounted read-only, including spaces" "$run_args" "type=bind,src=$registry_config/config.json,dst=/run/pi-registry/config.json,readonly"
assert_contains "Docker config is explicitly isolated" "$run_args" "DOCKER_CONFIG=/run/pi-registry"
printf '{"credsStore":"desktop","auths":{}}\n' >"$registry_config/config.json"
PI_DOCKER_CONFIG_DIR="$registry_config" assert_fail "credential stores are rejected" run_wrapper --buildkit
printf '{"credHelpers":{"example.com":"secret-helper"},"auths":{}}\n' >"$registry_config/config.json"
PI_DOCKER_CONFIG_DIR="$registry_config" assert_fail "credential helpers are rejected" run_wrapper --buildkit
printf 'invalid json with secret token\n' >"$registry_config/config.json"
if PI_DOCKER_CONFIG_DIR="$registry_config" run_wrapper --buildkit >"$tmp_dir/invalid-config.log" 2>&1; then
  test_fail "invalid registry JSON fails closed" "wrapper succeeded"
else
  test_pass "invalid registry JSON fails closed"
fi
assert_not_match "credential contents never appear in diagnostics" "secret token" "$(<"$tmp_dir/invalid-config.log")"
DOCKER_CONFIG="$registry_config" run_wrapper --buildkit
assert_not_match "host Docker config is not implicitly forwarded" "DOCKER_CONFIG|registry credentials" "$(<"$docker_run_log")"

# BuildKit forwards the resolved user's default Docker config, but ordinary launches do not.
mkdir -p "$home/.docker"
printf '{"auths":{}}\n' >"$home/.docker/config.json"
run_wrapper
assert_not_match "ordinary launches never mount default Docker credentials" "DOCKER_CONFIG|/\\.docker/config\\.json" "$(<"$docker_run_log")"
run_wrapper --buildkit
assert_contains "--buildkit accepts default Docker credentials" "$(<"$docker_run_log")" "type=bind,src=$home/.docker/config.json,dst=/run/pi-registry/config.json,readonly"
assert_contains "default credentials are selected through DOCKER_CONFIG" "$(<"$docker_run_log")" "DOCKER_CONFIG=/run/pi-registry"
printf '{"auths":{}}\n' >"$registry_config/config.json"
PI_DOCKER_CONFIG_DIR="$registry_config" run_wrapper --buildkit
assert_contains "explicit config overrides default Docker credentials" "$(<"$docker_run_log")" "src=$registry_config/config.json,dst=/run/pi-registry/config.json,readonly"
assert_not_match "override does not also mount default credentials" "/\\.docker/config\\.json" "$(<"$docker_run_log")"
printf '{"credsStore":"desktop","auths":{}}\n' >"$home/.docker/config.json"
assert_fail "default config with unsupported helpers fails clearly" run_wrapper --buildkit
rm "$home/.docker/config.json"

# Select the installed named policy automatically, without touching the real host's /etc.
mkdir -p "$tmp_dir/apparmor-wrapper"
ln -s "$REPO_ROOT/profile/gwt" "$tmp_dir/apparmor-wrapper/gwt"
awk -v policy="$tmp_dir/installed-pi-buildkit" '{ gsub(/\/etc\/apparmor\.d\/pi-buildkit/, policy); print }' \
  "$REPO_ROOT/profile/pi-unleashed-safely.sh" >"$tmp_dir/apparmor-wrapper/pi-unleashed-safely.sh"
test_wrapper="$tmp_dir/apparmor-wrapper/pi-unleashed-safely.sh"
rm -f "$docker_command_log"
run_wrapper --buildkit
assert_contains "hosts without installed policy retain unconfined default" "$(<"$docker_command_log")" 'apparmor=unconfined'
touch "$tmp_dir/installed-pi-buildkit"
rm -f "$docker_command_log"
run_wrapper --buildkit
assert_contains "installed policy is automatically selected" "$(<"$docker_command_log")" 'apparmor=pi-buildkit'
rm -f "$docker_command_log"
PI_BUILDKIT_APPARMOR_PROFILE=custom-policy run_wrapper --buildkit
assert_contains "explicit policy overrides installed default" "$(<"$docker_command_log")" 'apparmor=custom-policy'
unset test_wrapper

test_summary
