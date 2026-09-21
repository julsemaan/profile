---
name: pr-feedback
description: Use when the user needs to handle feedback on a pull request.
---

# PR feedback

Use this skill only for the pull-request-feedback stage explicitly requested by the user. Preserve earlier and later task instructions, and keep the current mode's restrictions. Recognize natural-language requests and explicit `/pr-feedback` or `/skill:pr-feedback` references.

Read the PR URL from the user's request, not prompt-template substitution. For a slash invocation, use the URL after the command. For an inline reference or natural-language request, extract the URL supplied with that request. Do not reinterpret earlier task instructions as feedback work.

Process one pull request in one pass. No loop. No state file. No watermark commits. No wait markers.

## Main-session rules

Main session orchestrates only.

Main session may:
- parse PR URL
- resolve a missing PR URL with the list calls in step 0 only
- invoke subagents
- run `git log`, `git push`, and other read-only git checks
- aggregate results
- print final operator report

Main session must not:
- call MCP directly for PR fetch, diff, comment, or replies outside the step 0 resolution
- improvise fallback workflows if subagents fail
- create empty commits
- create resumable state
- emit `[ai-review]`, `[WAIT:review ...]`, or goal markers

## Flow

### 0. Resolve PR URL

If the request holds a PR URL, use it and continue to step 1.

Else resolve from the current branch:

1. Get the branch from `git branch --show-current`. Fail on detached or empty.
2. Pick the remote from the branch upstream, else `origin`. Fail if it is missing.
3. Read fetch and push URLs. Require the same repo and host exactly `github.com` or `bitbucket.org`. Parse owner and repo, or workspace and repo, strip one trailing `.git`, reusing the `github-open-pr` and `bitbucket-open-pr` URL rules. Head is the branch name.
4. Look up the open PR for that head:
   - GitHub: `github_list_pull_requests` with state open, head `owner:branch`, `perPage 100`, small fields for number, title, url, head, base.
   - Bitbucket: `bitbucket_bitbucketPullRequest` with action list, state OPEN, query on source branch name. Keep the single retry on `Bad Request` from the `bitbucket-open-pr` skill.
5. One match means use its URL. Zero matches means fail with no open PR for this branch. Several matches means fail listing the candidate URLs. The user re-runs with an explicit URL in those cases.

### 1. Parse and validate PR URL

Parse the resolved URL from step 0 into:
- `forge`: `github` or `bitbucket`
- `owner` or workspace
- `repo`
- `pullNumber`

Supported forms:
- GitHub: `https://github.com/<owner>/<repo>/pull/<number>`
- Bitbucket Cloud: `https://bitbucket.org/<workspace>/<repo>/pull-requests/<number>`

If the URL is invalid or the forge is unsupported, fail immediately with the exact reason.

### 2. Run analyzer

Call:

```text
subagent({
  agent: "pr-feedback-analyzer",
  task: "Analyze PR URL: <resolved PR URL from step 0>. Parse and fetch PR state. Return pullRequest, ciStatus, reviewerSummaryStatus, reviewerSummaryAt, and actionableItems with exact reply-routing metadata for every actionable item.",
  agentScope: "both"
})
```

Treat analyzer output as the source of truth. If the analyzer fails or omits required top-level fields, fail immediately with the exact error.

### 3. No-op exit

If `actionableItems` is empty:
- print a compact no-op report
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

If the reviewer fails for one item:
- record item failure
- continue to the next item
- do not call the worker for that item

#### b. Worker

Call:

```text
subagent({
  agent: "pr-feedback-worker",
  task: "PR URL: <actual prUrl>\nPR metadata: <serialized pullRequest JSON>\nFeedback item: <serialized item JSON>\n\nReviewer recommendation:\n<full reviewer block>",
  agentScope: "both"
})
```

The worker must:
- execute the smallest valid action for the item
- post the exact PR reply for the item
- commit only if a real diff exists
- return reply target, reply posted status, reply status, commit SHA, files changed, and validation

If the worker fails for one item:
- record item failure
- continue to the next item

### 5. Push once

After all items:

```bash
BRANCH=$(git rev-parse --abbrev-ref HEAD)
git log --oneline @{upstream}..HEAD 2>/dev/null || git log --oneline origin/HEAD..HEAD 2>/dev/null || true
git push --set-upstream origin "$BRANCH"
```

`--set-upstream` creates the tracking ref if missing and updates it if present, so branches created in worktrees without an upstream push cleanly.

Rules:
- push once only
- if push fails, report the exact failure
- do not retry
- do not create synthetic commits

### 6. Final report

Print a compact operator rollup with:
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

Keep the report compact. Include exact failure text only for failed items or failed push.

## Required policy

Every actionable item must receive a PR reply.
- `fix` means reply with a change summary and validation
- `reply` means direct response
- `clarify` means a targeted question
- `decline` means a polite technical decline

A reply is mandatory. A code diff is optional.

## Decision counting

Count by reviewer decision unless the worker proves a different final action was necessary. Mark an item as failed if:
- reviewer output is missing required fields
- worker fails
- worker reports that the reply was not posted

## Minimalism rules

- Smallest valid action wins
- No batching multiple feedback items into one worker task
- No empty commits
- No background polling
- No backward-compatibility aliases inside this flow
- No giant execution trace unless something fails

## Final sanity checks

Before printing the final report, verify:
- every actionable item has a per-item result
- every successful item reports a reply target and reply status
- every `fix` item reports validation text
- push executed at most once

If any of those checks fail, mark the affected item or push step as failed in the report.

## Failure handling

- Invalid URL means fail fast
- Unsupported forge means fail fast
- Analyzer failure means fail fast
- Per-item reviewer or worker failure means continue and report the exact failure
- Push failure means report the exact failure and do not retry
- Never silently skip reply posting
- Never silently downgrade a failed fix to reply-only
- Never invent MCP fallback outside the worker

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

If there are no actionable items, print the same report with zero counts and an empty table.

Do not print any extra footer markers.

## Important

Always call subagents with `agentScope: "both"`. Do not use deleted review-loop agents or prompts. Use only `pr-feedback-analyzer`, `pr-feedback-reviewer`, and `pr-feedback-worker`.

If old names appear anywhere in scratch reasoning, ignore them. Use new names only.

## Note on task strings

When constructing subagent task strings, insert the actual serialized PR metadata and item payloads. Do not send placeholders literally.

## TODO discipline

Track orchestration progress with `todo` while running this command. Keep one item for analyze, one for per-item processing, and one for final push/report. Ensure todos are completed before exit.

## Git safety

Never run `git add *`. If the worker created commits, assume the worker staged only intended files. Main session only inspects commit state and runs the single final `git push --set-upstream origin "$(git rev-parse --abbrev-ref HEAD)"` when needed.

## Success definition

Success means:
- analyzer returned valid actionable items
- every actionable item was reviewed
- every actionable item got a PR reply attempt
- any real commits were pushed once
- the final report shows reply outcomes and commit outcomes
