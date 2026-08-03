#!/usr/bin/env bash
# tests/pi-unleashed-safely-test.sh - Regression test for explicit Git SSH paths
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
key="$ssh_dir/id_rsa_git"
known_hosts="$ssh_dir/known_hosts"
config="$ssh_dir/config"
mkdir -p "$ssh_dir" "$stub_dir"

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
    export PI_SSH_KEY_PATH="$key"
    unset SUDO_UID SUDO_GID SUDO_USER GOFLAGS GOMODCACHE GOCACHE GOPATH
    unset TMUX DISPLAY WAYLAND_DISPLAY XDG_RUNTIME_DIR HERDR_SOCKET_PATH
    bash "$REPO_ROOT/profile/pi-unleashed-safely.sh" --no-tty
  )
}

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
