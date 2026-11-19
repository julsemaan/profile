import { describe, it, beforeEach, afterEach, after } from "node:test";
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
	let originalFastMode: string | undefined;
	beforeEach(() => {
		clearProcessState("fast-mode");
		originalFastMode = process.env.PI_FAST_MODE;
		delete process.env.PI_FAST_MODE;
	});
	afterEach(() => {
		if (originalFastMode === undefined) delete process.env.PI_FAST_MODE;
		else process.env.PI_FAST_MODE = originalFastMode;
	});
	after(() => clearProcessState("fast-mode"));

	for (const value of [undefined, "0", "1", "true", "", "2"]) {
		it(`uses only PI_FAST_MODE=1 as the default, value ${JSON.stringify(value)}`, async () => {
			if (value !== undefined) process.env.PI_FAST_MODE = value;
			const { extension, entries, statuses, ctx } = await loadFastModeExtension();
			await extension.handlers.get("session_start")?.[0]({ type: "session_start", reason: "startup" }, ctx);
			const enabled = value === "1";
			assert.equal(statuses.at(-1), enabled ? "⚡ fast" : "○ standard");
			assert.equal(readFastModeFromEntries(entries), enabled ? true : undefined);
			const payload = { model: "gpt" };
			assert.deepEqual(
				await extension.handlers.get("before_provider_request")?.[0]({ payload }, ctx),
				enabled ? { ...payload, service_tier: "priority" } : payload,
			);
		});
	}

	for (const saved of [false, true]) {
		it(`prefers saved ${saved} over the opposite environment default`, async () => {
			process.env.PI_FAST_MODE = saved ? "0" : "1";
			writeProcessState("fast-mode", !saved);
			const { extension, entries, statuses, ctx } = await loadFastModeExtension();
			entries.push({ type: "custom", customType: "codex-fast-mode", data: { enabled: saved } });
			await extension.handlers.get("session_start")?.[0]({ type: "session_start", reason: "new" }, ctx);
			assert.equal(statuses.at(-1), saved ? "⚡ fast" : "○ standard");
			assert.equal(entries.length, 1);
		});
	}

	it("uses the environment on /new when no process state exists", async () => {
		process.env.PI_FAST_MODE = "1";
		const { extension, entries, statuses, ctx } = await loadFastModeExtension();
		await extension.handlers.get("session_start")?.[0]({ type: "session_start", reason: "new" }, ctx);
		assert.equal(statuses.at(-1), "⚡ fast");
		assert.equal(readFastModeFromEntries(entries), true);
	});

	it("keeps /fast off across /new despite the environment default", async () => {
		process.env.PI_FAST_MODE = "1";
		const first = await loadFastModeExtension();
		await first.extension.handlers.get("session_start")?.[0]({ type: "session_start", reason: "startup" }, first.ctx);
		assert.equal(first.statuses.at(-1), "⚡ fast");
		await first.extension.commands.get("fast")?.handler("off", first.ctx);
		assert.equal(readFastModeFromEntries(first.entries), false);
		await first.extension.handlers.get("session_shutdown")?.[0]({ type: "session_shutdown", reason: "new" }, first.ctx);

		const next = await loadFastModeExtension();
		await next.extension.handlers.get("session_start")?.[0]({ type: "session_start", reason: "new" }, next.ctx);
		assert.equal(next.statuses.at(-1), "○ standard");
		const payload = { model: "gpt" };
		assert.equal(await next.extension.handlers.get("before_provider_request")?.[0]({ payload }, next.ctx), payload);
	});

	it("does not apply the environment-enabled mode to unsupported providers", async () => {
		process.env.PI_FAST_MODE = "1";
		const { extension, statuses, ctx } = await loadFastModeExtension();
		ctx.model = { provider: "openai", api: "openai-responses" };
		await extension.handlers.get("session_start")?.[0]({ type: "session_start", reason: "startup" }, ctx);
		const payload = { model: "gpt" };
		assert.equal(statuses.at(-1), undefined);
		assert.equal(await extension.handlers.get("before_provider_request")?.[0]({ payload }, ctx), undefined);
		assert.deepEqual(payload, { model: "gpt" });
	});

	it("reads the process state on /new", async () => {
		writeProcessState("fast-mode", true);
		const { extension, statuses, ctx } = await loadFastModeExtension();
		await extension.handlers.get("session_start")?.[0](
			{ type: "session_start", reason: "new" },
			ctx,
		);

		assert.equal(statuses.at(-1), "⚡ fast");
	});

	it("keeps /fast on across /new without a persisted session", async () => {
		const first = await loadFastModeExtension();
		await first.extension.handlers.get("session_start")?.[0]({ type: "session_start", reason: "startup" }, first.ctx);
		await first.extension.commands.get("fast")?.handler("on", first.ctx);
		assert.equal(first.statuses.at(-1), "⚡ fast");

		// Fresh instance after /new: the previous session never persisted an entry.
		const next = await loadFastModeExtension();
		await next.extension.handlers.get("session_start")?.[0]({ type: "session_start", reason: "new" }, next.ctx);
		assert.equal(next.statuses.at(-1), "⚡ fast");
	});

	it("ignores a seeded process file on startup", async () => {
		writeProcessState("fast-mode", true);
		const { extension, statuses, ctx } = await loadFastModeExtension();
		await extension.handlers.get("session_start")?.[0]({ type: "session_start", reason: "startup" }, ctx);
		assert.equal(statuses.at(-1), "○ standard");
	});

	it("starts standard on a fresh startup", async () => {
		const { extension, statuses, ctx } = await loadFastModeExtension();
		await extension.handlers.get("session_start")?.[0]({ type: "session_start", reason: "startup" }, ctx);
		assert.equal(statuses.at(-1), "○ standard");
	});

	it("restores from session entries on resume", async () => {
		const { extension, entries, statuses, ctx } = await loadFastModeExtension();
		entries.push({ type: "custom", customType: "codex-fast-mode", data: { enabled: true } });
		await extension.handlers.get("session_start")?.[0]({ type: "session_start", reason: "resume" }, ctx);
		assert.equal(statuses.at(-1), "⚡ fast");
	});
});
