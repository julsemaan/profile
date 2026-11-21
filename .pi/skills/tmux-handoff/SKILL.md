---
name: tmux-handoff
description: Hand off the current task or plan to a fresh interactive Pi session in a new tmux coding window. Use when asked to hand off to another window.
---

# Tmux handoff

Prepare an isolated task worktree and a self-contained handoff, open the worktree with `tnc`, and start interactive `puss` in build mode with the originating session's current model profile in its empty shell pane. Select the new window. Do not implement the handed-off task in the originating session.

## Prepare

1. Read the project's safety instructions and load the `gwt` skill. Every handoff, including read-only tasks, must run in a dedicated task worktree, never the main checkout or an unrelated task's workspace. Reuse a worktree only when it was explicitly designated for this task; otherwise create one with `gwt create <base-ref> <task-name>` and capture its returned path. Use the requested base ref, or resolve the repository's default branch rather than assuming `origin/main`. Check the source checkout for uncommitted changes. If the task needs them, ask how to carry them over; never silently omit, move, stash, or discard them. Verify the resulting branch and working directory. If creation fails or the sandbox mount excludes sibling worktrees, stop and report the blocker. Never fall back to the current checkout or raw worktree commands.
2. Write a uniquely named handoff under the project's `julsemaan-tmp/` using `write_tmp_document`. Include the goal, decisions, relevant files, implementation steps, validation commands, safety restrictions, and known blockers. State that workspace setup and window creation are already handled so the receiver does not repeat the handoff. Include any uncommitted changes the receiver must preserve. Do not include credentials or the entire conversation.
3. Confirm the handoff is readable through the task worktree and both paths are visible on the host and inside the `puss` mount. `gwt` may symlink `julsemaan-tmp` from the main checkout; verify its target is mounted too. Record the task worktree path and branch in the handoff, and instruct the receiver to work only there. Do not assume sandbox paths exist on the host.

## Preserve the current model profile

Before launching, capture the originating session's effective profile and all three model aliases with their thinking levels. Read only the relevant `build-plan-mode` state from the current session identified by `PI_SESSION_FILE`, or use the extension's current-profile output. Resolve missing state from the extension's runtime state or profile override using its actual precedence rules. An empty `PI_BUILD_PLAN_MODEL_PROFILE` does not mean the default is active, and a concrete `PI_MODEL` does not identify the whole profile. If the effective profile cannot be determined, ask rather than guess.

For a built-in profile, launch `puss --model-profile <captured-profile>`. For a custom profile, launch `puss` without a task, then restore the captured mappings through `/large-model <provider/model> <thinking>`, `/medium-model <provider/model> <thinking>`, and `/small-model <provider/model> <thinking>` in the receiving session. Never replace custom mappings with a built-in profile or change a shared `julsemaan-tmp/model-profile` file to configure one handoff. Record the captured configuration in the handoff.

## Use the host helpers

Read the current definitions before launching. The source is `~/src/profile/`:

- `profile/bashrc.d/10-tmux.bash`: `tnc` aliases `tmux-new-coding` and accepts a directory, not a command. Worktree windows are named after their branch.
- `tmuxifiers/coding.window.sh`: the coding layout starts Neovim and devbox panes and leaves an empty shell pane. Inspect the layout rather than hardcoding pane numbers.
- `profile/bashrc.d/30-ai.bash`: `puss` launches sandboxed Pi with `~/src` mounted.

`tnc`, `tmuxifier`, and `puss` may be absent from the agent container. This is expected. Sourcing profile files or running `bash -lic` inside the container does not grant host execution.

Run every tmux CLI call as `letee tmux <args>`, never bare `tmux`. This includes read-only queries, `run-shell`, window selection, `send-keys`, and pane capture. `letee tmux` passes arguments unchanged, so keep the explicit `-S <socket>` and `-t <target>` on every call. If `letee tmux -V` fails, stop and report it rather than falling back to bare `tmux`.

Both helpers are host shell aliases. Invoke a host `bash -lic` through the existing tmux server's `letee tmux -S <socket> run-shell -t <source-pane>`. First run a read-only host preflight, `type tnc; type puss; command -v tmuxifier`, and capture stdout/stderr. Proceed only if all three resolve on the host. If the socket or host helpers are unavailable, stop and provide manual host instructions. Do not install or recreate the helpers inside the container.

Use shell-quoted arguments. Do not substitute bare `pi`, print mode, or redirected Pi stdin/stdout. The receiving session must remain interactive.

## Launch

1. Discover the current tmux socket and session from the actual environment. Resolve stable session/window/pane IDs with read-only queries. Never hardcode a username, UID, socket, or session ID from another task. Use an explicit socket and session/pane targets for every `letee tmux` command.
2. After the host preflight succeeds, run `tnc <absolute-task-worktree-path>` through the same host execution route. Pass the resolved tmux context to the host shell so `tnc` targets the intended server/session. Never invoke `tnc` directly with the agent's bash tool inside the container.
3. Record existing window IDs before creation and identify the new window afterward. Confirm its pane working directories point to the task worktree and inspect the layout. Do not identify it by name alone, as names can collide. If creation is ambiguous or fails, stop and inspect the output rather than creating another window.
4. Select the new window and its empty shell pane. Verify it is idle before sending anything. Never send commands to the originating agent, Neovim, a running devbox startup, or an existing user process.
5. In that new shell, launch `puss --model-profile <captured-profile>` for a built-in profile, or `puss` for a custom profile. Shell-quote arguments. Do not pass the handoff as an initial prompt: new sessions default to plan mode. The shell must have loaded the aliases. Prefer sending the launch command to the new interactive shell rather than replacing its shell process, so launch errors remain visible. Do not pipe the prompt into Pi.
6. Wait for Pi's input editor. Restore custom mappings if needed, then submit `/build` and wait for confirmation. Submit `/model-profile` and verify all alias models and thinking levels match the captured configuration. Verify the status shows build mode. Do not use `PI_SUBAGENT=1` as a mode workaround or invent a `--build` flag. If configuration differs or a command fails, stop before sending the task.
7. Only after mode and profile verification, submit a normal Pi prompt telling the receiver to read and execute the handoff at its absolute path in the task worktree. Treat the path as prompt text, not a shell command. Check the pane output to confirm the handoff was read. A successful window-creation exit code is not evidence that Pi launched. If startup is still underway, report that instead of claiming completion. If it exits, capture the actual error from the pane before retrying. Do not repeat a launch merely because the original window did not visibly change.

## Safety and completion

- Respect repository tmux restrictions even when they prevent using `tnc`. Do not restart, kill, or reconfigure servers, modify shell configuration, install tools, or bypass sandbox restrictions to make the handoff work.
- If host execution or helper access is unavailable, save the handoff and provide a shell-quoted host command using `tnc` and interactive `puss`. Report the exact blocker and any captured error. Do not invent an error when none was captured.
- Do not run a live handoff merely to test this skill. Validate commands with stubs or inspect definitions unless the user requests a launch.
- Finish with the workspace, branch, new window/pane IDs, handoff path, verified build mode, inherited profile, and launch status. Leave the new window selected. Do not wait for the receiver to complete the implementation unless asked.
