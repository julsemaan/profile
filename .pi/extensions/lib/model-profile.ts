/**
 * Model-profile codec — parse, validate, and serialize model profiles.
 *
 * Built-in profiles are bare names (case-insensitive): pub, deep, priv, etc.
 * Custom profiles are JSON with all configured alias keys.
 */

import type { ThinkingLevel } from "@mariozechner/pi-agent-core";

export type ModelAlias = "custom/large" | "custom/medium" | "custom/small";
export type AliasConfig = { model: string; thinkingLevel: ThinkingLevel };
export type ModelMap = Record<ModelAlias, AliasConfig>;

// ── Built-in profiles ──────────────────────────────────────────────────────

export const BUILTIN_ALIASES: readonly ModelAlias[] = ["custom/large", "custom/medium", "custom/small"];

export function isModelAlias(value: string): value is ModelAlias {
	return (BUILTIN_ALIASES as readonly string[]).includes(value);
}

const THINKING_LEVELS: Record<ThinkingLevel, true> = {
	off: true,
	minimal: true,
	low: true,
	medium: true,
	high: true,
	xhigh: true,
	max: true,
};

export const VALID_THINKING_LEVELS = Object.keys(THINKING_LEVELS) as ThinkingLevel[];

export function isThinkingLevel(value: string): value is ThinkingLevel {
	return (VALID_THINKING_LEVELS as readonly string[]).includes(value);
}

export function parseModelRef(modelRef: string): { provider: string; modelId: string } | undefined {
	const trimmed = modelRef.trim();
	const slashIndex = trimmed.indexOf("/");
	if (slashIndex <= 0 || slashIndex === trimmed.length - 1) return undefined;
	return {
		provider: trimmed.slice(0, slashIndex),
		modelId: trimmed.slice(slashIndex + 1),
	};
}

export type ModelCompletionCandidate = { provider: string; id: string };
export type ScopedModelCompletion = { model: ModelCompletionCandidate };

export function getModelCompletionCandidates(
	availableModels: readonly ModelCompletionCandidate[],
	scopedModels: readonly ScopedModelCompletion[],
	currentValue?: string,
): ModelCompletionCandidate[] {
	const candidates = scopedModels.length > 0
		? scopedModels.map(({ model }) => model)
		: [...availableModels];

	if (scopedModels.length === 0 && currentValue) {
		const parsed = parseModelRef(currentValue);
		if (parsed && !candidates.some((model) => model.provider === parsed.provider && model.id === parsed.modelId)) {
			candidates.unshift({ provider: parsed.provider, id: parsed.modelId });
		}
	}

	return candidates;
}

// ── Built-in profile names (from build-plan-mode.ts) ───────────────────────

export type BuiltinProfile = "pubFree" | "pub" | "deep" | "priv" | "copilotPriv";

export const BUILTIN_PROFILES: readonly BuiltinProfile[] = [
	"opencode", "openrouter", "deep", "priv", "copilotPriv",
];

export function isBuiltinProfile(value: string): value is BuiltinProfile {
	return (BUILTIN_PROFILES as readonly string[]).includes(value);
}

export function findBuiltinProfile(value: string): BuiltinProfile | undefined {
	const lower = value.toLowerCase();
	return (BUILTIN_PROFILES as readonly string[]).find(
		p => p.toLowerCase() === lower,
	) as BuiltinProfile | undefined;
}

export type ModelProfile = BuiltinProfile | "custom";

// ── Custom profile validation ──────────────────────────────────────────────

export type CustomProfile = Record<ModelAlias, { model: string; thinkingLevel: string }>;

export function validateCustomProfile(raw: unknown): {
	ok: true;
	data: Record<ModelAlias, AliasConfig>;
} | { ok: false; error: string } {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		return { ok: false, error: "Expected a JSON object" };
	}

	const obj = raw as Record<string, unknown>;
	const missing = BUILTIN_ALIASES.filter(a => !(a in obj));
	if (missing.length > 0) {
		return { ok: false, error: `Missing required alias keys: ${missing.join(", ")}` };
	}

	const result: Partial<Record<ModelAlias, AliasConfig>> = {};

	for (const alias of BUILTIN_ALIASES) {
		const entry = obj[alias];
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
			return { ok: false, error: `"${alias}" must be an object` };
		}
		const { model, thinkingLevel } = entry as Record<string, unknown>;
		if (typeof model !== "string") {
			return { ok: false, error: `"${alias}".model must be a string` };
		}
		if (!parseModelRef(model)) {
			return { ok: false, error: `"${alias}".model "${model}" is not a valid provider/model reference` };
		}
		if (typeof thinkingLevel !== "string") {
			return { ok: false, error: `"${alias}".thinkingLevel must be a string` };
		}
		if (!isThinkingLevel(thinkingLevel)) {
			return { ok: false, error: `"${alias}".thinkingLevel "${thinkingLevel}" is invalid. Must be one of: ${VALID_THINKING_LEVELS.join(", ")}` };
		}
		result[alias] = { model, thinkingLevel: thinkingLevel as ThinkingLevel };
	}

	return { ok: true, data: result as Record<ModelAlias, AliasConfig> };
}

