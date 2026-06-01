/**
 * Mode registry - discovers, validates, and serves mode configs.
 *
 * Built-in modes (build, plan) + extra modes from .pi/modes/*.md.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir, parseFrontmatter } from "@mariozechner/pi-coding-agent";

export type ModeAccess = "build" | "read-only";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface ModeConfig {
	name: string;
	description: string;
	/** Tools available in this mode. If not set, all registered tools are exposed. */
	tools?: string[];
	/** Model alias or direct provider/model ref. */
	model?: string;
	/** Thinking level for this mode. */
	thinking?: ThinkingLevel;
	/** Access level: "build" (full) or "read-only". */
	access: ModeAccess;
	/** When true, bash commands are restricted to safe allowlist. */
	safeBashOnly: boolean;
	/** Optional status bar label override. */
	statusLabel?: string;
	/** Optional status bar icon override. */
	statusIcon?: string;
	/** Slash command name (e.g. "brainstorm"). Auto-derived from name if absent. */
	command?: string;
	/** System prompt appended to base system prompt. */
	systemPrompt: string;
	/** Source file path for file-backed modes. */
	filePath?: string;
}

const VALID_THINKING_LEVELS = new Set<string>([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
]);

const VALID_ACCESS = new Set<string>(["build", "read-only"]);

// ── Built-in defaults (tool arrays removed — all tools inherited from pi.getAllTools())

const BUILD_INSTRUCTIONS = `
IMPORTANT: You are in BUILD MODE.
- You may edit files and implement the requested changes.
- You may look up online resources and documentation using bash when helpful.
- Keep changes focused and minimal.
- Read files before editing them.
- After making changes, validate them when practical.
- Summarize what changed and any follow-up work.
- Start by creating a clear, multi-step todo list from the request or plan before any other work.
- After creating the todo list, continue working in the same turn — do not stop after todo creation.
  Immediately start the first concrete step (read files, inspect code, or begin implementation).
`;

const PLAN_INSTRUCTIONS = `
IMPORTANT: You are in PLAN MODE.
- Read-only mode: enforced by instruction, not tool restriction.
- All tools may be available \u2014 do not misuse them.
- Never use \`edit\` or \`write\`.
- Never use \`bash\` for mutating commands.
- Never change git state or working tree.
- Never post PR reviews, comments, or replies.
- Never use \`subagent\` to implement or cause side effects.
- Use tools only for inspection, evidence gathering, research, and planning.
- If requirements are ambiguous, ask clarifying questions.
- End with a concrete implementation plan.
- Prefer a numbered plan with files to change and validation steps.
- After creating the todo list, continue working in the same turn — do not stop after todo creation.
  Immediately start the first inspection step (read files, grep code, gather evidence).
`;

export const BUILTIN_MODES: Record<string, Omit<ModeConfig, "name">> = {
	build: {
		description: "Implementation mode - full tool access",
		access: "build",
		safeBashOnly: false,
		systemPrompt: BUILD_INSTRUCTIONS,
		statusIcon: "⚒",
		command: "build",
	},
	plan: {
		description: "Read-only planning mode",
		access: "read-only",
		safeBashOnly: true,
		systemPrompt: PLAN_INSTRUCTIONS,
		statusIcon: "⏸",
		command: "plan",
	},
};

// ── File-backed mode loader ────────────────────────────────────────────────

