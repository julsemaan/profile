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

const STATE_TYPE = "review-loop-state";
const STATUS_KEY = "review-loop";
const DEFAULT_POLL_INTERVAL_MS = 120000;
const REVIEW_LOOP_TRIGGER = (prUrl: string) => `/handle-review ${prUrl}`;

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
	feedbackMarkdown: Type.Optional(Type.String({ description: "Structured feedback snapshot markdown" })),
	lastSeenCommentAt: Type.Optional(Type.String({ description: "Newest comment timestamp seen this cycle" })),
	lastSeenReviewAt: Type.Optional(Type.String({ description: "Newest review timestamp seen this cycle" })),
	lastHandledItemKeys: Type.Optional(Type.Array(Type.String(), { description: "Handled item fingerprints" })),
	cycleSummary: Type.Optional(Type.String({ description: "Human-readable cycle result summary" })),
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
	pi.on("agent_end", async (_event, ctx) => {
		schedulePoll(ctx);
	});
	pi.on("session_shutdown", async () => clearPollTimer());

	pi.registerTool({
		name: "review_loop",
		label: "Review loop",
		description: "Persistent PR review loop state. Actions: start, status, record_feedback_snapshot, record_cycle_result, record_ai_review_request, stop.",
		promptSnippet: "Use review_loop to persist PR loop state, feedback snapshots, cycle results, and [ai-review] watermark data.",
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
					state = {
						...createEmptyState(),
						active: true,
						prUrl,
						forge: parsed.forge,
						owner: params.owner?.trim() || parsed.owner,
						repo: params.repo?.trim() || parsed.repo,
						pullNumber: params.pullNumber || parsed.pullNumber,
						pollIntervalMs:
							typeof params.pollIntervalMs === "number" && params.pollIntervalMs > 0
								? Math.floor(params.pollIntervalMs)
								: DEFAULT_POLL_INTERVAL_MS,
						stateDir: buildStateDir(ctx.cwd, parsed.forge, parsed.repo, params.pullNumber || parsed.pullNumber),
						status: params.status || "working",
						nextPollAt: Date.now() + (params.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS),
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
					state = {
						...state,
						cycle: typeof params.cycleNumber === "number" && params.cycleNumber > 0 ? Math.floor(params.cycleNumber) : state.cycle,
						lastCycleSummary: params.cycleSummary?.trim() || state.lastCycleSummary,
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
