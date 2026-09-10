import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { fuzzyFilter, Text, type AutocompleteItem } from "@mariozechner/pi-tui";
import { Type } from "typebox";
import * as fs from "fs";
import * as os from "node:os";
import * as path from "path";
import { createHash } from "node:crypto";
import {
	discoverModes,
	type ModeConfig,
	type ModeRegistry,
	type ThinkingLevel,
} from "./modes.js";
import {
	BUILTIN_ALIASES,
	BUILTIN_PROFILES,
	MODEL_PROFILES,
	VALID_THINKING_LEVELS,
	type AliasConfig,
	type BuiltinProfile,
	type ModelAlias,
	type ModelMap,
	type ModelProfile,
	applyProfileData,
	findBuiltinProfile,
	getModelCompletionCandidates,
	getNextProfile,
	isModelAlias,
	isThinkingLevel,
	parseModelRef,
	parseProfileContent,
	serializeBuiltinProfile,
	serializeCustomProfile,
	resolveStartupMap,
} from "./lib/model-profile.js";

const BUILTIN_PROFILES_DISPLAY = BUILTIN_PROFILES.join("|");
const THINKING_LEVELS_DISPLAY = VALID_THINKING_LEVELS.join("|");

type AppState = {
	mode?: string;
	profile?: ModelProfile;
	modelMap?: Partial<ModelMap>;
};

const STATE_TYPE = "build-plan-mode";
const MODEL_CONFIG_EVENT = "build-plan:model-config";
const FILE_OVERRIDE_RELPATH = "julsemaan-tmp/model-profile";

function getTempStateFilePath(cwd: string): string {
	const hash = createHash("sha256").update(cwd).digest("hex").slice(0, 12);
	return path.join(os.tmpdir(), `pi-model-state-${hash}.json`);
}
const DEFAULT_MODEL_MAP: ModelMap = structuredClone(MODEL_PROFILES.priv);
const DEFAULT_NEW_SESSION_MODE = "plan";
const DEFAULT_EXISTING_SESSION_MODE = "build";
const AUTO_BUILD_EXECUTION_INSTRUCTIONS = "This is a plain automatic /plan-build build session. Implement and validate the plan. Do not commit, push, or open a pull request.";
const PR_EXECUTION_INSTRUCTIONS = `This execution is authorized to implement the plan, commit the intended changes, push the branch, and open a ready-for-review pull request.

1. Before changing files, check the repository status. Stop if unrelated uncommitted changes exist. Do not stash, reset, discard, or commit those changes.
2. Determine the push remote and remote default branch. Stop on detached HEAD or ambiguous repository configuration. If the current branch is the default branch, create a descriptive feature branch before implementation. Otherwise keep the current branch.
3. Implement the plan and run its validation. Resolve failures before committing. If blocked, report the exact blocker and do not commit, push, or open a pull request.
4. Inspect the diff and commit only the intended changes.
5. Read and follow the existing github-open-pr or bitbucket-open-pr skill according to the remote. Preserve its clean-worktree checks, duplicate detection, supported-host rules, push-failure handling, and one-push behavior. Open the pull request ready for review by default.
6. Report the commit SHA and pull request URL.`;
const AUTO_PLAN_BUILD_INSTRUCTIONS = `This is an explicitly activated /plan-build workflow. Stay in plan mode while exploring and asking questions. Do not infer completion from an ordinary response or a question. Once all required questions are answered, call finish_plan exactly once with a nonempty, self-contained plan containing decisions, files, implementation steps, and validation. The tool will start a fresh build session after this turn settles.`;
const FINISH_PLAN_PARAMS = Type.Object({
	plan: Type.String({ minLength: 1, description: "A nonempty, self-contained plan with decisions, files, implementation steps, and validation." }),
});

type ExecutePlanOptions = {
	pr?: boolean;
	automatic?: boolean;
};

type PendingAutomaticHandoff = {
	plan: string;
};

type FinishPlanDetails = {
	accepted: boolean;
	plan?: string;
};

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

function getLastAssistantEntry(ctx: ExtensionContext): { id: string; text: string; stopReason: AssistantMessage["stopReason"] } | undefined {
	const branch = ctx.sessionManager.getBranch();
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type !== "message" || !isAssistantMessage(entry.message)) continue;
		const text = getAssistantText(entry.message);
		if (text) return { id: entry.id, text, stopReason: entry.message.stopReason };
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

