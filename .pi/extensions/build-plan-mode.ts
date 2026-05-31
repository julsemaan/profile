import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AutocompleteItem } from "@mariozechner/pi-tui";
import { fuzzyFilter } from "@mariozechner/pi-tui";
import * as fs from "fs";
import * as path from "path";

type HarnessMode = "build" | "plan";
type ModelAlias = "custom/large" | "custom/medium";
type ModelMap = Record<ModelAlias, string>;
type ModelProfile = "pub" | "priv" | "custom";

type ModelProfileConfig = {
	modelMap: ModelMap;
	buildThinkingLevel: ThinkingLevel;
	planThinkingLevel: ThinkingLevel;
};

const MODEL_PROFILES: Record<Exclude<ModelProfile, "custom">, ModelProfileConfig> = {
	pub: {
		modelMap: {
			"custom/large": "openai-codex/gpt-5.4",
			"custom/medium": "opencode/big-pickle",
		},
		buildThinkingLevel: "high",
		planThinkingLevel: "high",
	},
	priv: {
		modelMap: {
			"custom/large": "openai-codex/gpt-5.4",
			"custom/medium": "openai-codex/gpt-5.4",
		},
		buildThinkingLevel: "medium",
		planThinkingLevel: "high",
	},
};

type BuildPlanState = {
	mode?: HarnessMode;
	profile?: ModelProfile;
	modelMap?: Partial<ModelMap>;
	buildThinkingLevel?: ThinkingLevel;
	planThinkingLevel?: ThinkingLevel;
	// Legacy fallback for sessions that never ran updated code
	previousThinkingLevel?: ThinkingLevel;
};
type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
type ScopedModelSelection = { provider: string; modelId: string; thinkingLevel?: ThinkingLevel };

const READ_ONLY_TOOLS = ["read", "bash", "grep", "find", "ls", "questionnaire", "todo"];
const PLAN_TOOLS = [...READ_ONLY_TOOLS, "github_pr_review_fetch"];
const BUILD_TOOLS = [
	...PLAN_TOOLS,
	"github_pr_review_reply",
	"github_pr_comment_reply",
	"edit",
	"write",
	"subagent",
];
const DEFAULT_BUILD_THINKING: ThinkingLevel = "medium";
const DEFAULT_PLAN_THINKING: ThinkingLevel = "high";
const STATE_TYPE = "build-plan-mode";
const MODEL_CONFIG_EVENT = "build-plan:model-config";
const FILE_OVERRIDE_RELPATH = "julsemaan-tmp/model-profile";
const DEFAULT_MODEL_MAP: ModelMap = { ...MODEL_PROFILES.priv.modelMap };

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
	if (/\b(sudo|rm|mv|cp|mkdir|rmdir|touch|chmod|chown|tee|xargs|kill|pkill|nohup|ssh|scp|sftp)\b/.test(trimmed))
		return false;
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

function parseModelRef(modelRef: string): { provider: string; modelId: string } | undefined {
	const trimmed = modelRef.trim();
	const slashIndex = trimmed.indexOf("/");
	if (slashIndex <= 0 || slashIndex === trimmed.length - 1) return undefined;
	return {
		provider: trimmed.slice(0, slashIndex),
		modelId: trimmed.slice(slashIndex + 1),
	};
}

function isThinkingLevel(value: string): value is ThinkingLevel {
	return value === "off" || value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh";
}

function getCurrentProfile(
	modelMap: ModelMap,
	buildThinkingLevel: ThinkingLevel,
	planThinkingLevel: ThinkingLevel
): ModelProfile {
	for (const [profile, config] of Object.entries(MODEL_PROFILES)) {
		if (
			modelMap["custom/large"] === config.modelMap["custom/large"] &&
			modelMap["custom/medium"] === config.modelMap["custom/medium"] &&
			buildThinkingLevel === config.buildThinkingLevel &&
			planThinkingLevel === config.planThinkingLevel
		) {
			return profile as ModelProfile;
		}
	}
	return "custom";
}

