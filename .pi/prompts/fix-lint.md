---
description: Run make lint and fix all lint errors automatically
mode: build
---
Run `make lint` and fix all lint errors found. Follow this loop:

1. Run `make lint` and capture the output
2. For each lint error, fix the underlying issue in the source code
3. Run `make lint` again to verify the fix
4. Repeat until `make lint` exits with a zero exit code (no errors)

Fix the root cause of each lint error — do not use lint suppression comments (e.g., `// eslint-disable-next-line`, `# noqa`, `// NOLINT`) unless the suppression is clearly warranted and you have a strong justification for it. Prefer fixing the actual code.

If you encounter errors you cannot fix or that require human judgment, report them clearly at the end.
