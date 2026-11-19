import { describe, it } from "node:test";
import assert from "node:assert/strict";

import contextWindowCap, { MAX_CONTEXT_WINDOW, capContextWindow } from "../.pi/extensions/context-window-cap.ts";

describe("capContextWindow", () => {
	it("lowers a 1M window to the cap", () => {
		const model = { contextWindow: 1_000_000 };
		assert.equal(capContextWindow(model), true);
		assert.equal(model.contextWindow, MAX_CONTEXT_WINDOW);
	});

	it("leaves a 128K window untouched", () => {
		const model = { contextWindow: 128_000 };
		assert.equal(capContextWindow(model), false);
		assert.equal(model.contextWindow, 128_000);
	});

	it("leaves exactly the cap unchanged", () => {
		const model = { contextWindow: MAX_CONTEXT_WINDOW };
		assert.equal(capContextWindow(model), false);
		assert.equal(model.contextWindow, MAX_CONTEXT_WINDOW);
	});

	it("is a no-op on undefined", () => {
		assert.equal(capContextWindow(undefined), false);
	});
});

describe("contextWindowCap extension", () => {
	it("caps the model from each registered hook", () => {
		const handlers = new Map<string, (event: unknown, ctx: any) => void>();
		const pi = { on: (name: string, handler: (event: unknown, ctx: any) => void) => handlers.set(name, handler) };
		contextWindowCap(pi as any);

		for (const hook of ["session_start", "model_select", "agent_start"]) {
			const model = { contextWindow: 1_000_000 };
			handlers.get(hook)?.({}, { model });
			assert.equal(model.contextWindow, MAX_CONTEXT_WINDOW, `${hook} did not cap the model`);
		}
	});
});
