import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export function ringTmuxBellOnce() {
	if (!process.env.TMUX && !process.env.TMUX_PANE) {
		return;
	}

	try {
		process.stdout.write("\x07");
	} catch {
		// best-effort only
	}
}

/**
 * No-op default export to allow clean loading as a pi extension.
 * tmux-bell.ts is utility module imported by other extensions.
 */
export default function (_pi: ExtensionAPI) {
	// No-op.
}
