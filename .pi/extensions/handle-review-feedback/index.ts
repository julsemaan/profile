import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import registerGitHubReviewTools from "./github.js";
import registerReviewFeedbackSubagent from "./subagent.js";

export default function handleReviewFeedback(pi: ExtensionAPI) {
	registerGitHubReviewTools(pi);
	registerReviewFeedbackSubagent(pi);
}
