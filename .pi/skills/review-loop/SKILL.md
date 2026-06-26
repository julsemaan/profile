---
name: review-loop
description: Autonomous PR review loop. Fetches feedback, reviews each item, implements fixes, posts replies, pushes [ai-review] markers. Runs in bounded resumable batches until reviewer approves.
---

# Review Loop

Bounded resumable PR review worker. Never wait inside same session. Do work, persist state, exit with machine-readable markers.

## Main-Session Rule

Main session orchestrates only.

Main session may:
- read and write `state.json`
- track progress with `todo`
- invoke subagents
- decide exit status
- print per-cycle status and final markers

Main session must never:
- call MCP directly
- run git directly
- edit repo files directly
- post PR comments directly
- sleep or poll in-session
- replace failed subagent work with improvised work

## State

State dir:

```text
julsemaan-tmp/review-loop/<forge>-<repo>-<pr>/
  state.json
  feedback.md
  cycle-<n>.md
```

`state.json` core fields:

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

Persist after every meaningful change.

## Subagents

| Agent | Purpose |
|---|---|
| `review-loop-fetcher` | Fetch complete raw PR artifacts + CI status |
| `review-loop-snapshot` | Build structured snapshot, write `feedback.md`, classify active vs historical |
| `feedback-reviewer` | Decide fix/reply/clarify/decline per actionable item |
| `feedback-worker` | Implement decision, post reply, commit if needed |
| `review-loop-closer` | Post AI cycle summary, create `[ai-review]`, push |

## Required flow per cycle

1. read `state.json`
2. run `review-loop-fetcher`
3. run `review-loop-snapshot`
4. check human reviewer summary completion
5. check CI status
6. process actionable items
7. run closer if work happened
8. update state
9. print status + final markers and exit or continue bounded next cycle

## Fetcher contract

Run:

```text
subagent({ agent: "review-loop-fetcher", task: "Fetch all PR data. Forge: {forge}, owner: {owner}, repo: {repo}, pull number: {pullNumber}." })
```

Fetcher must return complete raw artifact data needed for classification:
- PR metadata
- review comments with `id`, `threadId`, `author`, `body`, `createdAt`, `updatedAt`, `path`, `line`, `state`
- reviews with `id`, `author`, `body`, `createdAt`, `updatedAt`, `state`, `submittedAt`
- PR comments with `id`, `author`, `body`, `createdAt`, `updatedAt`
- CI status
- exact failure details on error

No retry.

## Snapshot contract

Run:

```text
subagent({ agent: "review-loop-snapshot", task: "Build feedback snapshot from fetched PR data. Watermark timestamp: {lastAiReviewRequestAt}. Already handled keys: {lastHandledItemKeys}. State dir: julsemaan-tmp/review-loop/{forge}-{repo}-{pr}/." })
```

Snapshot must write `feedback.md` and return JSON with all required fields:
- `actionableItems`
- `actionableKeys`
- `ciStatus`
- `reviewerSummaryStatus`
- `reviewerSummaryId`
- `reviewerSummaryAt`
- `lastSeenCommentAt`
- `lastSeenReviewAt`

Rules:
- latest human reviewer summary only
- AI cycle summary comments never count as reviewer summary
- missing required fields = blocking failure

## Per-item handling

For each actionable item, run:
1. `feedback-reviewer`
2. `feedback-worker`

Collect per-item result: item key, decision, disposition, reply status, commit SHA, failure if any.

## Closer contract

Run:

```text
subagent({ agent: "review-loop-closer", task: "Close review cycle {cycle} for {forge}/{owner}/{repo}#{pullNumber}. PR URL: {prUrl}. Per-item results: {perItemResults}." })
```

Closer posts AI cycle summary comment only. That comment never counts as reviewer approval. Closer must return:
- `summaryCommentId`
- `emptyCommitSha`
- `headSha`

After closer succeeds update:
- `lastAiReviewRequestAt`
- `lastAiReviewRequestSha`
- `lastAiReviewRequestHeadSha`
- `cycle += 1`
- merge handled keys into `lastHandledItemKeys`

## Decision rules

Apply in order after snapshot returns.

1. **Done**
   - only if latest human reviewer summary is newer than `lastAiReviewRequestAt`
   - and summary status says all addressed / approved
   - AI cycle summary comment never finishes loop

2. **Wait for CI**
   - if `ciStatus == "running"`
   - exit deferred, not blocked

3. **Wait for review**
   - if no actionable items and no qualifying newer human reviewer summary
   - exit deferred, not blocked

4. **Process work**
   - handle actionable items item-by-item
   - continue on per-item failure when safe
   - closer failure blocks whole run

## Anti-stall

- Same `actionableKeys` and no progress this cycle -> increment `stagnantCycles`
- Different actionable set or any progress -> reset `stagnantCycles = 0`
- `stagnantCycles >= 2` -> `no-progress`
- fetcher failure -> `blocked`
- snapshot failure or schema miss -> `blocked`
- push failure -> `blocked`
- max 3 cycles per invocation by default -> `max-iterations`

## Progress definition

Progress if any:
- new actionable item processed
- reply posted
- code diff committed
- new human reviewer summary seen

## Output contract

Per cycle print:

```text
[cycle N] forge#PR · status=<status> · actionable=<N> · summary=<status|none>
```

End every invocation with exact final lines in this order:

```text
[exit] reason=<outcome> cycle=<N> detail=<short text>
[WAIT:review poll=300]      # only for waiting-for-review, waiting-for-ci, max-iterations
[GOAL:working|done|blocked]
```

Exact mapping:
- `done` -> `[GOAL:done]`
- `waiting-for-review` -> `[WAIT:review poll=300]` + `[GOAL:working]`
- `waiting-for-ci` -> `[WAIT:review poll=300]` + `[GOAL:working]`
- `max-iterations` -> `[WAIT:review poll=300]` + `[GOAL:working]`
- `blocked` -> `[GOAL:blocked]`
- `no-progress` -> `[GOAL:blocked]`

Use one final goal marker only. Wait marker only for deferred states.

## Start sequence

1. parse PR URL
2. resolve state dir
3. create initial `state.json` if missing
4. run bounded cycles
5. persist final state
6. print final markers exactly
