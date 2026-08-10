---
description: Open current branch as a Bitbucket pull request (no preview, no confirmation)
argument-hint: "[draft]"
mode: build
---

# Open Bitbucket Pull Request

Open the current branch as one Bitbucket pull request. Treat `$1` as the optional mode argument:
- empty: ready for review (`draft: false`)
- `draft`: draft pull request (`draft: true`)
- anything else: fail before doing any work

Use only local Git commands and the Bitbucket MCP tools. Do not use `gh`, GitHub MCP, or any
other forge. Keep preflight and all MCP reads read-only. Do not push, create, or otherwise mutate
remote state until all checks pass. There is no preview or confirmation step — push and create
happen immediately after preflight.

## Preflight

Run these checks before duplicate detection:

1. Require a clean worktree. `git status --porcelain=v1` must be empty, including untracked files.
   Do not stash, reset, commit, or amend anything to make it clean.
2. Require a named branch from `git branch --show-current`.
3. Never create or switch branches. Work only on the current branch.
4. Select the push remote from the current branch's upstream when available; otherwise use `origin`.
   Fail if that remote does not exist.
5. Read both fetch and push URLs. Accept only standard Bitbucket.org URLs whose host is exactly
   `bitbucket.org`, including HTTPS and SSH forms such as:
   - `https://bitbucket.org/WORKSPACE/REPO.git`
   - `git@bitbucket.org:WORKSPACE/REPO.git`
   - `ssh://git@bitbucket.org/WORKSPACE/REPO.git`

   Parse `workspace` and `repo` from the repository URL, removing one trailing `.git`. Reject
   every other host, including Bitbucket Server instances. Reject malformed URLs or URLs whose
   fetch and push repositories differ.
6. Detect the current remote default branch without changing local refs. Prefer
   `git ls-remote --symref <remote> HEAD`; fall back to `refs/remotes/<remote>/HEAD` only when
   the remote query does not return a branch. Fail if the default branch cannot be determined.
7. Fail if the current branch is the default branch.
8. Use the local `refs/remotes/<remote>/<base>` ref for comparisons. Fail with a clear instruction
   to fetch the base branch manually if it is unavailable; do not fetch automatically.
9. Fail when `git rev-list --count <base-ref>..HEAD` is zero. The branch must contain at least one
   commit not in the default branch.

## Prevent duplicate PRs

After `workspace`, `repo`, `base`, and `head` are known, list open pull requests on Bitbucket
before continuing:

```text
bitbucket_bitbucketPullRequest({
  action: "list",
  workspaceId: "<workspace>",
  repoId: "<repo>",
  state: "OPEN",
  q: "source.repository.full_name = <workspace>/<repo> AND source.branch.name = <head>",
  pagelen: 100
})
```

If any matching pull request exists, print its URL (and title when available) and stop. Do not
push or create another pull request.

## Generate PR content

Inspect the current branch against the remote default branch:

```bash
git log --format=%s <base-ref>..HEAD
git diff --stat <base-ref>...HEAD
git diff --name-status <base-ref>...HEAD
```

Use commit subjects, diff summary, and changed paths to generate:

- A concise title describing the primary change.
- A Markdown description containing:
  - `## Summary` with up to three accurate bullets
  - `## Validation` listing checks actually run, or `Not run (not requested)`

No Jira or Bitbucket issue matching. Do not search for or link issues.

## Push and create

There is no preview, confirmation, or `question` call. Proceed directly:

1. Push exactly once:

   ```bash
   git push -u <remote> HEAD
   ```

   If push fails, report the exact error and stop. Do not call the create tool or retry.
2. Recheck for an existing open pull request with the same duplicate-detection query. If one now
   exists, report its URL and stop without creating a duplicate.
3. Call `bitbucket_bitbucketPullRequest` with:

   ```text
   {
     action: "create",
     workspaceId: "<workspace>",
     repoId: "<repo>",
     title: "<title>",
     description: "<description>",
     sourceBranch: "<head>",
     targetBranch: "<base>",
     draft: true|false
   }
   ```

## Report result

Print the created pull request URL, title, workspace/repository, source branch, target branch,
and ready/draft state. Report exact Bitbucket MCP or Git error text on failure.
