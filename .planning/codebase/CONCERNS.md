# Codebase Concerns

**Analysis Date:** 2026-04-26

## Tech Debt

**Bootstrap and installation are concentrated in one root-only script:**
- Issue: `install` is a 181-line imperative installer that mixes package installation, remote downloads, filesystem mutation, cron setup, git config changes, and per-user home directory mutation in one path.
- Files: `install`, `setup`, `cron`
- Impact: Small changes are high-risk because install behavior is not modular, not idempotent in every branch, and hard to validate without exercising a real machine.
- Fix approach: Split `install` into focused functions or sub-scripts for system packages, shell profile files, editor setup, and GSD/OpenCode setup; add a dry-run mode and explicit OS/environment checks.

**Runtime tooling metadata is not reproducible from manifest alone:**
- Issue: `.opencode/package.json` only declares `{"type":"commonjs"}` while `.opencode/package-lock.json` resolves real dependencies and `.opencode/node_modules/` exists locally.
- Files: `.opencode/package.json`, `.opencode/package-lock.json`, `.opencode/.gitignore`
- Impact: Fresh installs cannot reconstruct the same dependency set from the manifest, and local state can diverge from what the repository declares.
- Fix approach: Commit a complete manifest for `.opencode/` dependencies and rely on lockfile+install rather than local `node_modules/` state.

**Shell profile has side effects beyond shell configuration:**
- Issue: `profile/.bashrc_append` performs behavioral changes like `git config --global credential.helper cache` at shell startup instead of limiting itself to aliases and prompt setup.
- Files: `profile/.bashrc_append`
- Impact: Opening a shell mutates global git configuration, which is surprising, hard to audit, and difficult to override in managed environments.
- Fix approach: Move one-time machine setup into `install` or a dedicated bootstrap command and keep `profile/.bashrc_append` side-effect-light.

## Known Bugs

**Neovim tarball cleanup targets the wrong filename:**
- Symptoms: After downloading `nvim-linux-x86_64.tar.gz`, cleanup removes `nvim-linux64.tar.gz`, leaving the downloaded archive behind.
- Files: `install`
- Trigger: Run the `install_nvim` path on a machine that does not already have `/opt/nvim-linux64`.
- Workaround: Manually delete `nvim-linux-x86_64.tar.gz` after install.

**Daily self-update can change a machine without repository review:**
- Symptoms: The installed cron job pulls and executes remote code every day, so behavior can change independently of the checked-out repository state.
- Files: `README.md`, `cron`, `setup`
- Trigger: Install the cron entry from `install` and wait for the scheduled run.
- Workaround: Remove `/etc/cron.d/jprofile` or disable the update job before making local customizations.

**Shell startup assumes optional tools are present:**
- Symptoms: `profile/.bashrc_append` unconditionally sources `/etc/bash_completion`, `/etc/bash_completion.d/complete_alias`, and `kubectl completion bash`, which can generate startup errors on machines missing those assets.
- Files: `profile/.bashrc_append`
- Trigger: Start an interactive shell on a machine without bash-completion or `kubectl` installed.
- Workaround: Guard each source/completion call with `test -f` / `command -v` checks.

## Security Considerations

**Remote code execution is the primary installation model:**
- Risk: The documented install flow pipes a remote script directly to `bash`, and the cron job repeats that pattern unattended.
- Files: `README.md`, `setup`, `cron`
- Current mitigation: `setup` fetches `install` from a commit SHA instead of an unpinned raw branch path.
- Recommendations: Replace `curl | bash` with a signed or checksum-verified release artifact, require explicit upgrade commands, and remove unattended remote execution from `cron`.

