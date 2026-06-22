# Profile Concept

This repository (`julsemaan/profile`) is a **personal developer environment profile** that bootstraps
and manages shell, editor, tmux, and AI coding-agent tooling across machines. It is designed to be
installed on fresh systems (servers, workstations, containers) via a one-liner curl bootstrap.

## High-Level Architecture

The profile consists of several layers:

1. **Bootstrap & install** — `setup` curls and runs `install`, which is the main provisioning script.
2. **Shell configuration** — `.bashrc_append`, `.inputrc`, `.blerc`, `.fzf` sourced into the user's
   `~/.bashrc`. Provides a rich prompt with git status, history preservation, tmux integration, and
   shell completion improvements (ble.sh, fzf, complete_alias).
3. **Editor configuration** — `.vimrc` (vim with Vundle plugins), Neovim profile (cloned from
   `julsemaan/nvim-profile`), and common `.gitignore`.
4. **Tmux configuration** — `.tmux.conf` with TPM plugins (catppuccin theme, vim-tmux-navigator,
   tmux-yank, tmux-sensible), custom keybindings, and tmuxifier for window/session layouts.
5. **AI coding agents (sandboxed)** — Shell wrappers (`pi-unleashed-safely`, `opencode-unleashed-safely`,
   `codex-unleashed-safely`) that run each agent inside a Docker container based on a shared base
   image (`julsemaan/code-sandbox-img`).
6. **Pi coding agent configuration** — `.pi/` directory containing agent definitions, extensions,
   prompts, modes, MCP servers, and model settings.
7. **Tmuxifier session layouts** — `tmuxifiers/` directory with predefined tmux session/window
   layouts for common workflows (coding, kpp, kubex).
8. **Utilities** — `utils/` with kinto config for macOS key remapping, Ghostty config,
   port-forwarding scripts, and more.
9. **Self-updating** — A system cron job (`cron`) and daily cron script (`cron.daily`) that
   periodically re-runs the install to stay up to date.

## How Installation Works

### Bootstrap (`setup`)

```
curl -L -s https://semaan.ca/jsemaan-profile | bash
```

This downloads the latest `install` script from the repository's master branch and runs it.

### Install script (`install`)

The `install` script:

1. **Clones or uses the local copy** of the repository.
2. **Copies config files** to `/usr/local/etc/` (system-wide):
   - `.bashrc_append` → `/usr/local/etc/.bashrc_append`
   - `.inputrc` → `/usr/local/etc/.inputrc`
   - `.tmux.conf` → `/usr/local/etc/.tmux.conf`
   - `.vimrc` → `/usr/local/etc/.vimrc`
   - `.gitignore` → `/usr/local/etc/.gitignore`
   - `.blerc` → `/usr/local/etc/.blerc`
3. **Installs sandbox wrappers** to `/usr/local/bin/`:
   - `codex-unleashed-safely`
   - `opencode-unleashed-safely`
   - `pi-unleashed-safely`
4. **Installs opencode system config** from `.opencode/` to `/usr/local/etc/opencode/`.
5. **Installs tmuxifier layouts** from `tmuxifiers/` to `/usr/local/etc/tmuxifiers/`.
6. **Installs Neovim** from upstream tarball to `/opt/nvim-linux64`.
7. **Configures Vim** by sourcing `/usr/local/etc/.vimrc` from the system vimrc and installing
   Vundle plugins.
8. **Sets up git** with a system-level core.excludesfile pointing at the installed `.gitignore`.
9. **Iterates over all user home directories** and:
   - Symlinks/copies config files (`.tmux.conf`, `.inputrc`, `.blerc`)
   - Creates config dirs for Ghostty, kinto, direnv
   - Sources `.bashrc_append` into each user's `~/.bashrc`
   - Installs TPM (Tmux Plugin Manager)
   - Clones/updates the Neovim profile
   - Installs the pi agent configuration (`install_pi_global_config`): copies `.pi/.*` files
     into `~/.pi/agent/`
10. **Installs supporting tools**:
    - Tmuxifier (session/window manager for tmux)
    - ble.sh (bash-line-editor, syntax highlighting and completion)
    - fzf (fuzzy finder)
    - complete_alias (bash completion for aliases)
11. **Installs cron jobs**:
    - `/etc/cron.d/jprofile` — hourly cleanup of ble.sh cache
    - `/etc/cron.daily/jprofile` — daily re-install of the profile

## The Sandbox Pattern: "unleashed-safely"

All three AI coding agents (pi, opencode, codex) are wrapped in a **Docker-based sandbox** pattern:

- Each wrapper script builds (or reuses) a Docker image on top of `julsemaan/code-sandbox-img:latest`.
- The container runs the AI agent with **read/write access only to the mounted working directory**.
- The container has **no access to the host system** beyond the mounted paths — no ability to modify
  system config or install packages globally. Sensitive host-file access is blocked except for one
  pi-specific read-only SSH exception described below.
- The agent's home directory is a **tmpfs** (ephemeral), so no state persists on the host.
- Selected host paths are explicitly bind-mounted for persistence (e.g., pi's `~/.pi`, opencode's
  config/cache/data). `pi-unleashed-safely` can opt into read-only SSH file mounts only when
  `PI_SSH_KEY_PATH` is set to a host private-key file. In that case it also mounts `~/.ssh/known_hosts`
  and `~/.ssh/config` read-only when present. It does not forward an SSH agent or socket.
