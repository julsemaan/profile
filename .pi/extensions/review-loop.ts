import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext, ToolExecutionMode } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "typebox";
import * as fs from "node:fs";
import * as path from "node:path";

type Forge = "github" | "bitbucket";
type LoopStatus = "working" | "waiting-for-review" | "done" | "blocked";

type ReviewLoopState = {
	active: boolean;
	prUrl: string;
	forge: Forge | "";
	owner: string;
	repo: string;
	pullNumber: number;
	pollIntervalMs: number;
	stateDir: string;
	lastSeenCommentAt: string;
	lastSeenReviewAt: string;
	lastHandledItemKeys: string[];
	lastAiReviewRequestSha: string;
	lastAiReviewRequestAt: string;
	lastAiReviewRequestHeadSha: string;
	latestReviewerSummaryId: string;
	latestReviewerSummaryAt: string;
	latestReviewerSummaryStatus: string;
	status: LoopStatus;
	nextPollAt: number;
	cycle: number;
	lastCycleSummary: string;
	error: string;
};

type ReviewLoopAction =
	| "start"
	| "status"
	| "record_feedback_snapshot"
	| "record_cycle_result"
	| "record_ai_review_request"
	| "stop";

interface ReviewLoopDetails {
	action: ReviewLoopAction;
	state: ReviewLoopState;
	error?: string;
}

type ReviewLoopToolArgs = Record<string, unknown>;
type AssistantToolCallBlock = {
	type: "toolCall";
	id: string;
	name: string;
	arguments: Record<string, unknown>;
	thoughtSignature?: string;
};

type AssistantMessageLike = {
	role: "assistant";
	content: Array<AssistantToolCallBlock | Record<string, unknown>>;
	[key: string]: unknown;
};

type AgentStartSnapshot = {
	status: LoopStatus;
	cycle: number;
	lastAiReviewRequestAt: string;
};

const STATE_TYPE = "review-loop-state";
const STATUS_KEY = "review-loop";
const DEFAULT_POLL_INTERVAL_MS = 120000;
const REVIEW_LOOP_TRIGGER = (prUrl: string) => `/handle-review ${prUrl}`;
const STORED_CYCLE_SUMMARY_MAX_CHARS = 240;
const STORED_ITEM_KEYS_MAX = 20;
const COMPACT_THRESHOLD_TOKENS = 100000;

const ReviewLoopParams = Type.Object({
	action: StringEnum([
		"start",
		"status",
		"record_feedback_snapshot",
		"record_cycle_result",
		"record_ai_review_request",
		"stop",
	] as const, { description: "Review loop action" }),
	prUrl: Type.Optional(Type.String({ description: "Pull request URL" })),
	forge: Type.Optional(StringEnum(["github", "bitbucket"] as const, { description: "Forge name" })),
	owner: Type.Optional(Type.String({ description: "Repository owner or workspace" })),
	repo: Type.Optional(Type.String({ description: "Repository name" })),
	pullNumber: Type.Optional(Type.Number({ description: "Pull request number" })),
	pollIntervalMs: Type.Optional(Type.Number({ description: "Poll interval in milliseconds" })),
	feedbackMarkdown: Type.Optional(Type.String({ description: "Debug-only feedback snapshot markdown; avoid on normal cycles" })),
	lastSeenCommentAt: Type.Optional(Type.String({ description: "Newest comment timestamp seen this cycle" })),
	lastSeenReviewAt: Type.Optional(Type.String({ description: "Newest review timestamp seen this cycle" })),
	lastHandledItemKeys: Type.Optional(Type.Array(Type.String(), { description: "Handled item fingerprints" })),
	cycleSummary: Type.Optional(Type.String({ description: "Short machine summary for resume/state; not reviewer-facing narrative" })),
	cycleNumber: Type.Optional(Type.Number({ description: "Cycle number" })),
	latestReviewerSummaryId: Type.Optional(Type.String({ description: "Latest reviewer summary identifier" })),
	latestReviewerSummaryAt: Type.Optional(Type.String({ description: "Latest reviewer summary timestamp" })),
	latestReviewerSummaryStatus: Type.Optional(Type.String({ description: "Summary status: open/done/etc" })),
	status: Type.Optional(StringEnum(["working", "waiting-for-review", "done", "blocked"] as const, { description: "Loop status" })),
	lastAiReviewRequestSha: Type.Optional(Type.String({ description: "Empty [ai-review] commit SHA" })),
	lastAiReviewRequestAt: Type.Optional(Type.String({ description: "Timestamp recorded after [ai-review] push" })),
	lastAiReviewRequestHeadSha: Type.Optional(Type.String({ description: "Head SHA after [ai-review] push" })),
	error: Type.Optional(Type.String({ description: "Blocking reason or stop note" })),
});

