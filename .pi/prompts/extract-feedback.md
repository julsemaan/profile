---
description: Extract feedback from pull requests that is not yet addressed
argument-hint: "<PR-URL-or-source>"
---
Extract the feedback that is not yet addressed from $ARGUMENTS and put it in julsemaan-tmp/feedback.md

Use an MCP server to obtain this information, either github or bitbucket. If the MCP server cannot be used, fail immediately and do not attempt workarounds.

Ensure the feedback items are extracted with enough details to be evaluated offline.
