import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import {
	applyFastMode,
	readFastModeFromEntries,
	supportsCodexFastMode,
} from "../.pi/extensions/codex-fast-mode.ts";
import { clearProcessState, writeProcessState } from "../.pi/extensions/lib/process-state.ts";
import { loadExtensions, createExtensionRuntime } from "/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/index.js";
import { createEventBus } from "/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/event-bus.js";

const EXTENSION_PATH = ".pi/extensions/codex-fast-mode.ts";
const FAST_MODEL = { provider: "openai-codex", api: "openai-codex-responses" };

describe("applyFastMode", () => {
	it("adds the priority service tier when enabled", () => {
		assert.deepEqual(applyFastMode({ model: "gpt" }, true), {
			model: "gpt",
			service_tier: "priority",
		});
	});

	it("passes the payload through when disabled", () => {
		assert.deepEqual(applyFastMode({ model: "gpt" }, false), { model: "gpt" });
	});

	it("passes non-record payloads through even when enabled", () => {
		assert.equal(applyFastMode("raw", true), "raw");
		assert.equal(applyFastMode(undefined, true), undefined);
	});
});

describe("supportsCodexFastMode", () => {
	it("accepts only the openai-codex responses API", () => {
		assert.equal(supportsCodexFastMode(FAST_MODEL), true);
		assert.equal(supportsCodexFastMode({ provider: "openai-codex", api: "other" }), false);
		assert.equal(supportsCodexFastMode({ provider: "other", api: "openai-codex-responses" }), false);
		assert.equal(supportsCodexFastMode(undefined), false);
	});
});

describe("readFastModeFromEntries", () => {
	it("returns the last matching value", () => {
		const entries = [
			{ type: "custom", customType: "codex-fast-mode", data: { enabled: true } },
			{ type: "custom", customType: "other", data: { enabled: false } },
			{ type: "custom", customType: "codex-fast-mode", data: { enabled: false } },
		];
		assert.equal(readFastModeFromEntries(entries), false);
	});

	it("ignores entries without a boolean value", () => {
		const entries = [
			{ type: "custom", customType: "codex-fast-mode", data: { enabled: "yes" } },
			{ type: "message" },
		];
		assert.equal(readFastModeFromEntries(entries), undefined);
	});

	it("returns undefined when no entry matches", () => {
		assert.equal(readFastModeFromEntries([]), undefined);
	});
});

type MockContext = {
	model: { provider: string; api: string };
	ui: {
		statuses: (string | undefined)[];
		setStatus(_key: string, status: string | undefined): void;
		notify(): void;
	};
	sessionManager: { getEntries(): any[] };
};

async function loadFastModeExtension() {
	const runtime = createExtensionRuntime();
	const entries: any[] = [];
	const statuses: (string | undefined)[] = [];
	const ctx: MockContext = {
		model: FAST_MODEL,
		ui: {
			statuses,
			setStatus(_key, status) {
				statuses.push(status);
			},
			notify() {},
		},
		sessionManager: { getEntries: () => entries },
	};
	runtime.appendEntry = (type: string, data: unknown) => {
		entries.push({ type: "custom", customType: type, data });
	};

	const result = await loadExtensions([EXTENSION_PATH], process.cwd(), createEventBus(), runtime);
	assert.equal(result.errors.length, 0, result.errors.map((error) => error.error).join("\n"));
	const extension = result.extensions[0];
	assert.ok(extension);
	return { extension, entries, statuses, ctx };
}

describe("codexFastMode extension", () => {
	beforeEach(() => clearProcessState("fast-mode"));
	after(() => clearProcessState("fast-mode"));

	it("reads the process state on /new", async () => {
		writeProcessState("fast-mode", true);
		const { extension, statuses, ctx } = await loadFastModeExtension();
		await extension.handlers.get("session_start")?.[0](
			{ type: "session_start", reason: "new" },
			ctx,
		);

		assert.equal(statuses.at(-1), "⚡ Codex fast");
	});

	it("keeps /fast on across /new without a persisted session", async () => {
		const first = await loadFastModeExtension();
		await first.extension.handlers.get("session_start")?.[0]({ type: "session_start", reason: "startup" }, first.ctx);
		await first.extension.commands.get("fast")?.handler("on", first.ctx);
		assert.equal(first.statuses.at(-1), "⚡ Codex fast");

		// Fresh instance after /new: the previous session never persisted an entry.
		const next = await loadFastModeExtension();
		await next.extension.handlers.get("session_start")?.[0]({ type: "session_start", reason: "new" }, next.ctx);
		assert.equal(next.statuses.at(-1), "⚡ Codex fast");
	});

	it("ignores a seeded process file on startup", async () => {
		writeProcessState("fast-mode", true);
		const { extension, statuses, ctx } = await loadFastModeExtension();
		await extension.handlers.get("session_start")?.[0]({ type: "session_start", reason: "startup" }, ctx);
		assert.equal(statuses.at(-1), "○ Codex standard");
	});

	it("starts standard on a fresh startup", async () => {
		const { extension, statuses, ctx } = await loadFastModeExtension();
		await extension.handlers.get("session_start")?.[0]({ type: "session_start", reason: "startup" }, ctx);
		assert.equal(statuses.at(-1), "○ Codex standard");
	});

	it("restores from session entries on resume", async () => {
		const { extension, entries, statuses, ctx } = await loadFastModeExtension();
		entries.push({ type: "custom", customType: "codex-fast-mode", data: { enabled: true } });
		await extension.handlers.get("session_start")?.[0]({ type: "session_start", reason: "resume" }, ctx);
		assert.equal(statuses.at(-1), "⚡ Codex fast");
	});
});
