---
name: review-loop
description: Autonomous PR review loop. Fetches feedback, reviews each item, implements fixes, posts replies, pushes [ai-review] markers. Runs in bounded resumable batches until reviewer approves.
---

# Review Loop

Autonomous pull-request review loop. Fetches reviewer feedback, evaluates each item via subagents, implements fixes, posts replies, and exits intentionally after a bounded batch of cycles. Every invocation must be resumable from disk.

## Architecture

Bounded resumable run. Never keep a single long-lived session alive waiting for future review activity.

| Agent | Purpose |
|-------|---------|
| `review-loop-fetcher` | Fetch PR data via MCP |
| `review-loop-snapshot` | Build structured feedback snapshot |
| `feedback-reviewer` | Review one feedback item |
| `feedback-worker` | Implement fix + post reply |
| `review-loop-closer` | Post summary, create `[ai-review]`, push |

```
Main session (orchestration only)
  │
  ├─→ read/write state.json
  ├─→ subagent: review-loop-fetcher
  ├─→ subagent: review-loop-snapshot
  ├─→ subagent: feedback-reviewer (per item)
  ├─→ subagent: feedback-worker (per item)
  ├─→ subagent: review-loop-closer
  └─→ print exit reason, persist state, exit
```

Default run guard:

```json
{
  "maxIterationsPerRun": 3,
  "maxStagnantCycles": 2
}
```

No `while true`. No in-session sleeping. No `bash "sleep 300"`.

## Main-Session Rule

Main session orchestrates only. All work that touches external data (PR, git, MCP) or produces output (code, replies, commits) must run in subagents.

Main session may:
- read and write `state.json`
- track progress with `todo`
- invoke subagents
- decide exit status
- print per-cycle status and final exit reason

Main session must never:
- call MCP directly
- read or write repo code files
- run git
- post PR comments directly
- improvise missing subagent work
- sleep and wait for future work inside same session

If a subagent fails, record failure in state and apply failure rules below. Never fall back to direct implementation.

## State

State lives on disk:

```
julsemaan-tmp/review-loop/<forge>-<repo>-<pr>/
  state.json    — resumable loop state
  feedback.md   — latest feedback snapshot
  cycle-<n>.md  — optional per-cycle summary
```

`state.json` holds only core resume data:

```json
{
  "prUrl": "https://...",
  "forge": "github",
  "owner": "...",
  "repo": "...",
  "pullNumber": 123,
  "cycle": 0,
  "status": "working|waiting-for-review|waiting-for-ci|done|blocked|max-iterations|no-progress",
  "lastAiReviewRequestAt": "",
  "lastAiReviewRequestSha": "",
  "lastAiReviewRequestHeadSha": "",
  "lastSeenCommentAt": "",
  "lastSeenReviewAt": "",
  "lastHandledItemKeys": [],
  "latestReviewerSummaryId": "",
  "latestReviewerSummaryAt": "",
  "latestReviewerSummaryStatus": "",
  "lastExitReason": "",
  "lastActionableKeys": [],
  "stagnantCycles": 0
}
```

Field intent:
- PR identity: `prUrl`, `forge`, `owner`, `repo`, `pullNumber`
- cycle/status: `cycle`, `status`
- watermark fields: `lastAiReviewRequestAt`, `lastAiReviewRequestSha`, `lastAiReviewRequestHeadSha`
- reviewer-watermark fields: `lastSeenCommentAt`, `lastSeenReviewAt`, `latestReviewerSummaryId`, `latestReviewerSummaryAt`, `latestReviewerSummaryStatus`
- handled item keys: `lastHandledItemKeys`
- anti-stall markers: `lastExitReason`, `lastActionableKeys`, `stagnantCycles`

Read `state.json` at start of every cycle. Write it after every meaningful state change. Create directory and initial file if missing.

## Run Outcomes

Every invocation must end with exactly one of these outcomes and print it before exit:
- `done`
- `waiting-for-review`
- `waiting-for-ci`
- `blocked`
- `max-iterations`
- `no-progress`

Print format:

```
[exit] reason=<outcome> cycle=<N> detail=<short text>
```

Persist same outcome to `state.json.status` and `state.json.lastExitReason`.

## Progress Definition

A cycle counts as progress if any of these happen:
- new actionable item processed
- reply posted
- code diff committed
- new reviewer summary seen

If none happen, cycle made no progress.

## Subagent Contracts

### Step 1: Fetch PR Data

```
subagent({ agent: "review-loop-fetcher", task: "Fetch all PR data. Forge: {forge}, owner: {owner}, repo: {repo}, pull number: {pullNumber}." })
```

Fetcher must return PR metadata, comments, reviews, CI status, and any reviewer summary. No retry.

### Step 2: Build Feedback Snapshot

```
subagent({ agent: "review-loop-snapshot", task: "Build feedback snapshot from fetched PR data. Watermark timestamp: {lastAiReviewRequestAt}. Already handled keys: {lastHandledItemKeys}. State dir: julsemaan-tmp/review-loop/{forge}-{repo}-{pr}/." })
```

Snapshot must write `feedback.md` and return compact JSON with at least:
- `actionableItems`
- `actionableKeys`
- `ciStatus`
- `reviewerSummaryStatus`
- `reviewerSummaryAt`

Optional extra fields fine. Main session should treat missing required fields as blocking failure.

