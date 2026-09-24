#!/usr/bin/env bash
# tests/gwt-test.sh - Regression test for new gwt branch push setup
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=tests/lib/assert.sh
source "$SCRIPT_DIR/lib/assert.sh"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

origin="$tmp_dir/origin.git"
repo="$tmp_dir/repo"
stub_dir="$tmp_dir/bin"
wt_path="$tmp_dir/repo-feature"
mkdir -p "$stub_dir"

git init -q --bare "$origin"
git init -q "$repo"
git -C "$repo" checkout -q -b main
git -C "$repo" config user.email test@example.invalid
git -C "$repo" config user.name 'gwt test'
printf 'initial\n' >"$repo/README"
git -C "$repo" add README
git -C "$repo" commit -q -m initial
git -C "$repo" remote add origin "$origin"
git -C "$repo" push -q -u origin main
git -C "$repo" fetch -q origin
git -C "$repo" symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main

cat >"$stub_dir/fzf" <<'STUB'
#!/usr/bin/env bash
cat >/dev/null
printf '%s\n' 'local/main'
STUB
chmod +x "$stub_dir/fzf"

no_fzf_dir="$tmp_dir/no-fzf"
mkdir -p "$no_fzf_dir"
cat >"$no_fzf_dir/fzf" <<'STUB'
#!/usr/bin/env bash
echo 'fzf must not be called for explicit create' >&2
exit 99
STUB
chmod +x "$no_fzf_dir/fzf"

noninteractive_stderr="$tmp_dir/gwt-noninteractive.stderr"
if noninteractive_output=$(
  cd "$repo"
  GWT_MOUNT_ROOT="$tmp_dir" PATH="$no_fzf_dir:/usr/bin:/bin" \
    bash "$REPO_ROOT/profile/gwt" create origin/main noninteractive \
    2>"$noninteractive_stderr"
); then
  test_pass 'non-interactive create succeeds without fzf'
else
  test_fail 'non-interactive create succeeds without fzf' "$(<"$noninteractive_stderr")"
  test_summary
  exit 1
fi

assert_eq 'non-interactive create stdout is only worktree path' "$tmp_dir/repo-noninteractive" "$noninteractive_output"
assert_eq 'non-interactive branch is created' noninteractive "$(git -C "$tmp_dir/repo-noninteractive" branch --show-current)"
assert_eq 'non-interactive branch starts without upstream' '' "$(git -C "$tmp_dir/repo-noninteractive" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)"
assert_eq 'non-interactive branch records origin' origin "$(git -C "$repo" config --local --get branch.noninteractive.remote || true)"

create_command="cd $(printf '%q' "$repo") && bash $(printf '%q' "$REPO_ROOT/profile/gwt") create"
if create_output=$(printf 'feature\n' | PATH="$stub_dir:$PATH" script -qfec "$create_command" /dev/null 2>&1); then
  test_pass 'interactive create succeeds'
else
  test_fail 'interactive create succeeds' "$create_output"
  test_summary
  exit 1
fi

assert_eq 'new branch starts without upstream' '' "$(git -C "$wt_path" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)"
assert_eq 'selected remote is recorded' origin "$(git -C "$repo" config --local --get branch.feature.remote || true)"
assert_eq 'push auto-setup is enabled locally' true "$(git -C "$repo" config --local --get push.autoSetupRemote || true)"

# A remote-only branch exercises gwt's tracking-branch path.
git -C "$repo" push -q origin main:remote-only
git -C "$repo" fetch -q origin
cat >"$stub_dir/fzf" <<'STUB'
#!/usr/bin/env bash
cat >/dev/null
printf '%s\n' 'origin/remote-only'
STUB
chmod +x "$stub_dir/fzf"

remote_wt_path="$tmp_dir/repo-remote-only"
remote_stdout_file="$tmp_dir/gwt-create.stdout"
remote_create_command="cd $(printf '%q' "$repo") && bash $(printf '%q' "$REPO_ROOT/profile/gwt") create > $(printf '%q' "$remote_stdout_file")"
if remote_create_output=$(printf 'remote-only\n' | PATH="$stub_dir:$PATH" script -qfec "$remote_create_command" /dev/null 2>&1); then
  test_pass 'remote-only interactive create succeeds'
else
  test_fail 'remote-only interactive create succeeds' "$remote_create_output"
  test_summary
  exit 1
fi

