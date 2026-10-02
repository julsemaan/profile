import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";

const FAST_MODE_SERVICE_TIER = "priority";
const STATUS_KEY = "codex-fast-mode";
const STATE_TYPE = "codex-fast-mode";

interface ModelDescriptor {
	provider?: unknown;
	api?: unknown;
}

interface FastModeEntry {
	type?: string;
	customType?: string;
	data?: { enabled?: unknown };
}

export function supportsCodexFastMode(model: ModelDescriptor | undefined): boolean {
	return model?.provider === "openai-codex" && model.api === "openai-codex-responses";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function applyFastMode(payload: unknown, enabled: boolean): unknown {
	if (!enabled || !isRecord(payload)) return payload;
	return { ...payload, service_tier: FAST_MODE_SERVICE_TIER };
}

export function readFastModeFromEntries(entries: readonly FastModeEntry[]): boolean | undefined {
	let enabled: boolean | undefined;
	for (const entry of entries) {
		if (entry?.type !== "custom" || entry.customType !== STATE_TYPE) continue;
		if (typeof entry.data?.enabled === "boolean") enabled = entry.data.enabled;
	}
	return enabled;
}

export function readFastModeFromSessionFile(filePath: string | undefined): boolean | undefined {
	if (!filePath) return undefined;
	try {
		const entries: FastModeEntry[] = [];
		for (const line of fs.readFileSync(filePath, "utf-8").split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			try {
				entries.push(JSON.parse(trimmed) as FastModeEntry);
			} catch {
				// skip malformed line
			}
		}
		return readFastModeFromEntries(entries);
	} catch {
		return undefined;
	}
}

// Fast mode is off by default and stored in the session so /new keeps the setting,
// mirroring the build-plan model profile.
export default function codexFastMode(pi: ExtensionAPI) {
	let enabled = false;

	const updateStatus = (ctx: ExtensionContext) => {
		const status = supportsCodexFastMode(ctx.model)
			? enabled
				? "⚡ Codex fast"
				: "○ Codex standard"
			: undefined;
		ctx.ui.setStatus(STATUS_KEY, status);
	};

	const describeStatus = (ctx: ExtensionContext) => {
		if (!enabled) return "Codex fast mode is off.";
		if (supportsCodexFastMode(ctx.model)) return "Codex fast mode is on and active.";
		return "Codex fast mode is on, but the current model does not support it.";
	};

	pi.on("session_start", (event, ctx) => {
		const fromSession = readFastModeFromEntries(ctx.sessionManager.getEntries());
		if (fromSession !== undefined) {
			enabled = fromSession;
		} else if (event.reason === "new") {
			const fromPrevious = readFastModeFromSessionFile(event.previousSessionFile);
			if (fromPrevious !== undefined) enabled = fromPrevious;
			// No persisted entry: keep the running value on a same-instance /new.
			if (enabled) pi.appendEntry(STATE_TYPE, { enabled: true });
		} else {
			enabled = false;
		}
		updateStatus(ctx);
	});

	pi.on("model_select", (_event, ctx) => {
		updateStatus(ctx);
	});

	pi.on("before_provider_request", (event, ctx) => {
		if (!supportsCodexFastMode(ctx.model)) return;
		return applyFastMode(event.payload, enabled);
	});

	pi.registerCommand("fast", {
		description: "Control Codex fast mode: /fast on|off|status",
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase() || "status";

			if (action === "status") {
				ctx.ui.notify(describeStatus(ctx), "info");
				return;
			}

			if (action !== "on" && action !== "off") {
				ctx.ui.notify("Usage: /fast on|off|status", "error");
				return;
			}

			enabled = action === "on";
			pi.appendEntry(STATE_TYPE, { enabled });
			updateStatus(ctx);
			ctx.ui.notify(describeStatus(ctx), "info");
		},
	});
}
