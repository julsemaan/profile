---
name: gwt
description: Manage Git worktrees with the gwt command. Use before creating, listing, removing, or pruning worktrees.
---

# Git worktrees with gwt

Load this skill before any worktree operation. Prefer `gwt` over raw `git worktree` commands.

## Commands

```bash
gwt create <local/branch|remote/branch> [worktree-name]
gwt list
gwt rm <branch-or-path>
gwt prune
```

Running `gwt` or `gwt create` with no arguments keeps the interactive flow. It uses `fzf` and reads the optional worktree name from `/dev/tty`. An explicit `gwt create` source and name are non-interactive and do not use either one.

Examples:

```bash
# New branch from origin/main.
gwt create origin/main feature-login

# Check out an existing local branch.
gwt create local/feature-login feature-login-review

# Check out an existing remote branch. A local tracking branch is created when needed.
gwt create origin/feature-login feature-login-review

# Inspect, remove, and prune.
gwt list
gwt rm feature-login-review
gwt rm ../profile-feature-login
gwt prune
```

## Behavior

- New worktrees use a sibling path named `<repository>-<worktree-name>` next to the main repository. Slashes and spaces become hyphens, and other unsupported characters are removed.
- Successful `gwt create` writes only the created path to stdout. Progress and errors go to stderr, so callers can capture the path safely.
- Remote creation fetches all remotes with pruning before it uses the selected remote ref. A remote branch without a local branch becomes a local tracking branch.
- A new branch created from a remote ref starts without an upstream. `gwt` records the remote and enables Git's automatic push setup. The first plain `git push` creates and records the upstream, for example `origin/feature-login`.
- If a local branch and its remote source have diverged, interactive mode asks before resetting. Non-interactive mode never resets the existing branch. It creates the requested worktree name as a new branch when that name is different and free. If the name is occupied, or the default name is the divergent branch itself, it fails and asks for a different name.
- If the main repository has `.envrc` or `julsemaan-tmp`, `gwt create` links each existing path into the new worktree. Existing target entries are left alone.
- `gwt rm` refuses to remove the main worktree, the current worktree, a worktree containing the current directory, or a dirty worktree. It removes the worktree directory and registration but preserves the branch.
- `gwt prune` removes stale worktree registrations only after its safety checks pass.

## Pi sandbox rules

Pi sets `GWT_MOUNT_ROOT` to the primary container mount. `gwt create` and `gwt rm` reject worktree paths outside that root. `gwt prune` refuses to run if any registered worktree is outside the visible root.

Worktrees are siblings of the repository, so the repository parent must be in Pi's primary mount for create and remove operations. Prefer `puss` or an equivalent broad `--mount` that includes both the repository and its sibling worktree paths. A narrow repository-only mount is useful for edits but cannot create a sibling worktree.

Report mount or safety failures. Do not bypass them with raw `git worktree`, `git worktree remove --force`, `git reset`, force options, or manual deletion.
