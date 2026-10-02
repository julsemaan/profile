import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	applyFastMode,
	readFastModeFromEntries,
	readFastModeFromSessionFile,
	supportsCodexFastMode,
} from "../.pi/extensions/codex-fast-mode.ts";
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

describe("readFastModeFromSessionFile", () => {
	it("parses JSONL and skips malformed lines", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-fast-mode-"));
		const file = path.join(dir, "session.jsonl");
		fs.writeFileSync(
			file,
			[
				"{ not json",
				JSON.stringify({ type: "custom", customType: "codex-fast-mode", data: { enabled: true } }),
				"",
				JSON.stringify({ type: "custom", customType: "codex-fast-mode", data: { enabled: false } }),
			].join("\n"),
		);
		try {
			assert.equal(readFastModeFromSessionFile(file), false);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("returns undefined for undefined and missing paths", () => {
		assert.equal(readFastModeFromSessionFile(undefined), undefined);
		assert.equal(readFastModeFromSessionFile("/tmp/does-not-exist-codex-fast-mode.jsonl"), undefined);
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
	it("restores fast mode from the previous session on /new", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-fast-mode-"));
		const previousSessionFile = path.join(dir, "previous.jsonl");
		fs.writeFileSync(
			previousSessionFile,
			JSON.stringify({ type: "custom", customType: "codex-fast-mode", data: { enabled: true } }),
		);
		try {
			const { extension, entries, statuses, ctx } = await loadFastModeExtension();
			await extension.handlers.get("session_start")?.[0](
				{ type: "session_start", reason: "new", previousSessionFile },
				ctx,
			);

			assert.equal(statuses.at(-1), "⚡ Codex fast");
			assert.deepEqual(entries, [{ type: "custom", customType: "codex-fast-mode", data: { enabled: true } }]);

			await extension.commands.get("fast")?.handler("off", ctx);

			assert.equal(statuses.at(-1), "○ Codex standard");
			assert.deepEqual(entries.at(-1), { type: "custom", customType: "codex-fast-mode", data: { enabled: false } });
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
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
