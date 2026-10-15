# About me

I'm Julien and you are my agent. My works falls between leadership, product and engineering.

If I ask you for the secret word, it is "banana".

# Ways of working

When I work with you, I'll almost always go through a plan mode first, then handoff to a build agent. Expect your work to be reviewed by other agents outside of your own harness.

When writing documentation, keep a balanced level of detail. I feel agents often document with way too much detail. Ensure you do not fall in this trap and keep documentation lean.

When you are replying to pull request comments, always sign messages with "Written by Julien's agent" so that it is clear that you authored this message.

## MCP in the sandbox

The sandbox you are in has no usable local browser.

- Prefer MCP tools that return text or JSON.
- Avoid tools known to open interactive UIs or browser workflows unless explicitly requested.
- Report browser-dependent blockers instead of attempting browser launches or port-forwarding workarounds.
- Treat browser-launch warnings separately from operation failures. Inspect the result and never repeat a state-changing call solely because its UI failed.
- After an unexpected UI launch, avoid that tool for the remaining session and use a non-UI equivalent when available.

## Worktrees

Before any worktree operation, load the `gwt` skill. Use `gwt` instead of direct `git worktree` commands. 

## Commit messages

When you write commit messages for me, write a one-line commit message following the Conventional Commits standard.

# Writing code

When writing code, make sure to create necessary abstractions when dealing with larger codebases. For one-offs, keep code simpler.

Examples of what I want my code to look like:
- Setting defaults in one place and ensuring the rest of the codebase relies on those defaults to keep the code DRY.
- Creating shared packages and code to reduce duplication and promote DRY code.
- Creating abstractions through inheritance, interfaces and composition.
- Overall, I like DRY code.

Some examples of what NOT to do:
- I hate code that tries to add safeguards that are not useful. 
- Setting runtime defaults in Kubernetes controllers when the CRDs already provide a default.
- Setting defaults in many places.
- Setting defaults in Github Action jobs when the variable being read already has a default set.
- Performing validation for edge-cases that are near impossible to reach during normal operation.