function createEmptyState(): ReviewLoopState {
	return {
		active: false,
		prUrl: "",
		forge: "",
		owner: "",
		repo: "",
		pullNumber: 0,
		pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
		stateDir: "",
		lastSeenCommentAt: "",
		lastSeenReviewAt: "",
		lastHandledItemKeys: [],
		lastAiReviewRequestSha: "",
		lastAiReviewRequestAt: "",
		lastAiReviewRequestHeadSha: "",
		latestReviewerSummaryId: "",
		latestReviewerSummaryAt: "",
		latestReviewerSummaryStatus: "",
		status: "blocked",
		nextPollAt: 0,
		cycle: 0,
		lastCycleSummary: "",
		error: "",
	};
}

function normalizeState(data: unknown): ReviewLoopState {
	const base = createEmptyState();
	const raw = (typeof data === "object" && data !== null ? data : {}) as Partial<ReviewLoopState>;
	const status = raw.status;
	return {
		...base,
		...raw,
		active: raw.active === true,
		forge: raw.forge === "github" || raw.forge === "bitbucket" ? raw.forge : "",
		status:
			status === "working" || status === "waiting-for-review" || status === "done" || status === "blocked"
				? status
				: base.status,
		pullNumber:
			typeof raw.pullNumber === "number" && Number.isFinite(raw.pullNumber) && raw.pullNumber > 0
				? Math.floor(raw.pullNumber)
				: 0,
		pollIntervalMs:
			typeof raw.pollIntervalMs === "number" && Number.isFinite(raw.pollIntervalMs) && raw.pollIntervalMs > 0
				? Math.floor(raw.pollIntervalMs)
				: DEFAULT_POLL_INTERVAL_MS,
		nextPollAt:
			typeof raw.nextPollAt === "number" && Number.isFinite(raw.nextPollAt) && raw.nextPollAt >= 0
				? Math.floor(raw.nextPollAt)
				: 0,
		cycle: typeof raw.cycle === "number" && Number.isFinite(raw.cycle) && raw.cycle >= 0 ? Math.floor(raw.cycle) : 0,
		lastHandledItemKeys: Array.isArray(raw.lastHandledItemKeys)
			? raw.lastHandledItemKeys.filter((item): item is string => typeof item === "string")
			: [],
	};
}

function reconstructState(ctx: ExtensionContext): ReviewLoopState {
	const entries = ctx.sessionManager.getBranch?.() || ctx.sessionManager.getEntries?.() || [];
	let state = createEmptyState();
	for (const entry of entries) {
		const custom = entry as { type?: string; customType?: string; data?: unknown };
		if (custom.type !== "custom" || custom.customType !== STATE_TYPE) continue;
		state = normalizeState(custom.data);
	}
	return state;
}