function loadModeFromFile(filePath: string): ModeConfig | { error: string } {
	let content: string;
	try {
		content = fs.readFileSync(filePath, "utf-8");
	} catch (e) {
		return { error: `Cannot read ${filePath}: ${e}` };
	}

	let frontmatter: Record<string, unknown>;
	let body: string;
	try {
		const parsed = parseFrontmatter<Record<string, unknown>>(content);
		frontmatter = parsed.frontmatter;
		body = parsed.body.trim();
	} catch (e) {
		return { error: `Invalid frontmatter in ${filePath}: ${e}` };
	}

	// ── Required fields ──
	const name = typeof frontmatter.name === "string" ? frontmatter.name.trim() : "";
	if (!name) {
		return { error: `Mode file ${filePath}: missing or empty "name" in frontmatter` };
	}

	const description =
		typeof frontmatter.description === "string" ? frontmatter.description.trim() : "";
	if (!description) {
		return { error: `Mode file ${filePath}: missing or empty "description" in frontmatter` };
	}

	// ── Optional fields with defaults ──

	const accessRaw =
		typeof frontmatter.access === "string" ? frontmatter.access.trim().toLowerCase() : "read-only";
	if (!VALID_ACCESS.has(accessRaw)) {
		return {
			error: `Mode file ${filePath}: invalid access "${accessRaw}". Must be "build" or "read-only".`,
		};
	}
	const access = accessRaw as ModeAccess;

	const safeBashOnly =
		typeof frontmatter.safeBashOnly === "boolean"
			? frontmatter.safeBashOnly
			: access === "read-only";

	const toolsRaw =
		typeof frontmatter.tools === "string"
			? frontmatter.tools
				.split(",")
				.map((t) => t.trim())
				.filter(Boolean)
			: undefined;

	const model =
		typeof frontmatter.model === "string" ? frontmatter.model.trim() : undefined;

	let thinking: ThinkingLevel | undefined;
	if (typeof frontmatter.thinking === "string") {
		const tl = frontmatter.thinking.trim().toLowerCase();
		if (VALID_THINKING_LEVELS.has(tl)) {
			thinking = tl as ThinkingLevel;
		}
	}

	const statusIcon =
		typeof frontmatter.statusIcon === "string" ? frontmatter.statusIcon.trim() : undefined;

	const statusLabel =
		typeof frontmatter.statusLabel === "string" ? frontmatter.statusLabel.trim() : undefined;

	const command =
		typeof frontmatter.command === "string"
			? frontmatter.command.trim().toLowerCase()
			: name.toLowerCase().replace(/\s+/g, "-");

	return {
		name,
		description,
		tools: toolsRaw,
		model,
		thinking,
		access,
		safeBashOnly,
		statusLabel,
		statusIcon,
		command,
		systemPrompt: body || "",
		filePath,
	};
}

// ── Discovery ──────────────────────────────────────────────────────────────

