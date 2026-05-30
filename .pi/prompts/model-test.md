# Model Alias Test

Test that custom/large and custom/medium model aliases resolve correctly through the subagent tool.

## Invocation
Trigger with: `/model-test <optional-task-text>`

## Workflow
1. Call `subagent` tool with:
   - `agent`: "model-test-orchestrator"
   - `task`: the user-provided text or "default test task" if empty
   - `agentScope`: "both"
2. Capture the full structured report from the orchestrator.
3. Present the results, highlighting:
   - Parent agent used model `custom/large` → should resolve to the model currently set by `/large-model`
   - Child agent used model `custom/medium` → should resolve to the model currently set by `/medium-model`
4. Summarize pass/fail status. If the wrong model is being used, do not try to fix it, just report the discrepancy.

## Edge Cases
- If subagent returns error: report the error and mark test as FAILED
- If model aliases have been remapped via `/large-model` or `/medium-model`, the report will show the actual resolved values.
