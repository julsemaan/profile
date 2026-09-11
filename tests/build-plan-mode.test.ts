import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { MODEL_PROFILES } from "../.pi/extensions/lib/model-profile.ts";
import { loadExtensions, createExtensionRuntime } from "/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/index.js";
import { createEventBus } from "/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/event-bus.js";

const EXTENSION_PATH = ".pi/extensions/build-plan-mode.ts";
const PLAN = [
	"Decisions:",
	"- Keep the existing command path.",
	"Files:",
	"- .pi/extensions/build-plan-mode.ts",
	"Implementation steps:",
	"1. Add the workflow.",
	"Validation:",
	"- Run node --test tests/build-plan-mode.test.ts",
].join("\n");

type SentMessage = { content: string; options?: Record<string, unknown> };
type NewSessionCall = {
	parentSession?: string;
	setup?: (sessionManager: { appendCustomEntry(type: string, data: unknown): void }) => Promise<void>;
	withSession?: (ctx: MockContext & { sendUserMessage(content: string, options?: Record<string, unknown>): Promise<void> }) => Promise<void>;
};

type MockContext = {
	cwd: string;
	replacementPrompts: string[];
	replacementCommands: string[];
	mode: "tui";
	hasUI: true;
	ui: {
		notifications: string[];
		notify(message: string, type?: string): void;
		setStatus(): void;
		theme: { fg(_color: string, text: string): string };
	};
	sessionManager: {
		entries: any[];
		getEntries(): any[];
		getBranch(): any[];
		getSessionFile(): string;
	};
	modelRegistry: {
		find(provider: string, modelId: string): { provider: string; id: string };
		refresh(): Promise<void>;
		getAvailable(): { provider: string; id: string }[];
	};
	scopedModels: [];
	isIdle(): boolean;
	waitForIdle(): Promise<void>;
	newSessionCalls: NewSessionCall[];
	newSessionResult: { cancelled: boolean };
	newSession(options?: NewSessionCall): Promise<{ cancelled: boolean }>;
	sendUserMessage?(content: string, options?: Record<string, unknown>): Promise<void>;
};

type Loaded = {
	extension: any;
	runtime: any;
	ctx: MockContext;
	sent: SentMessage[];
	startedPrompts: string[];
};

function makeContext(): MockContext {
	const notifications: string[] = [];
	const ctx = {
		cwd: process.cwd(),
		replacementPrompts: [] as string[],
		replacementCommands: [] as string[],
		mode: "tui" as const,
		hasUI: true as const,
		ui: {
			notifications,
			notify(message: string, type?: string) {
				notifications.push(`${type ?? "info"}: ${message}`);
			},
			setStatus() {},
			theme: { fg: (_color: string, text: string) => text },
		},
		sessionManager: {
			entries: [] as any[],
			getEntries() {
				return this.entries;
			},
			getBranch() {
				return this.entries;
			},
			getSessionFile() {
				return "/tmp/plan-session.jsonl";
			},
		},
		modelRegistry: {
			find(provider: string, modelId: string) {
				return { provider, id: modelId };
			},
			async refresh() {},
			getAvailable() {
				return [];
			},
		},
		scopedModels: [] as [],
		isIdle: () => true,
		async waitForIdle() {},
		newSessionCalls: [] as NewSessionCall[],
		newSessionResult: { cancelled: false },
		async newSession(options?: NewSessionCall) {
			this.newSessionCalls.push(options ?? {});
			if (options?.setup) {
				await options.setup({
					appendCustomEntry: (type, data) => this.sessionManager.entries.push({ type: "custom", customType: type, data }),
				});
			}
			if (!this.newSessionResult.cancelled && options?.withSession) {
				await options.withSession({
					...this,
					sessionManager: this.sessionManager,
					sendUserMessage: async (content: string) => {
						if (content === "/build") this.replacementCommands.push(content);
						else this.replacementPrompts.push(content);
					},
				});
			}
			return this.newSessionResult;
		},
	};
	return ctx;
}

