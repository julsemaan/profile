import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Message } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "typebox";

const WORKER_TOOLS = ["read", "bash", "grep", "find", "ls", "edit", "write", "todo"];
const VALID_STATUSES = new Set([
	"completed",
	"already_addressed",
	"accepted",
	"needs_clarification",
	"failed",
]);

interface WorkerResult {
	status: "completed" | "already_addressed" | "accepted" | "needs_clarification" | "failed";
	reply: string;
	summary: string;
	questions: string[];
	changedFiles: string[];
}

interface ToolDetails {
	feedback: string;
	thread: {
		rootCommentId: number;
		path?: string;
		url?: string;
		text?: string;
	};
	result?: WorkerResult;
	rawOutput: string;
	exitCode: number;
	stderr: string;
}

function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}

	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) {
		return { command: process.execPath, args };
	}

	return { command: "pi", args };
}

async function writeTempFile(prefix: string, content: string): Promise<{ dir: string; filePath: string }> {
	const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix));
	const filePath = path.join(dir, "prompt.md");
	await fs.promises.writeFile(filePath, content, { encoding: "utf-8", mode: 0o600 });
	return { dir, filePath };
}

function getFinalAssistantText(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role !== "assistant") continue;
		for (const part of msg.content) {
			if (part.type === "text") return part.text.trim();
		}
	}
	return "";
}

function buildWorkerPrompt(params: {
	feedback: string;
	thread: { rootCommentId: number; path?: string; url?: string; text?: string };
	context?: string;
}): string {
	return [
		"You are a focused PR feedback worker.",
		"Review exactly one GitHub PR review thread, make any needed repo changes, and produce exactly one final JSON object.",
		"Do not ask the user questions directly. Do not use questionnaire. Do not post GitHub replies yourself.",
		"If you need more information, set status to needs_clarification and put concise follow-up questions in questions.",
		"If the feedback is already satisfied, use already_addressed.",
		"If you agree and intentionally applied or would apply the suggestion, use completed or accepted as appropriate.",
		"Return JSON only with this exact shape:",
		JSON.stringify(
			{
				status: "completed",
				reply: "short GitHub reply",
				summary: "what you checked or changed",
				questions: ["only when clarification is needed"],
				changedFiles: ["relative/path.ts"],
			},
			null,
			2,
		),
		"Feedback item:",
		params.feedback,
		"Relevant review thread:",
		JSON.stringify(params.thread, null, 2),
		params.context?.trim() ? `Extra context:\n${params.context.trim()}` : undefined,
	].filter(Boolean).join("\n\n");
}

function parseWorkerResult(output: string): WorkerResult {
	const parsed = JSON.parse(output) as Partial<WorkerResult>;
	if (!parsed || typeof parsed !== "object") throw new Error("Worker did not return an object.");
	if (typeof parsed.status !== "string" || !VALID_STATUSES.has(parsed.status)) {
		throw new Error("Worker returned an invalid status.");
	}
	if (typeof parsed.reply !== "string") throw new Error("Worker reply must be a string.");
	if (typeof parsed.summary !== "string") throw new Error("Worker summary must be a string.");
	if (!Array.isArray(parsed.questions) || parsed.questions.some((item) => typeof item !== "string")) {
		throw new Error("Worker questions must be a string array.");
	}
	if (!Array.isArray(parsed.changedFiles) || parsed.changedFiles.some((item) => typeof item !== "string")) {
		throw new Error("Worker changedFiles must be a string array.");
	}
	return {
		status: parsed.status as WorkerResult["status"],
		reply: parsed.reply,
		summary: parsed.summary,
		questions: parsed.questions,
		changedFiles: parsed.changedFiles,
	};
}