function parsePrUrl(prUrl: string):
	| { forge: Forge; owner: string; repo: string; pullNumber: number }
	| { error: string } {
	let url: URL;
	try {
		url = new URL(prUrl);
	} catch {
		return { error: `Invalid PR URL: ${prUrl}` };
	}

	const parts = url.pathname.split("/").filter(Boolean);
	if (url.hostname === "github.com") {
		if (parts.length < 4 || parts[2] !== "pull") return { error: `Unsupported GitHub PR URL: ${prUrl}` };
		const pullNumber = Number(parts[3]);
		if (!Number.isFinite(pullNumber) || pullNumber <= 0) return { error: `Invalid GitHub PR number: ${prUrl}` };
		return { forge: "github", owner: parts[0], repo: parts[1], pullNumber };
	}

	if (url.hostname === "bitbucket.org") {
		if (parts.length < 4 || parts[2] !== "pull-requests") {
			return { error: `Unsupported Bitbucket PR URL: ${prUrl}` };
		}
		const pullNumber = Number(parts[3]);
		if (!Number.isFinite(pullNumber) || pullNumber <= 0) return { error: `Invalid Bitbucket PR number: ${prUrl}` };
		return { forge: "bitbucket", owner: parts[0], repo: parts[1], pullNumber };
	}

	return { error: `Unsupported forge host: ${url.hostname}` };
}

function buildStateDir(cwd: string, forge: Forge, repo: string, pullNumber: number): string {
	return path.join(cwd, "julsemaan-tmp", "review-loop", `${forge}-${repo}-${pullNumber}`);
}

function ensureStateDir(state: ReviewLoopState) {
	if (!state.stateDir) return;
	fs.mkdirSync(state.stateDir, { recursive: true });
}

function persistFiles(state: ReviewLoopState) {
	if (!state.active || !state.stateDir) return;
	ensureStateDir(state);
	fs.writeFileSync(path.join(state.stateDir, "state.json"), JSON.stringify(state, null, 2), "utf8");
}

function writeFeedbackSnapshot(state: ReviewLoopState, feedbackMarkdown: string) {
	if (!state.active || !state.stateDir) return;
	ensureStateDir(state);
	fs.writeFileSync(path.join(state.stateDir, "feedback.md"), feedbackMarkdown, "utf8");
}

function writeCycleSummary(state: ReviewLoopState, summary: string) {
	if (!state.active || !state.stateDir) return;
	ensureStateDir(state);
	const cycleNumber = state.cycle > 0 ? state.cycle : 1;
	fs.writeFileSync(path.join(state.stateDir, `cycle-${cycleNumber}.md`), summary, "utf8");
}

function trimString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed ? trimmed : undefined;
}

function truncateCycleSummary(value: unknown): string | undefined {
	const summary = trimString(value);
	if (!summary) return undefined;
	if (summary.length <= STORED_CYCLE_SUMMARY_MAX_CHARS) return summary;
	return `${summary.slice(0, STORED_CYCLE_SUMMARY_MAX_CHARS - 1)}…`;
}

function summarizeHandledItemKeys(value: unknown): {
	lastHandledItemKeys?: string[];
	lastHandledItemKeysTotal?: number;
	lastHandledItemKeysTruncated?: boolean;
} {
	if (!Array.isArray(value)) return {};
	const keys = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
	if (keys.length === 0) return {};
	return {
		lastHandledItemKeys: keys.slice(0, STORED_ITEM_KEYS_MAX),
		...(keys.length > STORED_ITEM_KEYS_MAX
			? {
					lastHandledItemKeysTotal: keys.length,
					lastHandledItemKeysTruncated: true,
				}
			: {}),
	};
}