**Container wrappers forward high-privilege credentials into broadly mounted environments:**
- Risk: The wrappers pass `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `BB_MCP_TOKEN`, and `GH_MCP_TOKEN` into containers while bind-mounting user-controlled paths.
- Files: `profile/codex-unleashed-safely.sh`, `profile/opencode-unleashed-safely.sh`
- Current mitigation: Containers run as the host uid/gid instead of root, and mount paths are explicit CLI arguments.
- Recommendations: Add allowlists for mount roots, support per-command opt-in env forwarding, and document that these wrappers intentionally trade isolation for convenience.

**Prompt-injection defense at write time is advisory only:**
- Risk: Suspicious content written into `.planning/` is detected but not blocked, so compromised or careless agents can still persist hostile instructions into future agent context.
- Files: `.opencode/hooks/gsd-prompt-guard.js`, `.opencode/get-shit-done/bin/lib/security.cjs`
- Current mitigation: Pattern scanning warns about common prompt-injection markers before Write/Edit operations.
- Recommendations: Add a blocking mode for high-confidence matches, quarantine suspect writes, and log detections to a durable audit file.

## Performance Bottlenecks

**CLI wrappers pay a Docker build cost on every invocation:**
- Problem: Both wrapper scripts always run `docker build` before `docker run`, even when the image already exists and `--rebuild` is not requested.
- Files: `profile/codex-unleashed-safely.sh`, `profile/opencode-unleashed-safely.sh`
- Cause: Image existence is not checked before building.
- Improvement path: Skip the build when the target image tag already exists, or separate build and run into explicit commands.

**Background update check introduces network latency and registry dependence per session:**
- Problem: The session hook launches an `npm view get-shit-done-cc version` lookup for every session start.
- Files: `.opencode/hooks/gsd-check-update.js`
- Cause: Version discovery depends on live npm registry access rather than a longer-lived cache or release feed.
- Improvement path: Increase cache TTL, back off on repeated failures, and make update checks explicitly opt-in for offline or latency-sensitive environments.

## Fragile Areas

**Planning lock recovery can permit overlapping writers:**
- Files: `.opencode/get-shit-done/bin/lib/core.cjs`
- Why fragile: `withPlanningLock()` force-removes the lock after a 10s wait and treats locks older than 30s as stale, which can allow two long-running processes to believe they own `.planning/.lock`.
- Safe modification: Preserve atomic locking but replace time-based forced unlocks with pid validation, heartbeat refresh, or OS-backed advisory locks.
- Test coverage: No repository tests exercise concurrent writes to `.planning/`.

**Hooks intentionally swallow most failures:**
- Files: `.opencode/hooks/gsd-statusline.js`, `.opencode/hooks/gsd-check-update.js`, `.opencode/hooks/gsd-context-monitor.js`, `.opencode/hooks/gsd-workflow-guard.js`
- Why fragile: Many `catch` blocks exit silently, so broken JSON, filesystem issues, or cache corruption degrade behavior without leaving an obvious signal.
- Safe modification: Add optional debug logging and structured error counters before tightening behavior.
- Test coverage: No hook-level regression tests or fixture-driven stdin/stdout tests are present.

**Installer logic depends on hardcoded filesystem conventions:**
- Files: `install`, `profile/.bashrc_append`, `tmuxifiers/kubex.session.sh`, `tmuxifiers/kpp.session.sh`
- Why fragile: Paths like `/usr/local/etc`, `/opt/nvim-linux64`, `/home/*`, `/Users/*`, `~/src/app-platform`, and `~/src/automation-controller` are embedded directly in scripts and sessions.
- Safe modification: Centralize path configuration and validate host-specific dependencies before mutating files.
- Test coverage: No environment-matrix tests verify Linux/macOS/home-directory variations.

## Scaling Limits

**The repository scales for one operator profile, not multiple environments:**
- Current capacity: The scripts assume a single opinionated workstation layout and a small number of personal repositories under `~/src`.
- Limit: Portability drops quickly when usernames, home layouts, shell packages, or repo names differ from the author’s machine assumptions.
- Scaling path: Externalize host-specific values into config files and support per-machine overlays rather than editing shared scripts.

## Dependencies at Risk

**Multiple installs depend on moving `latest` or default-branch artifacts:**
- Risk: Bootstrap depends on mutable upstream state instead of version-pinned releases.
- Impact: Re-running installation can yield different binaries or repository contents without any change in this repo.
- Migration plan: Pin exact tags or digests for `julsemaan/codex-dev-img:latest`, `opencode-ai`, `@openai/codex`, `tmux-plugins/tpm`, `junegunn/fzf`, `akinomyoga/ble.sh`, `VundleVim/Vundle.vim`, and `julsemaan/nvim-profile` referenced from `profile/codex-unleashed-safely.sh`, `profile/opencode-unleashed-safely.sh`, and `install`.

## Missing Critical Features

**No automated verification path exists for bootstrap-critical scripts:**
- Problem: There is no test harness, smoke test, or CI workflow validating `install`, `setup`, shell profile files, or the GSD hook/CLI scripts.
- Blocks: Safe refactoring of `install`, confident upgrades of `.opencode/get-shit-done/bin/*.cjs`, and reliable cross-platform changes.

## Test Coverage Gaps

**Installer and bootstrap flows are untested:**
- What's not tested: `install`, `setup`, `cron`, and the profile wrapper scripts.
- Files: `install`, `setup`, `cron`, `profile/codex-unleashed-safely.sh`, `profile/opencode-unleashed-safely.sh`
- Risk: Regressions can break machine setup, shell startup, or unattended updates without early detection.
- Priority: High

**Hook behavior is untested despite security and workflow responsibilities:**
- What's not tested: stdin parsing, timeout behavior, advisory output, and error handling for the hook scripts.
- Files: `.opencode/hooks/gsd-statusline.js`, `.opencode/hooks/gsd-read-guard.js`, `.opencode/hooks/gsd-prompt-guard.js`, `.opencode/hooks/gsd-workflow-guard.js`, `.opencode/hooks/gsd-check-update.js`, `.opencode/hooks/gsd-context-monitor.js`
- Risk: Silent failures can disable safety and UX features without being noticed.
- Priority: High

**Core planning state mutations are untested under concurrency and failure modes:**
- What's not tested: `.planning` lock acquisition, recovery from partial writes, workspace mutation flows, and commit guard edge cases.
- Files: `.opencode/get-shit-done/bin/lib/core.cjs`, `.opencode/get-shit-done/bin/lib/state.cjs`, `.opencode/get-shit-done/bin/lib/phase.cjs`, `.opencode/get-shit-done/bin/lib/commands.cjs`, `.opencode/get-shit-done/bin/lib/init.cjs`
- Risk: State corruption or false safety signals can surface only in real user sessions.
- Priority: High

---

*Concerns audit: 2026-04-26*
