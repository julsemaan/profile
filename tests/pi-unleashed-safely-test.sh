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

case "${1:-}" in
pull)
  ;;
build)
  cat >/dev/null
  ;;
run)
  printf '%s\n' "$@" >"$DOCKER_RUN_LOG"
  printf '%s\n' "$@" >>"$DOCKER_COMMAND_LOG"
  ;;
*)
  echo "unexpected docker command: ${1:-<missing>}" >&2
  exit 1
  ;;
esac
STUB
chmod +x "$stub_dir/docker"

function run_wrapper {
  (
    cd "$REPO_ROOT"
    export HOME="$home"
    export PATH="$stub_dir:/usr/bin:/bin"
    export DOCKER_RUN_LOG="$docker_run_log"
    export DOCKER_COMMAND_LOG="$docker_command_log"
    export PI_SSH_KEY_PATH="$key"
    unset SUDO_UID SUDO_GID SUDO_USER GOFLAGS GOMODCACHE GOCACHE GOPATH
    unset TMUX DISPLAY WAYLAND_DISPLAY XDG_RUNTIME_DIR HERDR_SOCKET_PATH
    bash "$REPO_ROOT/profile/pi-unleashed-safely.sh" --no-tty "$@"
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

node_bin="$(command -v node || true)"
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

let systemPrompt = "base system prompt";
for (const handler of handlers) {
  const result = await handler({ systemPrompt });
  if (result?.systemPrompt !== undefined) systemPrompt = result.systemPrompt;
}

const prompt = fs.readFileSync(promptPath, "utf8");
const marker = "<!-- profile:always-on-unslop -->";
const markerCount = systemPrompt.split(marker).length - 1;
if (!systemPrompt.includes(prompt)) throw new Error("full UNSLOP.md content was not injected");
if (markerCount !== 1) throw new Error(`expected one marker, got ${markerCount}`);

const duplicateResult = await handlers[0]({ systemPrompt });
if (duplicateResult !== undefined) throw new Error("duplicate prompt was injected");

process.stdout.write("ok\n");
NODE
  ); then
    assert_eq "unslop extension injects the full prompt once" "ok" "${injection_output//$'\n'/}"
  else
    test_fail "unslop extension injects the full prompt once" "extension runtime check failed"
  fi
fi

# --- .gitconfig forwarding tests ---
gitconfig="$home/.gitconfig"
printf '[user]\n  name = Test User\n  email = test@example.com\n' >"$gitconfig"

run_wrapper
run_args=$(<"$docker_run_log")
assert_contains ".gitconfig mounted read-only" "$run_args" "$gitconfig:$home/.gitconfig:ro"

rm "$gitconfig"
run_wrapper
run_args=$(<"$docker_run_log")
assert_not_match "absent .gitconfig is not mounted" "gitconfig" "$run_args"

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

test_summary
