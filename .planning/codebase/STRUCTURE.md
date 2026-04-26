# Codebase Structure

**Analysis Date:** 2026-04-26

## Directory Layout

```text
profile/
├── .opencode/               # OpenCode config, commands, hooks, agents, GSD toolkit
│   ├── agent/              # Primary subagent prompts installed into user config
│   ├── agents/             # Additional agent prompt library
│   ├── command/            # Slash-command prompt definitions
│   ├── get-shit-done/      # Shared workflows, templates, references, CLI helpers
│   └── hooks/              # Node-based OpenCode hook scripts
├── .planning/codebase/     # Generated codebase map documents
├── profile/                # Installable shell/editor/runtime dotfiles and wrappers
├── tmuxifiers/             # Tmuxifier session and window recipes
├── utils/                  # Standalone operator utility scripts
├── cron                    # Cron payload installed as `/etc/cron.d/jprofile`
├── install                 # Main provisioning script
├── setup                   # Remote bootstrap script
└── README.md               # Install entry documentation
```

## Directory Purposes

**`.opencode/`:**
- Purpose: Hold the full OpenCode customization layer shipped by this repository.
- Contains: Config in `.opencode/opencode.json`, command prompts in `.opencode/command/`, hook scripts in `.opencode/hooks/`, prompt libraries in `.opencode/agent/` and `.opencode/agents/`, and workflow assets under `.opencode/get-shit-done/`.
- Key files: `.opencode/opencode.json`, `.opencode/command/gsd-map-codebase.md`, `.opencode/command/gsd-plan-phase.md`, `.opencode/hooks/gsd-workflow-guard.js`, `.opencode/get-shit-done/bin/gsd-tools.cjs`

**`.opencode/command/`:**
- Purpose: Define slash commands as markdown prompt specs.
- Contains: One file per command with frontmatter and prompt body.
- Key files: `.opencode/command/gsd-execute-phase.md`, `.opencode/command/gsd-map-codebase.md`, `.opencode/command/gsd-plan-phase.md`

**`.opencode/hooks/`:**
- Purpose: Enforce or advise runtime behavior around tool usage.
- Contains: Node scripts that parse JSON from stdin and emit hook context.
- Key files: `.opencode/hooks/gsd-read-guard.js`, `.opencode/hooks/gsd-statusline.js`, `.opencode/hooks/gsd-workflow-guard.js`

**`.opencode/get-shit-done/`:**
- Purpose: Package reusable workflow infrastructure behind the prompt files.
- Contains: `bin/` helpers, `workflows/` prompt bodies, `templates/`, `references/`, and a `VERSION` file.
- Key files: `.opencode/get-shit-done/bin/gsd-tools.cjs`, `.opencode/get-shit-done/bin/lib/state.cjs`, `.opencode/get-shit-done/workflows/map-codebase.md`, `.opencode/get-shit-done/templates/codebase/architecture.md`

**`profile/`:**
- Purpose: Store installable shell/editor/runtime configuration files.
- Contains: Bash, tmux, Vim, readline, ble.sh config, and AI wrapper scripts.
- Key files: `profile/.bashrc_append`, `profile/.tmux.conf`, `profile/.vimrc`, `profile/codex-unleashed-safely.sh`, `profile/opencode-unleashed-safely.sh`

**`tmuxifiers/`:**
- Purpose: Store reusable tmux session/window layouts.
- Contains: Tmuxifier DSL scripts.
- Key files: `tmuxifiers/coding.window.sh`, `tmuxifiers/kpp.session.sh`, `tmuxifiers/kubex.session.sh`

**`utils/`:**
- Purpose: Hold standalone machine/operator helper scripts that are not sourced during shell startup.
- Contains: Executable bash scripts and sample config data.
- Key files: `utils/port-forward.sh`, `utils/appimage-desktop-entry.sh`, `utils/disable-webcam-autofocus.sh`, `utils/port-forward.example.csv`

**`.planning/codebase/`:**
- Purpose: Hold generated architecture, stack, quality, and concern docs for GSD workflows.
- Contains: Uppercase markdown documents created by mapper agents.
- Key files: `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/STRUCTURE.md`

## Key File Locations