function buildFinalizePlanPrompt(extraInstructions?: string): string {
	const extra = extraInstructions?.trim();
	return [
		"Provide the final plan for this task.",
		extra ? `Additional instructions for the plan: ${extra}` : undefined,
	]
		.filter(Boolean)
		.join("\n\n");
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTurnStart(ctx: ExtensionContext, timeoutMs = 5000): Promise<boolean> {
	const startedAt = Date.now();
	while (Date.now() - startedAt < timeoutMs) {
		if (!ctx.isIdle()) return true;
		await sleep(50);
	}
	return false;
}




function parseAliasArgs(
	raw: string,
): { model?: string; thinkingLevel?: ThinkingLevel } | { error: string } {
	const trimmed = raw.trim();
	if (!trimmed) return {};

	const tokens = trimmed.split(/\s+/);

	if (tokens.length === 1) {
		const token = tokens[0];
		if (token.includes("/")) {
			if (!parseModelRef(token))
				return { error: `Invalid model reference: "${token}". Expected format: provider/model` };
			return { model: token };
		}
		if (isThinkingLevel(token)) {
			return { thinkingLevel: token };
		}
		return {
			error: `Invalid argument: "${token}". Expected provider/model or thinking level (${THINKING_LEVELS_DISPLAY}).`,
		};
	}

	if (tokens.length === 2) {
		const [modelToken, thinkingToken] = tokens;
		if (!modelToken.includes("/"))
			return {
				error: `First argument must be a model reference (provider/model), got: "${modelToken}"`,
			};
		if (!parseModelRef(modelToken))
			return { error: `Invalid model reference: "${modelToken}". Expected format: provider/model` };
		if (!isThinkingLevel(thinkingToken))
			return {
				error: `Second argument must be a thinking level (${THINKING_LEVELS_DISPLAY}), got: "${thinkingToken}"`,
			};
		return { model: modelToken, thinkingLevel: thinkingToken };
	}

	return {
		error: `Too many arguments. Usage: /command [provider/model] [thinking]`,
	};
}


function getCurrentProfile(modelMap: ModelMap): ModelProfile {
	for (const [profile, config] of Object.entries(MODEL_PROFILES)) {
		if (BUILTIN_ALIASES.every((alias) => {
			const current = modelMap[alias];
			const expected = config[alias];
			return current.model === expected.model && current.thinkingLevel === expected.thinkingLevel;
		})) {
			return profile as ModelProfile;
		}
	}
	return "custom";
}

function getActiveAlias(modeConfig: ModeConfig): ModelAlias {
	// If mode config specifies a model alias, use it
	const configuredModel = modeConfig.model;
	if (configuredModel && isModelAlias(configuredModel)) {
		return configuredModel;
	}
	// Fall back: read-only modes use custom/large, build modes use custom/medium
	return modeConfig.access === "read-only" ? "custom/large" : "custom/medium";
}

function getDefaultModeForSession(
	reason: string,
	modeRegistry: ModeRegistry,
	lastState?: { data?: AppState },
): string {
	const savedMode = lastState?.data?.mode;
	if (savedMode && modeRegistry.byName.has(savedMode)) return savedMode;

	// Saved mode wins. No saved mode: startup/new => plan. Legacy resume/reload/fork => build.
	return reason === "startup" || reason === "new"
		? DEFAULT_NEW_SESSION_MODE
		: DEFAULT_EXISTING_SESSION_MODE;
}

interface CommandEntry {
	name: string;
	description?: string;
	source: "extension" | "prompt" | "skill";
	sourceInfo: {
		path: string;
		source: string;
		scope: "user" | "project" | "temporary";
		origin: "package" | "top-level";
		baseDir?: string;
	};
}

function parseFrontmatter(content: string): Record<string, string> | null {
	const match = content.match(/^---\n([\s\S]*?)\n---/);
	if (!match) return null;
	const frontmatter: Record<string, string> = {};
	for (const line of match[1].split("\n")) {
		const colonIdx = line.indexOf(":");
		if (colonIdx > 0) {
			frontmatter[line.slice(0, colonIdx).trim()] = line.slice(colonIdx + 1).trim();
		}
	}
	return frontmatter;
}

function detectSlashCommand(text: string): string | undefined {
	const trimmed = text.trim();
	if (!trimmed.startsWith("/")) return undefined;
	return trimmed.slice(1).split(/\s+/)[0].toLowerCase();
}

function findPromptCommand(commands: CommandEntry[], name: string): CommandEntry | undefined {
	return commands.find((cmd) => {
		if (cmd.source !== "prompt") return false;
		const baseName = cmd.name.split(":")[0];
		return baseName === name;
	});
}

export default function buildPlanMode(pi: ExtensionAPI) {
	let mode: string = DEFAULT_EXISTING_SESSION_MODE;
	let modeRegistry: ModeRegistry = {
		byName: new Map(),
		byCommand: new Map(),
		warnings: [],
		builtinNames: new Set(),
	};
	let modelMap: ModelMap = structuredClone(DEFAULT_MODEL_MAP);
	let activeContext: ExtensionContext | undefined;
	let fileOverridePath: string | null = null;
	let fileOverrideProfile: BuiltinProfile | null = null;
	let fileOverrideCustomData: Record<ModelAlias, AliasConfig> | null = null;
	let fileOverrideSignature: string | null = null;
	// Keep this workflow in memory so reloads and resumed sessions cannot replay it.
	let automaticPlanBuildActive = false;
	let pendingAutomaticHandoff: PendingAutomaticHandoff | undefined;
	let automaticHandoffDispatch: PendingAutomaticHandoff | undefined;
	let automaticHandoffTimer: ReturnType<typeof setTimeout> | undefined;
	let automaticHandoffDispatchQueued = false;

	function getModeToolNames(modeConfig?: ModeConfig): string[] {
		if (modeConfig?.tools?.length) return modeConfig.tools;
		return pi.getAllTools().map(t => t.name);
	}

	function getActiveModeConfig(): ModeConfig | undefined {
		return modeRegistry.byName.get(mode);
	}

	function restoreModelMapFromSession(ctx: ExtensionContext) {
		const lastState = ctx.sessionManager.getEntries()
			.filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === STATE_TYPE)
			.pop() as { data?: AppState } | undefined;
		const savedMap = lastState?.data?.modelMap;
		if (!savedMap) return;

		for (const alias of BUILTIN_ALIASES) {
			const saved = savedMap[alias];
			if (saved) modelMap[alias] = { ...modelMap[alias], ...saved };
		}
	}

	// Emit model config early so subagent tool can resolve aliases even in --no-session mode.
	process.nextTick(() => {
		pi.events.emit(MODEL_CONFIG_EVENT, { ...modelMap });
	});

	function persistStateToFile(cwd: string) {
		const filePath = getTempStateFilePath(cwd);
		try {
			fs.writeFileSync(filePath, JSON.stringify({ modelMap }, null, 2), "utf-8");
		} catch {
			// File is secondary persistence; session entries are primary
		}
	}

	function readStateFromFile(cwd: string): Partial<Record<ModelAlias, Partial<AliasConfig>>> | null {
		const filePath = getTempStateFilePath(cwd);
		try {
			if (fs.existsSync(filePath)) {
				const content = fs.readFileSync(filePath, "utf-8");
				const data = JSON.parse(content);
				if (data && data.modelMap) return data.modelMap;
			}
		} catch {
			// Silently ignore corrupt/inaccessible file
		}
		return null;
	}

	function persistState(ctx?: ExtensionContext) {
		const profile = getCurrentProfile(modelMap);
		pi.appendEntry(STATE_TYPE, { mode, profile, modelMap });
		if (ctx) persistStateToFile(ctx.cwd);
	}

	function seedModeState() {
		pi.appendEntry(STATE_TYPE, { mode });
	}

	function emitModelConfig() {
		pi.events.emit(MODEL_CONFIG_EVENT, { ...modelMap });
	}

	async function updateModelMap(nextModelMap: Partial<Record<ModelAlias, Partial<AliasConfig>>>, ctx: ExtensionContext, notify: string) {
		for (const alias of Object.keys(nextModelMap) as ModelAlias[]) {
			const update = nextModelMap[alias];
			if (update) {
				modelMap[alias] = { ...modelMap[alias], ...update };
			}
		}
		emitModelConfig();
		persistState(ctx);
		const modeConfig = getActiveModeConfig();
		const activeAlias = modeConfig ? getActiveAlias(modeConfig) : "custom/medium";
		if (nextModelMap[activeAlias]) await setSessionModel(activeAlias, ctx);
		updateStatus(ctx);
		ctx.ui.notify(
			`${notify}\ncustom/large -> ${modelMap["custom/large"].model} (thinking: ${modelMap["custom/large"].thinkingLevel})\ncustom/medium -> ${modelMap["custom/medium"].model} (thinking: ${modelMap["custom/medium"].thinkingLevel})\ncustom/small -> ${modelMap["custom/small"].model} (thinking: ${modelMap["custom/small"].thinkingLevel})`,
			"info",
		);
	}

	function updateStatus(ctx: ExtensionContext) {
		const modeConfig = getActiveModeConfig();
		const profile = getCurrentProfile(modelMap);
		const suffix = ` · ${profile}`;
		if (modeConfig) {
			const icon = modeConfig.statusIcon ?? (modeConfig.access === "read-only" ? "⏸" : "⚒");
			const label = modeConfig.statusLabel ?? modeConfig.name;
			const color = modeConfig.access === "read-only" ? "warning" : "success";
			ctx.ui.setStatus(
				"build-plan-mode",
				ctx.ui.theme.fg(color as any, `${icon} ${label}${suffix}`),
			);
		} else {
			ctx.ui.setStatus(
				"build-plan-mode",
				ctx.ui.theme.fg("error", `⚠ ${mode}${suffix}`),
			);
		}
	}

	async function setSessionModel(alias: ModelAlias, ctx: ExtensionContext, notifyOnFailure = true) {
		const aliasConfig = modelMap[alias];
		const target = aliasConfig.model;
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

		pi.setThinkingLevel(aliasConfig.thinkingLevel);
	}

	async function applyMode(nextMode: string, ctx: ExtensionContext, notify = true) {
		const modeConfig = modeRegistry.byName.get(nextMode);
		if (!modeConfig) {
			ctx.ui.notify(`Unknown mode: "${nextMode}". Available: ${Array.from(modeRegistry.byName.keys()).join(", ")}`, "warning");
			return;
		}

		restoreModelMapFromSession(ctx);
		cancelAutomaticPlanBuild();
		mode = nextMode;
		pi.setActiveTools(getModeToolNames(modeConfig));

		// Determine model alias for this mode
		const activeAlias = getActiveAlias(modeConfig);

		// Resolve model: mode config's model field takes priority over alias
		const resolvedModel = modeConfig.model && !isModelAlias(modeConfig.model)
			? modeConfig.model
			: undefined;

		if (resolvedModel) {
			// Direct provider/model reference from mode config
			const parsed = parseModelRef(resolvedModel);
			if (parsed) {
				const model = ctx.modelRegistry.find(parsed.provider, parsed.modelId);
				if (model) await pi.setModel(model);
			}
		} else {
			// Use alias-based model selection
			await setSessionModel(activeAlias, ctx, false);
		}

		// Thinking level: mode config overrides, else use alias config
		const aliasConfig = modelMap[activeAlias];
		const thinking = modeConfig.thinking ?? aliasConfig.thinkingLevel;
		pi.setThinkingLevel(thinking);

		emitModelConfig();
		updateStatus(ctx);
		if (notify) {
			const modelLabel = resolvedModel ?? aliasConfig.model;
			ctx.ui.notify(
				`Switched to ${modeConfig.name} mode (${modelLabel}; thinking: ${thinking})`,
				"info",
			);
		}
		persistState(ctx);
	}

	async function applyProfile(
		profile: BuiltinProfile,
		ctx: ExtensionContext,
		source: string,
		notify = true,
	) {
		modelMap = structuredClone(MODEL_PROFILES[profile]);

		const modeConfig = getActiveModeConfig();
		const activeAlias = modeConfig ? getActiveAlias(modeConfig) : "custom/medium";
		pi.setThinkingLevel(modelMap[activeAlias].thinkingLevel);

		emitModelConfig();
		await setSessionModel(activeAlias, ctx, false);
		updateStatus(ctx);
		persistState(ctx);

		if (notify) {
			ctx.ui.notify(
				`${source}: ${profile}\ncustom/large -> ${modelMap["custom/large"].model} (thinking: ${modelMap["custom/large"].thinkingLevel})\ncustom/medium -> ${modelMap["custom/medium"].model} (thinking: ${modelMap["custom/medium"].thinkingLevel})\ncustom/small -> ${modelMap["custom/small"].model} (thinking: ${modelMap["custom/small"].thinkingLevel})`,
				"info",
			);
		}
	}

	function readFileOverride(ctx: ExtensionContext): {
		profile: BuiltinProfile | null;
		customData: Record<ModelAlias, AliasConfig> | null;
		filePath: string | null;
	} {
		let dir = ctx.cwd;
		while (true) {
			const candidate = path.join(dir, FILE_OVERRIDE_RELPATH);
			if (fs.existsSync(candidate)) {
				try {
					const content = fs.readFileSync(candidate, "utf-8");
					const parsed = parseProfileContent(content);
					if (parsed.type === "builtin") {
						return { profile: parsed.profile, customData: null, filePath: candidate };
					}
					if (parsed.type === "custom") {
						return { profile: null, customData: parsed.data, filePath: candidate };
					}
					ctx.ui.notify(
						`Invalid content in ${candidate}: ${parsed.error}`,
						"warning",
					);
					return { profile: null, customData: null, filePath: candidate };
				} catch (e) {
					ctx.ui.notify(`Error reading ${candidate}: ${e}`, "warning");
					return { profile: null, customData: null, filePath: candidate };
				}
			}
			const parent = path.dirname(dir);
			if (parent === dir) break;
			dir = parent;
		}
		return { profile: null, customData: null, filePath: null };
	}

	function getFileOverrideSignature(filePath: string, content: string): string {
		return `${filePath}:${content.trim()}`;
	}

	async function syncFileOverride(ctx: ExtensionContext): Promise<boolean> {
		const { profile: fileProfile, customData, filePath } = readFileOverride(ctx);

		if (!filePath) {
			if (fileOverridePath) {
				fileOverridePath = null;
				fileOverrideProfile = null;
				fileOverrideCustomData = null;
				fileOverrideSignature = null;
			}
			return false;
		}

		if (!fileProfile && !customData) {
			return false;
		}

		// Build signature from path + content to detect changes even for custom profiles
		let fileContent: string;
		try {
			fileContent = fs.readFileSync(filePath, "utf-8");
		} catch {
			return false;
		}
		const sig = getFileOverrideSignature(filePath, fileContent);
		if (sig === fileOverrideSignature) {
			return false;
		}

		fileOverridePath = filePath;
		fileOverrideSignature = sig;
		fileOverrideProfile = fileProfile;
		fileOverrideCustomData = customData;

		if (fileProfile) {
			await applyProfile(fileProfile, ctx, `File override (${path.relative(ctx.cwd, filePath)})`);
		} else if (customData) {
			// Apply custom profile: set modelMap from parsed data
			applyProfileData(modelMap, customData);
			emitModelConfig();
			const modeConfig = getActiveModeConfig();
			const activeAlias = modeConfig ? getActiveAlias(modeConfig) : "custom/medium";
			await setSessionModel(activeAlias, ctx, false);
			updateStatus(ctx);
			persistState(ctx);
			ctx.ui.notify(
				`File override (${path.relative(ctx.cwd, filePath)}): custom profile\ncustom/large -> ${modelMap["custom/large"].model} (thinking: ${modelMap["custom/large"].thinkingLevel})\ncustom/medium -> ${modelMap["custom/medium"].model} (thinking: ${modelMap["custom/medium"].thinkingLevel})\ncustom/small -> ${modelMap["custom/small"].model} (thinking: ${modelMap["custom/small"].thinkingLevel})`,
				"info",
			);
		}

		return true;
	}

	async function getAliasArgumentCompletions(prefix: string, alias: ModelAlias): Promise<AutocompleteItem[] | null> {
		const ctx = activeContext;
		if (!ctx) return null;

		const trimmedPrefix = prefix.trim();
		const spaceIndex = trimmedPrefix.indexOf(" ");

		if (spaceIndex >= 0) {
			const modelPart = trimmedPrefix.slice(0, spaceIndex);
			const thinkingPart = trimmedPrefix.slice(spaceIndex + 1).trimStart();

			if (!modelPart.includes("/")) return null;
			if (!parseModelRef(modelPart)) return null;

			const matching = VALID_THINKING_LEVELS.filter((l) => l.startsWith(thinkingPart));
			if (matching.length === 0) return null;

			return matching.map((level) => ({
				value: `${modelPart} ${level}`,
				label: level,
				description: "thinking level",
			}));
		}

		const currentValue = modelMap[alias].model;
		const scopedModels = ctx.scopedModels ?? [];
		let models;
		if (scopedModels.length > 0) {
			models = getModelCompletionCandidates([], scopedModels, currentValue);
		} else {
			await ctx.modelRegistry.refresh();
			models = getModelCompletionCandidates(ctx.modelRegistry.getAvailable(), [], currentValue);
		}
		const items = models.map((model) => ({
			id: model.id,
			provider: model.provider,
			label: `${model.provider}/${model.id}`,
		}));

		const filtered = fuzzyFilter(items, trimmedPrefix, (item) => `${item.id} ${item.provider}`);
		if (filtered.length === 0) return null;

		return filtered.map((item) => ({
			value: item.label,
			label: item.id,
			description: item.provider,
		}));
	}

	function cancelAutomaticPlanBuild() {
		automaticPlanBuildActive = false;
		pendingAutomaticHandoff = undefined;
		automaticHandoffDispatch = undefined;
		automaticHandoffDispatchQueued = false;
		if (automaticHandoffTimer) {
			clearTimeout(automaticHandoffTimer);
			automaticHandoffTimer = undefined;
		}
	}

	function errorMessage(error: unknown): string {
		return error instanceof Error ? error.message : String(error);
	}

	function scheduleAutomaticHandoff() {
		if (!automaticPlanBuildActive || !pendingAutomaticHandoff || automaticHandoffDispatchQueued) return;

		const pending = pendingAutomaticHandoff;
		automaticHandoffDispatchQueued = true;
		automaticHandoffTimer = setTimeout(() => {
			automaticHandoffTimer = undefined;
			automaticHandoffDispatchQueued = false;
			if (!automaticPlanBuildActive || pendingAutomaticHandoff !== pending) return;

			pendingAutomaticHandoff = undefined;
			automaticHandoffDispatch = pending;
			try {
				// Commands are handled immediately when prompt expansion is enabled.
				// Keep this outside agent_settled so session replacement is not re-entrant.
				pi.sendUserMessage("/execute-plan", {
					deliverAs: "followUp",
					expandPromptTemplates: true,
				});
			} catch (error) {
				automaticHandoffDispatch = undefined;
				automaticPlanBuildActive = false;
				activeContext?.ui.notify(`Automatic plan handoff failed: ${errorMessage(error)}`, "error");
			}
		}, 0);
	}

	async function executePlanHandoff(
		plan: string,
		args: string | undefined,
		ctx: ExtensionCommandContext,
		options: ExecutePlanOptions = {},
	): Promise<void> {
		const extraInstructions = options.pr
			? [args?.trim(), PR_EXECUTION_INSTRUCTIONS].filter(Boolean).join("\n\n")
			: options.automatic
				? AUTO_BUILD_EXECUTION_INSTRUCTIONS
				: args;
		const executionPrompt = buildExecutionPrompt(plan, extraInstructions);
		const ui = ctx.ui;
		const parentSession = ctx.sessionManager.getSessionFile();
		let result: { cancelled: boolean };
		try {
			result = await ctx.newSession({
				parentSession,
				setup: async (sessionManager) => {
					sessionManager.appendCustomEntry(STATE_TYPE, {
						mode: "build",
						profile: getCurrentProfile(modelMap),
						modelMap: structuredClone(modelMap),
					});
				},
				withSession: async (replacementCtx) => {
					// newSession setup runs after session_start, so select build mode explicitly.
					try {
						await replacementCtx.sendUserMessage("/build", {
							expandPromptTemplates: true,
						});
					} catch (error) {
						replacementCtx.ui.notify(`Failed to select build mode: ${errorMessage(error)}`, "error");
						return;
					}
					void replacementCtx.sendUserMessage(executionPrompt).catch((error) => {
						replacementCtx.ui.notify(`Failed to start plan execution: ${errorMessage(error)}`, "error");
					});
					replacementCtx.ui.notify("Started fresh build session.", "info");
				},
			});
		} catch (error) {
			ui.notify(
				`${options.automatic ? "Automatic plan handoff" : "Execute plan"} failed: ${errorMessage(error)}`,
				"error",
			);
			return;
		}

		if (result.cancelled) {
			ui.notify(
				options.automatic ? "Automatic plan handoff cancelled. No retry will be attempted." : "Execute plan cancelled.",
				"info",
			);
		}
	}

	// ── Register commands for each mode ──────────────────────────────────

	function registerModeCommands() {
		for (const [name, cfg] of modeRegistry.byName) {
			const cmd = cfg.command ?? name;
			pi.registerCommand(cmd, {
				description: `Switch to ${cfg.description}`,
				handler: async (_args, ctx) => {
					await applyMode(cfg.name, ctx);
				},
			});
		}
	}

	// ── Commands ─────────────────────────────────────────────────────────

	pi.registerTool({
		name: "finish_plan",
		label: "Finish Plan",
		description: "Submit a nonempty, self-contained plan with decisions, files, implementation steps, and validation for an explicitly activated /plan-build workflow.",
		promptSnippet: "Submit the completed plan for an explicitly activated /plan-build workflow",
		promptGuidelines: [
			"Use finish_plan only after all required questions are answered in an explicitly activated /plan-build workflow.",
			"Include decisions, files, implementation steps, and validation in the finish_plan plan.",
			"Do not use finish_plan to infer completion in an ordinary plan session.",
		],
		parameters: FINISH_PLAN_PARAMS,
		async execute(_toolCallId, params) {
			const plan = params.plan.trim();
			if (!plan) {
				return {
					content: [{ type: "text", text: "Error: plan must be nonempty." }],
					details: { accepted: false, plan: undefined } as FinishPlanDetails,
				};
			}

			if (!automaticPlanBuildActive || mode !== "plan") {
				return {
					content: [{ type: "text", text: "Automatic plan-build is not active. Continue planning and present the plan normally." }],
					details: { accepted: false, plan: undefined } as FinishPlanDetails,
				};
			}

			if (pendingAutomaticHandoff || automaticHandoffDispatch) {
				return {
					content: [{ type: "text", text: "A plan has already been submitted for handoff." }],
					details: { accepted: false, plan: undefined } as FinishPlanDetails,
				};
			}

			pendingAutomaticHandoff = { plan };
			return {
				content: [{ type: "text", text: "Plan accepted. A fresh build session will start after this turn settles." }],
				details: { accepted: true, plan } as FinishPlanDetails,
				terminate: true,
			};
		},
		renderCall(_args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("finish_plan")), 0, 0);
		},
		renderResult(result, _options, theme) {
			const text = result.content.find((part): part is TextContent => part.type === "text")?.text ?? "";
			const accepted = (result.details as { accepted?: boolean } | undefined)?.accepted;
			return new Text(theme.fg(accepted ? "success" : "warning", text), 0, 0);
		},
	});

	pi.registerCommand("plan-build", {
		description: "Plan the next request in read-only mode, then start a fresh build session automatically",
		handler: async (args, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Wait for the current turn to finish before starting plan-build.", "warning");
				return;
			}

			await applyMode("plan", ctx, false);
			automaticPlanBuildActive = true;
			const request = args.trim();
			if (!request) {
				ctx.ui.notify("Automatic plan-build enabled. Submit the next request.", "info");
				return;
			}

			ctx.ui.notify("Automatic plan-build started.", "info");
			pi.sendUserMessage(request);
		},
	});

	async function finalizeAndHandoff(args: string, ctx: ExtensionCommandContext, options: ExecutePlanOptions = {}) {
		const beforeEntry = getLastAssistantEntry(ctx);

		ctx.ui.notify("Requesting final consolidated plan…", "info");
		pi.sendUserMessage(buildFinalizePlanPrompt(args));

		const started = await waitForTurnStart(ctx);
		if (!started) {
			ctx.ui.notify("Final plan request did not start. Handoff aborted.", "warning");
			return;
		}

		await ctx.waitForIdle();

		const afterEntry = getLastAssistantEntry(ctx);
		if (!afterEntry) {
			ctx.ui.notify("Assistant did not produce a final plan. Handoff aborted.", "warning");
			return;
		}

		if (afterEntry.stopReason === "aborted" || afterEntry.stopReason === "error") {
			ctx.ui.notify("Final plan request failed. Handoff aborted.", "warning");
			return;
		}

		if (beforeEntry && beforeEntry.id === afterEntry.id) {
			ctx.ui.notify("Assistant did not produce a new plan. Handoff aborted.", "warning");
			return;
		}

		await executePlanHandoff(afterEntry.text, args, ctx, options);
	}

	pi.registerCommand("execute-plan", {
		description: "Finalize current plan, then start fresh build session from finalized plan only",
		handler: async (args, ctx) => {
			const automatic = automaticHandoffDispatch;
			if (automatic) {
				automaticHandoffDispatch = undefined;
				automaticPlanBuildActive = false;
				await executePlanHandoff(automatic.plan, undefined, ctx, { automatic: true });
				return;
			}

			if (!ctx.isIdle()) {
				ctx.ui.notify("Wait for the current turn to finish before executing the plan.", "warning");
				return;
			}

			await finalizeAndHandoff(args, ctx);
		},
	});

	pi.registerCommand("execute-plan-pr", {
		description: "Finalize current plan, then implement, commit, push, and open a ready-for-review pull request",
		handler: async (args, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Wait for the current turn to finish before executing the plan.", "warning");
				return;
			}

			await finalizeAndHandoff(args, ctx, { pr: true });
		},
	});

	pi.registerCommand("execute-plan-now", {
		description: "Start fresh build session from latest assistant message without finalizing it",
		handler: async (args, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Wait for the current turn to finish before executing the plan.", "warning");
				return;
			}

			const lastEntry = getLastAssistantEntry(ctx);
			if (!lastEntry) {
				ctx.ui.notify("No assistant message found. Nothing to execute.", "warning");
				return;
			}

			await executePlanHandoff(lastEntry.text, args, ctx);
		},
	});

	pi.registerCommand("large-model", {
		description: `Show or set model/thinking behind custom/large. Usage: /large-model [provider/model] [${THINKING_LEVELS_DISPLAY}]`,
		getArgumentCompletions: (prefix: string) => getAliasArgumentCompletions(prefix, "custom/large"),
		handler: async (args, ctx) => {
			const parsed = parseAliasArgs(args);
			if ("error" in parsed) {
				ctx.ui.notify(parsed.error, "warning");
				ctx.ui.notify(
					`Usage: /large-model [provider/model] [${THINKING_LEVELS_DISPLAY}]\nCurrent: ${modelMap["custom/large"].model} (thinking: ${modelMap["custom/large"].thinkingLevel})`,
					"info",
				);
				return;
			}
			if (!parsed.model && !parsed.thinkingLevel) {
				ctx.ui.notify(
					`custom/large -> ${modelMap["custom/large"].model} (thinking: ${modelMap["custom/large"].thinkingLevel})`,
					"info",
				);
				return;
			}
			const update: Partial<AliasConfig> = {};
			if (parsed.model) update.model = parsed.model;
			if (parsed.thinkingLevel) update.thinkingLevel = parsed.thinkingLevel;
			await updateModelMap({ "custom/large": update }, ctx, "Updated model alias.");
		},
	});

	pi.registerCommand("medium-model", {
		description: `Show or set model/thinking behind custom/medium. Usage: /medium-model [provider/model] [${THINKING_LEVELS_DISPLAY}]`,
		getArgumentCompletions: (prefix: string) => getAliasArgumentCompletions(prefix, "custom/medium"),
		handler: async (args, ctx) => {
			const parsed = parseAliasArgs(args);
			if ("error" in parsed) {
				ctx.ui.notify(parsed.error, "warning");
				ctx.ui.notify(
					`Usage: /medium-model [provider/model] [${THINKING_LEVELS_DISPLAY}]\nCurrent: ${modelMap["custom/medium"].model} (thinking: ${modelMap["custom/medium"].thinkingLevel})`,
					"info",
				);
				return;
			}
			if (!parsed.model && !parsed.thinkingLevel) {
				ctx.ui.notify(
					`custom/medium -> ${modelMap["custom/medium"].model} (thinking: ${modelMap["custom/medium"].thinkingLevel})`,
					"info",
				);
				return;
			}
			const update: Partial<AliasConfig> = {};
			if (parsed.model) update.model = parsed.model;
			if (parsed.thinkingLevel) update.thinkingLevel = parsed.thinkingLevel;
			await updateModelMap({ "custom/medium": update }, ctx, "Updated model alias.");
		},
	});

	pi.registerCommand("small-model", {
		description: `Show or set model/thinking behind custom/small. Usage: /small-model [provider/model] [${THINKING_LEVELS_DISPLAY}]`,
		getArgumentCompletions: (prefix: string) => getAliasArgumentCompletions(prefix, "custom/small"),
		handler: async (args, ctx) => {
			const parsed = parseAliasArgs(args);
			if ("error" in parsed) {
				ctx.ui.notify(parsed.error, "warning");
				ctx.ui.notify(
					`Usage: /small-model [provider/model] [${THINKING_LEVELS_DISPLAY}]\nCurrent: ${modelMap["custom/small"].model} (thinking: ${modelMap["custom/small"].thinkingLevel})`,
					"info",
				);
				return;
			}
			if (!parsed.model && !parsed.thinkingLevel) {
				ctx.ui.notify(
					`custom/small -> ${modelMap["custom/small"].model} (thinking: ${modelMap["custom/small"].thinkingLevel})`,
					"info",
				);
				return;
			}
			const update: Partial<AliasConfig> = {};
			if (parsed.model) update.model = parsed.model;
			if (parsed.thinkingLevel) update.thinkingLevel = parsed.thinkingLevel;
			await updateModelMap({ "custom/small": update }, ctx, "Updated model alias.");
		},
	});

	pi.registerCommand("model-profile", {
		description: `Show or set model alias profile (${BUILTIN_PROFILES_DISPLAY})`,
		handler: async (args, ctx) => {
			if (fileOverridePath) {
				ctx.ui.notify(
					`File override active (${path.relative(ctx.cwd, fileOverridePath)}). Manual profile will be overwritten on next turn. Remove the file to keep manual setting.`,
					"warning",
				);
			}
			const profile = args.trim().toLowerCase();
			if (!profile) {
				const current = getCurrentProfile(modelMap);
				ctx.ui.notify(`Current profile: ${current}\ncustom/large -> ${modelMap["custom/large"].model} (thinking: ${modelMap["custom/large"].thinkingLevel})\ncustom/medium -> ${modelMap["custom/medium"].model} (thinking: ${modelMap["custom/medium"].thinkingLevel})\ncustom/small -> ${modelMap["custom/small"].model} (thinking: ${modelMap["custom/small"].thinkingLevel})`, "info");
				return;
			}
			const matched = findBuiltinProfile(profile);
			if (matched) {
				await applyProfile(matched, ctx, "Manual profile");
				return;
			}
			ctx.ui.notify(`Usage: /model-profile [${BUILTIN_PROFILES_DISPLAY}]`, "warning");
		},
	});

	pi.registerCommand("save-model-profile", {
		description: "Save current model profile to julsemaan-tmp/model-profile",
		handler: async (_args, ctx) => {
			const profile = getCurrentProfile(modelMap);

			// Determine target: find existing file, nearest julsemaan-tmp/, or create
			let targetDir: string | null = null;
			let targetFile: string | null = null;

			// 1. Find existing profile file in cwd or ancestors
			let dir = ctx.cwd;
			while (true) {
				const candidate = path.join(dir, FILE_OVERRIDE_RELPATH);
				if (fs.existsSync(candidate)) {
					targetFile = candidate;
					break;
				}
				// Check for julsemaan-tmp/ directory
				const tmpDir = path.join(dir, "julsemaan-tmp");
				if (fs.existsSync(tmpDir) && fs.statSync(tmpDir).isDirectory()) {
					targetDir = dir;
				}
				const parent = path.dirname(dir);
				if (parent === dir) break;
				dir = parent;
			}

			// 2. If no existing file, use nearest julsemaan-tmp/ dir or create under cwd
			if (!targetFile) {
				if (targetDir) {
					targetFile = path.join(targetDir, FILE_OVERRIDE_RELPATH);
				} else {
					const tmpDir = path.join(ctx.cwd, "julsemaan-tmp");
					try {
						fs.mkdirSync(tmpDir, { recursive: true });
					} catch (e) {
						ctx.ui.notify(`Failed to create ${tmpDir}: ${e}`, "warning");
						return;
					}
					targetFile = path.join(tmpDir, "model-profile");
				}
			}

			// 3. Serialize and write
			let content: string;
			if (profile !== "custom") {
				content = serializeBuiltinProfile(profile);
			} else {
				content = serializeCustomProfile(modelMap);
			}

			try {
				fs.writeFileSync(targetFile, content, "utf-8");
			} catch (e) {
				ctx.ui.notify(`Failed to write ${targetFile}: ${e}`, "warning");
				return;
			}

			// 4. Refresh signature to prevent redundant reapplication
			fileOverrideSignature = getFileOverrideSignature(targetFile, content);

			// 5. Refresh cached override so Alt+M cycle picks up the profile immediately
			if (profile !== "custom") {
				fileOverrideProfile = profile;
				fileOverrideCustomData = null;
			} else {
				fileOverrideProfile = null;
				fileOverrideCustomData = structuredClone(modelMap);
			}

			const relPath = path.relative(ctx.cwd, targetFile);
			const label = profile !== "custom" ? `built-in (${profile})` : "custom";
			ctx.ui.notify(`Saved ${label} profile to ${relPath}`, "info");
		},
	});

	pi.registerCommand("mode", {
		description: "Show current mode or switch to named mode. Usage: /mode [name]",
		handler: async (args, ctx) => {
			const next = args.trim().toLowerCase();
			if (!next) {
				const modeConfig = getActiveModeConfig();
				if (modeConfig) {
					ctx.ui.notify(
						`Current mode: ${modeConfig.name} (${modeConfig.description}). Available: ${Array.from(modeRegistry.byName.keys()).join(", ")}`,
						"info",
					);
				} else {
					ctx.ui.notify(
						`Current mode: ${mode} (unknown). Available: ${Array.from(modeRegistry.byName.keys()).join(", ")}`,
						"info",
					);
				}
				return;
			}
			if (next === "toggle") {
				// Toggle between first two modes (usually build/plan)
				const names = Array.from(modeRegistry.byName.keys());
				const currentIdx = names.indexOf(mode);
				if (currentIdx < 0 || currentIdx >= names.length - 1) {
					await applyMode(names[0], ctx);
				} else {
					await applyMode(names[currentIdx + 1], ctx);
				}
				return;
			}
			const modeConfig = modeRegistry.byName.get(next);
			if (!modeConfig) {
				ctx.ui.notify(
					`Unknown mode: "${next}". Available: ${Array.from(modeRegistry.byName.keys()).join(", ")}`,
					"warning",
				);
				return;
			}
			await applyMode(modeConfig.name, ctx);
		},
	});

	pi.registerCommand("newbuild", {
		description: "Start new session in build mode",
		handler: async (_args, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Wait for the current turn to finish.", "warning");
				return;
			}
			const result = await ctx.newSession({
				setup: async (sessionManager) => {
					sessionManager.appendCustomEntry(STATE_TYPE, { mode: "build" });
				},
				withSession: async (replacementCtx) => {
					replacementCtx.ui.notify("Started new build session.", "info");
				},
			});
			if (result.cancelled) {
				ctx.ui.notify("New session cancelled.", "info");
			}
		},
	});

	pi.registerShortcut("alt+x", {
		description: "Cycle plan, build, and small-build modes",
		handler: async (ctx) => {
			const cycle = ["plan", "build", "small-build"];
			const currentIdx = cycle.indexOf(mode);
			const nextMode = cycle[(currentIdx + 1) % cycle.length] ?? cycle[0];
			await applyMode(nextMode, ctx);
		},
	});

	pi.registerShortcut("alt+m", {
		description: `Cycle model profile (${BUILTIN_PROFILES_DISPLAY}${fileOverrideCustomData ? "|custom" : ""})`,
		handler: async (ctx) => {
			// Refresh override on every cycle so externally saved custom profiles appear
			if (fileOverridePath) {
				const { profile: fp, customData: cd } = readFileOverride(ctx);
				fileOverrideProfile = fp;
				fileOverrideCustomData = cd;
			}

			const current = getCurrentProfile(modelMap);
			const hasCustom = fileOverrideCustomData !== null;
			const next = getNextProfile(current, hasCustom);

			if (next === "custom") {
				// Apply saved custom profile
				if (fileOverrideCustomData) {
					applyProfileData(modelMap, fileOverrideCustomData);
				}
				emitModelConfig();
				const modeConfig = getActiveModeConfig();
				const activeAlias = modeConfig ? getActiveAlias(modeConfig) : "custom/medium";
				await setSessionModel(activeAlias, ctx, false);
				updateStatus(ctx);
				persistState(ctx);
				ctx.ui.notify(
					`Cycled profile: custom\ncustom/large -> ${modelMap["custom/large"].model} (thinking: ${modelMap["custom/large"].thinkingLevel})\ncustom/medium -> ${modelMap["custom/medium"].model} (thinking: ${modelMap["custom/medium"].thinkingLevel})\ncustom/small -> ${modelMap["custom/small"].model} (thinking: ${modelMap["custom/small"].thinkingLevel})`,
					"info",
				);
			} else {
				await applyProfile(next, ctx, "Cycled profile");
			}
		},
	});

	// ── Lifecycle handlers ──────────────────────────────────────────────

	pi.on("session_start", async (event, ctx) => {
		cancelAutomaticPlanBuild();
		activeContext = ctx;

		// Discover modes from project
		modeRegistry = discoverModes(ctx.cwd);

		// Show warnings
		for (const w of modeRegistry.warnings) {
			ctx.ui.notify(w, "warning");
		}

		// Register per-mode commands (after discovery)
		registerModeCommands();

		const entries = ctx.sessionManager.getEntries();
		const lastState = entries
			.filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === STATE_TYPE)
			.pop() as { data?: AppState } | undefined;

		// Saved mode wins. No saved mode: startup/new sessions default to plan;
		// legacy resumed/reloaded/forked sessions default to build.
		mode = getDefaultModeForSession(event.reason, modeRegistry, lastState);
		// Subagent processes always run in build mode
		if (process.env.PI_SUBAGENT === "1" && modeRegistry.byName.has("build")) {
			mode = "build";
		}

		// Resolve modelMap. During /reload a valid file override beats stale
		// session/temp state; otherwise env > session > temp > file > default.
		let envProfile: BuiltinProfile | null = null;
		const envRaw = process.env.PI_BUILD_PLAN_MODEL_PROFILE?.trim();
		if (envRaw) {
			const matched = findBuiltinProfile(envRaw);
			if (matched) {
				envProfile = matched;
			} else {
				ctx.ui.notify(
					`Invalid PI_BUILD_PLAN_MODEL_PROFILE="${envRaw}" — expected one of: ${BUILTIN_PROFILES_DISPLAY}. Ignoring.`,
					"warning",
				);
			}
		}

		// File override (julsemaan-tmp/model-profile)
		const { profile: fileProfile, customData: fileCustomData, filePath } = readFileOverride(ctx);
		fileOverridePath = filePath;
		fileOverrideProfile = fileProfile;
		fileOverrideCustomData = fileCustomData;

		// Initialize signature so syncFileOverride won't re-apply an unchanged file on the first turn
		if (filePath) {
			try {
				const content = fs.readFileSync(filePath, "utf-8");
				fileOverrideSignature = getFileOverrideSignature(filePath, content);
			} catch {
				// File unreadable — syncFileOverride will handle on next turn
			}
		}

		const resolved = resolveStartupMap(
			{
				reason: event.reason,
				envProfile,
				sessionMap: lastState?.data?.modelMap ?? null,
				tempMap: readStateFromFile(ctx.cwd),
				fileProfile,
				fileCustomData,
			},
			DEFAULT_MODEL_MAP,
			MODEL_PROFILES,
		);
		modelMap = resolved.modelMap;

		// Reload picked up an externally changed profile: persist it so the next
		// reload doesn't restore the stale session state.
		if (event.reason === "reload" && resolved.source === "file") {
			persistState(ctx);
		}

		emitModelConfig();

		// Apply current mode config
		const modeConfig = getActiveModeConfig();
		if (modeConfig) {
			pi.setActiveTools(getModeToolNames(modeConfig));

			const activeAlias = getActiveAlias(modeConfig);
			const aliasConfig = modelMap[activeAlias];

			// Mode's own model override
			if (modeConfig.model && !isModelAlias(modeConfig.model)) {
				const parsed = parseModelRef(modeConfig.model);
				if (parsed) {
					const model = ctx.modelRegistry.find(parsed.provider, parsed.modelId);
					if (model) await pi.setModel(model);
				}
			} else {
				await setSessionModel(activeAlias, ctx, false);
			}

			pi.setThinkingLevel(modeConfig.thinking ?? aliasConfig.thinkingLevel);
		} else {
			// Fallback: should not happen since we validated mode is known
			pi.setActiveTools(pi.getAllTools().map(t => t.name));
		}

		if (!lastState && (event.reason === "startup" || event.reason === "new")) {
			seedModeState();
		}

		updateStatus(ctx);
	});

	pi.on("agent_end", async (event, ctx) => {
		if (!automaticPlanBuildActive && !pendingAutomaticHandoff && !automaticHandoffDispatch) return;
		const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
		if (ctx.signal?.aborted || !lastAssistant || lastAssistant.stopReason === "aborted" || lastAssistant.stopReason === "error") {
			cancelAutomaticPlanBuild();
		}
	});

	pi.on("agent_settled", async () => {
		scheduleAutomaticHandoff();
	});

	pi.on("session_shutdown", async () => {
		cancelAutomaticPlanBuild();
		activeContext = undefined;
	});

	pi.on("turn_start", async (_event, ctx) => {
		await syncFileOverride(ctx);
	});

	pi.on("before_agent_start", async (event) => {
		const modeConfig = getActiveModeConfig();
		const promptSuffix = modeConfig?.systemPrompt ? `\n\n${modeConfig.systemPrompt}` : "";
		const automaticSuffix = automaticPlanBuildActive && mode === "plan"
			? `\n\n${AUTO_PLAN_BUILD_INSTRUCTIONS}`
			: "";
		return {
			systemPrompt: event.systemPrompt + promptSuffix + automaticSuffix,
		};
	});

	pi.on("input", async (event, ctx) => {
		if (event.source !== "interactive" && event.source !== "extension") return { action: "continue" };

		const slashCmd = detectSlashCommand(event.text);
		if (!slashCmd) return { action: "continue" };

		const commands = pi.getCommands() as CommandEntry[];
		const matched = findPromptCommand(commands, slashCmd);
		if (!matched) return { action: "continue" };

		let content: string;
		try {
			content = fs.readFileSync(matched.sourceInfo.path, "utf-8");
		} catch {
			return { action: "continue" };
		}

		const frontmatter = parseFrontmatter(content);
		const requestedMode = frontmatter?.mode?.trim().toLowerCase();
		if (!requestedMode) return { action: "continue" };

		if (!modeRegistry.byName.has(requestedMode)) {
			ctx.ui.notify(
				`Prompt "${slashCmd}" requests unknown mode "${requestedMode}", ignoring.`,
				"warning",
			);
			return { action: "continue" };
		}

		if (requestedMode === mode) return { action: "continue" };

		await applyMode(requestedMode, ctx, true);
		return { action: "continue" };
	});

}
