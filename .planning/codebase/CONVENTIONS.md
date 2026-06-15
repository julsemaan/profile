# Coding Conventions

**Analysis Date:** 2026-04-26

## Naming Patterns

**Files:**
- Use kebab-case for JavaScript and shell entrypoints, especially operational scripts and hooks: `.opencode/hooks/gsd-statusline.js`, `.opencode/hooks/gsd-context-monitor.js`, `profile/opencode-unleashed-safely.sh`, `utils/disable-webcam-autofocus.sh`.
- Use dotfiles for user profile configuration and editor/runtime config: `.opencode/opencode.json`, `profile/.bashrc_append`, `profile/.tmux.conf`, `profile/.vimrc`.
- Use `*.session.sh` and `*.window.sh` suffixes for tmuxifier definitions: `tmuxifiers/kpp.session.sh`, `tmuxifiers/coding.window.sh`.

**Functions:**
- Use camelCase for JavaScript functions: `detectConfigDir` in `.opencode/hooks/gsd-check-update.js`.
- Use snake_case for Bash helper functions in older install scripts: `check_cmd`, `install_tpm`, `install_nvim_profile` in `install`.
- Use short lowercase verbs for Bash command helpers in focused scripts: `usage` and `cleanup` in `utils/port-forward.sh`, `usage` in `profile/codex-unleashed-safely.sh`.

**Variables:**
- Use `const` by default in JavaScript, with camelCase names for runtime values: `sessionSafe`, `bridgePath`, `warnData` in `.opencode/hooks/gsd-statusline.js` and `.opencode/hooks/gsd-context-monitor.js`.
- Use UPPER_SNAKE_CASE for stable configuration constants in both JS and Bash: `AUTO_COMPACT_BUFFER_PCT` in `.opencode/hooks/gsd-statusline.js`, `WARNING_THRESHOLD` in `.opencode/hooks/gsd-context-monitor.js`, `IMAGE`, `WORKDIR`, `USE_TTY` in `profile/opencode-unleashed-safely.sh`.
- Use lowercase names for mutable Bash inputs and loop-scoped values: `config`, `line_no`, `resource`, `label` in `utils/port-forward.sh`; `home`, `src`, `dst` in `install`.

**Types:**
- No TypeScript types, interfaces, or JSDoc typedef patterns are used in the analyzed runtime code. JavaScript in `.opencode/hooks/*.js` is untyped CommonJS.

## Code Style

**Formatting:**
- No Prettier, Biome, or repository-level formatter config was detected.
- Use two-space indentation in JavaScript files such as `.opencode/hooks/gsd-statusline.js` and `.opencode/hooks/gsd-workflow-guard.js`.
- Use two-space indentation in current Bash scripts such as `profile/codex-unleashed-safely.sh`, `profile/opencode-unleashed-safely.sh`, and `utils/port-forward.sh`.
- Preserve readable vertical spacing between validation blocks, setup blocks, and execution blocks; this pattern is consistent in `.opencode/hooks/gsd-check-update.js` and `profile/opencode-unleashed-safely.sh`.

**Linting:**
- No ESLint configuration was detected.
- Follow the existing self-policed style instead of tool-enforced rules.
- For shell scripts, prefer the stricter modern pattern already present in `profile/codex-unleashed-safely.sh`, `profile/opencode-unleashed-safely.sh`, and `utils/port-forward.sh`: `set -euo pipefail` near the top of the file.

## Import Organization

**Order:**
1. Node built-in modules first via `require(...)`, usually grouped at the top: `fs`, `path`, `os`, `child_process` in `.opencode/hooks/gsd-check-update.js`.
2. Local constants and helper functions immediately after imports: `WARNING_THRESHOLD` in `.opencode/hooks/gsd-context-monitor.js`, `detectConfigDir` in `.opencode/hooks/gsd-check-update.js`.
3. Main event-handling or execution flow last: `process.stdin.on('end', ...)` blocks in `.opencode/hooks/*.js`, argument parsing plus `docker run` in `profile/codex-unleashed-safely.sh`.

**Path Aliases:**
- No path aliases were detected. Use relative filesystem paths and built-in `path.join(...)` in JS, as in `.opencode/hooks/gsd-statusline.js` and `.opencode/hooks/gsd-workflow-guard.js`.

## Error Handling

