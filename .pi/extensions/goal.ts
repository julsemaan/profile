import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

type GoalStatus = "working" | "done" | "blocked" | "idle";

type GoalState = {
	active: boolean;
	goalText: string;
	status: GoalStatus;
	autoTurns: number;
	maxAutoTurns: number;
	waitReason?: string;
	pollSeconds?: number;
	resumeAt?: string;
};

type WaitState = {
	reason: string;
	pollSeconds: number;
	resumeAt: string;
};

const STATE_TYPE = "goal-state";
const STATUS_KEY = "goal";
const DEFAULT_MAX_AUTO_TURNS = 6;
const DEFAULT_WAIT_POLL_SECONDS = 300;
const BUSY_RETRY_SECONDS = 15;
const FOLLOW_UP_PROMPT = "Continue working toward current goal. Do next best step. End with goal marker.";
const GOAL_LINE_RE = /^\[GOAL:(working|done|blocked)\]$/;
const WAIT_LINE_RE = /^\[WAIT:([^\s\]]+)(?:\s+poll=(\d+))?(?:\s+[^\]]+)?\]$/;

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

function normalizePollSeconds(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
	return Math.floor(value);
}

function normalizeResumeAt(value: unknown): string | undefined {
	if (typeof value !== "string" || !value.trim()) return undefined;
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

function normalizeWaitState(raw: Partial<GoalState>): Pick<GoalState, "waitReason" | "pollSeconds" | "resumeAt"> {
	const waitReason = typeof raw.waitReason === "string" && raw.waitReason.trim() ? raw.waitReason.trim() : undefined;
	const pollSeconds = normalizePollSeconds(raw.pollSeconds);
	const resumeAt = normalizeResumeAt(raw.resumeAt);
	if (!waitReason || !pollSeconds || !resumeAt) {
		return {};
	}
	return { waitReason, pollSeconds, resumeAt };
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
		...normalizeWaitState(raw),
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

function parseWaitLine(line: string): WaitState | undefined {
	const match = line.match(WAIT_LINE_RE);
	if (!match) return undefined;
	const reason = match[1]?.trim();
	const pollSeconds = match[2] ? Number.parseInt(match[2], 10) : DEFAULT_WAIT_POLL_SECONDS;
	if (!reason || !Number.isFinite(pollSeconds) || pollSeconds <= 0) return undefined;
	return {
		reason,
		pollSeconds,
		resumeAt: new Date(Date.now() + pollSeconds * 1000).toISOString(),
	};
}

function parseFinalMarkers(text: string): {
	goal?: Exclude<GoalStatus, "idle">;
	wait?: WaitState;
} {
	const lines = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	if (!lines.length) return {};

	const goalMatch = lines.at(-1)?.match(GOAL_LINE_RE);
	if (!goalMatch) return {};
	const goal = goalMatch[1] as Exclude<GoalStatus, "idle">;
	const wait = lines.length >= 2 ? parseWaitLine(lines[lines.length - 2] || "") : undefined;
	return { goal, wait };
}

function formatWaitStatus(state: GoalState): string | undefined {
	if (!state.waitReason || !state.resumeAt) return undefined;
	return `${state.waitReason} until ${state.resumeAt}`;
}

function buildStatusText(ctx: ExtensionContext, state: GoalState): string | undefined {
	if (state.active) {
		const waitStatus = formatWaitStatus(state);
		const label = waitStatus
			? `🎯 goal · waiting(${waitStatus}) · ${state.autoTurns}/${state.maxAutoTurns}`
			: `🎯 goal · working · ${state.autoTurns}/${state.maxAutoTurns}`;
		return ctx.ui.theme.fg("accent", label);
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
		`Wait: ${state.waitReason ? `${state.waitReason} @ ${state.resumeAt}` : "none"}`,
	].join("\n");
}

export default function goalExtension(pi: ExtensionAPI) {
	let state = createIdleState();
	let agentActive = false;
	let queuedThisTurn = false;
	let waitTimer: ReturnType<typeof setTimeout> | undefined;
	let lastCtx: ExtensionContext | undefined;

	const clearWaitTimer = () => {
		if (!waitTimer) return;
		clearTimeout(waitTimer);
		waitTimer = undefined;
	};

	const syncState = (ctx: ExtensionContext) => {
		lastCtx = ctx;
		state = reconstructState(ctx);
		ctx.ui.setStatus(STATUS_KEY, buildStatusText(ctx, state));
	};

	const persistState = (ctx: ExtensionContext) => {
		lastCtx = ctx;
		pi.appendEntry(STATE_TYPE, state);
		ctx.ui.setStatus(STATUS_KEY, buildStatusText(ctx, state));
	};

	const clearWaitState = () => {
		state = {
			...state,
			waitReason: undefined,
			pollSeconds: undefined,
			resumeAt: undefined,
		};
	};

	const stopGoal = (ctx: ExtensionContext, status: Exclude<GoalStatus, "working" | "idle">, reason?: string) => {
		clearWaitTimer();
		clearWaitState();
		state = {
			...state,
			active: false,
			status,
		};
		persistState(ctx);
		if (reason) ctx.ui.notify(reason, status === "done" ? "info" : "warning");
	};

	const clearGoal = (ctx: ExtensionContext, notify = true) => {
		clearWaitTimer();
		state = createIdleState();
		persistState(ctx);
		if (notify) ctx.ui.notify("Goal cleared.", "info");
	};

	const scheduleWaitResume = (ctx: ExtensionContext, resumeOverride?: WaitState) => {
		lastCtx = ctx;
		clearWaitTimer();
		const waitReason = resumeOverride?.reason ?? state.waitReason;
		const pollSeconds = resumeOverride?.pollSeconds ?? state.pollSeconds;
		const resumeAt = resumeOverride?.resumeAt ?? state.resumeAt;
		if (!state.active || !state.goalText || !waitReason || !pollSeconds || !resumeAt) return;

		const delayMs = Math.max(0, Date.parse(resumeAt) - Date.now());
		waitTimer = setTimeout(() => {
			waitTimer = undefined;
			const activeCtx = lastCtx;
			if (!activeCtx || !state.active || !state.goalText) return;
			if (agentActive || !activeCtx.isIdle()) {
				state = {
					...state,
					waitReason,
					pollSeconds,
					resumeAt: new Date(Date.now() + BUSY_RETRY_SECONDS * 1000).toISOString(),
				};
				persistState(activeCtx);
				scheduleWaitResume(activeCtx);
				return;
			}

			clearWaitState();
			persistState(activeCtx);
			queuedThisTurn = true;
			pi.sendUserMessage(state.goalText, { deliverAs: "followUp" });
			activeCtx.ui.notify(`Goal resumed: ${state.goalText}`, "info");
		}, delayMs);
		waitTimer.unref?.();
	};

	pi.registerCommand("goal", {
		description: "Start, inspect, or clear persistent goal loop. Usage: /goal <task> | /goal clear | /goal done | /goal blocked",
		handler: async (args, ctx) => {
			lastCtx = ctx;
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

			clearWaitTimer();
			state = {
				active: true,
				goalText,
				status: "working",
				autoTurns: 0,
				maxAutoTurns: DEFAULT_MAX_AUTO_TURNS,
				waitReason: undefined,
				pollSeconds: undefined,
				resumeAt: undefined,
			};
			queuedThisTurn = false;
			persistState(ctx);
			pi.setSessionName(goalText);
			ctx.ui.notify(`Goal started: ${goalText}`, "info");

			if (ctx.isIdle()) {
				pi.sendUserMessage(goalText);
			} else {
				queuedThisTurn = true;
				pi.sendUserMessage(goalText, { deliverAs: "followUp" });
				ctx.ui.notify("Goal armed. Applies next turn.", "info");
			}
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		syncState(ctx);
		scheduleWaitResume(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		syncState(ctx);
		scheduleWaitResume(ctx);
	});

	pi.on("agent_start", async () => {
		agentActive = true;
		queuedThisTurn = false;
	});

	pi.on("before_agent_start", async (event) => {
		if (!state.active) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\n[GOAL ACTIVE]\nCurrent goal: ${state.goalText}\nContinue working toward this goal.\nDo not stop early for partial progress.\nAsk user only if blocked or ambiguity prevents progress.\nIf deferred external wait needed, final lines must be: [exit] ..., optional [WAIT:<reason> poll=<seconds>], then final [GOAL:working|done|blocked].\nEnd every assistant message with exactly one final-line goal marker: [GOAL:working] or [GOAL:done] or [GOAL:blocked].`,
		};
	});

	pi.on("agent_end", async (event, ctx) => {
		lastCtx = ctx;
		if (!agentActive) return;
		agentActive = false;

		if (!state.active || queuedThisTurn) return;

		const text = getLastAssistantTextFromMessages(
			Array.isArray((event as { messages?: unknown[] }).messages)
				? (event as { messages?: unknown[] }).messages || []
				: [],
		);
		const { goal: marker, wait } = parseFinalMarkers(text);

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

		const nextAutoTurns = state.autoTurns + 1;
		if (nextAutoTurns > state.maxAutoTurns) {
			stopGoal(ctx, "blocked", `Goal stopped: auto-turn cap reached (${state.maxAutoTurns}).`);
			return;
		}

		state = {
			...state,
			autoTurns: nextAutoTurns,
		};

		if (wait) {
			state = {
				...state,
				waitReason: wait.reason,
				pollSeconds: wait.pollSeconds,
				resumeAt: wait.resumeAt,
			};
			persistState(ctx);
			scheduleWaitResume(ctx, wait);
			return;
		}

		clearWaitState();
		persistState(ctx);
		queuedThisTurn = true;
		pi.sendUserMessage(FOLLOW_UP_PROMPT, { deliverAs: "followUp" });
	});
}
