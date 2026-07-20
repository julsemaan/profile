import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AutocompleteItem } from "@mariozechner/pi-tui";
import { fuzzyFilter } from "@mariozechner/pi-tui";
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
	BUILTIN_PROFILES,
	type AliasConfig,
	type BuiltinProfile,
	type ModelAlias,
	type ModelMap,
	type ModelProfile,
	applyProfileData,
	findBuiltinProfile,
	getNextProfile,
	isThinkingLevel,
	parseModelRef,
	parseProfileContent,
	serializeBuiltinProfile,
	serializeCustomProfile,
} from "./lib/model-profile.js";

const BUILTIN_PROFILES_DISPLAY = BUILTIN_PROFILES.join("|");

const MODEL_PROFILES: Record<BuiltinProfile, { modelMap: ModelMap }> = {
	pubFree: {
		modelMap: {
			"custom/large": { model: "opencode/mimo-v2.5-free", thinkingLevel: "high" },
			"custom/medium": { model: "opencode/mimo-v2.5-free", thinkingLevel: "medium" },
		},
	},
	pub: {
		modelMap: {
			"custom/large": { model: "openai-codex/gpt-5.6-sol", thinkingLevel: "high" },
			"custom/medium": { model: "opencode/mimo-v2.5-free", thinkingLevel: "medium" },
		},
	},
	pubDeep: {
		modelMap: {
			"custom/large": { model: "deepseek/deepseek-v4-pro", thinkingLevel: "high" },
			"custom/medium": { model: "deepseek/deepseek-v4-pro", thinkingLevel: "medium" },
		},
	},
	priv: {
		modelMap: {
			"custom/large": { model: "openai-codex/gpt-5.6-sol", thinkingLevel: "high" },
			"custom/medium": { model: "openai-codex/gpt-5.6-sol", thinkingLevel: "low" },
		},
	},
	copilotPriv: {
		modelMap: {
			"custom/large": { model: "github-copilot/gpt-5.6-sol", thinkingLevel: "high" },
			"custom/medium": { model: "github-copilot/gpt-5.6-sol", thinkingLevel: "medium" },
		},
	},
};


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
const DEFAULT_MODEL_MAP: ModelMap = structuredClone(MODEL_PROFILES.priv.modelMap);
const DEFAULT_NEW_SESSION_MODE = "plan";
const DEFAULT_EXISTING_SESSION_MODE = "build";

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

function getLastAssistantEntry(ctx: ExtensionContext): { id: string; text: string } | undefined {
	const branch = ctx.sessionManager.getBranch();
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type !== "message" || !isAssistantMessage(entry.message)) continue;
		const text = getAssistantText(entry.message);
		if (text) return { id: entry.id, text };
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
		"Provide the final implementation plan for this task.",
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
			error: `Invalid argument: "${token}". Expected provider/model or thinking level (off|minimal|low|medium|high|xhigh).`,
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
				error: `Second argument must be a thinking level (off|minimal|low|medium|high|xhigh), got: "${thinkingToken}"`,
			};
		return { model: modelToken, thinkingLevel: thinkingToken };
	}

	return {
		error: `Too many arguments. Usage: /command [provider/model] [thinking]`,
	};
}


function getCurrentProfile(modelMap: ModelMap): ModelProfile {
	for (const [profile, config] of Object.entries(MODEL_PROFILES)) {
		const large = config.modelMap["custom/large"];
		const medium = config.modelMap["custom/medium"];
		if (
			modelMap["custom/large"].model === large.model &&
			modelMap["custom/medium"].model === medium.model &&
			modelMap["custom/large"].thinkingLevel === large.thinkingLevel &&
			modelMap["custom/medium"].thinkingLevel === medium.thinkingLevel
		) {
			return profile as ModelProfile;
		}
	}
	return "custom";
}