**Patterns:**
- Use early validation with immediate exit in Bash scripts. Examples: argument and dependency checks in `utils/port-forward.sh`, mount/workdir checks in `profile/opencode-unleashed-safely.sh`, and command checks in `install`.
- Use `try/catch` around JSON parsing and filesystem access in hooks, and fail silently when the hook is best-effort. Examples: `.opencode/hooks/gsd-statusline.js`, `.opencode/hooks/gsd-context-monitor.js`, `.opencode/hooks/gsd-prompt-guard.js`.
- Use guard clauses heavily to keep control flow flat. This is the dominant style in `.opencode/hooks/gsd-read-guard.js`, `.opencode/hooks/gsd-workflow-guard.js`, and `utils/port-forward.sh`.
- When a hook emits structured output, build an `output` object and serialize it once with `process.stdout.write(JSON.stringify(output))`, as in `.opencode/hooks/gsd-read-guard.js` and `.opencode/hooks/gsd-context-monitor.js`.

## Logging

**Framework:** console/stdout-stderr only.

**Patterns:**
- Use `echo "Error: ..." >&2` for user-facing Bash failures, as in `profile/codex-unleashed-safely.sh` and `utils/port-forward.sh`.
- Use plain stdout progress messages for operational state in Bash: `Starting port-forward...` and `All port-forwards running...` in `utils/port-forward.sh`.
- In JS hooks, avoid noisy logging and prefer silent failure unless output is part of the hook contract; see `.opencode/hooks/gsd-statusline.js` and `.opencode/hooks/gsd-prompt-guard.js`.

## Comments

**When to Comment:**
- Add comments for operational intent, edge cases, and security rationale rather than restating syntax. Strong examples appear in `.opencode/hooks/gsd-context-monitor.js`, `.opencode/hooks/gsd-read-guard.js`, and `.opencode/hooks/gsd-statusline.js`.
- Use short section comments to separate phases of work, such as detection, debounce, warning emission, and output formatting in `.opencode/hooks/gsd-context-monitor.js`.

**JSDoc/TSDoc:**
- Not used. Documentation is inline with `//` comments in JavaScript and occasional shell comments in Bash files such as `install` and `cron`.

## Function Design

**Size:**
- Keep hook files as single-purpose entrypoints with one top-level event handler and small helper functions where needed. Examples: `.opencode/hooks/gsd-check-update.js` uses `detectConfigDir`; `.opencode/hooks/gsd-statusline.js` keeps all logic inside the stdin callback but still organizes it into commented sections.

**Parameters:**
- In Bash, accept positional parameters first, then validate immediately. Examples: `config="${1:-}"` in `utils/port-forward.sh`, `home="$1"` in `install`, and CLI flag parsing in `profile/opencode-unleashed-safely.sh`.
- In JS hooks, derive inputs from parsed stdin payload objects (`data.tool_input`, `data.session_id`, `data.cwd`) instead of passing helpers deep through the file.

**Return Values:**
- JavaScript hook code usually communicates by side effect: `process.stdout.write(...)` or `process.exit(0)` in `.opencode/hooks/*.js`.
- Bash helpers mostly mutate filesystems or arrays and rely on exit status rather than returned strings, as in `install_file` in `install` and `cleanup` in `utils/port-forward.sh`.

## Module Design

**Exports:**
- No runtime modules export reusable APIs. JavaScript files under `.opencode/hooks/` are executable CLI-style entrypoints, and shell files under `profile/`, `utils/`, and `tmuxifiers/` are direct scripts.

**Barrel Files:**
- Not used.

## Practical Guidance for Future Changes

- Add new OpenCode/GSD hook logic under `.opencode/hooks/` as standalone CommonJS scripts with a shebang, top-level built-in `require(...)` imports, and a single stdin-driven control flow matching `.opencode/hooks/gsd-read-guard.js`.
- Add new operational shell tools under `utils/` or `profile/` with `#!/usr/bin/env bash` or `#!/bin/bash`, `set -euo pipefail` when possible, a `usage()` helper for CLI tools, and early argument validation matching `utils/port-forward.sh` and `profile/codex-unleashed-safely.sh`.
- When touching older shell code such as `install` or `utils/appimage-desktop-entry.sh`, preserve behavior first; these files mix older quoting/style patterns with current stricter Bash patterns.

---

*Convention analysis: 2026-04-26*
