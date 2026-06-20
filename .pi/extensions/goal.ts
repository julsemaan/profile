import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

type GoalStatus = "working" | "done" | "blocked" | "idle";

type GoalState = {
	active: boolean;
	goalText: string;
	status: GoalStatus;
	autoTurns: number;
	maxAutoTurns: number;
};

const STATE_TYPE = "goal-state";
const STATUS_KEY = "goal";
const DEFAULT_MAX_AUTO_TURNS = 6;
const FOLLOW_UP_PROMPT = "Continue working toward current goal. Do next best step. End with goal marker.";
const GOAL_MARKER_RE = /\[GOAL:(working|done|blocked)\]/g;

function createIdleState(): GoalState {
	return {
		active: false,
		goalText: "",
		status: "idle",
		autoTurns: 0,
		maxAutoTurns: DEFAULT_MAX_AUTO_TURNS,
	};
}

function normalizeStatus(value: unknown): GoalStatus {
	return value === "working" || value === "done" || value === "blocked" || value === "idle"
		? value
		: "idle";
}

function normalizeState(data: unknown): GoalState {
	const raw = (typeof data === "object" && data !== null ? data : {}) as Partial<GoalState>;
	const goalText = typeof raw.goalText === "string" ? raw.goalText : "";
	const status = normalizeStatus(raw.status);
	const maxAutoTurns =
		typeof raw.maxAutoTurns === "number" && Number.isFinite(raw.maxAutoTurns) && raw.maxAutoTurns > 0
			? Math.floor(raw.maxAutoTurns)
			: DEFAULT_MAX_AUTO_TURNS;
	const autoTurnsRaw =
		typeof raw.autoTurns === "number" && Number.isFinite(raw.autoTurns) && raw.autoTurns >= 0
			? Math.floor(raw.autoTurns)
			: 0;
	const autoTurns = Math.min(autoTurnsRaw, maxAutoTurns);
	const active = raw.active === true && goalText.trim().length > 0 && status === "working";

	return {
		active,
		goalText: goalText.trim(),
		status: active ? "working" : goalText.trim() ? status : "idle",
		autoTurns,
		maxAutoTurns,
	};
}

function reconstructState(ctx: ExtensionContext): GoalState {
	const entries = ctx.sessionManager.getBranch?.() || ctx.sessionManager.getEntries?.() || [];
	let state = createIdleState();

	for (const entry of entries) {
		const custom = entry as { type?: string; customType?: string; data?: unknown };
		if (custom.type !== "custom" || custom.customType !== STATE_TYPE) continue;
		state = normalizeState(custom.data);
	}

	return state;
}

function isAssistantMessage(value: unknown): value is AssistantMessage {
	return (
		typeof value === "object" &&
		value !== null &&
		"role" in value &&
		(value as { role?: string }).role === "assistant" &&
		"content" in value &&
		Array.isArray((value as { content?: unknown }).content)
	);
}

function getAssistantText(message: AssistantMessage): string {
	return message.content
		.filter((part): part is TextContent => part.type === "text")
		.map((part) => part.text)
		.join("\n")
		.trim();
}

function getLastAssistantTextFromMessages(messages: unknown[]): string {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i];
		if (!isAssistantMessage(message)) continue;
		return getAssistantText(message);
	}
	return "";
}

function parseGoalMarker(text: string): Exclude<GoalStatus, "idle"> | undefined {
	const matches = Array.from(text.matchAll(GOAL_MARKER_RE));
	if (matches.length !== 1) return undefined;
	const match = matches[0];
	if (!text.trimEnd().endsWith(match[0])) return undefined;
	const marker = match[1];
	return marker === "working" || marker === "done" || marker === "blocked" ? marker : undefined;
}

function buildKickoffPrompt(goalText: string): string {
	return [
		`Goal: ${goalText}`,
		"Work until goal is reached or truly blocked.",
		"Do not stop early for partial progress.",
		"Ask user only if blocked or ambiguity prevents progress.",
		"End response with exactly one final-line marker: [GOAL:working] or [GOAL:done] or [GOAL:blocked].",
	].join("\n");
}

function buildStatusText(ctx: ExtensionContext, state: GoalState): string | undefined {
	if (state.active) {
		return ctx.ui.theme.fg("accent", `🎯 goal · working · ${state.autoTurns}/${state.maxAutoTurns}`);
	}
	if (state.status === "done") {
		return ctx.ui.theme.fg("success", "🎯 goal · done");
	}
	if (state.status === "blocked") {
		return ctx.ui.theme.fg("warning", "🎯 goal · blocked");
	}
	return undefined;
}

