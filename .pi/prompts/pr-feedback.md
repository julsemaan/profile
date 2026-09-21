---
description: Use when the user needs to handle feedback on a pull request.
argument-hint: "[<PR-URL>]"
mode: build
---

Read and follow the `pr-feedback` skill from Pi's available skills. Apply it only to the pull-request-feedback stage requested here, preserve earlier task instructions and current mode restrictions, and pass these arguments unchanged. Empty means detect the PR from the current branch:

```text
$@
```
