/**
 * Caps every model's context window at 272K so no request enters the long-context tier.
 *
 * pi has no global max-context setting; compaction triggers on model.contextWindow, so
 * clamping the live model object is enough. Never raises a smaller window.
 */

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

export const MAX_CONTEXT_WINDOW = 272_000;

type ModelLike = { contextWindow: number };

export function capContextWindow(model: ModelLike | undefined): boolean {
	if (!model || model.contextWindow <= MAX_CONTEXT_WINDOW) {
		return false;
	}
	model.contextWindow = MAX_CONTEXT_WINDOW;
	return true;
}

function capActiveModel(ctx: ExtensionContext): void {
	capContextWindow(ctx.model);
}

export default function contextWindowCap(pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => capActiveModel(ctx));
	pi.on("model_select", (_event, ctx) => capActiveModel(ctx));
	// Safety net if a future path swaps the model object without model_select.
	pi.on("agent_start", (_event, ctx) => capActiveModel(ctx));
}
