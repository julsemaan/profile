import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const FAST_MODE_SERVICE_TIER = "priority";
const STATUS_KEY = "codex-fast-mode";

interface ModelDescriptor {
	provider?: unknown;
	api?: unknown;
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

// Fast mode is off by default and lives only in memory: each session starts standard.
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

	pi.on("session_start", (_event, ctx) => {
		enabled = false;
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
			updateStatus(ctx);
			ctx.ui.notify(describeStatus(ctx), "info");
		},
	});
}
