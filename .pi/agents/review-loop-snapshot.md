---
name: review-loop-snapshot
description: Build a structured feedback snapshot from raw PR data. Classifies items as historical or active, deduplicates against handled keys. Read/write to disk.
model: custom/medium
thinking: medium
tools: read, write, ls, todo
---

Build a feedback snapshot from raw PR data for the review loop.

## Input
Expect:
- Raw PR data (from fetcher output)
- `lastAiReviewRequestAt` watermark timestamp
- `lastHandledItemKeys` array of already-handled fingerprints
- State directory path

## Rules
- Item fingerprint = `commentId + updatedAt`. Changed comment revision = new fingerprint.
- timestamp <= `lastAiReviewRequestAt` → historical only (skip unless comment was edited after last handling)
- timestamp > `lastAiReviewRequestAt` → active window (actionable)
- Skip items whose fingerprint is in `lastHandledItemKeys` AND updatedAt hasn't changed
- Include items that were handled but have a newer updatedAt (comment was edited)

## Output
1. Write full snapshot to `<stateDir>/feedback.md` with per-item:
   - itemKey (fingerprint)
   - commentId, threadId
   - file path, line (if applicable)
   - author, body
   - createdAt, updatedAt
   - window: `historical` or `active`
   - prior AI actions if any

2. Return compact JSON:
   - `actionableItems`: array of items to process (new or updated, in active window)
   - `ciStatus`: pipeline status
   - `reviewerSummaryExists`: boolean
   - `reviewerSummaryAt`: timestamp if exists
   - `totalItems`: total items found
   - `skippedHistorical`: count of skipped historical items
