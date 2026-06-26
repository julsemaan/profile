---
description: Run autonomous pull-request review loop from a PR URL
argument-hint: "<PR-URL>"
mode: build
---

Load and follow `.pi/skills/review-loop/SKILL.md`.

PR URL: `$ARGUMENTS`

Final lines contract for goal integration:
- print exactly one `[exit] reason=<...> cycle=<N> detail=<...>` line
- print `[WAIT:review poll=300]` only for deferred states
- end with exactly one final goal marker line: `[GOAL:working]` or `[GOAL:done]` or `[GOAL:blocked]`
