import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { ringTmuxBellOnce } from "./tmux-bell";

const QUESTION_BLOCKED_LABEL = "Waiting for user input";
const IDLE_DEBOUNCE_MS = 250;

function lastAssistantMessage(messages: unknown[]): any | undefined {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i] as any;
		if (message?.role === "assistant") {
			return message;
		}
	}
}

function agentEndedSuccessfully(event: any): boolean {
	const messages = Array.isArray(event?.messages) ? event.messages : [];
	const assistant = lastAssistantMessage(messages);
	if (!assistant) {
		return false;
	}

	return assistant.stopReason !== "error" && assistant.stopReason !== "aborted";
}

export default function completionBell(_pi: ExtensionAPI) {
	let bellTimer: ReturnType<typeof setTimeout> | undefined;
	let agentActive = false;
	let bellRungThisTurn = false;
	let blockedCount = 0;
	let questionBlockedThisTurn = false;

	function clearBellTimer() {
		if (bellTimer) {
			clearTimeout(bellTimer);
			bellTimer = undefined;
		}
	}

	function shouldSkipBell() {
		return bellRungThisTurn || blockedCount > 0 || questionBlockedThisTurn;
	}

	_pi.on("turn_start", () => {
		clearBellTimer();
	});

	_pi.events.on("herdr:blocked", (data) => {
		if (!data?.active) {
			blockedCount = Math.max(0, blockedCount - 1);
			return;
		}

		clearBellTimer();
		blockedCount += 1;
		if (data.label === QUESTION_BLOCKED_LABEL) {
			questionBlockedThisTurn = true;
		}
	});

	_pi.on("agent_start", () => {
		clearBellTimer();
		agentActive = true;
		bellRungThisTurn = false;
		blockedCount = 0;
		questionBlockedThisTurn = false;
	});

	_pi.on("agent_end", (event) => {
		if (!agentActive) {
			return;
		}

		agentActive = false;

		if (!agentEndedSuccessfully(event) || shouldSkipBell()) {
			return;
		}

		bellTimer = setTimeout(() => {
			bellTimer = undefined;
			if (agentActive || shouldSkipBell()) {
				return;
			}
			bellRungThisTurn = true;
			ringTmuxBellOnce();
		}, IDLE_DEBOUNCE_MS);
		bellTimer.unref?.();
	});

	_pi.on("session_shutdown", () => {
		clearBellTimer();
	});
}
