/**
 * Bridge: profile-side agent status enrichment.
 *
 * Reads state from existing extension signals and session data,
 * emits composite `agent-status:profile` event for the astatus writer.
 *
 * Priority:
 *   question blocked → input-required
 *   active subagent  → working
 *   active goal      → working
 *   open todo, idle  → submitted
 *   else             → no bridge task (writer falls back to prompt-derived)
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const BRIDGE_EVENT = "agent-status:profile";

interface SubagentState {
	mode: string;
	agents: string[];
}

interface BridgeTask {
	state: "input-required" | "working" | "submitted";
	summary?: string;
}

interface BridgeMeta {
	pi: {
		mode: string;
		access?: string;
		profile?: string;
		ponytail: string;
		todo: { open: number; done: number; current?: string };
		goal: { active: boolean; status: string; text: string };
		subagent: { active: boolean; mode?: string; agents?: string[] };
	};
}

interface BridgeEvent {
	task?: BridgeTask;
	x_meta: BridgeMeta;
}

function reconstructTodoState(ctx: ExtensionContext): { open: number; done: number; current?: string } {
	const branch = ctx.sessionManager.getBranch();
	let todos: Array<{ id: number; text: string; done: boolean }> = [];
	for (const entry of branch) {
		if (entry.type !== "message") continue;
		const msg = (entry as any).message;
		if (msg?.role !== "toolResult" || msg?.toolName !== "todo") continue;
		const details = msg.details;
		if (!details?.todos) continue;
		todos = details.todos;
	}
	const open = todos.filter((t) => !t.done).length;
	const done = todos.filter((t) => t.done).length;
	const current = todos.find((t) => !t.done)?.text;
	return { open, done, current };
}

function reconstructGoalState(ctx: ExtensionContext): { active: boolean; status: string; text: string } {
	const entries = ctx.sessionManager.getBranch();
	let state = { active: false, status: "idle" as string, text: "" };
	for (const entry of entries) {
		if (entry.type !== "custom") continue;
		const custom = entry as any;
		if (custom.customType !== "goal-state") continue;
		const data = custom.data;
		if (data) {
			state = {
				active: data.active === true,
				status: data.status || "idle",
				text: data.goalText || "",
			};
		}
	}
	return state;
}

function reconstructModeState(ctx: ExtensionContext): { mode: string; access?: string; profile?: string } {
	const entries = ctx.sessionManager.getBranch();
	let mode = "build";
	let profile: string | undefined;
	for (const entry of entries) {
		if (entry.type !== "custom") continue;
		const custom = entry as any;
		if (custom.customType !== "build-plan-mode") continue;
		const data = custom.data;
		if (data?.mode) mode = data.mode;
		if (data?.profile) profile = data.profile;
	}
	const access = mode === "plan" ? "read-only" : mode === "brainstorm" ? "read-only" : undefined;
	return { mode, access, profile };
}

function reconstructPonytailMode(ctx: ExtensionContext): string {
	const entries = ctx.sessionManager.getBranch();
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i] as any;
		if (entry?.type !== "custom" || entry?.customType !== "ponytail-mode") continue;
		return entry?.data?.mode || "full";
	}
	return "full";
}

function buildBridgeEvent(
	questionBlocked: boolean,
	subagent: SubagentState | null,
	isAgentActive: boolean,
	ctx: ExtensionContext,
): BridgeEvent {
	const todo = reconstructTodoState(ctx);
	const goal = reconstructGoalState(ctx);
	const mode = reconstructModeState(ctx);
	const ponytail = reconstructPonytailMode(ctx);

	let task: BridgeTask | undefined;

	if (questionBlocked) {
		task = { state: "input-required", summary: "Waiting for user input" };
	} else if (subagent) {
		task = {
			state: "working",
			summary: `Subagent: ${subagent.agents.join(", ")}`,
		};
	} else if (goal.active) {
		task = { state: "working", summary: goal.text };
	} else if (todo.open > 0 && !isAgentActive) {
		task = {
			state: "submitted",
			summary: `${todo.open} open todo${todo.open > 1 ? "s" : ""} pending`,
		};
	}

	return {
		...(task ? { task } : {}),
		x_meta: {
			pi: {
				mode: mode.mode,
				access: mode.access,
				profile: mode.profile,
				ponytail,
				todo,
				goal,
				subagent: {
					active: subagent !== null,
					...(subagent ? { mode: subagent.mode, agents: subagent.agents } : {}),
				},
			},
		},
	};
}

export default function agentStatusBridge(pi: ExtensionAPI) {
	let questionBlocked = false;
	let subagentState: SubagentState | null = null;
	let isAgentActive = false;
	let lastCtx: ExtensionContext | undefined;

	const emit = (ctx: ExtensionContext) => {
		lastCtx = ctx;
		pi.events.emit(BRIDGE_EVENT, buildBridgeEvent(questionBlocked, subagentState, isAgentActive, ctx));
	};

	// Question blocked: herdr:blocked from question.ts
	pi.events.on("herdr:blocked", (data: any) => {
		if (data && typeof data.active === "boolean") {
			questionBlocked = data.active;
			if (lastCtx) emit(lastCtx);
		}
	});

	// Subagent start: tool_call
	pi.on("tool_call", async (event: any) => {
		if (event.toolName === "subagent") {
			const args = event.args || {};
			subagentState = {
				mode: args.chain ? "chain" : args.tasks ? "parallel" : "single",
				agents:
					args.chain?.map((s: any) => s.agent) ||
					args.tasks?.map((t: any) => t.agent) ||
					(args.agent ? [args.agent] : ["unknown"]),
			};
		}
	});

	// Lifecycle: track agent active / subagent done
	pi.on("before_agent_start", async (_event: any, ctx: ExtensionContext) => {
		isAgentActive = true;
		emit(ctx);
	});

	pi.on("agent_end", async (_event: any, ctx: ExtensionContext) => {
		subagentState = null;
		isAgentActive = false;
		emit(ctx);
	});

	// Sync on session events
	pi.on("session_start", async (_event: any, ctx: ExtensionContext) => {
		emit(ctx);
	});

	pi.on("session_tree", async (_event: any, ctx: ExtensionContext) => {
		emit(ctx);
	});
}