// ── Parse profile file content ─────────────────────────────────────────────

export function parseProfileContent(content: string): {
	type: "builtin";
	profile: BuiltinProfile;
} | {
	type: "custom";
	data: Record<ModelAlias, AliasConfig>;
} | {
	type: "error";
	error: string;
} {
	const trimmed = content.trim();
	if (!trimmed) {
		return { type: "error", error: "Empty profile content" };
	}

	// Try bare built-in name first
	const builtin = findBuiltinProfile(trimmed);
	if (builtin) {
		return { type: "builtin", profile: builtin };
	}

	// Try JSON
	try {
		const parsed = JSON.parse(trimmed);
		const validation = validateCustomProfile(parsed);
		if (!validation.ok) {
			return { type: "error", error: validation.error };
		}
		return { type: "custom", data: validation.data };
	} catch (e) {
		return { type: "error", error: `Not a valid built-in profile name or JSON: ${e}` };
	}
}

// ── Cycle helpers ───────────────────────────────────────────────────────────

/**
 * Ordered list of all profiles that participate in the Alt+M cycle.
 * "custom" is included only when a valid custom override file exists.
 */
export function getCycleProfiles(hasCustom: boolean): ModelProfile[] {
	const list: ModelProfile[] = [...BUILTIN_PROFILES];
	if (hasCustom) list.push("custom");
	return list;
}

/**
 * Return the next profile in the Alt+M cycle.
 * Wraps custom → first builtin and last → first.
 */
export function getNextProfile(
	current: ModelProfile,
	hasCustom: boolean,
): ModelProfile {
	const cycle = getCycleProfiles(hasCustom);
	const idx = cycle.indexOf(current);
	if (idx === -1) return cycle[0];
	return cycle[(idx + 1) % cycle.length];
}

/**
 * Apply custom profile data into an existing modelMap (mutates in place).
 */
export function applyProfileData(
	modelMap: ModelMap,
	customData: Record<ModelAlias, AliasConfig>,
): void {
	for (const alias of BUILTIN_ALIASES) {
		modelMap[alias] = { ...customData[alias] };
	}
}

// ── Startup profile resolution ──────────────────────────────────────────────

export type PartialAliasMap = Partial<Record<ModelAlias, Partial<AliasConfig>>>;

export type StartupProfileSource = "env" | "file" | "session" | "temp" | "default";

function mergeInto(map: ModelMap, patch: PartialAliasMap): void {
	for (const alias of Object.keys(patch) as ModelAlias[]) {
		const update = patch[alias];
		if (update) map[alias] = { ...map[alias], ...update };
	}
}

/**
 * Resolve the model map at session_start.
 *
 * Precedence during /reload (reason === "reload"):
 *   env override > file override > session state > temp state > default
 * Precedence otherwise (startup, resume, new, fork):
 *   env override > session state > temp state > file override > default
 */
export function resolveStartupMap(
	input: {
		reason: string;
		envProfile?: BuiltinProfile | null;
		sessionMap?: PartialAliasMap | null;
		tempMap?: PartialAliasMap | null;
		fileProfile?: BuiltinProfile | null;
		fileCustomData?: Record<ModelAlias, AliasConfig> | null;
	},
	defaultMap: ModelMap,
	builtinMaps: Record<BuiltinProfile, ModelMap>,
): { modelMap: ModelMap; source: StartupProfileSource } {
	const { reason, envProfile, sessionMap, tempMap, fileProfile, fileCustomData } = input;
	const fileWins = reason === "reload" && !!(fileProfile || fileCustomData);

	if (envProfile) {
		const modelMap = structuredClone(defaultMap);
		mergeInto(modelMap, builtinMaps[envProfile]);
		return { modelMap, source: "env" };
	}

	if (fileWins && fileProfile) {
		return { modelMap: structuredClone(builtinMaps[fileProfile]), source: "file" };
	}

	if (fileWins && fileCustomData) {
		const modelMap = structuredClone(defaultMap);
		applyProfileData(modelMap, fileCustomData);
		return { modelMap, source: "file" };
	}

	if (sessionMap) {
		const modelMap = structuredClone(defaultMap);
		mergeInto(modelMap, sessionMap);
		return { modelMap, source: "session" };
	}

	if (tempMap) {
		const modelMap = structuredClone(defaultMap);
		mergeInto(modelMap, tempMap);
		return { modelMap, source: "temp" };
	}

	if (fileProfile) {
		return { modelMap: structuredClone(builtinMaps[fileProfile]), source: "file" };
	}

	if (fileCustomData) {
		const modelMap = structuredClone(defaultMap);
		applyProfileData(modelMap, fileCustomData);
		return { modelMap, source: "file" };
	}

	return { modelMap: structuredClone(defaultMap), source: "default" };
}

// ── Serialization ──────────────────────────────────────────────────────────

export function serializeBuiltinProfile(profile: BuiltinProfile): string {
	return profile;
}

export function serializeCustomProfile(data: Record<ModelAlias, AliasConfig>): string {
	const profile = Object.fromEntries(BUILTIN_ALIASES.map(alias => [alias, data[alias]]));
	return JSON.stringify(profile, null, 2) + "\n";
}