function summarizeState(state: GoalState): string {
	if (!state.goalText) {
		return "No goal. Usage: /goal <task> | /goal clear";
	}
	return [
		`Goal: ${state.goalText}`,
		`Status: ${state.status}${state.active ? " (active)" : ""}`,
		`Auto-turns: ${state.autoTurns}/${state.maxAutoTurns}`,
	].join("\n");
}

export default function goalExtension(pi: ExtensionAPI) {
	let state = createIdleState();
	let agentActive = false;
	let queuedThisTurn = false;

	const syncState = (ctx: ExtensionContext) => {
		state = reconstructState(ctx);
		ctx.ui.setStatus(STATUS_KEY, buildStatusText(ctx, state));
	};

	const persistState = (ctx: ExtensionContext) => {
		pi.appendEntry(STATE_TYPE, state);
		ctx.ui.setStatus(STATUS_KEY, buildStatusText(ctx, state));
	};

	const stopGoal = (ctx: ExtensionContext, status: Exclude<GoalStatus, "working" | "idle">, reason?: string) => {
		state = {
			...state,
			active: false,
			status,
		};
		persistState(ctx);
		if (reason) ctx.ui.notify(reason, status === "done" ? "info" : "warning");
	};

	const clearGoal = (ctx: ExtensionContext, notify = true) => {
		state = createIdleState();
		persistState(ctx);
		if (notify) ctx.ui.notify("Goal cleared.", "info");
	};

	pi.registerCommand("goal", {
		description: "Start, inspect, or clear persistent goal loop. Usage: /goal <task> | /goal clear | /goal done | /goal blocked",
		handler: async (args, ctx) => {
			const raw = args.trim();
			if (!raw) {
				ctx.ui.notify(summarizeState(state), "info");
				return;
			}

			if (raw === "clear") {
				clearGoal(ctx);
				return;
			}

			if (raw === "done") {
				if (!state.goalText) {
					ctx.ui.notify("No goal to mark done.", "warning");
					return;
				}
				stopGoal(ctx, "done", "Goal marked done.");
				return;
			}

			if (raw === "blocked") {
				if (!state.goalText) {
					ctx.ui.notify("No goal to mark blocked.", "warning");
					return;
				}
				stopGoal(ctx, "blocked", "Goal marked blocked.");
				return;
			}

			const goalText = raw.trim();
			if (!goalText) {
				ctx.ui.notify("Usage: /goal <task>", "warning");
				return;
			}

			state = {
				active: true,
				goalText,
				status: "working",
				autoTurns: 0,
				maxAutoTurns: DEFAULT_MAX_AUTO_TURNS,
			};
			queuedThisTurn = false;
			persistState(ctx);
			pi.setSessionName(goalText);
			ctx.ui.notify(`Goal started: ${goalText}`, "info");

			if (ctx.isIdle()) {
				pi.sendUserMessage(buildKickoffPrompt(goalText));
			} else {
				ctx.ui.notify("Goal armed. Applies next turn.", "info");
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		syncState(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		syncState(ctx);
	});

	pi.on("agent_start", async () => {
		agentActive = true;
		queuedThisTurn = false;
	});

	pi.on("before_agent_start", async (event) => {
		if (!state.active) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\n[GOAL ACTIVE]\nCurrent goal: ${state.goalText}\nContinue working toward this goal.\nDo not stop early for partial progress.\nAsk user only if blocked or ambiguity prevents progress.\nEnd every assistant message with exactly one final-line marker: [GOAL:working] or [GOAL:done] or [GOAL:blocked].`,
		};
	});

	pi.on("agent_end", async (event, ctx) => {
		if (!agentActive) return;
		agentActive = false;

		if (!state.active || queuedThisTurn) return;

		const text = getLastAssistantTextFromMessages(Array.isArray((event as { messages?: unknown[] }).messages) ? (event as { messages?: unknown[] }).messages || [] : []);
		const marker = parseGoalMarker(text);

		if (marker === "done") {
			stopGoal(ctx, "done", "Goal done.");
			return;
		}

		if (marker === "blocked") {
			stopGoal(ctx, "blocked", "Goal blocked.");
			return;
		}

		if (marker !== "working") {
			stopGoal(ctx, "blocked", "Goal stopped: missing or malformed goal marker.");
			return;
		}

		if (state.autoTurns >= state.maxAutoTurns) {
			stopGoal(ctx, "blocked", `Goal stopped: auto-turn cap reached (${state.maxAutoTurns}).`);
			return;
		}

		state = {
			...state,
			autoTurns: state.autoTurns + 1,
		};
		persistState(ctx);
		queuedThisTurn = true;
		pi.sendUserMessage(FOLLOW_UP_PROMPT, { deliverAs: "followUp" });
	});
}
