import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createExtensionRuntime, loadExtensions } from "/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/index.js";
import { createEventBus } from "/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/event-bus.js";

const EXTENSION_PATH = ".pi/extensions/subagent/index.ts";

async function loadSubagentExtension() {
	const result = await loadExtensions([EXTENSION_PATH], process.cwd(), createEventBus(), createExtensionRuntime());
	assert.equal(result.errors.length, 0, result.errors.map((error) => error.error).join("\n"));
	const extension = result.extensions[0];
	assert.ok(extension, "subagent extension failed to load");
	return extension;
}

describe("subagent catalog prompt", () => {
	it("appends the discovered agent catalog to the system prompt", async () => {
		const extension = await loadSubagentExtension();
		const handler = extension.handlers.get("before_agent_start")?.[0];
		assert.ok(handler, "missing before_agent_start handler");

		const result = await handler({ systemPrompt: "BASE" }, { cwd: process.cwd() });

		assert.ok(result?.systemPrompt, "handler returned no systemPrompt");
		const prompt = result.systemPrompt as string;
		assert.match(prompt, /^BASE\n\n<subagents>/);
		assert.match(prompt, /<\/subagents>$/);
		for (const name of ["worker", "code-reviewer", "pr-feedback-worker", "pr-feedback-reviewer"]) {
			assert.match(prompt, new RegExp(`- ${name} \\(`), `catalog is missing ${name}`);
		}
	});
});
