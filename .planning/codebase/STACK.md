# Technology Stack

**Analysis Date:** 2026-04-26

## Languages

**Primary:**
- JavaScript (Node.js CommonJS) - CLI and hook implementation in `.opencode/get-shit-done/bin/gsd-tools.cjs`, `.opencode/get-shit-done/bin/lib/*.cjs`, and `.opencode/hooks/*.js`
- Bash - installation, container launch, cron, and utility automation in `install`, `setup`, `cron`, `profile/*.sh`, `utils/*.sh`, and `tmuxifiers/*.sh`

**Secondary:**
- JSON - runtime/tool configuration in `.opencode/opencode.json`, `.opencode/settings.json`, and `.opencode/package-lock.json`
- Markdown - command, agent, template, and workflow definitions in `.opencode/command/*.md`, `.opencode/agents/*.md`, and `.opencode/get-shit-done/templates/*.md`

## Runtime

**Environment:**
- Node.js - required for `.opencode/hooks/*.js` and `.opencode/get-shit-done/bin/**/*.cjs`
- Bash shell - required by `install`, `setup`, `cron`, `profile/opencode-unleashed-safely.sh`, `profile/codex-unleashed-safely.sh`, and `utils/port-forward.sh`
- Docker - required by `profile/opencode-unleashed-safely.sh` and `profile/codex-unleashed-safely.sh`

**Package Manager:**
- npm - lockfile present at `.opencode/package-lock.json`
- Global npm installs are used in `profile/opencode-unleashed-safely.sh` (`opencode-ai` by default) and `profile/codex-unleashed-safely.sh` (`@openai/codex`)

## Frameworks

**Core:**
- OpenCode agent runtime - configured in `.opencode/opencode.json` and wrapped by `profile/opencode-unleashed-safely.sh`
- GSD workflow toolkit (`gsd-opencode` 1.38.0) - installed via `.opencode/package-lock.json` and executed through `.opencode/get-shit-done/bin/gsd-tools.cjs`

**Testing:**
- Not detected - no `jest.config.*`, `vitest.config.*`, `playwright.config.*`, or top-level test suite files were found in `/home/julien/src/profile`

**Build/Dev:**
- Docker - disposable CLI runtime assembly in `profile/opencode-unleashed-safely.sh` and `profile/codex-unleashed-safely.sh`
- tmuxifier - session automation in `tmuxifiers/*.sh`
- kubectl - local Kubernetes helper workflow in `utils/port-forward.sh`

## Key Dependencies

**Critical:**
- `gsd-opencode` 1.38.0 - provides the GSD command/workflow toolkit referenced by `.opencode/get-shit-done/bin/gsd-tools.cjs` and locked in `.opencode/package-lock.json`
- `@opencode-ai/plugin` 1.14.25 - core OpenCode plugin dependency locked in `.opencode/package-lock.json`
- `@opencode-ai/sdk` 1.14.25 - OpenCode SDK dependency locked in `.opencode/package-lock.json`
- `commander` 12.1.0 - CLI parsing dependency locked in `.opencode/package-lock.json`

**Infrastructure:**
- `@inquirer/*` packages - interactive CLI prompts, locked in `.opencode/package-lock.json`
- `fast-check` 4.7.0 - property-based utility dependency, locked in `.opencode/package-lock.json`
- `kubernetes-types` 1.30.0 - Kubernetes-related dependency, locked in `.opencode/package-lock.json`
- `msgpackr` 1.11.10 - serialization dependency, locked in `.opencode/package-lock.json`

## Configuration

**Environment:**
- Primary OpenCode runtime config lives in `.opencode/opencode.json`
- Local settings file exists at `.opencode/settings.json`
- No `.env` or `.env.*` files were detected during this audit
- Runtime toggles and credentials are read from environment variables in `.opencode/opencode.json`, `.opencode/get-shit-done/bin/lib/init.cjs`, `.opencode/get-shit-done/bin/lib/config.cjs`, `.opencode/get-shit-done/bin/lib/commands.cjs`, `.opencode/get-shit-done/bin/lib/core.cjs`, `.opencode/hooks/gsd-statusline.js`, and `profile/*.sh`

**Build:**
- No compiled build pipeline config was detected
- Container build definitions are embedded directly in `profile/opencode-unleashed-safely.sh` and `profile/codex-unleashed-safely.sh`
- Installation/bootstrap flow is driven by `install`, `setup`, and `cron`

## Platform Requirements

**Development:**
- Linux/macOS-style shell environment assumed by `install`, `setup`, and `cron`
- `git`, `make`, and `gawk` are required by `install`
- `docker` is required by `profile/opencode-unleashed-safely.sh` and `profile/codex-unleashed-safely.sh`
- `kubectl` is required for `utils/port-forward.sh`
- `tmux`, `nvim`, and `devbox` are expected by `tmuxifiers/*.sh`

**Production:**
- Not a deployed application stack
- Operational target is a developer workstation plus ephemeral Docker containers launched from `profile/opencode-unleashed-safely.sh` and `profile/codex-unleashed-safely.sh`

---

*Stack analysis: 2026-04-26*