function sanitizeReviewLoopToolArgs(args: ReviewLoopToolArgs): ReviewLoopToolArgs {
	const action = trimString(args.action);
	const sanitized: ReviewLoopToolArgs = action ? { action } : {};
	const addTrimmed = (key: string) => {
		const value = trimString(args[key]);
		if (value) sanitized[key] = value;
	};
	const addFiniteNumber = (key: string) => {
		const value = args[key];
		if (typeof value === "number" && Number.isFinite(value)) sanitized[key] = value;
	};
	const addHandledKeys = () => Object.assign(sanitized, summarizeHandledItemKeys(args.lastHandledItemKeys));

	switch (action) {
		case "start":
			addTrimmed("prUrl");
			addTrimmed("forge");
			addTrimmed("owner");
			addTrimmed("repo");
			addFiniteNumber("pullNumber");
			addFiniteNumber("pollIntervalMs");
			addTrimmed("status");
			break;

		case "status":
			addTrimmed("prUrl");
			break;

		case "record_feedback_snapshot":
			addTrimmed("lastSeenCommentAt");
			addTrimmed("lastSeenReviewAt");
			addHandledKeys();
			addTrimmed("status");
			addTrimmed("error");
			break;

		case "record_cycle_result":
			addFiniteNumber("cycleNumber");
			{
				const cycleSummary = truncateCycleSummary(args.cycleSummary);
				if (cycleSummary) sanitized.cycleSummary = cycleSummary;
			}
			addTrimmed("latestReviewerSummaryId");
			addTrimmed("latestReviewerSummaryAt");
			addTrimmed("latestReviewerSummaryStatus");
			addHandledKeys();
			addTrimmed("status");
			addTrimmed("error");
			break;

		case "record_ai_review_request":
			addTrimmed("lastAiReviewRequestSha");
			addTrimmed("lastAiReviewRequestAt");
			addTrimmed("lastAiReviewRequestHeadSha");
			break;

		case "stop":
			addTrimmed("status");
			addTrimmed("error");
			break;

		default:
			addTrimmed("prUrl");
			addTrimmed("status");
			addTrimmed("error");
			addHandledKeys();
			{
				const cycleSummary = truncateCycleSummary(args.cycleSummary);
				if (cycleSummary) sanitized.cycleSummary = cycleSummary;
			}
			break;
	}

	return sanitized;
}

function sanitizeStoredAssistantMessage(message: unknown): AssistantMessageLike | undefined {
	if (!message || typeof message !== "object") return undefined;
	const assistantMessage = message as AssistantMessageLike;
	if (assistantMessage.role !== "assistant" || !Array.isArray(assistantMessage.content)) return undefined;

	let changed = false;
	const content = assistantMessage.content.map((block) => {
		if (!block || typeof block !== "object" || block.type !== "toolCall" || block.name !== "review_loop") {
			return block;
		}
		changed = true;
		return {
			...block,
			arguments: sanitizeReviewLoopToolArgs((block as AssistantToolCallBlock).arguments || {}),
		};
	});

	return changed ? { ...assistantMessage, content } : undefined;
}

function buildHandledItemIdentitySummary(keys: string[]): string {
	if (keys.length === 0) return "none";
	if (keys.length <= STORED_ITEM_KEYS_MAX) return keys.join(", ");
	return `${keys.slice(0, STORED_ITEM_KEYS_MAX).join(", ")} (+${keys.length - STORED_ITEM_KEYS_MAX} more)`;
}

function buildCompactionInstructions(state: ReviewLoopState): string {
	return [
		"Review-loop compaction. Preserve minimal facts needed for next poll cycle.",
		`PR URL: ${state.prUrl || "none"}`,
		`Forge: ${state.forge || "none"}`,
		`Owner: ${state.owner || "none"}`,
		`Repo: ${state.repo || "none"}`,
		`PR number: ${state.pullNumber || 0}`,
		`Loop status: ${state.status}`,
		`Cycle number: ${state.cycle}`,
		`State dir: ${state.stateDir || "none"}`,
		`Watermark lastAiReviewRequestAt: ${state.lastAiReviewRequestAt || "none"}`,
		`Watermark lastAiReviewRequestSha: ${state.lastAiReviewRequestSha || "none"}`,
		`Watermark lastAiReviewRequestHeadSha: ${state.lastAiReviewRequestHeadSha || "none"}`,
		`Latest reviewer summary id: ${state.latestReviewerSummaryId || "none"}`,
		`Latest reviewer summary at: ${state.latestReviewerSummaryAt || "none"}`,
		`Latest reviewer summary status: ${state.latestReviewerSummaryStatus || "none"}`,
		`Handled item identity summary: ${buildHandledItemIdentitySummary(state.lastHandledItemKeys)}`,
		"Keep unresolved item identity summary if present.",
		"Drop raw MCP payloads, full comment bodies, old tool outputs, prior expanded /handle-review prompt text, and verbose cycle summaries.",
	].join("\n");
}

