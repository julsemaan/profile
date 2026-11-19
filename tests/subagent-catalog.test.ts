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

		const event = { systemPrompt: "BASE", systemPromptOptions: { sections: {} as Record<string, string> } };
		const result = await handler(event, { cwd: process.cwd() });

		assert.equal(result?.systemPrompt, undefined);
		assert.equal(event.systemPrompt, "BASE");
		const prompt = event.systemPromptOptions.sections.subagents;
		assert.match(prompt, /^Only these agent names exist/);
		for (const name of ["worker", "code-reviewer", "pr-feedback-worker", "pr-feedback-reviewer"]) {
			assert.match(prompt, new RegExp(`- ${name} \\(`), `catalog is missing ${name}`);
		}
	});
});