async function runWorker(
	prompt: string,
	cwd: string,
	signal: AbortSignal | undefined,
	onUpdate: ((partial: { content: Array<{ type: "text"; text: string }>; details: ToolDetails }) => void) | undefined,
	baseDetails: Omit<ToolDetails, "rawOutput" | "exitCode" | "stderr" | "result">,
): Promise<ToolDetails> {
	const temp = await writeTempFile("pi-review-feedback-", prompt);
	const args = [
		"--mode",
		"json",
		"-p",
		"--no-session",
		"--tools",
		WORKER_TOOLS.join(","),
		"--append-system-prompt",
		temp.filePath,
		"Handle the provided PR review feedback item.",
	];

	const messages: Message[] = [];
	let stderr = "";
	let exitCode = 0;

	try {
		exitCode = await new Promise<number>((resolve) => {
			const invocation = getPiInvocation(args);
			const proc = spawn(invocation.command, invocation.args, {
				cwd,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
			});
			let buffer = "";

			const processLine = (line: string) => {
				if (!line.trim()) return;
				try {
					const event = JSON.parse(line);
					if ((event.type === "message_end" || event.type === "tool_result_end") && event.message) {
						messages.push(event.message as Message);
						const rawOutput = getFinalAssistantText(messages);
						onUpdate?.({
							content: [{ type: "text", text: rawOutput || "(running...)" }],
							details: { ...baseDetails, rawOutput, exitCode: -1, stderr },
						});
					}
				} catch {
					// ignore non-json lines
				}
			};

			proc.stdout.on("data", (data) => {
				buffer += data.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";
				for (const line of lines) processLine(line);
			});

			proc.stderr.on("data", (data) => {
				stderr += data.toString();
			});

			proc.on("close", (code) => {
				if (buffer.trim()) processLine(buffer);
				resolve(code ?? 0);
			});

			proc.on("error", () => resolve(1));

			if (signal) {
				const killProc = () => {
					proc.kill("SIGTERM");
					setTimeout(() => {
						if (!proc.killed) proc.kill("SIGKILL");
					}, 5_000);
				};
				if (signal.aborted) killProc();
				else signal.addEventListener("abort", killProc, { once: true });
			}
		});
	} finally {
		await fs.promises.rm(temp.dir, { recursive: true, force: true });
	}

	const rawOutput = getFinalAssistantText(messages);
	let result: WorkerResult | undefined;
	try {
		result = parseWorkerResult(rawOutput);
	} catch (error) {
		if (exitCode === 0) exitCode = 1;
		stderr = [stderr.trim(), error instanceof Error ? error.message : String(error)].filter(Boolean).join("\n");
	}

	return { ...baseDetails, result, rawOutput, exitCode, stderr };
}

export default function registerReviewFeedbackSubagent(pi: ExtensionAPI) {
	pi.registerTool({
		name: "review_feedback_subagent",
		label: "Review Feedback Subagent",
		description: "Handle one PR review feedback item in a fresh pi subprocess and return strict JSON results.",
		promptSnippet: "Delegate one PR review feedback item to a fresh-context worker subprocess",
		parameters: Type.Object({
			feedback: Type.String({ description: "Short summary of the feedback item to handle" }),
			thread: Type.Object({
				rootCommentId: Type.Number({ description: "Root review comment id" }),
				path: Type.Optional(Type.String({ description: "Changed file path for the thread" })),
				url: Type.Optional(Type.String({ description: "GitHub thread URL" })),
				text: Type.Optional(Type.String({ description: "Relevant thread text" })),
			}),
			context: Type.Optional(Type.String({ description: "Optional extra context for the worker" })),
		}),
		async execute(_toolCallId, params, signal, onUpdate, ctx) {
			const details = await runWorker(
				buildWorkerPrompt(params),
				ctx.cwd,
				signal,
				onUpdate,
				{ feedback: params.feedback, thread: params.thread },
			);

			if (!details.result) {
				return {
					content: [{ type: "text", text: `Worker failed: ${details.stderr || "invalid worker output"}` }],
					details,
					isError: true,
				};
			}

			return {
				content: [{ type: "text", text: JSON.stringify(details.result, null, 2) }],
				details,
				isError: details.result.status === "failed",
			};
		},
		renderCall(args, theme) {
			const preview = typeof args.feedback === "string" ? args.feedback : "review feedback";
			return new Text(
				theme.fg("toolTitle", theme.bold("review_feedback_subagent ")) +
					theme.fg("muted", preview.length > 70 ? `${preview.slice(0, 70)}...` : preview),
				0,
				0,
			);
		},
		renderResult(result, _options, theme) {
			const details = result.details as ToolDetails | undefined;
			if (!details?.result) {
				return new Text(theme.fg("error", details?.stderr || "Worker failed"), 0, 0);
			}
			return new Text(
				[
					`${theme.fg("accent", details.result.status)} ${details.result.summary}`,
					details.result.reply ? theme.fg("muted", details.result.reply) : undefined,
				]
					.filter(Boolean)
					.join("\n"),
				0,
				0,
			);
		},
	});
}
