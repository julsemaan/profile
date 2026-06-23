---
name: review-loop
description: Autonomous PR review loop. Fetches feedback, reviews each item, implements fixes, posts replies, pushes [ai-review] markers. Self-loops until reviewer approves. Use when you need to handle PR review feedback autonomously in a continuous loop.
---

# Review Loop

Autonomous pull-request review loop. Fetches reviewer feedback, evaluates each item via subagents, implements fixes, posts replies, and self-loops until the reviewer approves.

## Architecture

Single long-lived session. The main session orchestrates only. All work that touches external data runs in subagents — each with a dedicated agent definition:

| Agent | Purpose |
|-------|---------|
| `review-loop-fetcher` | Fetch PR data via MCP |
| `review-loop-snapshot` | Build structured feedback snapshot |
| `feedback-reviewer` | Review one feedback item |
| `feedback-worker` | Implement fix + post reply |
| `review-loop-closer` | Post summary, create [ai-review], push |

```
Main session (orchestration only)
  │
  ├─→ subagent: review-loop-fetcher
  ├─→ subagent: review-loop-snapshot
  ├─→ subagent: feedback-reviewer (per item)
  ├─→ subagent: feedback-worker (per item)
  ├─→ subagent: review-loop-closer
  │
  └─→ bash "sleep 300" → loop
```

## Subagent Maximization Rule

Every unit of work that touches external data (PR, git, MCP) or produces output (code, replies, commits) MUST run in a subagent. Main session only reads/writes `state.json`, tracks progress with `todo`, invokes subagents, and runs `sleep`.

Main session NEVER: calls MCP directly, reads/writes code files, runs git, posts PR comments, or reviews feedback items.

If a subagent fails, report the failure and continue to next item. Never fall back to direct implementation.

## State

State lives on disk:

```
julsemaan-tmp/review-loop/<forge>-<repo>-<pr>/
  state.json    — loop state
  feedback.md   — current feedback snapshot
  cycle-<n>.md  — per-cycle summary
```

`state.json` format:

```json
{
  "prUrl": "https://...",
  "forge": "github",
  "owner": "...",
  "repo": "...",
  "pullNumber": 123,
  "status": "working|waiting-for-review|done|blocked",
  "cycle": 0,
  "lastAiReviewRequestAt": "",
  "lastAiReviewRequestSha": "",
  "lastAiReviewRequestHeadSha": "",
  "lastSeenCommentAt": "",
  "lastSeenReviewAt": "",
  "lastHandledItemKeys": [],
  "latestReviewerSummaryId": "",
  "latestReviewerSummaryAt": "",
  "latestReviewerSummaryStatus": ""
}
```

Read `state.json` at start of every cycle. Write it after every state change. Create the directory and file if they don't exist.

## Subagent Task Templates

### Step 1: Fetch PR Data

```
subagent({ agent: "review-loop-fetcher", task: "Fetch all PR data. Forge: {forge}, owner: {owner}, repo: {repo}, pull number: {pullNumber}." })
```

### Step 2: Build Feedback Snapshot

```
subagent({ agent: "review-loop-snapshot", task: "Build feedback snapshot from the fetched PR data. Watermark timestamp: {lastAiReviewRequestAt}. Already handled keys: {lastHandledItemKeys}. State dir: julsemaan-tmp/review-loop/{forge}-{repo}-{pr}/." })
```

### Step 3: Per-Item Review

For EACH actionable item, run TWO subagents in sequence. These use named agents that already exist:

**First: feedback-reviewer**

```
subagent({ agent: "feedback-reviewer", task: "Review this PR feedback item:
  PR: {forge}/{owner}/{repo}#{pullNumber}
  Comment ID: {commentId}
  Thread ID: {threadId}
  File: {filePath}:{line}
  Author: {author}
  Body: {body}
  Created: {createdAt}
  Window: {window}
  Prior AI actions: {priorAiActions}

Decide fix|reply|clarify|decline and disposition." })
```

**Second: feedback-worker**

```
subagent({ agent: "feedback-worker", task: "Execute the reviewer decision for this PR feedback item.
  Original item: {itemSummary}
  Reviewer decision: {reviewerOutput}
  Forge: {forge}
  Owner: {owner}
  Repo: {repo}
  PR number: {pullNumber}
  Target comment ID: {commentId}
  Thread ID: {threadId}
  File path: {filePath}
  Line: {line}

Implement the fix (if fix), post the reply via MCP, and commit if there's a diff." })
```

