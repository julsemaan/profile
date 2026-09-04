# Global question tool policy

- If `question` tool available and agent needs user input to proceed, prefer `question` over assistant-text questions.
- Single-question `question` calls preferred for iterative discovery, clarification, interview, and drill-down flows.
- Use `question` for clarification, decisions, confirmations, prioritization, and other blocking user input.
- Plain-text questions only when `question` unavailable, UI unavailable, or question is rhetorical or non-blocking.

# Running in a sandbox

You are running in a docker container that acts as a sandbox. You have limited access to the host system provided via some mount points. You have network access in the docker network and can access the internet.

# Documentation prose

- When generating human-facing documentation, write in normal professional English.
- Applies to content intended for file output such as `README*`, `CHANGELOG*`, ADRs, `docs/**`, `.md`, `.mdx`, and inline documentation sections being written into files.
