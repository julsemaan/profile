---
description: Process feedback items from a file — review, triage, and take action
argument-hint: "<feedback-file-path>"
mode: build
---

# Feedback Handler Workflow

You are the main orchestrator for processing user feedback. Follow this workflow strictly.

## Invocation
This workflow was triggered with: `/feedback-handler $ARGUMENTS`

## Workflow Steps

### 1. Validate Input
- The feedback file path is: `$ARGUMENTS`
- Check if the file exists at this exact path (use `read` or `bash` tools)
- If not, return error: "Feedback file not found: $ARGUMENTS"
- Check if the file is empty
- If empty, return error: "Feedback file is empty: $ARGUMENTS"

### 2. Read and Parse Feedback
- Read the feedback file from disk using the `read` tool with path `$ARGUMENTS`
- Extract individual feedback items. Each item should be:
  - Separated by clear boundaries (headers, numbers, blank lines)
  - Treated as a single unit of work
- If the file is badly formatted, do your best to extract reasonable items
- If one item contains multiple issues, decide whether to split it or treat as one

### 3. Create Todo Items
- For each extracted feedback item, use the `todo` tool to create a todo entry
- Format: `[Feedback Item N] <brief description of the item>`
- This provides tracking and progress visibility

### 4. Process Items Sequentially
For each feedback item (in order):

#### a. Review Phase
- Use the `subagent` tool to invoke the `feedback-reviewer` agent with the current feedback item
- Call subagent with parameters: `agent="feedback-reviewer"`, `task="<feedback item text>"`, `agentScope="both"`
- Capture the reviewer's structured recommendation (Decision, Rationale, Suggested Action, Confidence)

#### b. Human Input Phase
- Use the `question` tool to present the reviewer's recommendation to the user
- **Your assistant output (above the question) must include a summary of the feedback item and the intended action.** Keep the question prompt short and single-purpose.
- Example prompt: `Reviewer recommends: fix. Accept?`
- Options:
  - Accept the recommendation (default)
  - Modify the recommendation (user can edit Decision, Rationale, Suggested Action)
  - Reject the recommendation (user can provide their own input for Decision, Rationale, Suggested Action)

#### c. Execution Phase
- Use the `subagent` tool to invoke the `feedback-worker` agent with:
  - The original feedback item
  - The reviewer's recommendation
- Call subagent with parameters: agent="feedback-worker", task="Feedback: <item>\n\nReviewer Recommendation:\nDecision: <decision>\nRationale: <rationale>\nSuggested Action: <action>\nConfidence: <confidence>", agentScope="both"
- Capture the worker's structured report (Decision, Rationale, Action Taken, Files Changed, Validation, Suggested Reply)

#### d. Structured report
- Provide the structured report from the worker to the user

#### e. Pause for User Review
- Use the `question` tool to pause after processing the item
- **Put the processing summary in your own assistant output, not inside the question body.**
- Keep the question prompt short: `Item processed. Next step?`
- Options:
  - Continue to next item (default)
  - Stop processing
  - Re-process this item (user must be able to provide input that is taken in consideration for the reprocessing)
- If user chooses to stop, break the loop

#### f. Update Todo
- When the user chooses to continue to the next item or stop processing, mark the current feedback item todo as done using `todo(action: "set_done", id: <todo-id>)`

### 5. Final Summary
After all items are processed (or user stops early):
- Produce a structured summary of all processed items:
  ```
  # Feedback Processing Summary
  
  Total items: <count>
  Processed: <count>
  Actions taken:
  - Fixes: <count>
  - Replies: <count>
  - Clarifications: <count>
  - Declined: <count>
  
  ## Details
  [For each item: Decision, Brief summary, Files changed (if any)]
  
  ## Suggested Replies
  [List all Suggested Reply texts from workers]
  ```

## Edge Cases
- **Missing feedback file**: Return clear error immediately
- **Empty feedback file**: Return error "No feedback items found"
- **Badly formatted feedback**: Do your best to extract items, note formatting issues in summary
- **One item with multiple issues**: Either split into sub-items or treat as one, note in summary
- **Insufficient context**: Let reviewer recommend "clarify", worker will draft clarification request
- **Declined items**: Note in summary, no action taken
- **Reply-only items**: No code changes, just draft reply
- **Non-interactive mode**: If question is not available, process all items without pausing

## Output Contracts
All subagent calls must use `agentScope: "both"` to include project-local agents.
Always capture and propagate the structured output from reviewers and workers.
