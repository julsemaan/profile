import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const UNSLOP_MARKER = "<!-- profile:always-on-unslop -->";
const extensionPath = fs.realpathSync(fileURLToPath(import.meta.url));
const UNSLOP_PROMPT = fs.readFileSync(path.join(path.dirname(extensionPath), "UNSLOP.md"), "utf8");
const UNSLOP_BLOCK = `${UNSLOP_MARKER}\n\n${UNSLOP_PROMPT}`;

export default function alwaysOnUnslop(pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event) => {
		if (event.systemPrompt.includes(UNSLOP_BLOCK)) return;

		return {
			systemPrompt: `${event.systemPrompt}\n\n${UNSLOP_BLOCK}`,
		};
	});
}