function shouldCompactAfterAgentEnd(state: ReviewLoopState, snapshot?: AgentStartSnapshot): boolean {
	if (!state.active || state.status !== "waiting-for-review" || !state.prUrl) return false;
	if (!snapshot) return true;
	return (
		snapshot.status !== "waiting-for-review" ||
		snapshot.cycle !== state.cycle ||
		snapshot.lastAiReviewRequestAt !== state.lastAiReviewRequestAt
	);
}

function buildStatusText(ctx: ExtensionContext, state: ReviewLoopState): string | undefined {
	if (!state.active) {
		if (state.status === "done") return ctx.ui.theme.fg("success", "🔁 review-loop · done");
		if (state.status === "blocked" && state.error) return ctx.ui.theme.fg("warning", "🔁 review-loop · blocked");
		return undefined;
	}
	const label = `${state.forge || "?"}#${state.pullNumber} · ${state.status}`;
	const color = state.status === "done" ? "success" : state.status === "blocked" ? "warning" : "accent";
	return ctx.ui.theme.fg(color as any, `🔁 review-loop · ${label}`);
}

function summarizeState(state: ReviewLoopState): string {
	if (!state.prUrl) return "Review loop idle";
	return [
		`active=${state.active}`,
		`prUrl=${state.prUrl}`,
		`status=${state.status}`,
		`forge=${state.forge || "unknown"}`,
		`repo=${state.owner}/${state.repo}`,
		`pullNumber=${state.pullNumber || 0}`,
		`cycle=${state.cycle}`,
		`lastAiReviewRequestAt=${state.lastAiReviewRequestAt || "none"}`,
		`latestReviewerSummaryStatus=${state.latestReviewerSummaryStatus || "none"}`,
		`stateDir=${state.stateDir || "none"}`,
		state.error ? `error=${state.error}` : undefined,
	]
		.filter(Boolean)
		.join("\n");
}

