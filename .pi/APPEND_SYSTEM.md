# Global question tool policy

- If `question` tool available and agent needs user input to proceed, prefer `question` over assistant-text questions.
- Single-question `question` calls preferred for iterative discovery, clarification, interview, and drill-down flows.
- Use `question` for clarification, decisions, confirmations, prioritization, and other blocking user input.
- Plain-text questions only when `question` unavailable, UI unavailable, or question is rhetorical or non-blocking.

# Documentation prose

- When generating human-facing documentation, write in normal professional English.
- Applies to content intended for file output such as `README*`, `CHANGELOG*`, ADRs, `docs/**`, `.md`, `.mdx`, and inline documentation sections being written into files.
