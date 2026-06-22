---
description: Run autonomous pull-request review loop from a PR URL
argument-hint: "<PR-URL>"
---

Run `/handle-review $ARGUMENTS` as single autonomous PR review loop.

## Rules
- This workflow owns full loop.
- Do not call deleted legacy prompts.
- Do not ask user between items.
- Use MCP only for forge access. No scraping.
- Do not trust reviewer summaries from before latest `[ai-review]` marker.
- Do not keep loop state only in memory.

## Required first step
1. Validate `$ARGUMENTS` is one PR URL.
2. Call `review_loop` with `action: "status"`.
3. If loop already active for `$ARGUMENTS`, resume it.
4. Otherwise call `review_loop` with `action: "start"` and `prUrl: "$ARGUMENTS"`.
5. If `review_loop start` returns parse or config error, stop immediately and report it.

## Forge capability gate
Support GitHub and Bitbucket through MCP only.

### GitHub
Required tools:
- `github_pull_request_read`
- `github_add_reply_to_pull_request_comment`
- `github_add_issue_comment`
- `github_pull_request_review_write` when needed

Use `github_pull_request_read` for at least:
- `method: "get"`
- `method: "get_review_comments"`
- `method: "get_reviews"`
- `method: "get_comments"`

### Bitbucket
Required tool:
- `bitbucket_bitbucketPullRequest`

Use at least:
- `action: "get"`
- `action: "comments"`
- `action: "comment"`
- optional `action: "diff"`
- optional `action: "listTasks"|"createTask"|"setTaskState"`

If required MCP call fails, fail immediately.

## State contract
Use `review_loop` as state owner.

State fields that matter:
- `lastAiReviewRequestAt`
- `lastAiReviewRequestSha`
- `lastAiReviewRequestHeadSha`
- `latestReviewerSummaryId`
- `latestReviewerSummaryAt`
- `latestReviewerSummaryStatus`
- `lastHandledItemKeys`
- `status`

State files live in:
- `julsemaan-tmp/review-loop/<forge>-<repo>-<pr>/state.json`
- `julsemaan-tmp/review-loop/<forge>-<repo>-<pr>/feedback.md`
- optional `cycle-<n>.md`

Detailed disk artifacts are optional/debug-only. Do not send bulky snapshots through tool args in normal path.

## Feedback snapshot
Build structured feedback snapshot from fetched artifacts.

When useful, write `feedback.md` locally with enough detail per item:
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

Call `review_loop record_feedback_snapshot` with only compact state:
- `lastSeenCommentAt`
- `lastSeenReviewAt`
- `lastHandledItemKeys`
- optional tiny status/error fields when useful

Do not pass full `feedbackMarkdown` unless debugging specific persistence issues.

## Watermark rule
Latest `[ai-review]` push starts active review window.

Completion decisions must use only reviewer artifacts with timestamp strictly greater than `lastAiReviewRequestAt`.

Interpretation:
- `timestamp <= lastAiReviewRequestAt` => historical only
- `timestamp > lastAiReviewRequestAt` => active window
- if no post-watermark reviewer summary exists, do not stop
- old approvals/comments/summaries must never stop loop

## Cycle logic
For each run:
1. Resume same PR loop when active. Only call `review_loop start` when needed.
2. Fetch PR metadata plus comments/reviews/tasks as supported.
3. Split artifacts into historical vs active window using watermark rule.
4. Extract actionable items:
   - new items
   - updated items
   - unresolved items needing another pass
5. Skip unchanged items already in `lastHandledItemKeys`.
6. For each actionable item:
   - run `feedback-reviewer`
   - then run `feedback-worker`
7. Collect machine-usable worker outputs.
8. Post one AI cycle summary comment on PR.
9. If repository diff exists after item work, ensure worker already committed as needed.
10. Create empty commit with exact message `[ai-review]`.
11. Push.
12. Call `review_loop record_ai_review_request` with:
   - empty commit SHA
   - current timestamp
   - current head SHA
13. Call `review_loop record_cycle_result` with compact machine fields only:
   - short `cycleSummary` for machine resume, not reviewer-facing narrative
   - current handled item keys
   - latest reviewer summary metadata when known
   - `status: "waiting-for-review"`
14. End turn. Extension handles polling follow-up.

Keep `cycleSummary` short and machine-usable. If detailed narrative is useful, put it in PR comment or optional disk artifact, not tool args.

## Item handling contract
Each actionable item must drive two agents.

### Reviewer input
Pass one structured item containing:
- PR metadata
- comment/thread IDs
- location
- timestamps
- prior AI actions if known
- whether item is historical or active

### Worker input
Pass:
- original structured item
- reviewer decision block
- forge metadata
- exact reply target IDs
- inline anchor metadata when available

## Reviewer summary stop condition
Stop only when latest reviewer summary chosen for decision:
- authored by reviewer, not AI
- newer than `lastAiReviewRequestAt`
- clearly says all items are addressed or accepted

Then:
- call `review_loop stop` with `status: "done"`
- report completion

## Continue condition
Keep waiting when any hold:
- no post-watermark reviewer summary yet
- post-watermark summary still lists open items
- new actionable feedback exists after watermark

Then call `review_loop record_cycle_result` with `status: "waiting-for-review"` and finish without asking user.

## Reply routing
### GitHub
- thread reply: `github_add_reply_to_pull_request_comment`
- PR-level summary: `github_add_issue_comment`

### Bitbucket
- thread reply: `bitbucket_bitbucketPullRequest` with `action: "comment"` and `parentCommentId`
- inline reply/comment: same tool with `inlinePath` and line anchors when needed
- PR-level summary: same tool with `action: "comment"` and no `parentCommentId`

## Commit and failure rules
- Commit only when actual diff exists for item.
- No empty item commits.
- `[ai-review]` empty commit happens once per cycle, after summary comment.
- Missing MCP capability: fail immediately.
- Missing push permission or git failure: mark loop blocked with `review_loop stop`.
- Ambiguous reviewer feedback: reviewer may choose `clarify`; worker should reply and keep loop alive.

## Final response format
Keep assistant response short. Include:
- cycle result
- whether loop is now waiting, done, or blocked
- path to review-loop state dir