export default function reviewLoop(pi: ExtensionAPI) {
	let state = createEmptyState();
	let pollTimer: ReturnType<typeof setTimeout> | undefined;
	let agentStartSnapshot: AgentStartSnapshot | undefined;
	let lastCompactionRequestKey = "";

	const clearPollTimer = () => {
		if (pollTimer) clearTimeout(pollTimer);
		pollTimer = undefined;
	};

	const persistState = (ctx?: ExtensionContext) => {
		pi.appendEntry(STATE_TYPE, state);
		if (ctx) {
			ctx.ui.setStatus(STATUS_KEY, buildStatusText(ctx, state));
		}
		persistFiles(state);
	};

	const syncState = (ctx: ExtensionContext) => {
		state = reconstructState(ctx);
		ctx.ui.setStatus(STATUS_KEY, buildStatusText(ctx, state));
		schedulePoll(ctx);
	};

	const maybeTriggerPoll = async (ctx: ExtensionContext) => {
		clearPollTimer();
		if (!state.active || state.status !== "waiting-for-review" || !state.prUrl) return;
		const now = Date.now();
		const dueAt = state.nextPollAt || now;
		if (dueAt > now) {
			schedulePoll(ctx);
			return;
		}
		if (!ctx.isIdle()) {
			state.nextPollAt = now + 5000;
			persistState(ctx);
			schedulePoll(ctx);
			return;
		}
		state.nextPollAt = now + state.pollIntervalMs;
		persistState(ctx);
		pi.sendUserMessage(REVIEW_LOOP_TRIGGER(state.prUrl), { deliverAs: "followUp" });
		schedulePoll(ctx);
	};

	const maybeCompactWaitingLoop = (ctx: ExtensionContext) => {
		if (!shouldCompactAfterAgentEnd(state, agentStartSnapshot)) return;
		const usage = ctx.getContextUsage();
		if (!usage || usage.tokens <= COMPACT_THRESHOLD_TOKENS) return;
		const compactionKey = [state.prUrl, state.status, state.cycle, state.lastAiReviewRequestAt, state.latestReviewerSummaryAt].join("|");
		if (compactionKey === lastCompactionRequestKey) return;
		lastCompactionRequestKey = compactionKey;
		ctx.compact({
			customInstructions: buildCompactionInstructions(state),
			onError: () => {
				if (lastCompactionRequestKey === compactionKey) lastCompactionRequestKey = "";
			},
		});
	};

	function schedulePoll(ctx: ExtensionContext) {
		clearPollTimer();
		if (!state.active || state.status !== "waiting-for-review") return;
		const waitMs = Math.max(1000, (state.nextPollAt || Date.now()) - Date.now());
		pollTimer = setTimeout(() => {
			void maybeTriggerPoll(ctx);
		}, waitMs);
		pollTimer.unref?.();
	}

	function makeResult(action: ReviewLoopAction, error?: string) {
		const details: ReviewLoopDetails = { action, state, ...(error ? { error } : {}) };
		return {
			content: [{ type: "text" as const, text: error ? `Error: ${error}` : summarizeState(state) }],
			details,
		};
	}

	pi.on("session_start", async (_event, ctx) => syncState(ctx));
	pi.on("session_tree", async (_event, ctx) => syncState(ctx));
	pi.on("before_agent_start", async () => {
		agentStartSnapshot = {
			status: state.status,
			cycle: state.cycle,
			lastAiReviewRequestAt: state.lastAiReviewRequestAt,
		};
	});
	(pi as any).on("message_end", async (event: any) => {
		const sanitizedMessage = sanitizeStoredAssistantMessage(event?.message);
		if (!sanitizedMessage) return;
		return { message: sanitizedMessage };
	});
	pi.on("agent_end", async (_event, ctx) => {
		maybeCompactWaitingLoop(ctx);
		schedulePoll(ctx);
		agentStartSnapshot = undefined;
	});
	pi.on("session_shutdown", async () => clearPollTimer());

	pi.registerTool({
		name: "review_loop",
		label: "Review loop",
		description: "Persistent PR review loop state. Actions: start, status, record_feedback_snapshot, record_cycle_result, record_ai_review_request, stop.",
		promptSnippet: "Use review_loop to persist PR loop state, compact snapshots, cycle results, and [ai-review] watermark data.",
		parameters: ReviewLoopParams,
		executionMode: "sequential" as ToolExecutionMode,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			switch (params.action) {
				case "start": {
					const prUrl = params.prUrl?.trim();
					if (!prUrl) return makeResult("start", "prUrl is required");
					const parsed = parsePrUrl(prUrl);
					if ("error" in parsed) {
						state = {
							...createEmptyState(),
							prUrl,
							status: "blocked",
							error: parsed.error,
						};
						persistState(ctx);
						return makeResult("start", parsed.error);
					}
					const pollIntervalMs =
						typeof params.pollIntervalMs === "number" && params.pollIntervalMs > 0
							? Math.floor(params.pollIntervalMs)
							: DEFAULT_POLL_INTERVAL_MS;
					const pullNumber = params.pullNumber || parsed.pullNumber;
					const owner = params.owner?.trim() || parsed.owner;
					const repo = params.repo?.trim() || parsed.repo;
					const isSameActivePr =
						state.active &&
						state.forge === parsed.forge &&
						state.owner === owner &&
						state.repo === repo &&
						state.pullNumber === pullNumber;
					if (isSameActivePr) {
						state = {
							...state,
							prUrl,
							owner,
							repo,
							pollIntervalMs,
							stateDir: state.stateDir || buildStateDir(ctx.cwd, parsed.forge, parsed.repo, pullNumber),
							status: params.status || "working",
							error: "",
						};
						persistState(ctx);
						schedulePoll(ctx);
						return makeResult("start");
					}
					state = {
						...createEmptyState(),
						active: true,
						prUrl,
						forge: parsed.forge,
						owner,
						repo,
						pullNumber,
						pollIntervalMs,
						stateDir: buildStateDir(ctx.cwd, parsed.forge, parsed.repo, pullNumber),
						status: params.status || "working",
						nextPollAt: Date.now() + pollIntervalMs,
					};
					persistState(ctx);
					schedulePoll(ctx);
					return makeResult("start");
				}

				case "status": {
					syncState(ctx);
					return makeResult("status");
				}

				case "record_feedback_snapshot": {
					state = {
						...state,
						lastSeenCommentAt: params.lastSeenCommentAt?.trim() || state.lastSeenCommentAt,
						lastSeenReviewAt: params.lastSeenReviewAt?.trim() || state.lastSeenReviewAt,
						lastHandledItemKeys: params.lastHandledItemKeys || state.lastHandledItemKeys,
						status: params.status || "working",
						error: params.error?.trim() || "",
					};
					if (typeof params.feedbackMarkdown === "string") {
						writeFeedbackSnapshot(state, params.feedbackMarkdown);
					}
					persistState(ctx);
					return makeResult("record_feedback_snapshot");
				}

				case "record_cycle_result": {
					const cycleSummary = truncateCycleSummary(params.cycleSummary);
					state = {
						...state,
						cycle: typeof params.cycleNumber === "number" && params.cycleNumber > 0 ? Math.floor(params.cycleNumber) : state.cycle,
						lastCycleSummary: cycleSummary || state.lastCycleSummary,
						latestReviewerSummaryId: params.latestReviewerSummaryId?.trim() || state.latestReviewerSummaryId,
						latestReviewerSummaryAt: params.latestReviewerSummaryAt?.trim() || state.latestReviewerSummaryAt,
						latestReviewerSummaryStatus: params.latestReviewerSummaryStatus?.trim() || state.latestReviewerSummaryStatus,
						lastHandledItemKeys: params.lastHandledItemKeys || state.lastHandledItemKeys,
						status: params.status || state.status,
						error: params.error?.trim() || state.error,
					};
					if (params.cycleSummary) writeCycleSummary(state, params.cycleSummary);
					if (state.status === "waiting-for-review") {
						state.nextPollAt = Date.now() + state.pollIntervalMs;
					}
					persistState(ctx);
					schedulePoll(ctx);
					return makeResult("record_cycle_result");
				}

				case "record_ai_review_request": {
					state = {
						...state,
						lastAiReviewRequestSha: params.lastAiReviewRequestSha?.trim() || state.lastAiReviewRequestSha,
						lastAiReviewRequestAt: params.lastAiReviewRequestAt?.trim() || new Date().toISOString(),
						lastAiReviewRequestHeadSha: params.lastAiReviewRequestHeadSha?.trim() || state.lastAiReviewRequestHeadSha,
						status: "waiting-for-review",
						nextPollAt: Date.now() + state.pollIntervalMs,
						error: "",
					};
					persistState(ctx);
					schedulePoll(ctx);
					return makeResult("record_ai_review_request");
				}

				case "stop": {
					state = {
						...state,
						active: false,
						status: params.status || (params.error ? "blocked" : "done"),
						error: params.error?.trim() || "",
						nextPollAt: 0,
					};
					clearPollTimer();
					persistState(ctx);
					return makeResult("stop");
				}
			}
		},

		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("review_loop ")) + theme.fg("muted", String(args.action ?? ""));
			if (typeof args.prUrl === "string" && args.prUrl.trim()) text += ` ${theme.fg("dim", args.prUrl.trim())}`;
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as ReviewLoopDetails | undefined;
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}
			if (details.error) return new Text(theme.fg("warning", `Error: ${details.error}`), 0, 0);
			const lines = [
				`${theme.fg("accent", details.state.forge || "idle")} ${theme.fg("muted", details.state.prUrl || "")}`.trim(),
				`${theme.fg("muted", "status=")}${details.state.status}`,
			];
			return new Text(lines.join("\n"), 0, 0);
		},
	});
}