- **Clipboard integration** is achieved by forwarding terminal environment variables and mounting
  tmux/X11/Wayland sockets when available.
- **Go module cache** is mounted from the host (read-only by default) to reuse downloaded modules.
- API keys for AI providers are forwarded from the host environment.

### Shared Base Image: `julsemaan/code-sandbox-img`

From `code-sandbox/Dockerfile`:
- Based on `node:25-bookworm`
- Includes: Go, kubectl, Helm, ripgrep, vim, tmux, clipboard utilities (xclip, xsel, wl-clipboard)
- Published via GitHub Actions on push (see `.github/workflows/docker.yml`)

### Wrapper Scripts

| Script | Agent | Image | Entrypoint |
|---|---|---|---|
| `pi-unleashed-safely.sh` | `@earendil-works/pi-coding-agent` | `pi-unleashed-safely:latest` | Custom entrypoint that re-registers extra pi packages at runtime |
| `opencode-unleashed-safely.sh` | `opencode-ai` | `opencode-unleashed-safely:latest` | `opencode` |
| `codex-unleashed-safely.sh` | `@openai/codex` | `codex-unleashed-safely:latest` | `codex --dangerously-bypass-approvals-and-sandbox` |

Each script accepts `--mount`, `--workdir`, `--rebuild`, `--no-tty` flags and passes remaining
arguments through to the agent.

## Pi Coding Agent Configuration (`.pi/`)

Located at the repository root, the `.pi/` directory configures the pi coding agent:

- **`settings.json`** — Default provider/model (`openai-codex/gpt-5.4`), enabled models, compaction.
- **`models.json`** — Provider overrides (e.g., DeepSeek context window).
- **`mcp.json`** — MCP server definitions (Context7 docs, Playwright, GitHub MCP, Bitbucket MCP).
- **`extensions/`** — Custom pi extensions (todo tracking,
  build-plan mode, question asking, subagent delegation, modes switcher).
- **`agents/`** — Custom agent definitions (feedback-reviewer, feedback-worker,
  model-test-orchestrator, model-test-worker).
- **`prompts/`** — Prompt templates (extract-feedback, feedback-handler, fix-lint, handle-review,
  model-test).
- **`modes/`** — Custom modes (brainstorm).
- **`TODO.md`** — Known issues (e.g., multiline copy/paste in pi).

### Important

When modifying pi extensions or configuration, always edit the files under `.pi/` in this repository.
During install, these are copied to each user's `~/.pi/agent/`. Never apply changes directly to
`~/.pi/` on a live system or to node_modules.

## Sandbox Awareness

Since the AI coding agents run inside Docker containers:
- The filesystem is **not** the same as the host machine.
- The agent sees only the mounted working directory and its own ephemeral home.
- System commands (apt, systemctl, etc.) are either unavailable or run inside the sandbox.
- Most tools (git, curl, vim, tmux, go, kubectl, helm, rg) are present inside the container.
- Do not assume access to host-specific paths, services, or credentials.

## Cron & Self-Updating

- **`cron`** — Installed as `/etc/cron.d/jprofile`. Runs hourly to clear ble.sh cache (which can leak).
  Content:
  ```
  0 * * * * root /bin/bash -c "rm -fr /run/user/*/blesh/*"
  ```
- **`cron.daily`** — Installed as `/etc/cron.daily/jprofile`. Re-runs the install script daily.
  Content:
  ```bash
  curl -L -s https://semaan.ca/jsemaan-profile | bash > /dev/null
  ```

## Summary of Key Directories

| Path | Purpose |
|---|---|
| `profile/` | Shell config files (.bashrc_append, .vimrc, .tmux.conf, .inputrc, .blerc, .gitignore) |
| `profile/pi-unleashed-safely.sh` | Pi coding agent sandbox wrapper |
| `profile/opencode-unleashed-safely.sh` | OpenCode coding agent sandbox wrapper |
| `profile/codex-unleashed-safely.sh` | Codex CLI sandbox wrapper |
| `code-sandbox/` | Dockerfile + README for the shared base image |
| `.pi/` | Pi agent config (agents, extensions, prompts, modes, settings, MCP, models) |
| `.opencode/` | OpenCode system config (opencode.json, tui.json, agent dir, plugins) |
| `tmuxifiers/` | Tmuxifier session/window layouts |
| `utils/` | Utility scripts (Ghostty config, kinto, port-forwarding, etc.) |
| `cron` | Hourly cron job (ble.sh cache cleanup) |
| `cron.daily` | Daily re-install bootstrap |
| `install` | Main provisioning script |
| `setup` | One-liner bootstrap that curls and runs install |

## Development Workflow

To extend the profile:
1. Edit files in this repository.
2. Commit and push (the daily cron will pick up changes on target systems).
3. For immediate testing, run `sudo ./install` locally.
4. For pi agent changes, edit `.pi/` files (never modify `~/.pi/` on a live system directly).
5. For sandbox changes, modify the relevant `*-unleashed-safely.sh` wrapper or `code-sandbox/Dockerfile`.

---

**You will always be running in a sandboxed environment, do not assume that the filesystem is the same as the local machine.**
