---
description: Find and fix all merge conflict markers in the codebase
---
Find all files with unresolved merge conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) and resolve them automatically. Follow this loop:

1. Search for conflict markers in the working tree using `git diff --check` or `rg '<<<<<<<|=======|>>>>>>>' --type-add 'all:*' -t all`
2. For each conflict, examine both sides (ours vs theirs) in context
3. Resolve by choosing one side, combining both, or writing a clean merge — never leave conflict markers
4. After resolving all conflicts, run `git diff --check` again to verify no markers remain
5. Repeat until no conflict markers are found

Resolution guidelines:
- Understand the intent of both sides before deciding
- Prefer a clean result that integrates both changes when they are complementary
- When both sides touch the same logic, choose the correct version or synthesize a new one
- Do not leave partial conflict markers, commented-out blocks, or stray separator lines
- If a conflict requires human judgment you cannot resolve, flag the file and explain why

Do not stage or commit the resolutions — leave the changes unstaged for the user to review.
