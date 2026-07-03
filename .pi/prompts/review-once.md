---
description: Single-pass PR feedback processor. Fetch, review, fix, push. No loop, no watermark.
argument-hint: "<PR-URL>"
mode: build
---

# Review Once

Single-pass PR feedback processor. Fetch feedback, review each item, implement fixes, post replies, push real diffs. No loop, no `[ai-review]` watermark commit, no state persistence.

PR URL: `$ARGUMENTS`

## Flow

### 1. Parse PR URL

Extract from `$ARGUMENTS`:
- `forge`: `github` or `bitbucket`
- `owner`
- `repo`
- `pullNumber`

If URL cannot be parsed, fail immediately with clear error.

### 2. Fetch PR Data

Run fetcher subagent:

```
subagent({
  agent: "review-loop-fetcher",
  task: "Fetch all PR data. Forge: {forge}, owner: {owner}, repo: {repo}, pull number: {pullNumber}."
})
```

Capture raw PR data from fetcher return. If fetcher fails, fail immediately with exact error.

### 3. Build Snapshot

Create working directory:

```bash
mkdir -p julsemaan-tmp/review-once
```

Run snapshot subagent:

```
subagent({
  agent: "review-loop-snapshot",
  task: "Build feedback snapshot from raw PR data. No watermark timestamp (treat everything as active). No already-handled keys. State dir: julsemaan-tmp/review-once/."
})
```

Capture snapshot return: `actionableItems`, `actionableKeys`, `ciStatus`, `reviewerSummaryStatus`.

If no actionable items and CI is not failing, print "No actionable feedback found" and exit.

### 4. Process Items

For each actionable item, run reviewer then worker in sequence. No user confirmation — auto-process all.

#### a. Review

```
subagent({
  agent: "feedback-reviewer",
  task: "<full feedback item text with PR metadata>",
  agentScope: "both"
})
```

Capture reviewer output: Decision, Disposition, Rationale, Suggested Action, Reply Text, Confidence.

#### b. Execute

```
subagent({
  agent: "feedback-worker",
  task: "Feedback: <item>\n\nReviewer Recommendation:\nDecision: <decision>\nRationale: <rationale>\nSuggested Action: <action>\nConfidence: <confidence>",
  agentScope: "both"
})
```

Capture worker output: Decision, Disposition, Rationale, Action Taken, Files Changed, Validation, Commit SHA, Suggested Reply.

Collect per-item results for summary.

### 5. Push

After all items processed, check for real commits (exclude empty commits):

```bash
git log origin/HEAD..HEAD --oneline
```

If real commits exist, push:

```bash
git push
```

If push fails, report error with exact git output. Do not retry.

No `[ai-review]` empty commit. No closer subagent.

### 6. Summary

Print structured summary:

```
# Review Once Summary

PR: {prUrl}
CI Status: {ciStatus}
Reviewer Summary Status: {reviewerSummaryStatus}

Items Processed: {count}
- Fixes: {count}
- Replies: {count}
- Clarifications: {count}
- Declined: {count}

## Per-Item Details

| # | Key | Decision | Disposition | Files Changed | Commit |
|---|-----|----------|-------------|---------------|--------|
| 1 | ...  | fix      | addressed   | src/foo.ts    | abc123 |
| 2 | ...  | reply    | accepted    | -             | none   |

Pushed: yes|no
```

## Edge Cases

- **URL parse failure**: Fail immediately with clear error.
- **Fetcher failure**: Fail immediately with exact error.
- **Snapshot failure**: Fail immediately with exact error.
- **No actionable items**: Print message, exit cleanly.
- **Worker fails per-item**: Continue to next item. Report failure in summary.
- **No commits to push**: Skip push step, note in summary.
- **Push failure**: Report error, do not retry.
- **CI failing**: Report in summary but do not block.