### Step 3: Per-Item Review

For each actionable item, run two subagents in sequence.

**First: `feedback-reviewer`**

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

**Second: `feedback-worker`**

```
subagent({ agent: "feedback-worker", task: "Execute reviewer decision for this PR feedback item.
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

Implement fix if needed, post reply via MCP, and commit if there is a diff." })
```

Collect each worker result: decision, disposition, commit SHA, reply status, item key, failure if any.

### Step 4: Close Cycle

Use closer only for:
- summary comment
- `[ai-review]` empty commit
- push

```
subagent({ agent: "review-loop-closer", task: "Close review cycle {cycle} for {forge}/{owner}/{repo}#{pullNumber}. PR URL: {prUrl}. Per-item results: {perItemResults}." })
```

After closer succeeds, update:
- `lastAiReviewRequestAt` = current ISO timestamp
- `lastAiReviewRequestSha` = empty commit SHA
- `lastAiReviewRequestHeadSha` = head SHA
- `cycle` += 1
- merge handled item fingerprints into `lastHandledItemKeys`

## Cycle Contract

One cycle is always:
1. read `state.json`
2. fetch PR data
3. build snapshot
4. check reviewer-summary completion
5. check CI status
6. process actionable items
7. close cycle if work happened
8. update state
9. decide exit

Exit immediately after cycle batch finishes. Never wait inside same session for future review or CI changes.

## Decision Rules Per Cycle

Apply in this order after snapshot returns:

1. **Reviewer summary says all addressed**
   - If `reviewerSummaryAt > lastAiReviewRequestAt` and summary status says all addressed:
   - set `status = "done"`
   - set `lastExitReason = "done"`
   - print exit reason and exit

2. **CI still running**
   - If `ciStatus == "running"`:
   - set `status = "waiting-for-ci"`
   - set `lastExitReason = "waiting-for-ci"`
   - persist snapshot watermarks
   - print exit reason and exit

3. **Nothing actionable and no new post-watermark reviewer summary**
   - If `actionableItems` empty and no newer reviewer summary:
   - set `status = "waiting-for-review"`
   - set `lastExitReason = "waiting-for-review"`
   - print exit reason and exit

4. **Actionable work exists**
   - Process items via `feedback-reviewer` then `feedback-worker`
   - Continue item-by-item even if one item fails, when safe
   - If closer succeeds, update watermark fields and cycle count
   - Recompute progress and anti-stall fields
   - Either continue next bounded iteration or exit by guard below

## Anti-Stall Rules

### Actionable-set stagnation

Compare current `actionableKeys` to `lastActionableKeys`.

- Same actionable set and no progress this cycle → increment `stagnantCycles`
- Different actionable set or any progress → reset `stagnantCycles = 0`

If `stagnantCycles >= maxStagnantCycles`:
- set `status = "no-progress"`
- set `lastExitReason = "no-progress"`
- print exit reason and exit

### Blocking failures

If fetcher, snapshot, or closer fails in a blocking way:
- set `status = "blocked"`
- set `lastExitReason = "blocked"`
- persist exact failure summary in cycle notes if possible
- print exit reason and exit

### Per-item failures

If one item fails but rest remain processable:
- record item failure
- continue remaining items
- do not mark whole run blocked unless closer/fetch/state contract becomes impossible

### Iteration guard

Each invocation may run at most `maxIterationsPerRun` cycles. Default `3`.

If guard trips before another deterministic terminal state:
- set `status = "max-iterations"`
- set `lastExitReason = "max-iterations"`
- print exit reason and exit

## Resume Rules

When `state.json` exists:
- resume from disk, do not reinitialize
- preserve `cycle`, watermark fields, handled keys, last exit reason
- use `lastHandledItemKeys` and watermark fields to avoid reprocessing already-addressed items
- keep resume deterministic: same snapshot + same state should produce same next action

## Watermark Rule

`[ai-review]` empty commit is watermark. Only reviewer artifacts with timestamp greater than `lastAiReviewRequestAt` belong to active window.

## Failure Handling

- **Fetcher failure** → `blocked`
- **Snapshot failure or missing required schema** → `blocked`
- **Closer push failure** → `blocked`
- **Ambiguous feedback** → reviewer may choose `clarify`; worker posts question; cycle still counts as progress if reply posted
- **Repeated same actionable set with no progress for 2 cycles** → `no-progress`

## Commit Rules

- Item commits only when diff exists. No empty item commits.
- `[ai-review]` empty commit once per successful closing cycle, after summary comment.
- Push after `[ai-review]`. If push fails, block.

## Output Convention

Per cycle, print:

```
[cycle N] forge#PR · status=<status> · actionable=<N> · summary=<status|none>
```

At end of invocation, always print:

```
[exit] reason=<outcome> cycle=<N> detail=<short text>
```

Verbose narrative belongs in PR summary comment, not main session.

## Start Sequence

1. Parse PR URL → forge, owner, repo, pullNumber
2. Resolve state dir `julsemaan-tmp/review-loop/<forge>-<repo>-<pr>/`
3. If `state.json` missing, create it with:
   - `cycle: 0`
   - `status: "working"`
   - empty watermark and tracking fields
   - `lastExitReason: ""`
   - `lastActionableKeys: []`
   - `stagnantCycles: 0`
4. Run up to `maxIterationsPerRun` cycles
5. Persist final state and print exit reason
