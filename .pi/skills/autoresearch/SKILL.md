---
name: autoresearch
description: |
  Autonomous research loop for iterative optimization and experimentation.
  Routes to plan/debug/fix/predict/security/scenario/reason/ship/learn docs,
  uses research.md as file-based state, and keeps all references local to this
  skill directory for Pi-safe discovery.
---

# autoresearch

Autonomous research and experimentation toolkit. Use for iterative optimization, overnight research loops, and file-based workflows centered on `research.md`.

All file references below are **relative to this skill directory**.

## Command routing

- Core loop: read `commands/autoresearch.md`
- Plan: read `commands/plan.md`
- Debug: read `commands/debug.md`
- Fix: read `commands/fix.md`
- Predict: read `commands/predict.md`
- Security: read `commands/security.md`
- Scenario: read `commands/scenario.md`
- Reason: read `commands/reason.md`
- Ship: read `commands/ship.md`
- Learn: read `commands/learn.md`

## Routing rule

- If user invokes plain `autoresearch` or asks for autonomous research loops, read `commands/autoresearch.md` and follow it.
- If user asks for `plan`, `debug`, `fix`, `predict`, `security`, `scenario`, `reason`, `ship`, or `learn`, read matching file under `commands/` and follow it.
- Keep any supporting reads inside this skill subtree: `assets/`, `references/`, `scripts/`, `support/`.

## Notes

- `research.md` is primary input/state file for research runs.
- `scripts/init_research.py` scaffolds new research directories.
- `scripts/autoresearch-loop.sh` and `scripts/check_progress.sh` support unattended runs.
