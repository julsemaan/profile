import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

export type ReviewStatusHint = "none" | "accepted" | "already_addressed";

export interface ReviewReply {
	databaseId: number;
	url: string;
	body: string;
	author: string;
	createdAt: string;
	replyTo: number | null;
}

export interface ReviewThread {
	threadId: string;
	rootCommentId: number;
	path: string;
	line: number | null;
	startLine: number | null;
	originalLine: number | null;
	originalStartLine: number | null;
	diffSide: string | null;
	isResolved: boolean;
	isOutdated: boolean;
	status: "open" | "resolved" | "outdated";
	statusHint: ReviewStatusHint;
	statusHintReason: string | null;
	url: string;
	rootAuthor: string;
	rootBody: string;
	replies: ReviewReply[];
	text: string;
}

export interface PRComment {
	commentId: number;
	body: string;
	author: string;
	createdAt: string;
	url: string;
	text: string; // formatted text for the agent
}

interface PullRequestRef {
	owner: string;
	repo: string;
	number: number;
	url?: string;
}

interface FetchDetails {
	pullRequest: {
		owner: string;
		repo: string;
		number: number;
		url: string;
		author: string;
	};
	threads: ReviewThread[];
	comments: PRComment[];
}

interface ReplyDetails {
	pullRequest: {
		owner: string;
		repo: string;
		number: number;
	};
	posted: Array<{
		rootCommentId: number;
		replyId: number;
		url: string;
	}>;
}

function parseGitHubRepo(remoteUrl: string): string | undefined {
	const sshMatch = remoteUrl.match(/^git@github\.com:([^/]+\/[^/]+?)(?:\.git)?$/);
	if (sshMatch) return sshMatch[1];

	const httpsMatch = remoteUrl.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
	if (httpsMatch) return httpsMatch[1];

	return undefined;
}

async function resolveGitHubRepo(pi: ExtensionAPI, cwd: string): Promise<{ owner: string; repo: string }> {
	const result = await pi.exec("git", ["remote", "-v"], { cwd, timeout: 5_000 });
	if (result.code !== 0) {
		throw new Error("Current working directory is not a git repository.");
	}

	for (const line of result.stdout.split("\n")) {
		const remoteUrl = line.trim().split(/\s+/)[1];
		if (!remoteUrl) continue;
		const parsed = parseGitHubRepo(remoteUrl);
		if (!parsed) continue;
		const [owner, repo] = parsed.split("/");
		return { owner, repo };
	}

	throw new Error("Current working directory is not a GitHub repository.");
}