export default function buildPlanMode(pi: ExtensionAPI) {
	let mode: HarnessMode = "build";
	let buildThinkingLevel: ThinkingLevel = DEFAULT_BUILD_THINKING;
	let planThinkingLevel: ThinkingLevel = DEFAULT_PLAN_THINKING;
	let modelMap: ModelMap = { ...DEFAULT_MODEL_MAP };
	let currentModelRegistry: any;
	let fileOverridePath: string | null = null;
	let fileOverrideProfile: Exclude<ModelProfile, "custom"> | null = null;

	// Emit model config early so subagent tool can resolve aliases even in --no-session mode.
	// This ensures nested subagent calls (e.g. orchestrator → worker) resolve correctly.
	process.nextTick(() => {
		pi.events.emit(MODEL_CONFIG_EVENT, { ...modelMap });
	});

	function persistMode() {
		const profile = getCurrentProfile(modelMap, buildThinkingLevel, planThinkingLevel);
		pi.appendEntry(STATE_TYPE, { mode, profile, modelMap, buildThinkingLevel, planThinkingLevel });
	}

	function emitModelConfig() {
		pi.events.emit(MODEL_CONFIG_EVENT, { ...modelMap });
	}

	async function updateModelMap(nextModelMap: Partial<ModelMap>, ctx: ExtensionContext, notify: string) {
		modelMap = { ...modelMap, ...nextModelMap };
		emitModelConfig();
		persistMode();
		const activeAlias = mode === "plan" ? "custom/large" : "custom/medium";
		if (nextModelMap[activeAlias]) await setSessionModel(activeAlias, ctx);
		updateStatus(ctx);
		ctx.ui.notify(
			`${notify}\ncustom/large -> ${modelMap["custom/large"]}\ncustom/medium -> ${modelMap["custom/medium"]}`,
			"info",
		);
	}

	function updateStatus(ctx: ExtensionContext) {
		const profile = getCurrentProfile(modelMap, buildThinkingLevel, planThinkingLevel);
		const suffix = ` · ${profile}`;
		ctx.ui.setStatus(
			"build-plan-mode",
			mode === "plan"
				? ctx.ui.theme.fg("warning", `⏸ plan${suffix}`)
				: ctx.ui.theme.fg("success", `⚒ build${suffix}`),
		);
	}

	async function setSessionModel(alias: ModelAlias, ctx: ExtensionContext, notifyOnFailure = true) {
		const target = modelMap[alias];
		const parsed = parseModelRef(target);
		if (!parsed) {
			if (notifyOnFailure) ctx.ui.notify(`Invalid model mapping for ${alias}: ${target}`, "warning");
			return;
		}

		const model = ctx.modelRegistry.find(parsed.provider, parsed.modelId);
		if (!model) {
			if (notifyOnFailure) ctx.ui.notify(`Model ${target} not found for ${alias}`, "warning");
			return;
		}

		const success = await pi.setModel(model);
		if (!success && notifyOnFailure) ctx.ui.notify(`No API key available for ${target}`, "warning");
	}

	async function applyMode(nextMode: HarnessMode, ctx: ExtensionContext, notify = true) {
		mode = nextMode;
		pi.setActiveTools(mode === "plan" ? PLAN_TOOLS : BUILD_TOOLS);

		const level = mode === "plan" ? planThinkingLevel : buildThinkingLevel;
		pi.setThinkingLevel(level);

		emitModelConfig();
		await setSessionModel(mode === "plan" ? "custom/large" : "custom/medium", ctx);
		updateStatus(ctx);
		if (notify) {
			ctx.ui.notify(
				mode === "plan"
					? `Switched to plan mode (${modelMap["custom/large"]}; thinking: ${planThinkingLevel})`
					: `Switched to build mode (${modelMap["custom/medium"]}; thinking: ${buildThinkingLevel})`,
				"info",
			);
		}
		persistMode();
	}

	async function applyProfile(
		profile: Exclude<ModelProfile, "custom">,
		ctx: ExtensionContext,
		source: string,
		notify = true,
	) {
		const config = MODEL_PROFILES[profile];
		modelMap = { ...config.modelMap };
		buildThinkingLevel = config.buildThinkingLevel;
		planThinkingLevel = config.planThinkingLevel;

		const level = mode === "plan" ? planThinkingLevel : buildThinkingLevel;
		pi.setThinkingLevel(level);

		emitModelConfig();
		await setSessionModel(mode === "plan" ? "custom/large" : "custom/medium", ctx, false);
		updateStatus(ctx);
		persistMode();

		if (notify) {
			ctx.ui.notify(
				`${source}: ${profile}\ncustom/large -> ${config.modelMap["custom/large"]}\ncustom/medium -> ${config.modelMap["custom/medium"]}\nbuild thinking: ${buildThinkingLevel}\nplan thinking: ${planThinkingLevel}`,
				"info",
			);
		}
	}

	function readFileOverride(ctx: ExtensionContext): {
		profile: Exclude<ModelProfile, "custom"> | null;
		filePath: string | null;
	} {
		let dir = ctx.cwd;
		while (true) {
			const candidate = path.join(dir, FILE_OVERRIDE_RELPATH);
			if (fs.existsSync(candidate)) {
				try {
					const content = fs.readFileSync(candidate, "utf-8").trim().toLowerCase();
					if (content === "pub" || content === "priv") {
						return { profile: content, filePath: candidate };
					}
					ctx.ui.notify(
						`Invalid content in ${candidate}: expected "pub" or "priv", got "${content}"`,
						"warning",
					);
					return { profile: null, filePath: candidate };
				} catch (e) {
					ctx.ui.notify(`Error reading ${candidate}: ${e}`, "warning");
					return { profile: null, filePath: candidate };
				}
			}
			const parent = path.dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
		return { profile: null, filePath: null };
	}

	async function syncFileOverride(ctx: ExtensionContext): Promise<boolean> {
		const { profile: fileProfile, filePath } = readFileOverride(ctx);

		// No file found
		if (!filePath) {
			if (fileOverridePath) {
				// File was removed, clear tracking but don't auto-revert
				fileOverridePath = null;
				fileOverrideProfile = null;
			}
			return false;
		}

		// File has invalid content
		if (!fileProfile) {
			return false;
		}

		// File matches last applied file override
		if (fileProfile === fileOverrideProfile && filePath === fileOverridePath) {
			return false;
		}

		// Apply the profile from file
		fileOverridePath = filePath;
		fileOverrideProfile = fileProfile;
		await applyProfile(fileProfile, ctx, `File override (${path.relative(ctx.cwd, filePath)})`);
		return true;
	}

	function getModelArgumentCompletions(prefix: string, alias: ModelAlias): AutocompleteItem[] | null {
		if (!currentModelRegistry) return null;
		currentModelRegistry.refresh();
		const models = currentModelRegistry.getAvailable();
		if (!models || models.length === 0) return null;

		const items = models.map((m: any) => ({
			id: m.id,
			provider: m.provider,
			label: `${m.provider}/${m.id}`,
		}));

		// Include current alias value even if not in available list
		const currentValue = modelMap[alias];
		if (currentValue && !items.some((item: any) => item.label === currentValue)) {
			const parsed = parseModelRef(currentValue);
			if (parsed) {
				items.unshift({
					id: parsed.modelId,
					provider: parsed.provider,
					label: currentValue,
				});
			}
		}

		const filtered = fuzzyFilter(items, prefix, (item: any) => `${item.id} ${item.provider}`);
		if (filtered.length === 0) return null;

		return filtered.map((item: any) => ({
			value: item.label,
			label: item.id,
			description: item.provider,
		}));
	}

	pi.registerCommand("plan", {
		description: "Switch to read-only planning mode",
		handler: async (_args, ctx) => {
			await applyMode("plan", ctx);
		},
	});

	pi.registerCommand("build", {
		description: "Switch to implementation mode",
		handler: async (_args, ctx) => {
			await applyMode("build", ctx);
		},
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

	pi.registerCommand("large-model", {
		description: "Show or set model behind custom/large",
		getArgumentCompletions: (prefix: string) => getModelArgumentCompletions(prefix, "custom/large"),
		handler: async (args, ctx) => {
			const next = args.trim();
			if (!next) {
				ctx.ui.notify(`custom/large -> ${modelMap["custom/large"]}`, "info");
				return;
			}
			await updateModelMap({ "custom/large": next }, ctx, "Updated model alias.");
		},
	});

	pi.registerCommand("medium-model", {
		description: "Show or set model behind custom/medium",
		getArgumentCompletions: (prefix: string) => getModelArgumentCompletions(prefix, "custom/medium"),
		handler: async (args, ctx) => {
			const next = args.trim();
			if (!next) {
				ctx.ui.notify(`custom/medium -> ${modelMap["custom/medium"]}`, "info");
				return;
			}
			await updateModelMap({ "custom/medium": next }, ctx, "Updated model alias.");
		},
	});

	pi.registerCommand("model-profile", {
		description: "Show or set model alias profile (pub|priv)",
		handler: async (args, ctx) => {
			if (fileOverridePath) {
				ctx.ui.notify(
					`File override active (${path.relative(ctx.cwd, fileOverridePath)}). Manual profile will be overwritten on next turn. Remove the file to keep manual setting.`,
					"warning",
				);
			}
			const profile = args.trim().toLowerCase();
			if (!profile) {
				const current = getCurrentProfile(modelMap, buildThinkingLevel, planThinkingLevel);
				ctx.ui.notify(`Current profile: ${current}`, "info");
				return;
			}
			if (profile === "pub" || profile === "priv") {
				await applyProfile(profile, ctx, "Manual profile");
				return;
			}
			ctx.ui.notify("Usage: /model-profile [pub|priv]", "warning");
		},
	});

	pi.registerCommand("mode", {
		description: "Show or set current mode (build|plan|toggle)",
		handler: async (args, ctx) => {
			const next = args.trim().toLowerCase();
			if (!next) {
				ctx.ui.notify(`Current mode: ${mode}`, "info");
				return;
			}
			if (next === "toggle") {
				await applyMode(mode === "plan" ? "build" : "plan", ctx);
				return;
			}
			if (next !== "build" && next !== "plan") {
				ctx.ui.notify('Usage: /mode build, /mode plan, or /mode toggle', "warning");
				return;
			}
			await applyMode(next, ctx);
		},
	});

	pi.registerShortcut("ctrl+shift+p", {
		description: "Toggle build/plan mode",
		handler: async (ctx) => {
			await applyMode(mode === "plan" ? "build" : "plan", ctx);
		},
	});

	pi.registerShortcut("ctrl+;", {
		description: "Cycle model profile (pub/priv)",
		handler: async (ctx) => {
			const profiles = Object.keys(MODEL_PROFILES) as Exclude<ModelProfile, "custom">[];
			const current = getCurrentProfile(modelMap, buildThinkingLevel, planThinkingLevel);
			const idx = profiles.indexOf(current as Exclude<ModelProfile, "custom">);
			const next = idx === -1 || idx >= profiles.length - 1 ? profiles[0] : profiles[idx + 1];
			await applyProfile(next, ctx, "Cycled profile");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		const entries = ctx.sessionManager.getEntries();
		const lastState = entries
			.filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === STATE_TYPE)
			.pop() as { data?: BuildPlanState } | undefined;

		mode = lastState?.data?.mode === "plan" ? "plan" : "build";
		modelMap = {
			...DEFAULT_MODEL_MAP,
			...(lastState?.data?.modelMap ?? {}),
		};

		// Restore thinking levels from state
		if (lastState?.data?.profile && lastState.data.profile !== "custom") {
			// Modern state: profile was persisted directly
			buildThinkingLevel = lastState.data.buildThinkingLevel ?? MODEL_PROFILES[lastState.data.profile].buildThinkingLevel;
			planThinkingLevel = lastState.data.planThinkingLevel ?? MODEL_PROFILES[lastState.data.profile].planThinkingLevel;
		} else if (lastState?.data?.previousThinkingLevel !== undefined) {
			// Legacy state: previousThinkingLevel was build thinking level
			buildThinkingLevel = lastState.data.previousThinkingLevel;
			planThinkingLevel = DEFAULT_PLAN_THINKING;
		} else {
			// No state or custom profile without explicit thinking
			buildThinkingLevel = DEFAULT_BUILD_THINKING;
			planThinkingLevel = DEFAULT_PLAN_THINKING;
		}

		currentModelRegistry = ctx.modelRegistry;
		fileOverridePath = null;
		fileOverrideProfile = null;

		// Apply file override on top of persisted state (if present)
		await syncFileOverride(ctx);

		emitModelConfig();
		pi.setActiveTools(mode === "plan" ? PLAN_TOOLS : BUILD_TOOLS);
		if (mode === "plan") {
			pi.setThinkingLevel(planThinkingLevel);
			await setSessionModel("custom/large", ctx, false);
		} else {
			pi.setThinkingLevel(buildThinkingLevel);
			await setSessionModel("custom/medium", ctx, false);
		}
		updateStatus(ctx);
	});

	pi.on("turn_start", async (_event, ctx) => {
		await syncFileOverride(ctx);
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
