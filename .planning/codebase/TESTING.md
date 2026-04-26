# Testing Patterns

**Analysis Date:** 2026-04-26

## Test Framework

**Runner:**
- Not detected.
- Config: No `jest.config.*`, `vitest.config.*`, `playwright.config.*`, `cypress.config.*`, `mocha` config, or repository test directory was found under `/home/julien/src/profile`.

**Assertion Library:**
- Not detected.

**Run Commands:**
```bash
Not detected        # Run all tests
Not detected        # Watch mode
Not detected        # Coverage
```

## Test File Organization

**Location:**
- No co-located or separate automated test files were detected. Searches for `**/*.{test,spec}.{js,jsx,ts,tsx}` returned no matches.

**Naming:**
- Not applicable; no automated test filenames are present.

**Structure:**
```
No test directory or test file pattern detected in `/home/julien/src/profile`.
```

## Test Structure

**Suite Organization:**
```typescript
// No repository test suite pattern detected.
```

**Patterns:**
- Setup pattern: Not detected.
- Teardown pattern: Not detected.
- Assertion pattern: Not detected.

## Mocking

**Framework:** Not detected.

**Patterns:**
```typescript
// No mocking pattern detected because no automated tests are present.
```

**What to Mock:**
- No repository testing guidance is encoded in test files.
- If automated tests are introduced for `.opencode/hooks/*.js`, mock filesystem and process-boundary dependencies such as `fs`, `os.tmpdir()`, `child_process.spawn`, and stdin payloads instead of depending on the live runtime.

**What NOT to Mock:**
- Preserve real parsing and decision logic in hook scripts such as `.opencode/hooks/gsd-context-monitor.js`, `.opencode/hooks/gsd-read-guard.js`, and `.opencode/hooks/gsd-prompt-guard.js`; these files are small enough that unit tests should exercise the real branching logic.

## Fixtures and Factories

**Test Data:**
```typescript
// No fixture or factory pattern detected.
```

**Location:**
- No fixture directories or helper factories were found.

## Coverage

**Requirements:** None enforced.

**View Coverage:**
```bash
Not detected
```

## Test Types

**Unit Tests:**
- Not present.
- The most natural unit-test targets are the hook scripts in `.opencode/hooks/`, especially `.opencode/hooks/gsd-statusline.js`, `.opencode/hooks/gsd-context-monitor.js`, and `.opencode/hooks/gsd-check-update.js`, because they contain deterministic branching around JSON input, filesystem access, and warning generation.

**Integration Tests:**
- Not present.
- Existing shell entrypoints such as `profile/opencode-unleashed-safely.sh`, `profile/codex-unleashed-safely.sh`, and `utils/port-forward.sh` are currently validated operationally rather than via scripted integration suites.

**E2E Tests:**
- Not used.

## Common Patterns

**Async Testing:**
```typescript
// No async test pattern detected.
```

**Error Testing:**
```typescript
// No error assertion pattern detected.
```

## Existing Verification Style Outside Formal Tests

- Repository quality currently relies on fail-fast scripting and manual execution rather than a test harness.
- Bash scripts validate prerequisites up front and exit on failure, which acts as runtime safety rather than test coverage: `install`, `profile/codex-unleashed-safely.sh`, `profile/opencode-unleashed-safely.sh`, and `utils/port-forward.sh`.
- Hook scripts are written to tolerate malformed or missing input with silent `try/catch` handling and `process.exit(0)`, which reduces runtime breakage but is not backed by automated regression tests in `.opencode/hooks/gsd-statusline.js`, `.opencode/hooks/gsd-workflow-guard.js`, and `.opencode/hooks/gsd-prompt-guard.js`.

## Practical Guidance for Future Test Work

- Place any new JavaScript tests near the hook runtime code or in a dedicated adjacent directory under `.opencode/hooks/`, and keep file names aligned to the current entrypoint names, for example tests targeting `.opencode/hooks/gsd-context-monitor.js` and `.opencode/hooks/gsd-check-update.js`.
- Prioritize coverage for branch-heavy hook behavior: invalid JSON input, missing `session_id`, config toggles in `.planning/config.json`, debounce behavior, and path-safety checks in `.opencode/hooks/gsd-context-monitor.js` and `.opencode/hooks/gsd-statusline.js`.
- Add shell-script tests only around stable CLI contracts, such as argument validation and emitted error messages for `utils/port-forward.sh` and `profile/opencode-unleashed-safely.sh`.

---

*Testing analysis: 2026-04-26*
