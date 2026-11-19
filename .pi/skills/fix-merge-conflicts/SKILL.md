---
name: fix-merge-conflicts
description: Use when solving merge conflicts.
---

# Fix merge conflicts

Use this skill only for the merge-conflict-resolution stage explicitly requested by the user. Preserve earlier and later task instructions, and keep the current mode's restrictions. Recognize natural-language requests and explicit `/fix-merge-conflicts` or `/skill:fix-merge-conflicts` references.

Read any arguments or extra instructions from the user's request, not prompt-template substitution. For a slash invocation, use the text after the command. For an inline reference or natural-language request, use the instructions attached to that request.

Find all files with unresolved merge conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) and resolve them automatically. Follow this loop:

1. Search for conflict markers in the working tree using `git diff --check` or `rg '<<<<<<<|=======|>>>>>>>' --type-add 'all:*' -t all`
2. For each conflict, examine both sides, ours and theirs, in context
3. Resolve by choosing one side, combining both, or writing a clean merge. Never leave conflict markers
4. After resolving all conflicts, run `git diff --check` again to verify no markers remain
5. Repeat until no conflict markers are found

Resolution guidelines:
- Understand the intent of both sides before deciding
- Prefer a clean result that integrates both changes when they are complementary
- When both sides touch the same logic, choose the correct version or synthesize a new one
- Do not leave partial conflict markers, commented-out blocks, or stray separator lines
- If a conflict requires human judgment you cannot resolve, flag the file and explain why

Do not stage or commit the resolutions. Leave the changes unstaged for the user to review.