Collect each worker's output: decision, disposition, commit SHA, reply text.

### Step 4: Close Cycle

```
subagent({ agent: "review-loop-closer", task: "Close review cycle {cycle} for {forge}/{owner}/{repo}#{pullNumber}. PR URL: {prUrl}. Per-item results: {perItemResults}. Loop should continue: {continueBoolean}." })
```

After this subagent returns, update `state.json`:
- `lastAiReviewRequestAt` = current ISO timestamp
- `lastAiReviewRequestSha` = empty commit SHA
- `lastAiReviewRequestHeadSha` = head SHA
- `cycle` += 1
- Add all handled item fingerprints to `lastHandledItemKeys`
- `status` = `"waiting-for-review"`

## Mid-Review Handling

When `state.json` already exists:

1. **CI pipeline running?** → Log "CI running, waiting." Sleep 300s and re-check. Don't process items until CI completes.

2. **Reviewer summary exists with timestamp > lastAiReviewRequestAt?**
   - Summary says all items addressed → stop loop (`status: "done"`, exit)
   - Summary has open items → process normally

3. **No post-watermark reviewer summary?** → Process active-window items. Do NOT stop.

Old approvals/comments with timestamp <= `lastAiReviewRequestAt` must never trigger loop stop.

## Loop Body

```
while true:
  read state.json
  if status == "done" or status == "blocked": exit

  run subagent: review-loop-fetcher       # Step 1
  run subagent: review-loop-snapshot      # Step 2

  if CI pipeline running:
    log, sleep 300, continue

  for each actionable item:
    run subagent: feedback-reviewer       # Step 3a
    run subagent: feedback-worker         # Step 3b
    collect result

  run subagent: review-loop-closer        # Step 4
  update state.json

  if reviewer summary says all addressed:
    status = "done", write state.json, exit

  if context tokens > 100K:
    compact context: keep only PR URL, forge, repo, pull number, cycle, timestamps, handled item summary

  bash "sleep 300"
```

## Reply Routing (for reference — workers handle this)

- GitHub thread reply: `github_add_reply_to_pull_request_comment`
- GitHub PR-level: `github_add_issue_comment`
- Bitbucket thread reply: `bitbucket_bitbucketPullRequest` action `comment` with `parentCommentId`
- Bitbucket inline: same tool with `inlinePath` and line anchors
- Bitbucket PR-level: same tool action `comment`, no `parentCommentId`

## Watermark Rule

`[ai-review]` empty commit is the watermark. Only reviewer artifacts with timestamp > `lastAiReviewRequestAt` are in the active window.

## Stop Conditions

- Reviewer-authored summary > `lastAiReviewRequestAt` says all items addressed → `status: "done"`
- Required MCP tools unavailable → `status: "blocked"`
- Git push fails → `status: "blocked"`
- User interrupts the session

## Continue Condition

- No post-watermark reviewer summary yet
- Summary has open items
- New actionable feedback in active window
- CI running (sleep, don't process)

## Start Sequence

1. Parse PR URL → forge, owner, repo, pullNumber
2. Check if `state.json` exists:
   - Exists → resume (mid-review handling)
   - Doesn't exist → create dir, write initial `state.json` with `status: "working"`, `cycle: 0`
3. Enter the loop body

## Failure Handling

- **MCP call fails** → mark loop blocked, post PR comment if possible
- **Subagent fails** → log, mark item blocked, continue to next item. Never fall back to direct implementation.
- **Git push fails** → mark loop blocked, post PR comment
- **Ambiguous feedback** → reviewer chooses `clarify`, worker posts question, loop continues
- **>5 cycles with no progress** → post PR comment asking for guidance, continue looping

## Commit Rules

- Item commits: only when diff exists. No empty item commits.
- `[ai-review]` empty commit: once per cycle, after summary comment.
- Push after `[ai-review]`. If push fails, block.

## Output Convention

Each cycle, print:

```
[cycle N] forge#PR · status=<status> · items_handled=<N> · summary=<id|none>
```

Verbose narrative goes in PR summary comment, not main session.
