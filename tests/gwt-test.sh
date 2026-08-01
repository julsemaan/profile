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
