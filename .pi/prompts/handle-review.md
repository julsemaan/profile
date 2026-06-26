---
description: Run autonomous pull-request review loop from a PR URL
argument-hint: "<PR-URL>"
mode: build
---

Load and follow `.pi/skills/review-loop/SKILL.md`.

PR URL: `$ARGUMENTS`

Runner contract:
- Parse PR URL and resolve review-loop state directory.
- Resume existing `state.json` if present. Otherwise create it.
- Run bounded resumable review-loop cycles only. Default `maxIterationsPerRun = 3` unless caller overrides.
- Persist state after meaningful changes and before exit.
- Never sleep or wait in-session. Exit resumably instead.
- Use subagents exactly as required by skill. Main session must not improvise missing MCP, git, code-edit, or reply work.
- At end, print short status summary plus explicit exit reason.

Required exit reasons:
- `done`
- `waiting-for-review`
- `waiting-for-ci`
- `blocked`
- `max-iterations`
- `no-progress`
