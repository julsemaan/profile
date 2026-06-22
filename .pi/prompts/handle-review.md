---
description: Run autonomous pull-request review loop from a PR URL
argument-hint: "<PR-URL>"
---

Run `/handle-review $ARGUMENTS` as single autonomous PR review loop.

## Scope
- This workflow owns full loop.
- Do not call deleted legacy prompts.
- Do not ask user between items.
- Do not trust stale reviewer summaries from before latest `[ai-review]` request marker.
- Do not keep loop state only in memory.

## Required first step
1. Validate `$ARGUMENTS` is one PR URL.
2. Call `review_loop` with `action: "start"` and `prUrl: "$ARGUMENTS"`.
3. If `review_loop start` returns parse or config error, stop immediately and report it.

## Forge capability gate
Support both forges through MCP only.

### GitHub required MCP surface
- read PR details/comments/reviews
- reply to PR comments
- post PR-level summary comment or review

Use tools:
- `github_pull_request_read`
- `github_add_reply_to_pull_request_comment`
- `github_add_issue_comment`
- `github_pull_request_review_write` when needed

### Bitbucket required MCP surface
- read PR metadata
- list PR comments
- add PR comment replies
- add PR-level summary comment
- optional PR task operations if useful

Use tool:
- `bitbucket_bitbucketPullRequest`
  - `action: "get"`
  - `action: "comments"`
  - `action: "comment"`
  - optional `action: "listTasks"|"createTask"|"setTaskState"`

If required MCP tool call fails for either forge, fail immediately. No scraping, no workaround.

## State contract
Use `review_loop` as state owner.

Important fields:
- `lastAiReviewRequestAt`
- `lastAiReviewRequestSha`
- `lastAiReviewRequestHeadSha`
- `latestReviewerSummaryId`
- `latestReviewerSummaryAt`
- `latestReviewerSummaryStatus`
- `lastHandledItemKeys`
- `status`

State files live in:
- `julsemaan-tmp/review-loop/<forge>-<repo>-<pr>/feedback.md`
- `julsemaan-tmp/review-loop/<forge>-<repo>-<pr>/state.json`
- optional `cycle-<n>.md`

## Forge data collection
Use MCP only.

### GitHub
Fetch at minimum:
1. PR metadata via `github_pull_request_read` with `method: "get"`
2. review threads/comments via `method: "get_review_comments"`
3. reviews via `method: "get_reviews"`
4. PR comments via `method: "get_comments"`
5. optional changed files / commits if needed for context

Paginate until complete when needed.

### Bitbucket
Fetch at minimum:
1. PR metadata via `bitbucket_bitbucketPullRequest` with `action: "get"`
2. PR comments via `action: "comments"`
3. optional diff via `action: "diff"`
4. optional tasks via `action: "listTasks"`

Paginate comment/task lists until complete when needed.

## Feedback snapshot
Build structured feedback snapshot and persist it.

Write `feedback.md` with enough detail for each item:
- `itemKey`
- forge/repo/pull number
- thread ID or parent comment ID
- comment ID
- file path / line when present
- author
- body
- createdAt
- updatedAt
- `window: historical|active`
- prior handling fields if known

Stable item fingerprint rule:
- use thread/comment identity plus updated timestamp
- changed comment revision must produce new fingerprint
- unchanged handled fingerprint should be skipped

Then call `review_loop record_feedback_snapshot` with:
- full markdown snapshot
- newest seen comment/review timestamps
- handled item keys carried forward

## Watermark rule
Latest `[ai-review]` push starts review window.

Completion decisions must use only reviewer artifacts with timestamp strictly greater than `lastAiReviewRequestAt`.

Interpretation rules:
- reviewer artifacts at or before watermark: historical only
- reviewer artifacts after watermark: active window
- if no post-watermark reviewer summary exists: do not stop
- old approvals/comments/summaries must never stop loop

## Cycle logic
For each run:
1. Start or resume loop state with `review_loop status` after `start` if needed.
2. Fetch forge PR metadata/comments/reviews/tasks as supported.
3. Split artifacts into:
   - historical context: `timestamp <= lastAiReviewRequestAt`
   - active review window: `timestamp > lastAiReviewRequestAt`
4. Extract actionable items:
   - new items
   - updated items
   - unresolved items needing another pass
5. Skip unchanged items already present in `lastHandledItemKeys`.
6. For each actionable item:
   - run `feedback-reviewer`
   - then run `feedback-worker`
7. Collect machine-usable worker outputs.
8. Post one AI cycle summary comment on PR.
9. If repository diff exists after item work, ensure commits are already created by worker as needed.
10. Create empty commit with exact message `[ai-review]`.
11. Push.
12. Call `review_loop record_ai_review_request` with:
   - empty commit SHA
   - current timestamp
   - current head SHA
13. Call `review_loop record_cycle_result` with:
   - cycle summary
   - current handled item keys
   - `status: "waiting-for-review"`
14. End turn. Extension handles polling follow-up.

## Item handling contract
Each item must drive two agents.

### Reviewer input
Pass one structured item containing:
- PR metadata
- comment/thread IDs
- location
- timestamps
- prior AI actions if known
- whether item is in historical or active window

### Worker input
Pass:
- original structured item
- reviewer decision block
- forge metadata
- exact reply target IDs
- inline anchor metadata when available

## Reviewer summary stop condition
Stop only when latest reviewer summary chosen for decision:
- is authored by reviewer, not AI
- is newer than `lastAiReviewRequestAt`
- clearly says all items are addressed or accepted

When true:
- call `review_loop stop` with `status: "done"`
- report completion

## Continue condition
Continue waiting when any of these hold:
- no post-watermark reviewer summary yet
- post-watermark summary still lists open items
- new actionable feedback exists after watermark

In those cases:
- call `review_loop record_cycle_result` with `status: "waiting-for-review"`
- finish without asking user

## AI cycle summary comment
Post one reviewer-facing summary comment per run.

Include:
- request marker / head SHA
- each tracked item
- status per item: `addressed|accepted|needs-author-action|blocked`
- short note per item
- reply IDs or links if useful

This AI summary is not stop signal. Only reviewer summary after watermark can stop loop.

## Forge reply routing
### GitHub
- thread reply: `github_add_reply_to_pull_request_comment`
- PR-level summary: `github_add_issue_comment`

### Bitbucket
- thread reply: `bitbucket_bitbucketPullRequest` with `action: "comment"` and `parentCommentId`
- inline reply/comment: same tool with `inlinePath` and line anchors when needed
- PR-level summary: same tool with `action: "comment"` and no `parentCommentId`

## Worker commit rule
- Commit only when actual diff exists for that item.
- No empty item commits.
- `[ai-review]` empty commit happens once per cycle, after summary comment.

## Failure rules
- Missing MCP capability: fail immediately.
- Missing push permission or git failure: mark loop blocked with `review_loop stop`.
- Ambiguous reviewer feedback: reviewer may choose `clarify`; worker should post clarification reply and keep loop alive.

## Final response format
Keep assistant response short. Include:
- cycle result
- whether loop is now waiting, done, or blocked
- path to review-loop state dir
