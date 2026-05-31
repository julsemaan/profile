import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AutocompleteItem } from "@mariozechner/pi-tui";
import { fuzzyFilter } from "@mariozechner/pi-tui";
import * as fs from "fs";
import * as path from "path";
import {
	discoverModes,
	type ModeConfig,
	type ModeRegistry,
	type ThinkingLevel,
} from "./modes.js";

type ModelAlias = "custom/large" | "custom/medium";
type AliasConfig = { model: string; thinkingLevel: ThinkingLevel };
type ModelMap = Record<ModelAlias, AliasConfig>;
type ModelProfile = "pub" | "priv" | "custom";

type ModelProfileConfig = {
	modelMap: ModelMap;
};

const MODEL_PROFILES: Record<Exclude<ModelProfile, "custom">, ModelProfileConfig> = {
	pub: {
		modelMap: {
			"custom/large": { model: "openai-codex/gpt-5.4", thinkingLevel: "high" },
			"custom/medium": { model: "opencode/big-pickle", thinkingLevel: "high" },
		},
	},
	priv: {
		modelMap: {
			"custom/large": { model: "openai-codex/gpt-5.4", thinkingLevel: "high" },
			"custom/medium": { model: "openai-codex/gpt-5.4", thinkingLevel: "medium" },
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
const DEFAULT_MODEL_MAP: ModelMap = structuredClone(MODEL_PROFILES.priv.modelMap);
const READ_ONLY_TOOLS = ["read", "bash", "grep", "find", "ls", "question", "todo"];

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

function isSafeBashCommand(command: string): boolean {
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

function isThinkingLevel(value: string): value is ThinkingLevel {
	return value === "off" || value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh";
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

export default function buildPlanMode(pi: ExtensionAPI) {
	let mode: string = "build";
	let modeRegistry: ModeRegistry = {
		byName: new Map(),
		byCommand: new Map(),
		warnings: [],
		builtinNames: new Set(),
	};
	let modelMap: ModelMap = structuredClone(DEFAULT_MODEL_MAP);
	let currentModelRegistry: any;
	let fileOverridePath: string | null = null;
	let fileOverrideProfile: Exclude<ModelProfile, "custom"> | null = null;

	function getActiveModeConfig(): ModeConfig | undefined {
		return modeRegistry.byName.get(mode);
	}

	// Emit model config early so subagent tool can resolve aliases even in --no-session mode.
	process.nextTick(() => {
		pi.events.emit(MODEL_CONFIG_EVENT, { ...modelMap });
	});

	function persistState() {
		const profile = getCurrentProfile(modelMap);
		pi.appendEntry(STATE_TYPE, { mode, profile, modelMap });
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
		persistState();
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
		pi.setActiveTools(modeConfig.tools);

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
		persistState();
	}

	async function applyProfile(
		profile: Exclude<ModelProfile, "custom">,
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
		persistState();

		if (notify) {
			ctx.ui.notify(
				`${source}: ${profile}\ncustom/large -> ${modelMap["custom/large"].model} (thinking: ${modelMap["custom/large"].thinkingLevel})\ncustom/medium -> ${modelMap["custom/medium"].model} (thinking: ${modelMap["custom/medium"].thinkingLevel})`,
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

		if (!filePath) {
			if (fileOverridePath) {
				fileOverridePath = null;
				fileOverrideProfile = null;
			}
			return false;
		}

		if (!fileProfile) {
			return false;
		}

		if (fileProfile === fileOverrideProfile && filePath === fileOverridePath) {
			return false;
		}

		fileOverridePath = filePath;
		fileOverrideProfile = fileProfile;
		await applyProfile(fileProfile, ctx, `File override (${path.relative(ctx.cwd, filePath)})`);
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
				const current = getCurrentProfile(modelMap);
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

	pi.registerShortcut("ctrl+;", {
		description: "Cycle model profile (pub/priv)",
		handler: async (ctx) => {
			const profiles = Object.keys(MODEL_PROFILES) as Exclude<ModelProfile, "custom">[];
			const current = getCurrentProfile(modelMap);
			const idx = profiles.indexOf(current as Exclude<ModelProfile, "custom">);
			const next = idx === -1 || idx >= profiles.length - 1 ? profiles[0] : profiles[idx + 1];
			await applyProfile(next, ctx, "Cycled profile");
		},
	});

	// ── Lifecycle handlers ──────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
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

		// Restore mode from persisted state, fall back to "build"
		const savedMode = lastState?.data?.mode;
		mode = savedMode && modeRegistry.byName.has(savedMode) ? savedMode : "build";

		// Deep merge persisted alias config over defaults
		const defaultMap = structuredClone(DEFAULT_MODEL_MAP);
		if (lastState?.data?.modelMap) {
			for (const alias of Object.keys(lastState.data.modelMap) as ModelAlias[]) {
				const saved = lastState.data.modelMap[alias];
				if (saved) {
					defaultMap[alias] = { ...defaultMap[alias], ...saved };
				}
			}
		}
		modelMap = defaultMap;

		currentModelRegistry = ctx.modelRegistry;
		fileOverridePath = null;
		fileOverrideProfile = null;

		await syncFileOverride(ctx);

		emitModelConfig();

		// Apply current mode config
		const modeConfig = getActiveModeConfig();
		if (modeConfig) {
			pi.setActiveTools(modeConfig.tools);

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
			pi.setActiveTools(READ_ONLY_TOOLS);
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

	pi.on("tool_call", async (event) => {
		const modeConfig = getActiveModeConfig();
		if (!modeConfig || modeConfig.access === "build") return;

		if (event.toolName === "edit" || event.toolName === "write") {
			return {
				block: true,
				reason: `${modeConfig.name} mode is read-only. Switch to /build to modify files.`,
			};
		}

		if (modeConfig.safeBashOnly && event.toolName === "bash") {
			const command = String(event.input.command ?? "");
			if (!isSafeBashCommand(command)) {
				return {
					block: true,
					reason: `${modeConfig.name} mode only allows read-only bash commands. Blocked: ${command}`,
				};
			}
		}
	});
}