function getActiveAlias(modeConfig: ModeConfig): ModelAlias {
	// If mode config specifies a model that looks like an alias, use it
	if (modeConfig.model === "custom/large" || modeConfig.model === "custom/medium") {
		return modeConfig.model;
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
	let currentModelRegistry: any;
	let fileOverridePath: string | null = null;
	let fileOverrideProfile: BuiltinProfile | null = null;
	let fileOverrideCustomData: Record<ModelAlias, AliasConfig> | null = null;
	let fileOverrideSignature: string | null = null;

	function getModeToolNames(modeConfig?: ModeConfig): string[] {
		if (modeConfig?.tools?.length) return modeConfig.tools;
		return pi.getAllTools().map(t => t.name);
	}

	function getActiveModeConfig(): ModeConfig | undefined {
		return modeRegistry.byName.get(mode);
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
			`${notify}\ncustom/large -> ${modelMap["custom/large"].model} (thinking: ${modelMap["custom/large"].thinkingLevel})\ncustom/medium -> ${modelMap["custom/medium"].model} (thinking: ${modelMap["custom/medium"].thinkingLevel})`,
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

		mode = nextMode;
		pi.setActiveTools(getModeToolNames(modeConfig));

		// Determine model alias for this mode
		const activeAlias = getActiveAlias(modeConfig);

		// Resolve model: mode config's model field takes priority over alias
		const resolvedModel = modeConfig.model && modeConfig.model !== "custom/large" && modeConfig.model !== "custom/medium"
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
		modelMap = structuredClone(MODEL_PROFILES[profile].modelMap);

		const modeConfig = getActiveModeConfig();
		const activeAlias = modeConfig ? getActiveAlias(modeConfig) : "custom/medium";
		pi.setThinkingLevel(modelMap[activeAlias].thinkingLevel);

		emitModelConfig();
		await setSessionModel(activeAlias, ctx, false);
		updateStatus(ctx);
		persistState(ctx);

		if (notify) {
			ctx.ui.notify(
				`${source}: ${profile}\ncustom/large -> ${modelMap["custom/large"].model} (thinking: ${modelMap["custom/large"].thinkingLevel})\ncustom/medium -> ${modelMap["custom/medium"].model} (thinking: ${modelMap["custom/medium"].thinkingLevel})`,
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
				`File override (${path.relative(ctx.cwd, filePath)}): custom profile\ncustom/large -> ${modelMap["custom/large"].model} (thinking: ${modelMap["custom/large"].thinkingLevel})\ncustom/medium -> ${modelMap["custom/medium"].model} (thinking: ${modelMap["custom/medium"].thinkingLevel})`,
				"info",
			);
		}

		return true;
	}

	function getAliasArgumentCompletions(prefix: string, alias: ModelAlias): AutocompleteItem[] | null {
		if (!currentModelRegistry) return null;

		const trimmedPrefix = prefix.trim();
		const spaceIndex = trimmedPrefix.indexOf(" ");

		if (spaceIndex >= 0) {
			const modelPart = trimmedPrefix.slice(0, spaceIndex);
			const thinkingPart = trimmedPrefix.slice(spaceIndex + 1).trimStart();

			if (!modelPart.includes("/")) return null;
			if (!parseModelRef(modelPart)) return null;

			const levels: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh"];
			const matching = levels.filter((l) => l.startsWith(thinkingPart));
			if (matching.length === 0) return null;

			return matching.map((level) => ({
				value: `${modelPart} ${level}`,
				label: level,
				description: "thinking level",
			}));
		}

		currentModelRegistry.refresh();
		const models = currentModelRegistry.getAvailable();
		if (!models || models.length === 0) return null;

		const items = models.map((m: any) => ({
			id: m.id,
			provider: m.provider,
			label: `${m.provider}/${m.id}`,
		}));

		const currentValue = modelMap[alias].model;
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

		const filtered = fuzzyFilter(items, trimmedPrefix, (item: any) => `${item.id} ${item.provider}`);
		if (filtered.length === 0) return null;

		return filtered.map((item: any) => ({
			value: item.label,
			label: item.id,
			description: item.provider,
		}));
	}

	async function executePlanHandoff(
		plan: string,
		args: string | undefined,
		ctx: ExtensionContext,
	): Promise<void> {
		const executionPrompt = buildExecutionPrompt(plan, args);
		const parentSession = ctx.sessionManager.getSessionFile();
		const result = await ctx.newSession({
			parentSession,
			setup: async (sessionManager) => {
				sessionManager.appendCustomEntry(STATE_TYPE, {
					mode: "build",
					profile: getCurrentProfile(modelMap),
					modelMap: structuredClone(modelMap),
				});
			},
			withSession: async (replacementCtx) => {
				replacementCtx.sendUserMessage(executionPrompt).catch(() => {});
				replacementCtx.ui.notify("Started fresh build session.", "info");
			},
		});

		if (result.cancelled) {
			ctx.ui.notify("Execute plan cancelled.", "info");
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

	pi.registerCommand("execute-plan", {
		description: "Finalize current plan, then start fresh build session from finalized plan only",
		handler: async (args, ctx) => {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Wait for the current turn to finish before executing the plan.", "warning");
				return;
			}

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

			if (beforeEntry && beforeEntry.id === afterEntry.id) {
				ctx.ui.notify("Assistant did not produce a new plan. Handoff aborted.", "warning");
				return;
			}

			await executePlanHandoff(afterEntry.text, args, ctx);
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
		description: "Show or set model/thinking behind custom/large. Usage: /large-model [provider/model] [off|minimal|low|medium|high|xhigh]",
		getArgumentCompletions: (prefix: string) => getAliasArgumentCompletions(prefix, "custom/large"),
		handler: async (args, ctx) => {
			const parsed = parseAliasArgs(args);
			if ("error" in parsed) {
				ctx.ui.notify(parsed.error, "warning");
				ctx.ui.notify(
					`Usage: /large-model [provider/model] [off|minimal|low|medium|high|xhigh]\nCurrent: ${modelMap["custom/large"].model} (thinking: ${modelMap["custom/large"].thinkingLevel})`,
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
		description: "Show or set model/thinking behind custom/medium. Usage: /medium-model [provider/model] [off|minimal|low|medium|high|xhigh]",
		getArgumentCompletions: (prefix: string) => getAliasArgumentCompletions(prefix, "custom/medium"),
		handler: async (args, ctx) => {
			const parsed = parseAliasArgs(args);
			if ("error" in parsed) {
				ctx.ui.notify(parsed.error, "warning");
				ctx.ui.notify(
					`Usage: /medium-model [provider/model] [off|minimal|low|medium|high|xhigh]\nCurrent: ${modelMap["custom/medium"].model} (thinking: ${modelMap["custom/medium"].thinkingLevel})`,
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
				ctx.ui.notify(`Current profile: ${current}\ncustom/large -> ${modelMap["custom/large"].model} (thinking: ${modelMap["custom/large"].thinkingLevel})\ncustom/medium -> ${modelMap["custom/medium"].model} (thinking: ${modelMap["custom/medium"].thinkingLevel})`, "info");
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

	pi.registerShortcut("ctrl+shift+p", {
		description: "Toggle between first two modes",
		handler: async (ctx) => {
			const names = Array.from(modeRegistry.byName.keys());
			const currentIdx = names.indexOf(mode);
			if (currentIdx < 0 || currentIdx >= names.length - 1) {
				await applyMode(names[0], ctx);
			} else {
				await applyMode(names[currentIdx + 1], ctx);
			}
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
					`Cycled profile: custom\ncustom/large -> ${modelMap["custom/large"].model} (thinking: ${modelMap["custom/large"].thinkingLevel})\ncustom/medium -> ${modelMap["custom/medium"].model} (thinking: ${modelMap["custom/medium"].thinkingLevel})`,
					"info",
				);
			} else {
				await applyProfile(next, ctx, "Cycled profile");
			}
		},
	});

	// ── Lifecycle handlers ──────────────────────────────────────────────

	pi.on("session_start", async (event, ctx) => {
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

		// Resolve modelMap with precedence: env override > session entries > temp file > file override > default
		const defaultMap = structuredClone(DEFAULT_MODEL_MAP);
		let hasCustomState = false;

		// 0. Env override from wrapper (--model-profile / PI_BUILD_PLAN_MODEL_PROFILE)
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

		if (envProfile) {
			// Highest precedence: env override. Applied but not persisted to session state.
			const envMap = MODEL_PROFILES[envProfile].modelMap;
			for (const alias of Object.keys(envMap) as ModelAlias[]) {
				defaultMap[alias] = { ...defaultMap[alias], ...envMap[alias] };
			}
			hasCustomState = true;
		} else if (lastState?.data?.modelMap) {
			for (const alias of Object.keys(lastState.data.modelMap) as ModelAlias[]) {
				const saved = lastState.data.modelMap[alias];
				if (saved) {
					defaultMap[alias] = { ...defaultMap[alias], ...saved };
				}
			}
			hasCustomState = true;
		}

		// 2. Temp file (if no session entries)
		if (!hasCustomState) {
			const fileState = readStateFromFile(ctx.cwd);
			if (fileState) {
				for (const alias of Object.keys(fileState) as ModelAlias[]) {
					const saved = fileState[alias];
					if (saved) {
						defaultMap[alias] = { ...defaultMap[alias], ...saved };
					}
				}
				hasCustomState = true;
			}
		}

		// 3. File override (julsemaan-tmp/model-profile) — applied without side effects
		const { profile: fileProfile, customData: fileCustomData, filePath } = readFileOverride(ctx);
		fileOverridePath = filePath;
		fileOverrideProfile = fileProfile;
		fileOverrideCustomData = fileCustomData;

		if (hasCustomState) {
			// Session entries or temp file had custom state (highest priority)
			modelMap = defaultMap;
		} else if (fileProfile) {
			// No custom state, fall back to file override profile
			modelMap = structuredClone(MODEL_PROFILES[fileProfile].modelMap);
		} else if (fileCustomData) {
			// Custom profile from file
			modelMap = defaultMap;
			applyProfileData(modelMap, fileCustomData);
		} else {
			// Pure DEFAULT_MODEL_MAP (no override from any source)
			modelMap = defaultMap;
		}

		currentModelRegistry = ctx.modelRegistry;

		emitModelConfig();

		// Apply current mode config
		const modeConfig = getActiveModeConfig();
		if (modeConfig) {
			pi.setActiveTools(getModeToolNames(modeConfig));

			const activeAlias = getActiveAlias(modeConfig);
			const aliasConfig = modelMap[activeAlias];

			// Mode's own model override
			if (modeConfig.model && modeConfig.model !== "custom/large" && modeConfig.model !== "custom/medium") {
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

	pi.on("turn_start", async (_event, ctx) => {
		await syncFileOverride(ctx);
	});

	pi.on("before_agent_start", async (event) => {
		const modeConfig = getActiveModeConfig();
		const promptSuffix = modeConfig?.systemPrompt ? `\n\n${modeConfig.systemPrompt}` : "";
		return {
			systemPrompt: event.systemPrompt + promptSuffix,
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
