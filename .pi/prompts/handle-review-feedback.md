---
description: Handle GitHub PR review threads and comments with focused worker delegation
argument-hint: "<pr-number-or-url>"
---
Handle GitHub PR review feedback for `$@`.

Workflow requirements:
1. Create an initial todo immediately.
2. Use `github_pr_review_fetch` to fetch review threads and comments for `$@`.
3. Work from PR review threads/comments and general PR comments, not unrelated top-level PR discussion.
4. For each comment or thread, create a todo item.
5. If multiple todo items 
6. If a thread or comment is clearly accepted or already addressed, post a concise reply if needed and mark its todo done without spawning a worker.
7. For review threads, call `review_feedback_subagent` once per grouped item.
8. For general PR comments, handle them directly or use `github_pr_comment_reply` to post replies.
9. If the worker returns `needs_clarification`, use `questionnaire` to ask the user the worker's questions, then continue.
10. Post GitHub replies with `github_pr_review_reply` (for review threads) or `github_pr_comment_reply` (for general comments) before calling `todo.set_done`.
11. Keep replies concise and specific about what changed, why it was already addressed, or what clarification is needed.
12. Summarize grouped todos, worker outcomes, clarification requests, replies posted, and any files changed.
