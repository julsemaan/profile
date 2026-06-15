# Architecture

**Analysis Date:** 2026-04-26

## Pattern Overview

**Overall:** Filesystem-driven profile distribution with a workflow toolkit embedded under `.opencode/`.

**Key Characteristics:**
- Use `setup` as the remote bootstrap entry point and `install` as the full local installer that materializes repo files into `/usr/local/etc/`, `/usr/local/bin/`, `/etc/cron.d/`, and user home directories.
- Keep reusable runtime assets as plain files under `profile/`, `tmuxifiers/`, `utils/`, and `.opencode/`, then copy or source them instead of generating them dynamically.
- Treat `.opencode/` as a self-contained command system with declarative command prompts in `.opencode/command/`, subagent definitions in `.opencode/agents/`, hooks in `.opencode/hooks/`, and a CommonJS helper CLI in `.opencode/get-shit-done/bin/gsd-tools.cjs`.

## Layers

**Bootstrap Layer:**
- Purpose: Fetch and launch installation.
- Location: `setup`, `README.md`
- Contains: One-shot remote installer bootstrap and install instructions.
- Depends on: GitHub raw content, curl, executable access to `/usr/local/bin/jprofile_install`.
- Used by: Manual setup flow and cron-driven refresh flow via `cron`.

**Provisioning Layer:**
- Purpose: Install repo assets onto a machine.
- Location: `install`, `cron`
- Contains: Dependency checks, file copy helpers, cron installation, system-wide config registration, user-home fanout, tmux/vim/ble/fzf/opencode installation.
- Depends on: `profile/`, `.opencode/`, `tmuxifiers/`, git, curl, make, gawk, system directories.
- Used by: `setup`, direct local invocation, and daily update cron execution.

**Shell and Editor Runtime Layer:**
- Purpose: Define the interactive shell, tmux, Vim, readline, and wrapper behavior users actually run.
- Location: `profile/.bashrc_append`, `profile/.tmux.conf`, `profile/.vimrc`, `profile/.inputrc`, `profile/.blerc`, `profile/codex-unleashed-safely.sh`, `profile/opencode-unleashed-safely.sh`
- Contains: Aliases, shell functions, prompt setup, editor settings, terminal bindings, Docker-based AI CLI launchers.
- Depends on: Files provisioned into `/usr/local/etc/`, installed tools such as tmux, vim, kubectl, docker, ble.sh, fzf, and opencode config copied by `install`.
- Used by: User login shells, tmux sessions, Vim, and AI CLI invocations.

**Workspace Automation Layer:**
- Purpose: Launch opinionated tmux sessions and workspace windows.
- Location: `tmuxifiers/coding.window.sh`, `tmuxifiers/kpp.session.sh`, `tmuxifiers/kubex.session.sh`
- Contains: Session roots, pane layouts, startup commands, editor/dev shell bootstrapping.
- Depends on: Tmuxifier initialization from `profile/.bashrc_append`, host workspaces under `~/src`.
- Used by: Aliases such as `jointmuxifier`, `kpptmux`, `kubextmux`, and function `tmux-new-coding` in `profile/.bashrc_append`.

**Utility Script Layer:**
- Purpose: Package standalone operational helpers outside login-shell startup.
- Location: `utils/port-forward.sh`, `utils/appimage-desktop-entry.sh`, `utils/disable-webcam-autofocus.sh`
- Contains: Kubernetes port-forward supervision, AppImage desktop entry generation, webcam control automation.
- Depends on: External binaries such as `kubectl`, `v4l2-ctl`, AppImage executables, desktop filesystem locations.
- Used by: Manual operator execution.

**OpenCode Command System Layer:**
- Purpose: Extend OpenCode with GSD commands, agents, hooks, and support libraries.
- Location: `.opencode/opencode.json`, `.opencode/command/`, `.opencode/agent/`, `.opencode/agents/`, `.opencode/hooks/`, `.opencode/get-shit-done/`
- Contains: Command prompt specs, agent prompt specs, pre/post tool hooks, templates, workflows, references, and helper CLI modules.
- Depends on: OpenCode runtime, MCP integrations configured in `.opencode/opencode.json`, CommonJS helpers in `.opencode/get-shit-done/bin/lib/`.
- Used by: `profile/opencode-unleashed-safely.sh` and installed OpenCode sessions.

## Data Flow

**Machine Provisioning Flow:**

1. `setup` fetches the latest `install` script from GitHub and executes `/usr/local/bin/jprofile_install`.
2. `install` clones the repository or uses the current checkout, then copies repo assets from `profile/`, `.opencode/`, and `tmuxifiers/` into system locations.
3. `install` amends user home directories by copying dotfiles and appending `source /usr/local/etc/.bashrc_append` to each detected `.bashrc`.
4. `install` installs supporting runtimes such as tmux plugins, Vim bundles, Neovim profile, ble.sh, and fzf.
5. `cron` re-enters the same bootstrap path daily to refresh the machine from the remote repository.

**Interactive Shell Flow:**

1. A shell sources installed `~/.bashrc`, which sources `/usr/local/etc/.bashrc_append` after provisioning.
2. `/usr/local/etc/.bashrc_append` wires prompt rendering, aliases, git helpers, kubectl helpers, tmuxifier setup, ble.sh, and fzf.
3. Shell commands dispatch into local functions such as `gchjira`, `klogs_deploy`, `tmux-new-coding`, and AI wrapper scripts installed from `profile/`.

**OpenCode / GSD Flow:**

