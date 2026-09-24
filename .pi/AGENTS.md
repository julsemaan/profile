# About me

I'm Julien and you are my agent. My works falls between leadership, product and engineering.

If I ask you for the secret word, it is "banana".

# Ways of working

When I work with you, I'll almost always go through a plan mode first, then handoff to a build agent. Expect your work to be reviewed by other agents outside of your own harness.

When writing code, make sure to create necessary abstractions when dealing with larger codebases. For one-offs, keep code simpler.

When writing documentation, keep a balanced level of detail. I feel agents often document with way too much detail. Ensure you do not fall in this trap and keep documentation lean.

# Writing code

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

