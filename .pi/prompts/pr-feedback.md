---
description: Fetch PR feedback, triage each actionable item, reply in-thread, push once if needed
argument-hint: "<PR-URL>"
mode: build
---

# PR Feedback

Process one pull request in one pass. No loop. No state file. No watermark commits. No wait markers.

PR URL: `$ARGUMENTS`

## Main-session rules

Main session orchestrates only.

Main session may:
- parse PR URL
- invoke subagents
- run `git log`, `git push`, and other read-only git checks
- aggregate results
- print final operator report

Main session must not:
- call MCP directly for PR fetch or replies
- improvise fallback workflows if subagents fail
- create empty commits
- create resumable state
- emit `[ai-review]`, `[WAIT:review ...]`, or goal markers

## Flow

### 1. Parse and validate PR URL

Parse `$ARGUMENTS` into:
- `forge`: `github` or `bitbucket`
- `owner` or workspace
- `repo`
- `pullNumber`

Supported forms:
- GitHub: `https://github.com/<owner>/<repo>/pull/<number>`
- Bitbucket Cloud: `https://bitbucket.org/<workspace>/<repo>/pull-requests/<number>`

If URL is invalid or forge unsupported, fail immediately with exact reason.

### 2. Run analyzer

Call:

```text
subagent({
  agent: "pr-feedback-analyzer",
  task: "Analyze PR URL: $ARGUMENTS. Parse and fetch PR state. Return pullRequest, ciStatus, reviewerSummaryStatus, reviewerSummaryAt, and actionableItems with exact reply-routing metadata for every actionable item.",
  agentScope: "both"
})
```

Treat analyzer output as source of truth.
If analyzer fails or omits required top-level fields, fail immediately with exact error.

### 3. No-op exit

If `actionableItems` is empty:
- print compact no-op report
- include PR URL
- include CI status
- include reviewer summary status and time
- `pushed: no`
- exit cleanly

### 4. Process each actionable item

For each `actionableItems[]` entry, in order:

#### a. Reviewer

Call:

```text
subagent({
  agent: "pr-feedback-reviewer",
  task: "PR URL: <actual prUrl>\nPR metadata: <serialized pullRequest JSON>\nFeedback item: <serialized item JSON>",
  agentScope: "both"
})
```

Reviewer must return exact fields:
- `Decision`
- `Disposition`
- `Rationale`
- `Suggested Action`
- `Reply Text`
- `Validation`
- `Confidence`

If reviewer fails for one item:
- record item failure
- continue to next item
- do not call worker for that item

#### b. Worker

Call:

```text
subagent({
  agent: "pr-feedback-worker",
  task: "PR URL: <actual prUrl>\nPR metadata: <serialized pullRequest JSON>\nFeedback item: <serialized item JSON>\n\nReviewer recommendation:\n<full reviewer block>",
  agentScope: "both"
})
```

Worker must:
- execute smallest valid action for item
- post exact PR reply for item
- commit only if real diff exists
- return reply target, reply posted status, reply status, commit SHA, files changed, validation

If worker fails for one item:
- record item failure
- continue to next item

### 5. Push once

After all items:

Check for commits ahead of upstream:

```bash
git log --oneline @{upstream}..HEAD
```

If output is non-empty, run:

```bash
git push
```

Rules:
- push once only
- if push fails, report exact failure
- do not retry
- do not create synthetic commits

If upstream is unavailable, fall back to:

```bash
git log --oneline origin/HEAD..HEAD
```

If both checks fail, report push-status uncertainty in final report.

### 6. Final report

Print compact operator rollup with:
- `PR URL`
- `CI Status`
- `Reviewer Summary Status`
- `Reviewer Summary At`
- `Pushed: yes|no|failed|unknown`
- counts for:
  - `fixed`
  - `replied`
  - `clarified`
  - `declined`
  - `failed`
- blocked items needing human action
- commit SHAs
- per-item table with columns:
  - `Key`
  - `Decision`
  - `Disposition`
  - `Files Changed`
  - `Reply Posted`
  - `Reply Target`
  - `Commit`

Keep report compact. Include exact failure text only for failed items or failed push.

## Required policy

Every actionable item must receive PR reply.
- `fix` => reply with change summary + validation
- `reply` => direct response
- `clarify` => targeted question
- `decline` => polite technical decline

Reply is mandatory. Code diff is optional.

## Decision counting

Count by reviewer decision unless worker proves different final action was necessary.
Mark item as failed if:
- reviewer output missing required fields
- worker fails
- worker reports reply not posted

## Minimalism rules

- Smallest valid action wins
- No batching multiple feedback items into one worker task
- No empty commits
- No background polling
- No backward-compat aliases inside this flow
- No giant execution trace unless something fails

## Final sanity checks

Before printing final report, verify:
- every actionable item has per-item result
- every successful item reports reply target and reply status
- every `fix` item reports validation text
- push executed at most once

If any of those checks fail, mark affected item or push step as failed in report.

## Failure handling

- Invalid URL => fail fast
- Unsupported forge => fail fast
- Analyzer failure => fail fast
- Per-item reviewer or worker failure => continue, report exact failure
- Push failure => report exact failure, do not retry
- Never silently skip reply posting
- Never silently downgrade failed fix to reply-only
- Never invent MCP fallback outside worker

## Output shape

Use this shape:

```text
# PR Feedback Report

PR URL: ...
CI Status: ...
Reviewer Summary Status: ...
Reviewer Summary At: ...
Pushed: ...

Counts:
- Fixed: ...
- Replied: ...
- Clarified: ...
- Declined: ...
- Failed: ...

Blocked Items Needing Human Action:
- ...

Commit SHAs:
- ...

| Key | Decision | Disposition | Files Changed | Reply Posted | Reply Target | Commit |
| --- | --- | --- | --- | --- | --- | --- |
| ... | ... | ... | ... | ... | ... | ... |

Failures:
- <only when present>
```

If no actionable items, print same report with zero counts and empty table.

Do not print any extra footer markers.

## Important

Always call subagents with `agentScope: "both"`.
Do not use deleted review-loop agents or prompts.
Use only `pr-feedback-analyzer`, `pr-feedback-reviewer`, and `pr-feedback-worker`.

If old names appear anywhere in scratch reasoning, ignore them.
Use new names only.

## Note on task strings

When constructing subagent task strings, insert actual serialized PR metadata and item payloads. Do not send placeholders literally.

## TODO discipline

Track orchestration progress with `todo` while running this command.
Keep one item for analyze, one for per-item processing, one for final push/report.
Ensure todos are completed before exit.

## Git safety

Never run `git add *`.
If worker created commits, assume worker staged only intended files.
Main session only inspects commit state and runs single final `git push` when needed.

## Success definition

Success means:
- analyzer returned valid actionable items
- every actionable item was reviewed
- every actionable item got PR reply attempt
- any real commits were pushed once
- final report shows reply outcomes and commit outcomes