function findProjectPiDir(cwd: string): string | null {
	let dir = cwd;
	while (true) {
		const candidate = path.join(dir, ".pi");
		if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
			return candidate;
		}
		const parent = path.dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

/**
 * Return the global modes directory (~/.pi/agent/modes/) if it exists.
 * The install script puts .pi/modes/*.md into ~/.pi/agent/modes/.
 */
function getGlobalModesDir(): string | null {
	try {
		const agentDir = getAgentDir();
		// getAgentDir returns ~/.pi/agent
		const modesDir = path.join(agentDir, "modes");
		return isDirectory(modesDir) ? modesDir : null;
	} catch {
		return null;
	}
}

interface DiscoveryResult {
	modes: ModeConfig[];
	warnings: string[];
}

function discoverModesFromDir(modesDir: string): { modes: ModeConfig[]; warnings: string[] } {
	const modes: ModeConfig[] = [];
	const warnings: string[] = [];

	if (!isDirectory(modesDir)) return { modes, warnings };

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(modesDir, { withFileTypes: true });
	} catch {
		return { modes, warnings };
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(modesDir, entry.name);
		const result = loadModeFromFile(filePath);

		if ("error" in result) {
			warnings.push(result.error);
			continue;
		}

		modes.push(result);
	}

	return { modes, warnings };
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface ModeRegistry {
	/** All known modes keyed by name (lowercase). */
	byName: Map<string, ModeConfig>;
	/** All known modes keyed by command (lowercase). */
	byCommand: Map<string, ModeConfig>;
	/** Warnings from loading file-backed modes. */
	warnings: string[];
	/** Names of built-in modes. */
	builtinNames: Set<string>;
}

/**
 * Discover all modes: built-in + file-backed from .pi/modes/*.md.
 * File-backed modes override built-in modes with same name (with warning).
 *
 * Discovery order (last wins for same-name modes):
 * 1. Built-in modes (build, plan)
 * 2. Global modes from ~/.pi/modes/
 * 3. Project-local modes from cwd-walk .pi/modes/ (highest priority)
 */
export function discoverModes(cwd: string): ModeRegistry {
	const byName = new Map<string, ModeConfig>();
	const byCommand = new Map<string, ModeConfig>();
	const warnings: string[] = [];
	const builtinNames = new Set<string>();

	// 1. Register built-ins
	for (const [name, config] of Object.entries(BUILTIN_MODES)) {
		const mode: ModeConfig = { name, ...config };
		byName.set(name, mode);

		const cmd = mode.command ?? name;
		if (!byCommand.has(cmd)) {
			byCommand.set(cmd, mode);
		}

		builtinNames.add(name);
	}

	// 2. Discover global modes (~/.pi/modes/)
	const globalModesDir = getGlobalModesDir();
	if (globalModesDir) {
		const globalResult = discoverModesFromDir(globalModesDir);
		for (const w of globalResult.warnings) {
			warnings.push(w);
		}
		for (const mode of globalResult.modes) {
			const nameKey = mode.name.toLowerCase();
			if (byName.has(nameKey)) {
				warnings.push(
					`Mode "${mode.name}" from ${mode.filePath} overrides built-in mode with same name`,
				);
			}
			byName.set(nameKey, mode);
			registerModeCommand(byCommand, mode, nameKey, warnings);
		}
	}

	// 3. Discover project-local modes (cwd-walk) — highest priority
	const piDir = findProjectPiDir(cwd);
	if (piDir) {
		const modesDir = path.join(piDir, "modes");
		const fileResult = discoverModesFromDir(modesDir);

		for (const w of fileResult.warnings) {
			warnings.push(w);
		}

		for (const mode of fileResult.modes) {
			const nameKey = mode.name.toLowerCase();

			if (byName.has(nameKey)) {
				warnings.push(
					`Mode "${mode.name}" from ${mode.filePath} overrides existing mode with same name`,
				);
			}

			byName.set(nameKey, mode);
			registerModeCommand(byCommand, mode, nameKey, warnings);
		}
	}

	return { byName, byCommand, warnings, builtinNames };
}

function registerModeCommand(
	byCommand: Map<string, ModeConfig>,
	mode: ModeConfig,
	nameKey: string,
	warnings: string[],
) {
	const cmd = mode.command ?? nameKey;
	if (byCommand.has(cmd) && byCommand.get(cmd)!.name !== mode.name) {
		warnings.push(
			`Command "/${cmd}" from mode "${mode.name}" (${mode.filePath}) collides with existing command for mode "${byCommand.get(cmd)!.name}". Skipping command registration.`,
		);
	} else {
		byCommand.set(cmd, mode);
	}
}

/**
 * Find the .pi/modes directory for the given cwd, if it exists.
 * Falls back to the global modes directory (~/.pi/modes/).
 */
export function findModesDir(cwd: string): string | null {
	const piDir = findProjectPiDir(cwd);
	if (piDir) {
		const modesDir = path.join(piDir, "modes");
		if (isDirectory(modesDir)) return modesDir;
	}
	// Fall back to global modes directory
	return getGlobalModesDir();
}

/**
 * No-op default export to allow clean loading as a pi extension.
 * modes.ts is a utility module imported by other extensions.
 */
export default function (_pi: ExtensionAPI) {
	// This extension registers no commands, tools, or handlers.
	// It provides the mode registry functions used by build-plan-mode.ts.
}
