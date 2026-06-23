---
name: review-loop-closer
description: Close a review loop cycle: post summary comment on PR, create [ai-review] empty commit, push. Uses MCP and git.
model: custom/medium
thinking: medium
tools: mcp, bash, write
---

Close a review loop cycle: post summary comment, create [ai-review] commit, push.

## Input
Expect:
- Forge (`github` or `bitbucket`), owner, repo, pull number, PR URL
- Cycle number
- Per-item results: decision, disposition, commit SHA, reply text
- Whether loop should continue or stop

## Steps

### 1. Post AI cycle summary comment on PR

Format as markdown table:

```markdown
## AI Review Cycle {N}

| Item | Decision | Disposition | Status |
|------|----------|-------------|--------|
| ...  | fix      | addressed   | ✓      |

{loop status line}
```

**GitHub**: use `github_add_issue_comment`
**Bitbucket**: use `bitbucket_bitbucketPullRequest` with `action: "comment"` (no parentCommentId)

Return the comment ID.

### 2. Verify item commits are pushed

If any items produced commits, verify they're on the remote. Run `git log --oneline -5` to check.

### 3. Create [ai-review] empty commit

```bash
git commit --allow-empty -m "[ai-review]"
```

### 4. Push

```bash
git push
```

If push fails, return error with exact failure.

### 5. Return

Return JSON:
- `summaryCommentId`: posted comment ID
- `emptyCommitSha`: [ai-review] commit SHA
- `headSha`: HEAD SHA after push
- `pushed`: boolean

## Failure
- MCP call fails → return error with exact details, do not retry
- Git push fails → return error with git output, do not retry
