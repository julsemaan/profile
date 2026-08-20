---
description: Open current branch as a GitHub pull request after preview without confirmation
argument-hint: "[draft]"
mode: build
---

# Open GitHub Pull Request

Open the current branch as one GitHub pull request. Treat `$1` as the optional mode argument:
- empty: ready for review (`draft: false`)
- `draft`: draft pull request (`draft: true`)
- anything else: fail before doing any work

Use only local Git commands and the GitHub MCP tools. Do not use `gh`, Bitbucket MCP, or any
other forge. Keep preflight and all MCP reads read-only. Do not push, create, or otherwise mutate
remote state until all preflight, duplicate-detection, issue-matching, and content-generation checks pass.

## Preflight

Run these checks before issue matching:

1. Require a clean worktree. `git status --porcelain=v1` must be empty, including untracked files.
   Do not stash, reset, commit, or amend anything to make it clean.
2. Require a named branch from `git branch --show-current`.
3. Select the push remote from the current branch's upstream when available; otherwise use `origin`.
   Fail if that remote does not exist.
4. Read both fetch and push URLs. Accept only standard GitHub.com URLs whose host is exactly
   `github.com`, including HTTPS and SSH forms such as:
   - `https://github.com/OWNER/REPO.git`
   - `git@github.com:OWNER/REPO.git`
   - `ssh://git@github.com/OWNER/REPO.git`

   Parse `owner` and `repo` from the repository URL, removing one trailing `.git`. Reject
   `bitbucket.org` explicitly. Reject every other host, including GitHub Enterprise hosts and
   `www.github.com`. Reject malformed URLs or URLs whose fetch and push repositories differ.
5. Detect the current remote default branch without changing local refs. Prefer
   `git ls-remote --symref <remote> HEAD`; fall back to `refs/remotes/<remote>/HEAD` only when the
   remote query does not return a branch. Fail if the default branch cannot be determined.
6. Fail if the current branch is the default branch.
7. Use the local `refs/remotes/<remote>/<base>` ref for comparisons. Fail with a clear instruction
   to fetch the base branch manually if it is unavailable; do not fetch automatically.
8. Fail when `git rev-list --count <base-ref>..HEAD` is zero. The branch must contain at least one
   commit not in the default branch.

After `owner`, `repo`, `base`, and `head` are known, check for an existing open pull request before
continuing:

```text
github_list_pull_requests({
  owner,
  repo,
  state: "open",
  head: `${owner}:${head}`,
  perPage: 100,
  fields: ["number", "title", "html_url", "draft", "head", "base"]
})
```

If any matching pull request exists, print its URL (and number/title when available) and stop. Do
not search issues, push, or create another pull request.

## Find a matching issue

Inspect, without changing files or refs:

```bash
git log --format=%s <base-ref>..HEAD
git diff --stat <base-ref>...HEAD
git diff --name-status <base-ref>...HEAD
```

Use branch name, commit subjects, diff summary, and changed paths as matching evidence. Never paste
secrets or an entire sensitive diff into an MCP query.

1. Extract explicit references from the branch name and commit subjects first. Recognize
   `#123`, `OWNER/REPO#123`, and GitHub issue URLs. Only use a reference for this repository.
   Validate candidates with `github_issue_read` (`method: "get"`). Prefer one explicit open issue.
2. If no explicit issue is a strong match, search open issues with `github_search_issues`, scoped to
   `repo:OWNER/REPO is:open`, using one or more concise terms from the branch, commit subjects, and
   change summary. Request only small fields such as `number`, `title`, `body`, `state`, and
   `html_url`.
3. Select one issue only when evidence is strong: the issue clearly describes the change and no
   competing result is similarly plausible. Do not link an issue merely because a keyword matches.
4. If multiple issues are plausibly strong, use the `question` tool to ask the user which issue to
   link, with an option to link none. Continue only after the user chooses. If there is no strong
   match, omit issue linkage.

Record selected issue evidence for the preview. Do not add more than one automatic issue link. If an
issue is selected, append exactly one `Fixes #<number>` line to the pull request body.

## Build and preview

Generate a concise title describing the primary change following the Conventional Commit standard. Generate a short Markdown body with:
- `## Summary` with up to three accurate bullets that describe the changes
- `## Impact` with bullet points if necessary that describes the impact (if any) of the changes in the PR
- the single `Fixes #<number>` line only when an issue was selected

Show this complete preview, then proceed directly to creation:

```text
Repository: OWNER/REPO
Remote: REMOTE
Base: BASE
Head: HEAD
State: ready|draft
Issue: #NUMBER — TITLE, or none
Issue evidence: ...

Title: ...

Body:
...
```

After printing the preview, proceed directly to `Create`. Do not use the `question` tool for
creation confirmation.

## Create

After the preview:

1. Push exactly once:

   ```bash
   git push -u <remote> HEAD
   ```

   If push fails, report the exact error and stop. Do not call the create tool or retry.
2. Recheck for an existing open pull request with `github_list_pull_requests` using the same owner,
   repository, and head filters. If one now exists, report its URL and stop without creating a
   duplicate.
3. Call `github_create_pull_request` with:

   ```text
   {
     owner,
     repo,
     base,
     head,
     title,
     body,
     draft: true|false
   }
   ```

Report the created pull request URL, title, base/head, ready/draft state, and linked issue (or
`none`). Report exact failure text if the MCP create call fails.