async function resolvePullRequest(pi: ExtensionAPI, cwd: string, input: string): Promise<PullRequestRef> {
	const trimmed = input.trim();
	if (!trimmed) throw new Error("pr is required");

	const urlMatch = trimmed.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/.*)?$/i);
	if (urlMatch) {
		return {
			owner: urlMatch[1],
			repo: urlMatch[2],
			number: Number(urlMatch[3]),
			url: trimmed,
		};
	}

	const shortMatch = trimmed.match(/^([^/\s]+)\/([^#\s]+)#(\d+)$/);
	if (shortMatch) {
		return {
			owner: shortMatch[1],
			repo: shortMatch[2],
			number: Number(shortMatch[3]),
		};
	}

	if (/^\d+$/.test(trimmed)) {
		const repo = await resolveGitHubRepo(pi, cwd);
		return { ...repo, number: Number(trimmed) };
	}

	throw new Error(`Unsupported PR input: ${trimmed}`);
}

async function ghJson<T>(pi: ExtensionAPI, cwd: string, args: string[]): Promise<T> {
	const result = await pi.exec("gh", args, { cwd, timeout: 20_000 });
	if (result.code !== 0) {
		throw new Error(result.stderr.trim() || `gh exited with code ${result.code}`);
	}

	try {
		return JSON.parse(result.stdout) as T;
	} catch {
		throw new Error("Failed to parse gh JSON output.");
	}
}

function formatComment(author: string, body: string): string {
	return `${author}:\n${body.trim()}`;
}

function detectStatusHint(thread: {
	isResolved: boolean;
	isOutdated: boolean;
	replies: ReviewReply[];
	prAuthor: string;
}): { statusHint: ReviewStatusHint; statusHintReason: string | null } {
	const authorReplies = thread.replies.filter((reply) => reply.author.toLowerCase() === thread.prAuthor.toLowerCase());
	const combined = authorReplies.map((reply) => reply.body).join("\n");
	const acceptedPattern = /\b(fixed|addressed|updated|changed|implemented|done|good catch|thanks,? fixed|resolved)\b/i;
	const addressedPattern = /\b(already|existing|covered|handled|by design|duplicate|same as|intended|won't change|not changing)\b/i;

	if (addressedPattern.test(combined) || thread.isOutdated) {
		return {
			statusHint: "already_addressed",
			statusHintReason: thread.isOutdated ? "Thread is outdated." : "Author reply suggests it was already addressed.",
		};
	}

	if (acceptedPattern.test(combined) || (thread.isResolved && authorReplies.length > 0)) {
		return {
			statusHint: "accepted",
			statusHintReason: thread.isResolved ? "Thread is resolved after author follow-up." : "Author reply suggests the feedback was accepted.",
		};
	}

	return { statusHint: "none", statusHintReason: null };
}

async function fetchReviewThreads(pi: ExtensionAPI, cwd: string, pr: PullRequestRef): Promise<FetchDetails> {
	const reviewQuery = `
		query($owner: String!, $repo: String!, $number: Int!, $after: String) {
			repository(owner: $owner, name: $repo) {
				pullRequest(number: $number) {
					number
					url
					author { login }
					reviewThreads(first: 100, after: $after) {
						pageInfo { hasNextPage endCursor }
						nodes {
							id
							isResolved
							isOutdated
							path
							line
							startLine
							originalLine
							originalStartLine
							diffSide
							comments(first: 100) {
								nodes {
									databaseId
									url
									body
									createdAt
									author { login }
									replyTo { databaseId }
								}
							}
						}
					}
				}
			}
		}
	`;

	const commentQuery = `
		query($owner: String!, $repo: String!, $number: Int!, $after: String) {
			repository(owner: $owner, name: $repo) {
				pullRequest(number: $number) {
					comments(first: 100, after: $after) {
						pageInfo { hasNextPage endCursor }
						nodes {
							databaseId
							body
							createdAt
							author { login }
							url
						}
					}
				}
			}
		}
	`;

	const threadNodes: any[] = [];
	const prComments: PRComment[] = [];
	let after: string | undefined;
	let prUrl = pr.url ?? "";
	let prAuthor = "unknown";

	// Fetch review threads
	while (true) {
		const payload = await ghJson<any>(pi, cwd, [
			"api",
			"graphql",
			"-f",
			`query=${reviewQuery}`,
			"-F",
			`owner=${pr.owner}`,
			"-F",
			`repo=${pr.repo}`,
			"-F",
			`number=${pr.number}`,
			...(after ? ["-F", `after=${after}`] : []),
		]);

		const pullRequest = payload?.data?.repository?.pullRequest;
		if (!pullRequest) {
			throw new Error(`Pull request not found: ${pr.owner}/${pr.repo}#${pr.number}`);
		}

		prUrl = pullRequest.url;
		prAuthor = pullRequest.author?.login ?? "unknown";
		const reviewThreads = pullRequest.reviewThreads;
		threadNodes.push(...(reviewThreads?.nodes ?? []));
		if (!reviewThreads?.pageInfo?.hasNextPage) break;
		after = reviewThreads.pageInfo.endCursor;
	}

	// Fetch PR comments (general comments on the PR, not review threads)
	after = undefined;
	while (true) {
		const payload = await ghJson<any>(pi, cwd, [
			"api",
			"graphql",
			"-f",
			`query=${commentQuery}`,
			"-F",
			`owner=${pr.owner}`,
			"-F",
			`repo=${pr.repo}`,
			"-F",
			`number=${pr.number}`,
			...(after ? ["-F", `after=${after}`] : []),
		]);

		const pullRequest = payload?.data?.repository?.pullRequest;
		if (!pullRequest) break;

		const comments = pullRequest.comments;
		for (const comment of comments?.nodes ?? []) {
			if (typeof comment?.databaseId !== "number") continue;
			prComments.push({
				commentId: comment.databaseId,
				body: comment.body ?? "",
				author: comment.author?.login ?? "unknown",
				createdAt: comment.createdAt,
				url: comment.url,
				text: formatComment(comment.author?.login ?? "unknown", comment.body ?? ""),
			});
		}
		if (!comments?.pageInfo?.hasNextPage) break;
		after = comments.pageInfo.endCursor;
	}

	const threads: ReviewThread[] = threadNodes
		.map((thread) => {
			const comments = (thread.comments?.nodes ?? []).filter((comment: any) => typeof comment?.databaseId === "number");
			const root = comments.find((comment: any) => !comment.replyTo?.databaseId) ?? comments[0];
			if (!root) return undefined;

			const replies: ReviewReply[] = comments
				.filter((comment: any) => comment.databaseId !== root.databaseId)
				.map((comment: any) => ({
					databaseId: comment.databaseId,
					url: comment.url,
					body: comment.body ?? "",
					author: comment.author?.login ?? "unknown",
					createdAt: comment.createdAt,
					replyTo: comment.replyTo?.databaseId ?? null,
				}));

			const hint = detectStatusHint({
				isResolved: Boolean(thread.isResolved),
				isOutdated: Boolean(thread.isOutdated),
				replies,
				prAuthor,
			});
			const status = thread.isOutdated ? "outdated" : thread.isResolved ? "resolved" : "open";
			const text = [formatComment(root.author?.login ?? "unknown", root.body ?? "")]
				.concat(replies.map((reply) => formatComment(reply.author, reply.body)))
				.join("\n\n");

			return {
				threadId: thread.id,
				rootCommentId: root.databaseId,
				path: thread.path ?? "",
				line: typeof thread.line === "number" ? thread.line : null,
				startLine: typeof thread.startLine === "number" ? thread.startLine : null,
				originalLine: typeof thread.originalLine === "number" ? thread.originalLine : null,
				originalStartLine: typeof thread.originalStartLine === "number" ? thread.originalStartLine : null,
				diffSide: thread.diffSide ?? null,
				isResolved: Boolean(thread.isResolved),
				isOutdated: Boolean(thread.isOutdated),
				status,
				statusHint: hint.statusHint,
				statusHintReason: hint.statusHintReason,
				url: root.url,
				rootAuthor: root.author?.login ?? "unknown",
				rootBody: root.body ?? "",
				replies,
				text,
			} satisfies ReviewThread;
		})
		.filter((thread): thread is ReviewThread => Boolean(thread));

	return {
		pullRequest: {
			owner: pr.owner,
			repo: pr.repo,
			number: pr.number,
			url: prUrl,
			author: prAuthor,
		},
		threads,
		comments: prComments,
	};
}

async function postReviewReplies(
	pi: ExtensionAPI,
	cwd: string,
	pr: PullRequestRef,
	rootCommentIds: number[],
	body: string,
): Promise<ReplyDetails> {
	const posted: ReplyDetails["posted"] = [];

	for (const rootCommentId of Array.from(new Set(rootCommentIds))) {
		const response = await ghJson<any>(pi, cwd, [
			"api",
			"-X",
			"POST",
			`repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/comments/${rootCommentId}/replies`,
			"-f",
			`body=${body}`,
		]);
		posted.push({
			rootCommentId,
			replyId: response.id,
			url: response.html_url ?? response.url,
		});
	}

	return {
		pullRequest: {
			owner: pr.owner,
			repo: pr.repo,
			number: pr.number,
		},
		posted,
	};
}

async function postCommentReplies(
	pi: ExtensionAPI,
	cwd: string,
	pr: PullRequestRef,
	commentIds: number[],
	body: string,
): Promise<ReplyDetails> {
	const posted: ReplyDetails["posted"] = [];

	for (const commentId of Array.from(new Set(commentIds))) {
		const originalComment = await ghJson<any>(pi, cwd, [
			"api",
			`repos/${pr.owner}/${pr.repo}/issues/comments/${commentId}`,
		]);
		const author = originalComment.user?.login;
		const replyBody = author && !body.includes(`@${author}`) ? `@${author} ${body}` : body;
		const response = await ghJson<any>(pi, cwd, [
			"api",
			"-X",
			"POST",
			`repos/${pr.owner}/${pr.repo}/issues/${pr.number}/comments`,
			"-f",
			`body=${replyBody}`,
		]);
		posted.push({
			rootCommentId: commentId,
			replyId: response.id,
			url: response.html_url ?? response.url,
		});
	}

	return {
		pullRequest: {
			owner: pr.owner,
			repo: pr.repo,
			number: pr.number,
		},
		posted,
	};
}

export default function registerGitHubReviewTools(pi: ExtensionAPI) {
	pi.registerTool({
		name: "github_pr_review_fetch",
		label: "GitHub PR Review Fetch",
		description: "Fetch GitHub PR review threads and comments, normalizing them into reply-ready objects.",
		promptSnippet: "Fetch GitHub PR review threads and comments with ids, file info, URLs, replies, and status hints",
		parameters: Type.Object({
			pr: Type.String({ description: "Pull request number, URL, or owner/repo#number" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const details = await fetchReviewThreads(pi, ctx.cwd, await resolvePullRequest(pi, ctx.cwd, params.pr));
			return {
				content: [{ type: "text", text: `Fetched ${details.threads.length} review thread(s) and ${details.comments.length} comment(s) for ${details.pullRequest.owner}/${details.pullRequest.repo}#${details.pullRequest.number}.` }],
				details,
			};
		},
	});

	pi.registerTool({
		name: "github_pr_review_reply",
		label: "GitHub PR Review Reply",
		description: "Post one reply body to one or many GitHub PR review-thread root comment ids.",
		promptSnippet: "Reply to one or many GitHub PR review threads by root comment id",
		parameters: Type.Object({
			pr: Type.String({ description: "Pull request number, URL, or owner/repo#number" }),
			rootCommentIds: Type.Array(Type.Number(), {
				description: "Root review comment ids to reply to",
			}),
			body: Type.String({ description: "Reply body to post" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const text = params.body.trim();
			if (params.rootCommentIds.length === 0) {
				return {
					content: [{ type: "text", text: "Error: rootCommentIds is required" }],
					details: { error: "rootCommentIds is required" },
					isError: true,
				};
			}
			if (!text) {
				return {
					content: [{ type: "text", text: "Error: body is required" }],
					details: { error: "body is required" },
					isError: true,
				};
			}
			const details = await postReviewReplies(
				pi,
				ctx.cwd,
				await resolvePullRequest(pi, ctx.cwd, params.pr),
				params.rootCommentIds,
				text,
			);
			return {
				content: [{ type: "text", text: `Posted ${details.posted.length} review repl${details.posted.length === 1 ? "y" : "ies"}.` }],
				details,
			};
		},
	});

	pi.registerTool({
		name: "github_pr_comment_reply",
		label: "GitHub PR Comment Reply",
		description: "Post one or many follow-up PR comments addressing general PR comment ids (non-review comments).",
		promptSnippet: "Post follow-up PR comments addressing one or many general PR comment ids",
		parameters: Type.Object({
			pr: Type.String({ description: "Pull request number, URL, or owner/repo#number" }),
			commentIds: Type.Array(Type.Number(), {
				description: "PR comment ids to reply to",
			}),
			body: Type.String({ description: "Reply body to post" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const text = params.body.trim();
			if (params.commentIds.length === 0) {
				return {
					content: [{ type: "text", text: "Error: commentIds is required" }],
					details: { error: "commentIds is required" },
					isError: true,
				};
			}
			if (!text) {
				return {
					content: [{ type: "text", text: "Error: body is required" }],
					details: { error: "body is required" },
					isError: true,
				};
			}
			const details = await postCommentReplies(
				pi,
				ctx.cwd,
				await resolvePullRequest(pi, ctx.cwd, params.pr),
				params.commentIds,
				text,
			);
			return {
				content: [{ type: "text", text: `Posted ${details.posted.length} comment repl${details.posted.length === 1 ? "y" : "ies"}.` }],
				details,
			};
		},
	});
}