async function loadBuildPlanExtension(): Promise<Loaded> {
	const runtime = createExtensionRuntime();
	const ctx = makeContext();
	const sent: SentMessage[] = [];
	const startedPrompts: string[] = [];
	const activeTools: string[] = [];

	runtime.getAllTools = () => [
		{ name: "read", description: "read", parameters: {}, sourceInfo: { path: "test", source: "test", scope: "temporary", origin: "top-level" } },
		{ name: "question", description: "question", parameters: {}, sourceInfo: { path: "test", source: "test", scope: "temporary", origin: "top-level" } },
	];
	runtime.getActiveTools = () => [...activeTools];
	runtime.setActiveTools = (names: string[]) => {
		activeTools.splice(0, activeTools.length, ...names);
	};
	runtime.getCommands = () => [];
	runtime.setModel = async () => true;
	runtime.setThinkingLevel = () => {};
	runtime.appendEntry = (type: string, data: unknown) => {
		ctx.sessionManager.entries.push({ type: "custom", customType: type, data });
	};
	runtime.sendMessage = () => {};
	runtime.sendUserMessage = (content: any, options?: any) => {
		sent.push({ content, options });
		if (typeof content === "string" && content !== "/execute-plan") startedPrompts.push(content);
	};

	const result = await loadExtensions([EXTENSION_PATH], process.cwd(), createEventBus(), runtime);
	assert.equal(result.errors.length, 0, result.errors.map((error) => error.error).join("\n"));
	const extension = result.extensions[0];
	assert.ok(extension);

	const sessionStart = extension.handlers.get("session_start")?.[0];
	assert.ok(sessionStart);
	await sessionStart({ type: "session_start", reason: "startup" }, ctx);

	runtime.sendUserMessage = (content: any, options?: any) => {
		sent.push({ content, options });
		if (typeof content === "string" && content !== "/execute-plan") startedPrompts.push(content);
		if (content === "/execute-plan" && options?.expandPromptTemplates === true) {
			const execute = extension.commands.get("execute-plan")?.handler;
			if (execute) void execute("", ctx as any);
		}
	};

	return { extension, runtime, ctx, sent, startedPrompts };
}

function command(loaded: Loaded, name: string) {
	const registered = loaded.extension.commands.get(name);
	assert.ok(registered, `missing command: ${name}`);
	return registered.handler;
}

function tool(loaded: Loaded, name: string) {
	const registered = loaded.extension.tools.get(name);
	assert.ok(registered, `missing tool: ${name}`);
	return registered.definition;
}

function handler(loaded: Loaded, event: string) {
	const registered = loaded.extension.handlers.get(event)?.[0];
	assert.ok(registered, `missing handler: ${event}`);
	return registered;
}

function waitForTimers(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 10));
}

