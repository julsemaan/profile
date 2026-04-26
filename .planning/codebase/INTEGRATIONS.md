# External Integrations

**Analysis Date:** 2026-04-26

## APIs & External Services

**AI / Agent Platforms:**
- OpenAI - model provider for OpenCode agents configured in `.opencode/opencode.json`
  - SDK/Client: OpenCode provider config in `.opencode/opencode.json`
  - Auth: `OPENAI_API_KEY` is forwarded by `profile/opencode-unleashed-safely.sh` and `profile/codex-unleashed-safely.sh`
- Anthropic - credential forwarding for OpenCode container sessions in `profile/opencode-unleashed-safely.sh`
  - SDK/Client: OpenCode runtime inside container launched by `profile/opencode-unleashed-safely.sh`
  - Auth: `ANTHROPIC_API_KEY`

**MCP Services:**
- Context7 MCP - remote documentation server configured in `.opencode/opencode.json`
  - SDK/Client: MCP remote endpoint `https://mcp.context7.com/mcp`
  - Auth: Not configured
- GitHub MCP - remote GitHub/Copilot integration configured in `.opencode/opencode.json`
  - SDK/Client: MCP remote endpoint `https://api.githubcopilot.com/mcp/`
  - Auth: `GH_MCP_TOKEN`
- Bitbucket MCP - remote Bitbucket integration configured in `.opencode/opencode.json`
  - SDK/Client: MCP remote endpoint `https://mcp.atlassian.com/v1/mcp`
  - Auth: `BB_MCP_TOKEN`
- Playwright MCP - local browser automation service configured in `.opencode/opencode.json`
  - SDK/Client: `npx @playwright/mcp@latest`
  - Auth: Not applicable
- Sentry MCP - configuration exists in `.opencode/opencode.json` but is disabled
  - SDK/Client: `https://mcp.sentry.dev/mcp`
  - Auth: OAuth block present but not configured

**Search / Research Services:**
- Brave Search API - direct HTTP integration in `.opencode/get-shit-done/bin/lib/commands.cjs`
  - SDK/Client: native `fetch()` call to `https://api.search.brave.com/res/v1/web/search`
  - Auth: `BRAVE_API_KEY`
- Firecrawl - availability detection only in `.opencode/get-shit-done/bin/lib/init.cjs` and `.opencode/get-shit-done/bin/lib/config.cjs`
  - SDK/Client: external tool availability expected by GSD workflows
  - Auth: `FIRECRAWL_API_KEY`
- Exa - availability detection only in `.opencode/get-shit-done/bin/lib/init.cjs` and `.opencode/get-shit-done/bin/lib/config.cjs`
  - SDK/Client: external tool availability expected by GSD workflows
  - Auth: `EXA_API_KEY`

**Source / Package Distribution:**
- GitHub raw content and GitHub REST API - bootstrap/update flow in `setup` and `install`
  - SDK/Client: `curl` to `https://api.github.com/repos/julsemaan/profile/commits/master` and `https://raw.githubusercontent.com/julsemaan/profile/...`
  - Auth: None in checked-in scripts
- npm registry - dependency resolution from `.opencode/package-lock.json` and version checks in `.opencode/hooks/gsd-check-update.js`
  - SDK/Client: `npm view get-shit-done-cc version` in `.opencode/hooks/gsd-check-update.js`
  - Auth: Not configured in repository files
- Docker Hub / registry image pulls - container builds in `profile/opencode-unleashed-safely.sh` and `profile/codex-unleashed-safely.sh`
  - SDK/Client: Docker base image `julsemaan/codex-dev-img:latest`
  - Auth: Docker runtime environment

**Community / Metadata:**
- Discord - invite/reference link documented in `.opencode/command/gsd-join-discord.md`
  - SDK/Client: browser link only
  - Auth: Not applicable
