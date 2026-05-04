import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const PROVIDER = "openai-codex";
const MODEL_ID = "gpt-5.4";

export default function paidModelCommand(pi: ExtensionAPI) {
	pi.registerCommand("paid-model", {
		description: `Switch to ${PROVIDER}/${MODEL_ID}`,
		handler: async (_args, ctx) => {
			const model = ctx.modelRegistry.find(PROVIDER, MODEL_ID);
			if (!model) {
				ctx.ui.notify(`Model ${PROVIDER}/${MODEL_ID} not found`, "warning");
				return;
			}

			const success = await pi.setModel(model);
			if (!success) {
				ctx.ui.notify(`No API key available for ${PROVIDER}/${MODEL_ID}`, "warning");
				return;
			}

			ctx.ui.notify(`Switched to ${PROVIDER}/${MODEL_ID}`, "info");
		},
	});
}
