---
name: fix-lint
description: Use when needing to fix lint issues.
---

# Fix lint errors

Use this skill only for the lint-fix stage explicitly requested by the user. Preserve earlier and later task instructions, and keep the current mode's restrictions. Recognize natural-language requests and explicit `/fix-lint` or `/skill:fix-lint` references.

Read any arguments or extra instructions from the user's request, not prompt-template substitution. For a slash invocation, use the text after the command. For an inline reference or natural-language request, use the instructions attached to that request.

Run `make lint` and fix all lint errors found. Follow this loop:

1. Run `make lint` and capture the output
2. For each lint error, fix the underlying issue in the source code
3. Run `make lint` again to verify the fix
4. Repeat until `make lint` exits with a zero exit code, with no errors

Fix the root cause of each lint error. Do not use lint suppression comments such as `// eslint-disable-next-line`, `# noqa`, or `// NOLINT` unless the suppression is clearly warranted and you have a strong justification for it. Prefer fixing the actual code.

If you encounter errors you cannot fix or that require human judgment, report them clearly at the end.
