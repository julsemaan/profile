import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

type HarnessMode = "build" | "plan";
type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

const READ_ONLY_TOOLS = ["read", "bash", "grep", "find", "ls", "questionnaire", "todo"];
const PLAN_TOOLS = [...READ_ONLY_TOOLS, "github_pr_review_fetch"];
const BUILD_TOOLS = [
	...PLAN_TOOLS,
	"github_pr_review_reply",
	"github_pr_comment_reply",
	"review_feedback_subagent",
	"edit",
	"write",
];
const BUILD_DEFAULT_THINKING_LEVEL: ThinkingLevel = "medium";
const PLAN_THINKING_LEVEL: ThinkingLevel = "high";
const STATE_TYPE = "build-plan-mode";

const PLAN_INSTRUCTIONS = `
IMPORTANT: You are in PLAN MODE.
- Do not modify files.
- Use tools only to inspect the codebase and gather evidence.
- You may look up online resources and documentation using bash with read-only network commands like curl.
- Think through architecture, edge cases, risks, and tests.
- If requirements are ambiguous, ask clarifying questions.
- End with a concrete implementation plan.
- Prefer a numbered plan with files to change and validation steps.
`;

const BUILD_INSTRUCTIONS = `
IMPORTANT: You are in BUILD MODE.
- You may edit files and implement the requested changes.
- You may look up online resources and documentation using bash when helpful.
- Keep changes focused and minimal.
- Read files before editing them.
- After making changes, validate them when practical.
- Summarize what changed and any follow-up work.
`;

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

function getLastPlanText(ctx: ExtensionContext): string | undefined {
	const branch = ctx.sessionManager.getBranch();
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type !== "message" || !isAssistantMessage(entry.message)) continue;
		const text = getAssistantText(entry.message);
		if (text) return text;
	}
	return undefined;
}

function buildExecutionPrompt(plan: string, extraInstructions?: string): string {
	const extra = extraInstructions?.trim();
	return [
		"Execute this plan.",
		"You only have the plan below, not the prior planning conversation.",
		extra ? `Additional instructions: ${extra}` : undefined,
		"## Plan",
		plan,
	]
		.filter(Boolean)
		.join("\n\n");
}

