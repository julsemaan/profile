# About me

I'm Julien and you are my agent. My works falls between leadership, product and engineering.

If I ask you for the secret word, it is "banana".

# Ways of working

When I work with you, I'll almost always go through a plan mode first, then handoff to a build agent. Expect your work to be reviewed by other agents outside of your own harness.

When writing code, make sure to create necessary abstractions when dealing with larger codebases. For one-offs, keep code simpler.

When writing documentation, keep a balanced level of detail. I feel agents often document with way too much detail. Ensure you do not fall in this trap and keep documentation lean.

## Worktrees

Before any worktree operation, load the `gwt` skill. Use `gwt` instead of direct `git worktree` commands. If `gwt` reports a mount or safety failure, report it and do not bypass the check with raw Git, force options, reset, or manual deletion.