1. `profile/opencode-unleashed-safely.sh` copies installed config from `/usr/local/etc/opencode/opencode.json` and agent markdown from `/usr/local/etc/opencode/agent/` into the user config directory.
2. The wrapper builds and runs an OpenCode container, mounting the requested workspace and forwarding terminal, clipboard, and API-token environment variables.
3. OpenCode loads command definitions from `.opencode/command/*.md`, hooks from `.opencode/hooks/*.js`, and agent prompts from `.opencode/agent/*.md` and `.opencode/agents/*.md`.
4. Workflow-style commands delegate structured filesystem and planning operations to `.opencode/get-shit-done/bin/gsd-tools.cjs` and its modules in `.opencode/get-shit-done/bin/lib/`.

**State Management:**
- Store durable state in files and installed paths, not in a long-running application process.
- Use shell environment variables for transient runtime behavior in `profile/.bashrc_append`, `profile/codex-unleashed-safely.sh`, and `profile/opencode-unleashed-safely.sh`.
- Use `.planning/` and `.opencode/get-shit-done/` as the command-system state surface when GSD workflows run.

## Key Abstractions

**Provisioned Asset:**
- Purpose: A repo file whose source-of-truth lives in git and whose runtime copy is installed elsewhere.
- Examples: `profile/.bashrc_append`, `profile/.tmux.conf`, `profile/opencode-unleashed-safely.sh`, `.opencode/opencode.json`, `tmuxifiers/kubex.session.sh`
- Pattern: Copy-on-install through helper `install_file` in `install`.

**Command Prompt Definition:**
- Purpose: A markdown file that declares a slash command, tool permissions, and workflow context.
- Examples: `.opencode/command/gsd-map-codebase.md`, `.opencode/command/gsd-plan-phase.md`, `.opencode/command/gsd-execute-phase.md`
- Pattern: Frontmatter plus structured prompt body consumed by OpenCode.

**Workflow Support CLI:**
- Purpose: A centralized CommonJS utility that removes repeated shell logic from prompt files.
- Examples: `.opencode/get-shit-done/bin/gsd-tools.cjs`, `.opencode/get-shit-done/bin/lib/state.cjs`, `.opencode/get-shit-done/bin/lib/phase.cjs`, `.opencode/get-shit-done/bin/lib/verify.cjs`
- Pattern: Thin router in `gsd-tools.cjs` delegating to domain modules in `bin/lib/`.

**Safety Wrapper:**
- Purpose: Run AI tooling inside Docker with curated mounts, forwarded credentials, and predictable config paths.
- Examples: `profile/codex-unleashed-safely.sh`, `profile/opencode-unleashed-safely.sh`
- Pattern: Validate inputs, optionally rebuild image, then `docker run` with mounted workspace and selected env vars.

**Tmux Session Recipe:**
- Purpose: A declarative shell script that describes panes, windows, and startup commands for a workspace.
- Examples: `tmuxifiers/coding.window.sh`, `tmuxifiers/kpp.session.sh`, `tmuxifiers/kubex.session.sh`
- Pattern: Tmuxifier DSL with `session_root`, `new_window`, `split_v`, `split_h`, `run_cmd`, and `finalize_and_go_to_session`.

## Entry Points

**Remote Installer:**
- Location: `setup`
- Triggers: Manual bootstrap from the install command in `README.md`.
- Responsibilities: Download current `install`, mark it executable, and execute it.

**Local Installer:**
- Location: `install`
- Triggers: `setup`, local execution from a checked-out repository, and daily cron refresh.
- Responsibilities: Validate dependencies, copy repo assets, install supporting tools, update user homes, and register cron/system config.

**Daily Update Trigger:**
- Location: `cron`
- Triggers: System cron.
- Responsibilities: Refresh the profile install daily and clear `ble.sh` cache directories.

**Shell Runtime Entry:**
- Location: `profile/.bashrc_append`
- Triggers: Interactive bash sessions after installation.
- Responsibilities: Configure prompt, aliases, completion, tmuxifier, helper functions, and optional integrations.

**AI Runtime Entrypoints:**
- Location: `profile/codex-unleashed-safely.sh`, `profile/opencode-unleashed-safely.sh`
- Triggers: Direct CLI invocation or aliases such as `codex-unleashed-safely-src` and `opencode-unleashed-safely-src` in `profile/.bashrc_append`.
- Responsibilities: Build/run Dockerized AI CLIs with mounted workspace and prepared config.

## Error Handling

**Strategy:** Fail fast in shell entrypoints and validate prerequisites before mutation.

**Patterns:**
- Use strict shell modes such as `set -o nounset -o pipefail -o errexit` in `install` and `set -euo pipefail` in `profile/codex-unleashed-safely.sh`, `profile/opencode-unleashed-safely.sh`, and `utils/port-forward.sh`.
- Gate unsafe operations with explicit existence checks and usage validation in `setup`, `install`, `utils/port-forward.sh`, `utils/appimage-desktop-entry.sh`, and `profile/.bashrc_append` functions such as `gchjira`, `gtagpush`, and `klogs_deploy`.

## Cross-Cutting Concerns

**Logging:** Use stdout/stderr messaging from shell scripts for operator feedback; see `install`, `utils/port-forward.sh`, and `utils/disable-webcam-autofocus.sh`.
**Validation:** Validate external commands, file paths, and arguments before side effects; see `install`, `setup`, `profile/codex-unleashed-safely.sh`, and `profile/opencode-unleashed-safely.sh`.
**Authentication:** Pass credentials through environment variables at runtime rather than storing them in tracked files; see env forwarding in `profile/codex-unleashed-safely.sh` and `profile/opencode-unleashed-safely.sh` plus MCP token references in `.opencode/opencode.json`.

---

*Architecture analysis: 2026-04-26*