function isPlanSafeCommand(command: string): boolean {
	const trimmed = command.trim();
	if (!trimmed) return false;

	// Block common shell features that make allowlisting unreliable.
	if (/[|&;><`$\\]/.test(trimmed)) return false;
	if (/\b(sudo|rm|mv|cp|mkdir|rmdir|touch|chmod|chown|tee|xargs|kill|pkill|nohup|ssh|scp|sftp)\b/.test(trimmed)) return false;
	if (/\b(npm|pnpm|yarn|bun|pip|cargo|make)\b/.test(trimmed) && !/\b(list|ls|why|info|outdated)\b/.test(trimmed)) {
		return false;
	}

	const allowed = [
		/^pwd$/,
		/^ls(\s+.+)?$/,
		/^find(\s+.+)?$/,
		/^rg(\s+.+)?$/,
		/^grep(\s+.+)?$/,
		/^git\s+(status|diff|log|show|branch)(\s+.+)?$/,
		/^cat\s+.+$/,
		/^head(\s+.+)?$/,
		/^tail(\s+.+)?$/,
		/^sed\s+-n\s+.+$/,
		/^wc(\s+.+)?$/,
		/^tree(\s+.+)?$/,
		/^curl(\s+.+)?$/,
		/^wget\s+(-q\s+)?(-O-\s+)?https?:\/\/.+$/,
	];

	return allowed.some((pattern) => pattern.test(trimmed));
}

export default function buildPlanMode(pi: ExtensionAPI) {
	let mode: HarnessMode = "build";
	let previousThinkingLevel: ThinkingLevel | undefined;

	function persistMode() {
		pi.appendEntry(STATE_TYPE, { mode, previousThinkingLevel });
	}

	function getBuildThinkingLevel(): ThinkingLevel {
		return previousThinkingLevel ?? BUILD_DEFAULT_THINKING_LEVEL;
	}

	function applyMode(nextMode: HarnessMode, ctx: ExtensionContext) {
		if (nextMode === "plan") {
			if (mode !== "plan") {
				previousThinkingLevel = pi.getThinkingLevel() as ThinkingLevel;
			}
			pi.setThinkingLevel(PLAN_THINKING_LEVEL);
		} else if (mode === "plan") {
			previousThinkingLevel = getBuildThinkingLevel();
			pi.setThinkingLevel(previousThinkingLevel);
		}

		mode = nextMode;
		pi.setActiveTools(mode === "plan" ? PLAN_TOOLS : BUILD_TOOLS);
		ctx.ui.setStatus(
			"build-plan-mode",
			mode === "plan"
				? ctx.ui.theme.fg("warning", "⏸ plan")
				: ctx.ui.theme.fg("success", "⚒ build"),
		);
		ctx.ui.notify(
			mode === "plan"
				? `Switched to plan mode (thinking: ${PLAN_THINKING_LEVEL})`
				: `Switched to build mode (thinking: ${getBuildThinkingLevel()})`,
			"info",
		);
		persistMode();
	}

	pi.registerCommand("plan", {
		description: "Switch to read-only planning mode",
		handler: async (_args, ctx) => applyMode("plan", ctx),
	});

	pi.registerCommand("build", {
		description: "Switch to implementation mode",
		handler: async (_args, ctx) => applyMode("build", ctx),
	});

	pi.registerCommand("execute-plan", {
		description: "Start a fresh build session from the latest plan only",
		handler: async (args, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Wait for the current turn to finish before executing the plan.", "warning");
				return;
			}

			const plan = getLastPlanText(ctx);
			if (!plan) {
				ctx.ui.notify("No assistant plan found in the current session.", "warning");
				return;
			}

			const executionPrompt = buildExecutionPrompt(plan, args);
			const parentSession = ctx.sessionManager.getSessionFile();
			const result = await ctx.newSession({
				parentSession,
				withSession: async (replacementCtx) => {
					await replacementCtx.sendUserMessage(executionPrompt);
					replacementCtx.ui.notify("Started fresh build session from latest plan.", "info");
				},
			});

			if (result.cancelled) {
				ctx.ui.notify("Execute plan cancelled.", "info");
			}
		},
	});

	pi.registerCommand("mode", {
		description: "Show or set current mode (build|plan)",
		handler: async (args, ctx) => {
			const next = args.trim();
			if (!next) {
				ctx.ui.notify(`Current mode: ${mode}`, "info");
				return;
			}
			if (next !== "build" && next !== "plan") {
				ctx.ui.notify('Usage: /mode build or /mode plan', "warning");
				return;
			}
			applyMode(next, ctx);
		},
	});


	pi.on("session_start", async (_event, ctx) => {
		const entries = ctx.sessionManager.getEntries();
		const lastState = entries
			.filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === STATE_TYPE)
			.pop() as { data?: { mode?: HarnessMode; previousThinkingLevel?: ThinkingLevel } } | undefined;

		mode = lastState?.data?.mode === "plan" ? "plan" : "build";
		previousThinkingLevel = lastState?.data?.previousThinkingLevel;
		pi.setActiveTools(mode === "plan" ? PLAN_TOOLS : BUILD_TOOLS);
		if (mode === "plan") {
			pi.setThinkingLevel(PLAN_THINKING_LEVEL);
		} else {
			previousThinkingLevel = getBuildThinkingLevel();
			pi.setThinkingLevel(previousThinkingLevel);
		}
		ctx.ui.setStatus(
			"build-plan-mode",
			mode === "plan"
				? ctx.ui.theme.fg("warning", "⏸ plan")
				: ctx.ui.theme.fg("success", "⚒ build"),
		);
	});

	pi.on("before_agent_start", async (event) => {
		return {
			systemPrompt:
				event.systemPrompt + (mode === "plan" ? `\n\n${PLAN_INSTRUCTIONS}` : `\n\n${BUILD_INSTRUCTIONS}`),
		};
	});

	pi.on("tool_call", async (event) => {
		if (mode !== "plan") return;

		if (event.toolName === "edit" || event.toolName === "write") {
			return {
				block: true,
				reason: "Plan mode is read-only. Switch to /build to modify files.",
			};
		}

		if (event.toolName === "bash") {
			const command = String(event.input.command ?? "");
			if (!isPlanSafeCommand(command)) {
				return {
					block: true,
					reason: `Plan mode only allows read-only bash commands. Blocked: ${command}`,
				};
			}
		}
	});
}
