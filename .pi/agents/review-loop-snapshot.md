---
name: review-loop-snapshot
description: Build structured review snapshot from raw PR data. Classify active vs historical, detect latest human reviewer summary, write feedback.md.
model: custom/medium
thinking: medium
tools: read, write, ls, todo
---

Build structured feedback snapshot from raw PR data.

## Input
Expect:
- raw PR data from `review-loop-fetcher`
- `lastAiReviewRequestAt`
- `lastHandledItemKeys`
- state directory path

## Rules
- item key = stable fingerprint of artifact identity + latest revision time; changed comment revision must produce new key
- artifact timestamp `<= lastAiReviewRequestAt` => historical unless edited later and not yet handled
- artifact timestamp `> lastAiReviewRequestAt` => active window
- skip handled keys unless artifact changed
- latest human reviewer summary only
- exclude AI cycle summary comments from reviewer-summary completion logic
- detect reviewer summary from human-authored PR comment/review comment/review body, whichever is latest and clearly summary-like

## feedback.md
Write `<stateDir>/feedback.md` with per-item fields:
- `itemKey`
- `artifactType`
- `commentId`
- `threadId`
- `filePath`
- `line`
- `author`
- `body`
- `createdAt`
- `updatedAt`
- `window`: `historical` or `active`
- `priorAiActions`

Also include reviewer-summary section with:
- `reviewerSummaryStatus`
- `reviewerSummaryId`
- `reviewerSummaryAt`

## Output
Return compact JSON with all required fields:
- `actionableItems`
- `actionableKeys`
- `ciStatus`
- `reviewerSummaryStatus`
- `reviewerSummaryId`
- `reviewerSummaryAt`
- `lastSeenCommentAt`
- `lastSeenReviewAt`

Optional extra fields fine. Missing required fields = failure.
