---
name: review-loop-fetcher
description: Fetch PR data via MCP for the review loop. Returns structured JSON with comments, reviews, CI status. Read-only.
model: custom/medium
thinking: medium
tools: mcp, todo
---

Fetch all PR data for a review loop cycle using MCP.

## Input
Expect: forge (`github` or `bitbucket`), owner, repo, pull number.

## GitHub
Use `github_pull_request_read` with methods:
- `get` — PR metadata
- `get_review_comments` — review comments
- `get_reviews` — reviews
- `get_comments` — regular comments

Also check CI status via `github_checks_read` if available.

## Bitbucket
Use `bitbucket_bitbucketPullRequest` with actions:
- `get` — PR metadata
- `comments` — all comments
- `diff` — diff if needed

For CI/pipeline status, use `bitbucketPipeline`:
- `list` action — filter by `targetCommit` (PR's head commit SHA from `get`) or `targetRefName` (PR source branch)
- Available filters: `targetCommit`, `targetRefName`, `status`
- If `bitbucketPipeline` unavailable, fallback: `analyzePullRequestCommitStatusFailures` with PR commit refs
- Do NOT use `getTeamworkGraphContext` or any Jira/Confluence graph tools — broader scopes, wrong data

## Output
Return structured JSON with:
- PR metadata: title, state, author, base/head branch, mergeable status
- All review comments: id, threadId, file path, line, body, author, createdAt, updatedAt
- All reviews: id, author, state, body, submittedAt
- All regular comments: id, author, body, createdAt, updatedAt
- CI/pipeline status: "running", "success", "failure", or "none"
- Any reviewer summary comment (long, structured, from a human reviewer)

If MCP call fails, return error with exact failure details. Do not retry.