describe("automatic plan-build workflow", () => {
	it("registers /plan-build and the finish_plan tool", async () => {
		const loaded = await loadBuildPlanExtension();

		assert.ok(loaded.extension.commands.has("plan-build"));
		assert.ok(loaded.extension.tools.has("finish_plan"));
	});

	it("keeps questions and ordinary assistant responses in plan mode", async () => {
		const loaded = await loadBuildPlanExtension();
		await command(loaded, "plan-build")("", loaded.ctx);
		const prompt = await handler(loaded, "before_agent_start")({ systemPrompt: "base" }, loaded.ctx);
		assert.match(prompt.systemPrompt, /finish_plan exactly once/);

		await handler(loaded, "agent_end")({
			type: "agent_end",
			messages: [{ role: "assistant", content: [{ type: "toolCall", name: "question" }, { type: "text", text: PLAN }] }],
		}, loaded.ctx);
		await handler(loaded, "agent_settled")({ type: "agent_settled" }, loaded.ctx);
		await waitForTimers();

		assert.equal(loaded.sent.some((message) => message.content === "/execute-plan"), false);
		assert.equal(loaded.ctx.ui.notifications.some((message) => message.includes("Automatic plan-build enabled")), true);
	});

	it("accepts an explicit plan and dispatches exactly one handoff after settling", async () => {
		const loaded = await loadBuildPlanExtension();
		await command(loaded, "plan-build")("Implement the feature", loaded.ctx);
		assert.equal(loaded.startedPrompts.at(-1), "Implement the feature");
		const finish = tool(loaded, "finish_plan");
		const result = await finish.execute("finish-1", { plan: PLAN }, undefined, undefined, loaded.ctx);

		assert.equal(result.terminate, true);
		assert.match(result.content[0].text, /Plan accepted/);
		await handler(loaded, "agent_settled")({ type: "agent_settled" }, loaded.ctx);
		await handler(loaded, "agent_settled")({ type: "agent_settled" }, loaded.ctx);
		await waitForTimers();

		assert.equal(loaded.sent.filter((message) => message.content === "/execute-plan").length, 1);
		assert.equal(loaded.sent.find((message) => message.content === "/execute-plan")?.options?.deliverAs, "followUp");
		assert.equal(loaded.sent.find((message) => message.content === "/execute-plan")?.options?.expandPromptTemplates, true);
		await waitForTimers();
		assert.equal(loaded.ctx.newSessionCalls.length, 1);
		assert.equal(loaded.ctx.newSessionCalls[0]?.parentSession, "/tmp/plan-session.jsonl");
		assert.match(loaded.ctx.replacementPrompts[0] ?? "", /Do not commit, push, or open a pull request/);
	});

	it("does not retry a cancelled automatic session replacement", async () => {
		const loaded = await loadBuildPlanExtension();
		await command(loaded, "plan-build")("task", loaded.ctx);
		loaded.ctx.newSessionResult = { cancelled: true };
		await tool(loaded, "finish_plan").execute("finish-1", { plan: PLAN }, undefined, undefined, loaded.ctx);
		await handler(loaded, "agent_settled")({ type: "agent_settled" }, loaded.ctx);
		await waitForTimers();
		await handler(loaded, "agent_settled")({ type: "agent_settled" }, loaded.ctx);
		await waitForTimers();

		assert.equal(loaded.ctx.newSessionCalls.length, 1);
		assert.equal(loaded.ctx.ui.notifications.some((message) => message.includes("No retry will be attempted")), true);
	});

	it("rejects empty plans without scheduling a handoff", async () => {
		const loaded = await loadBuildPlanExtension();
		await command(loaded, "plan-build")("task", loaded.ctx);
		const result = await tool(loaded, "finish_plan").execute("finish-1", { plan: " \n " }, undefined, undefined, loaded.ctx);

		assert.equal(result.terminate, undefined);
		assert.match(result.content[0].text, /nonempty/);
		await handler(loaded, "agent_settled")({ type: "agent_settled" }, loaded.ctx);
		await waitForTimers();
		assert.equal(loaded.sent.some((message) => message.content === "/execute-plan"), false);
	});

	it("cancels automatic completion on abort, mode changes, and shutdown", async () => {
		const loaded = await loadBuildPlanExtension();
		await command(loaded, "plan-build")("task", loaded.ctx);
		await handler(loaded, "agent_end")({
			type: "agent_end",
			messages: [{ role: "assistant", stopReason: "aborted", content: [] }],
		}, loaded.ctx);
		assert.equal((await tool(loaded, "finish_plan").execute("finish-1", { plan: PLAN }, undefined, undefined, loaded.ctx)).terminate, undefined);

		await command(loaded, "plan-build")("task", loaded.ctx);
		await command(loaded, "plan")("", loaded.ctx);
		assert.equal((await tool(loaded, "finish_plan").execute("finish-2", { plan: PLAN }, undefined, undefined, loaded.ctx)).terminate, undefined);

		await command(loaded, "plan-build")("task", loaded.ctx);
		await command(loaded, "build")("", loaded.ctx);
		assert.equal((await tool(loaded, "finish_plan").execute("finish-3", { plan: PLAN }, undefined, undefined, loaded.ctx)).terminate, undefined);

		await command(loaded, "plan-build")("task", loaded.ctx);
		await handler(loaded, "session_start")({ type: "session_start", reason: "reload" }, loaded.ctx);
		assert.equal((await tool(loaded, "finish_plan").execute("finish-4", { plan: PLAN }, undefined, undefined, loaded.ctx)).terminate, undefined);

		await handler(loaded, "session_shutdown")({ type: "session_shutdown", reason: "reload" }, loaded.ctx);
		assert.equal((await tool(loaded, "finish_plan").execute("finish-5", { plan: PLAN }, undefined, undefined, loaded.ctx)).terminate, undefined);
	});
});