**Entry Points:**
- `README.md`: Human-facing install command.
- `setup`: Remote bootstrap that fetches and runs `install`.
- `install`: Main provisioning script.
- `cron`: Recurring refresh and cleanup entrypoint.
- `profile/.bashrc_append`: Interactive shell runtime entrypoint after installation.
- `profile/opencode-unleashed-safely.sh`: Dockerized OpenCode runtime entrypoint.
- `profile/codex-unleashed-safely.sh`: Dockerized Codex runtime entrypoint.

**Configuration:**
- `.opencode/opencode.json`: OpenCode agent, command, permission, and MCP configuration.
- `.opencode/settings.json`: OpenCode local settings stub.
- `profile/.tmux.conf`: Tmux configuration.
- `profile/.vimrc`: Vim configuration.
- `profile/.inputrc`: Readline key bindings.
- `profile/.gitignore`: Global git ignore entries installed system-wide.

**Core Logic:**
- `.opencode/get-shit-done/bin/gsd-tools.cjs`: Central CLI router for workflow operations.
- `.opencode/get-shit-done/bin/lib/`: Domain helper modules for state, phase, roadmap, template, security, verification, and docs operations.
- `.opencode/hooks/`: Hook logic for read-before-edit, workflow advisory, statusline, and prompt/context guards.
- `install`: Copy/install orchestration logic.

**Testing:**
- Not detected in this repository. No dedicated `test/`, `tests/`, `__tests__/`, `*.spec.*`, or `*.test.*` files were found during structure analysis.

## Naming Conventions

**Files:**
- Use dotfiles for installed shell/editor config in `profile/`: `profile/.bashrc_append`, `profile/.tmux.conf`, `profile/.vimrc`.
- Use kebab-case command names under `.opencode/command/`: `.opencode/command/gsd-map-codebase.md`, `.opencode/command/gsd-execute-phase.md`.
- Use `gsd-` prefix for hook and agent support files under `.opencode/hooks/` and `.opencode/agents/`: `.opencode/hooks/gsd-statusline.js`, `.opencode/agents/gsd-codebase-mapper.md`.
- Use descriptive tmuxifier suffixes `.session.sh` and `.window.sh` in `tmuxifiers/`.

**Directories:**
- Use plural noun directories for grouped assets: `.opencode/hooks/`, `.opencode/agents/`, `.opencode/command/`, `tmuxifiers/`, `utils/`.
- Keep workflow internals nested under `.opencode/get-shit-done/` with function-based subdirectories: `bin/`, `workflows/`, `templates/`, `references/`.

## Where to Add New Code

**New Feature:**
- Shell/runtime behavior: add the source asset under `profile/` and wire installation in `install`.
- OpenCode/GSD command behavior: add the prompt file under `.opencode/command/` and supporting workflow/template/reference files under `.opencode/get-shit-done/`.
- Tests: not established; if introducing test coverage, place it alongside the implementation area being expanded and add the runner/config explicitly because no test directory convention exists yet.

**New Component/Module:**
- New OpenCode hook: add a `.js` file under `.opencode/hooks/`.
- New OpenCode agent prompt: add a `.md` file under `.opencode/agent/` or `.opencode/agents/` depending on whether it is part of the installed runtime or the broader prompt library.
- New GSD helper module: add a `.cjs` file under `.opencode/get-shit-done/bin/lib/` and route to it from `.opencode/get-shit-done/bin/gsd-tools.cjs`.
- New tmux recipe: add a `.session.sh` or `.window.sh` file under `tmuxifiers/`.

**Utilities:**
- Shared operator scripts: place them under `utils/`.
- Sample data for those scripts: keep adjacent to the script in `utils/`, following the `*.example.*` pattern used by `utils/port-forward.example.csv`.

## Special Directories

**`.opencode/get-shit-done/`:**
- Purpose: Internal toolkit consumed by OpenCode workflow prompts.
- Generated: No
- Committed: Yes

**`.planning/codebase/`:**
- Purpose: Generated codebase map consumed by planning/execution workflows.
- Generated: Yes
- Committed: Yes

**`.opencode/node_modules/`:**
- Purpose: Dependency directory present inside the OpenCode customization area.
- Generated: Yes
- Committed: Yes

---

*Structure analysis: 2026-04-26*