- semaan.ca - install/update entrypoint referenced by `README.md` and `cron`
  - SDK/Client: `curl https://semaan.ca/jsemaan-profile -L | bash`
  - Auth: None

## Data Storage

**Databases:**
- None detected
  - Connection: Not applicable
  - Client: Not applicable

**File Storage:**
- Local filesystem only - configuration and state are stored under `.opencode/`, `.planning/`, `~/.opencode`, and XDG paths referenced by `profile/opencode-unleashed-safely.sh`

**Caching:**
- Local file cache only - update/status artifacts are written under `.opencode` and `/tmp` by `.opencode/hooks/gsd-statusline.js`, `.opencode/hooks/gsd-check-update.js`, and `.opencode/hooks/gsd-context-monitor.js`

## Authentication & Identity

**Auth Provider:**
- Environment-token based authentication only
  - Implementation: bearer/basic header injection in `.opencode/opencode.json` for MCP endpoints, plus environment variable forwarding in `profile/opencode-unleashed-safely.sh` and `profile/codex-unleashed-safely.sh`

## Monitoring & Observability

**Error Tracking:**
- Sentry MCP config exists in `.opencode/opencode.json` but is disabled

**Logs:**
- Local stdout/stderr logging in Bash scripts such as `install` and `utils/port-forward.sh`
- Local JSON/file-based session metrics in `/tmp` and `.opencode/cache` via `.opencode/hooks/gsd-statusline.js` and `.opencode/hooks/gsd-context-monitor.js`

## CI/CD & Deployment

**Hosting:**
- Not applicable for an application service
- Distribution is script-based via `README.md`, `setup`, `install`, and `cron`

**CI Pipeline:**
- None detected in repository files

## Environment Configuration

**Required env vars:**
- `OPENAI_API_KEY` - forwarded by `profile/opencode-unleashed-safely.sh` and `profile/codex-unleashed-safely.sh`
- `ANTHROPIC_API_KEY` - forwarded by `profile/opencode-unleashed-safely.sh`
- `GH_MCP_TOKEN` - used by GitHub MCP config in `.opencode/opencode.json`
- `BB_MCP_TOKEN` - used by Bitbucket MCP config in `.opencode/opencode.json`
- `BRAVE_API_KEY` - used by `.opencode/get-shit-done/bin/lib/commands.cjs`

**Optional env vars:**
- `FIRECRAWL_API_KEY` - detected in `.opencode/get-shit-done/bin/lib/init.cjs`
- `EXA_API_KEY` - detected in `.opencode/get-shit-done/bin/lib/init.cjs`
- `GEMINI_API_KEY` - changes hook behavior in `.opencode/hooks/gsd-context-monitor.js`
- `CLAUDE_CONFIG_DIR` - overrides config path in `.opencode/hooks/gsd-statusline.js` and `.opencode/hooks/gsd-check-update.js`
- `GSD_PROJECT`, `GSD_WORKSTREAM`, `GSD_AGENTS_DIR` - workflow routing/config in `.opencode/get-shit-done/bin/lib/core.cjs` and `.opencode/get-shit-done/bin/gsd-tools.cjs`
- `OPENCODE_NPM_PACKAGE` - controls installed CLI package in `profile/opencode-unleashed-safely.sh`

**Secrets location:**
- Environment variables at runtime
- Optional local key files under `~/.gsd/` are checked for Brave, Firecrawl, and Exa in `.opencode/get-shit-done/bin/lib/init.cjs` and `.opencode/get-shit-done/bin/lib/config.cjs`

## Webhooks & Callbacks

**Incoming:**
- None detected in repository implementation files

**Outgoing:**
- Brave Search HTTP request from `.opencode/get-shit-done/bin/lib/commands.cjs`
- GitHub API and raw GitHub content downloads from `setup` and `install`
- MCP RPC calls to Context7, GitHub, Bitbucket, and optional Sentry endpoints from `.opencode/opencode.json`

---

*Integration audit: 2026-04-26*