assert_eq 'gwt create stdout is only worktree path' "$remote_wt_path" "$(<"$remote_stdout_file")"

git -C "$repo" push -q origin main:remote-explicit
git -C "$repo" fetch -q origin
remote_explicit_stderr="$tmp_dir/gwt-remote-explicit.stderr"
if remote_explicit_output=$(
  cd "$repo"
  GWT_MOUNT_ROOT="$tmp_dir" PATH="$no_fzf_dir:/usr/bin:/bin" \
    bash "$REPO_ROOT/profile/gwt" create origin/remote-explicit remote-explicit-wt \
    2>"$remote_explicit_stderr"
); then
  test_pass 'non-interactive remote branch create succeeds'
else
  test_fail 'non-interactive remote branch create succeeds' "$(<"$remote_explicit_stderr")"
fi
assert_eq 'remote branch create stdout is only worktree path' "$tmp_dir/repo-remote-explicit-wt" "$remote_explicit_output"
assert_eq 'remote branch creates the remote branch name' remote-explicit "$(git -C "$tmp_dir/repo-remote-explicit-wt" branch --show-current)"
assert_eq 'remote branch tracks its source' origin/remote-explicit "$(git -C "$tmp_dir/repo-remote-explicit-wt" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)"

git -C "$repo" branch local-explicit main
local_explicit_stderr="$tmp_dir/gwt-local-explicit.stderr"
if local_explicit_output=$(
  cd "$repo"
  GWT_MOUNT_ROOT="$tmp_dir" PATH="$no_fzf_dir:/usr/bin:/bin" \
    bash "$REPO_ROOT/profile/gwt" create local/local-explicit local-explicit-wt \
    2>"$local_explicit_stderr"
); then
  test_pass 'non-interactive local branch create succeeds'
else
  test_fail 'non-interactive local branch create succeeds' "$(<"$local_explicit_stderr")"
fi
assert_eq 'local branch create stdout is only worktree path' "$tmp_dir/repo-local-explicit-wt" "$local_explicit_output"
assert_eq 'local branch is checked out' local-explicit "$(git -C "$tmp_dir/repo-local-explicit-wt" branch --show-current)"

invalid_stderr="$tmp_dir/gwt-invalid.stderr"
if invalid_output=$(
  cd "$repo"
  GWT_MOUNT_ROOT="$tmp_dir" PATH="$no_fzf_dir:/usr/bin:/bin" \
    bash "$REPO_ROOT/profile/gwt" create local/does-not-exist invalid-wt \
    2>"$invalid_stderr"
); then
  test_fail 'invalid source branch is rejected' "unexpected output: $invalid_output"
else
  test_pass 'invalid source branch is rejected'
fi
assert_contains 'invalid source explains the missing branch' "$(<"$invalid_stderr")" "does not exist"
if [ -e "$tmp_dir/repo-invalid-wt" ]; then
  invalid_target_state=exists
else
  invalid_target_state=''
fi
assert_eq 'invalid source does not create a target path' '' "$invalid_target_state"

base_commit="$(git -C "$repo" rev-parse refs/remotes/origin/main)"
base_tree="$(git -C "$repo" rev-parse "$base_commit^{tree}")"
local_divergent_commit="$(printf 'local divergence\n' | git -C "$repo" commit-tree "$base_tree" -p "$base_commit")"
remote_divergent_commit="$(printf 'remote divergence\n' | git -C "$repo" commit-tree "$base_tree" -p "$base_commit")"
git -C "$repo" branch diverge "$base_commit"
git -C "$repo" update-ref refs/heads/diverge "$local_divergent_commit"
git -C "$repo" push -q origin "$remote_divergent_commit:refs/heads/diverge"
git -C "$repo" fetch -q origin
diverge_before="$(git -C "$repo" rev-parse refs/heads/diverge)"

divergence_stderr="$tmp_dir/gwt-divergence.stderr"
if divergence_output=$(
  cd "$repo"
  GWT_MOUNT_ROOT="$tmp_dir" PATH="$no_fzf_dir:/usr/bin:/bin" \
    bash "$REPO_ROOT/profile/gwt" create origin/diverge diverge-copy \
    2>"$divergence_stderr"
); then
  test_pass 'divergent non-interactive create uses a distinct branch'
else
  test_fail 'divergent non-interactive create uses a distinct branch' "$(<"$divergence_stderr")"