describe("plan execution commands", () => {
	it("keeps /execute-plan finalization and /execute-plan-now direct handoff behavior", async () => {
		const loaded = await loadBuildPlanExtension();
		let idle = true;
		loaded.ctx.isIdle = () => idle;
		loaded.runtime.sendUserMessage = (content: string, options?: Record<string, unknown>) => {
			loaded.sent.push({ content, options });
			if (content.startsWith("Provide the final plan")) {
				idle = false;
				queueMicrotask(() => {
					loaded.ctx.sessionManager.entries.push({
						type: "message",
						id: "final-plan",
						message: { role: "assistant", content: [{ type: "text", text: PLAN }] },
					});
					idle = true;
				});
			}
		};

		await command(loaded, "execute-plan")("extra", loaded.ctx);
		await waitForTimers();
		assert.match(loaded.sent[0]?.content ?? "", /^Provide the final plan/);

		const direct = await loadBuildPlanExtension();
		direct.ctx.sessionManager.entries.push({
			type: "message",
			id: "latest",
			message: { role: "assistant", content: [{ type: "text", text: PLAN }] },
		});
		await command(direct, "execute-plan-now")("direct", direct.ctx);
		await waitForTimers();
		assert.equal(direct.sent.some((message) => message.content.startsWith("Provide the final plan")), false);
		assert.equal(direct.ctx.newSessionCalls.length, 1);
		assert.doesNotMatch(direct.ctx.replacementPrompts[0] ?? "", /github-open-pr or bitbucket-open-pr/);
	});

	it("reports failed finalization and cancelled session creation without retrying", async () => {
		const loaded = await loadBuildPlanExtension();
		let idle = true;
		loaded.ctx.isIdle = () => idle;
		loaded.runtime.sendUserMessage = (content: string) => {
			loaded.sent.push({ content });
			idle = false;
			queueMicrotask(() => {
				idle = true;
			});
		};
		await command(loaded, "execute-plan")("", loaded.ctx);
		assert.equal(loaded.ctx.ui.notifications.some((message) => message.includes("did not produce a final plan")), true);

		const failed = await loadBuildPlanExtension();
		let failedIdle = true;
		failed.ctx.isIdle = () => failedIdle;
		failed.runtime.sendUserMessage = (content: string) => {
			failed.sent.push({ content });
			failedIdle = false;
			queueMicrotask(() => {
				failed.ctx.sessionManager.entries.push({
					type: "message",
					id: "failed-plan",
					message: { role: "assistant", stopReason: "error", content: [{ type: "text", text: PLAN }] },
				});
				failedIdle = true;
			});
		};
		await command(failed, "execute-plan")("", failed.ctx);
		assert.equal(failed.ctx.newSessionCalls.length, 0);
		assert.equal(failed.ctx.ui.notifications.some((message) => message.includes("Final plan request failed")), true);

		const cancelled = await loadBuildPlanExtension();
		cancelled.ctx.sessionManager.entries.push({
			type: "message",
			id: "latest",
			message: { role: "assistant", content: [{ type: "text", text: PLAN }] },
		});
		cancelled.ctx.newSessionResult = { cancelled: true };
		await command(cancelled, "execute-plan-now")("", cancelled.ctx);
		assert.equal(cancelled.ctx.newSessionCalls.length, 1);
		assert.equal(cancelled.ctx.ui.notifications.some((message) => message.includes("Execute plan cancelled")), true);

		const failedSession = await loadBuildPlanExtension();
		failedSession.ctx.sessionManager.entries.push({
			type: "message",
			id: "latest",
			message: { role: "assistant", content: [{ type: "text", text: PLAN }] },
		});
		failedSession.ctx.newSession = async () => {
			throw new Error("session unavailable");
		};
		await command(failedSession, "execute-plan-now")("", failedSession.ctx);
		assert.equal(failedSession.ctx.ui.notifications.some((message) => message.includes("session unavailable")), true);
	});

	it("passes only the submitted plan, execution instructions, and build configuration to a fresh session", async () => {
		const loaded = await loadBuildPlanExtension();
		loaded.ctx.sessionManager.entries.push({
			type: "message",
			id: "latest",
			message: { role: "assistant", content: [{ type: "text", text: PLAN }] },
		});
		await command(loaded, "execute-plan-now")("run validation", loaded.ctx);
		await waitForTimers();

		const setupState = loaded.ctx.sessionManager.entries.at(-1)?.data;
		assert.equal(setupState?.mode, "build");
		assert.deepEqual(loaded.ctx.replacementCommands, ["/build"]);
		assert.equal(loaded.ctx.replacementPrompts.length, 1);
		assert.match(loaded.ctx.replacementPrompts[0] ?? "", /Execute this plan/);
		assert.match(loaded.ctx.replacementPrompts[0] ?? "", /run validation/);
		assert.match(loaded.ctx.replacementPrompts[0] ?? "", /## Plan/);
	});

	it("adds PR instructions only for /execute-plan-pr", async () => {
		const loaded = await loadBuildPlanExtension();
		let idle = true;
		loaded.ctx.isIdle = () => idle;
		loaded.runtime.sendUserMessage = (content: string, options?: Record<string, unknown>) => {
			loaded.sent.push({ content, options });
			if (content.startsWith("Provide the final plan")) {
				idle = false;
				queueMicrotask(() => {
					loaded.ctx.sessionManager.entries.push({
						type: "message",
						id: `final-${loaded.sent.length}`,
						message: { role: "assistant", content: [{ type: "text", text: PLAN }] },
					});
					idle = true;
				});
			}
		};
		await command(loaded, "execute-plan-pr")("", loaded.ctx);
		await waitForTimers();
		assert.equal(loaded.ctx.newSessionCalls.length, 1);
		assert.match(loaded.ctx.ui.notifications.join("\n"), /Started fresh build session/);
		assert.match(loaded.ctx.replacementPrompts[0] ?? "", /github-open-pr or bitbucket-open-pr/);
		assert.match(loaded.ctx.replacementPrompts[0] ?? "", /ready-for-review/);
	});
});

describe("manual profile persistence", () => {
	it("keeps manual pick across /new with empty entries on the same instance", async () => {
		const loaded = await loadBuildPlanExtension();
		await command(loaded, "model-profile")("deep", loaded.ctx);
		loaded.ctx.ui.notifications.length = 0;

		// Simulate /new: same extension instance, fresh empty session.
		loaded.ctx.sessionManager.entries = [];
		await handler(loaded, "session_start")({ type: "session_start", reason: "new" }, loaded.ctx);

		loaded.ctx.ui.notifications.length = 0;
		await command(loaded, "model-profile")("", loaded.ctx);
		assert.match(loaded.ctx.ui.notifications.join("\n"), /Current profile: deep/);
	});

	it("restores the previous session pick on /new in a fresh instance", async () => {
		const loaded = await loadBuildPlanExtension();
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pi-prev-session-"));
		try {
			const prevFile = path.join(tmp, "prev.jsonl");
			const stamp = new Date().toISOString();
				const lines = [
					{ type: "custom", customType: "build-plan-mode", data: { mode: "build", profile: "deep", modelMap: structuredClone(MODEL_PROFILES.deep) }, id: "e1", parentId: null, timestamp: stamp },
					{ type: "custom", customType: "build-plan-mode", data: { mode: "small-build" }, id: "e2", parentId: "e1", timestamp: stamp },
				];
				fs.writeFileSync(prevFile, lines.map((line) => JSON.stringify(line)).join("\n") + "\n");

				// Fresh instance, empty new session, previous file carries the pick.
			loaded.ctx.sessionManager.entries = [];
			loaded.ctx.ui.notifications.length = 0;
			await handler(loaded, "session_start")({ type: "session_start", reason: "new", previousSessionFile: prevFile }, loaded.ctx);

				loaded.ctx.ui.notifications.length = 0;
			await command(loaded, "model-profile")("", loaded.ctx);
			assert.match(loaded.ctx.ui.notifications.join("\n"), /Current profile: deep/);
		} finally {
			fs.rmSync(tmp, { recursive: true, force: true });
		}
	});
});
