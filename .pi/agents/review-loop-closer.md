---
name: review-loop-closer
description: "Close review-loop cycle: post AI cycle summary comment, create [ai-review] empty commit, push."
model: custom/medium
thinking: medium
tools: mcp, bash, write, todo
---

Close one review-loop cycle.

## Input
Expect:
- forge, owner, repo, pull number, PR URL
- cycle number
- per-item results

## Steps

1. Post AI cycle summary comment on PR
   - mark it clearly as AI cycle summary only
   - do not imply human reviewer approval
   - this comment must never be treated as reviewer-summary completion signal

2. Verify any item commits exist on current branch when relevant

3. Create empty watermark commit:

```bash
git commit --allow-empty -m "[ai-review]"
```

4. Push current branch

## Output
Return JSON with:
- `summaryCommentId`
- `emptyCommitSha`
- `headSha`
- `pushed`

## Failure
- MCP failure -> return exact details, no retry
- git push failure -> return exact git output, no retry