fi
assert_eq 'divergent create uses the requested path' "$tmp_dir/repo-diverge-copy" "$divergence_output"
assert_eq 'divergent create preserves the original branch' "$diverge_before" "$(git -C "$repo" rev-parse refs/heads/diverge)"
assert_eq 'divergent create uses the distinct branch' diverge-copy "$(git -C "$tmp_dir/repo-diverge-copy" branch --show-current)"

same_name_divergence_stderr="$tmp_dir/gwt-divergence-same-name.stderr"
if same_name_output=$(
  cd "$repo"
  GWT_MOUNT_ROOT="$tmp_dir" PATH="$no_fzf_dir:/usr/bin:/bin" \
    bash "$REPO_ROOT/profile/gwt" create origin/diverge \
    2>"$same_name_divergence_stderr"
); then
  test_fail 'divergent non-interactive create never resets implicitly' "unexpected output: $same_name_output"
else
  test_pass 'divergent non-interactive create never resets implicitly'
fi
assert_contains 'divergence failure gives a safe instruction' "$(<"$same_name_divergence_stderr")" 'choose a different worktree name'
assert_eq 'divergence failure leaves the branch unchanged' "$diverge_before" "$(git -C "$repo" rev-parse refs/heads/diverge)"

create_boundary_stderr="$tmp_dir/gwt-create-boundary.stderr"
if create_boundary_output=$(
  cd "$repo"
  GWT_MOUNT_ROOT="$repo" PATH="$no_fzf_dir:/usr/bin:/bin" \
    bash "$REPO_ROOT/profile/gwt" create origin/main boundary-create \
    2>"$create_boundary_stderr"
); then
  test_fail 'create rejects a target outside the mount' "unexpected output: $create_boundary_output"
else
  test_pass 'create rejects a target outside the mount'
fi
assert_contains 'create boundary failure names the mount guard' "$(<"$create_boundary_stderr")" 'outside GWT_MOUNT_ROOT'
if [ -e "$tmp_dir/repo-boundary-create" ]; then
  boundary_target_state=exists
else
  boundary_target_state=''
fi
assert_eq 'create boundary failure does not create a worktree' '' "$boundary_target_state"

remove_boundary_stderr="$tmp_dir/gwt-remove-boundary.stderr"
if remove_boundary_output=$(
  cd "$repo"
  GWT_MOUNT_ROOT="$repo" PATH="$no_fzf_dir:/usr/bin:/bin" \
    bash "$REPO_ROOT/profile/gwt" rm "$wt_path" \
    2>"$remove_boundary_stderr"
); then
  test_fail 'remove rejects a target outside the mount' "unexpected output: $remove_boundary_output"
else
  test_pass 'remove rejects a target outside the mount'
fi
assert_contains 'remove boundary failure names the mount guard' "$(<"$remove_boundary_stderr")" 'outside GWT_MOUNT_ROOT'
if [ -d "$wt_path" ]; then
  removed_worktree_state=exists
else
  removed_worktree_state=''
fi
assert_eq 'remove boundary failure leaves the worktree' exists "$removed_worktree_state"

prune_boundary_stderr="$tmp_dir/gwt-prune-boundary.stderr"
if prune_boundary_output=$(
  cd "$repo"
  GWT_MOUNT_ROOT="$repo" PATH="$no_fzf_dir:/usr/bin:/bin" \
    bash "$REPO_ROOT/profile/gwt" prune --dry-run \
    2>"$prune_boundary_stderr"
); then
  test_fail 'prune rejects hidden worktrees' "unexpected output: $prune_boundary_output"
else
  test_pass 'prune rejects hidden worktrees'
fi
assert_contains 'prune boundary failure names the mount guard' "$(<"$prune_boundary_stderr")" 'outside GWT_MOUNT_ROOT'

printf 'feature\n' >"$wt_path/feature.txt"
git -C "$wt_path" add feature.txt
git -C "$wt_path" commit -q -m feature

if git -C "$wt_path" push >/dev/null 2>&1; then
  test_pass 'plain git push succeeds'
else
  test_fail 'plain git push succeeds' 'git push failed'
fi

if git -C "$repo" ls-remote --exit-code origin refs/heads/feature >/dev/null 2>&1; then
  test_pass 'plain push creates origin/feature'
else
  test_fail 'plain push creates origin/feature' 'remote branch missing'
fi

assert_eq 'plain push configures origin/feature upstream' origin/feature "$(git -C "$wt_path" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)"

test_summary
