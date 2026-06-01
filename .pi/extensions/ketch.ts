import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_BYTES = 50 * 1024;
const MAX_LINES = 2000;

// ─── Shared helper: call ketch with --json ───────────────────────────────────

interface KetchExecResult {
	parsed: unknown;
	stderr: string | undefined;
	killed: boolean;
}

async function ketchExec(
	pi: ExtensionAPI,
	args: string[],
	ctx: { cwd: string },
	signal?: AbortSignal,
): Promise<KetchExecResult> {
	const result = await pi.exec("ketch", [...args, "--json"], {
		cwd: ctx.cwd,
		signal,
		timeout: 120_000,
	});

	let parsed: unknown = null;
	try {
		parsed = JSON.parse(result.stdout);
	} catch {
		// parse failure — return raw output for error handling
	}

	if (result.code !== 0 && !parsed) {
		const errMsg =
			result.stderr?.trim() || result.stdout?.trim() || `ketch exited ${result.code}`;
		throw new Error(errMsg);
	}

	return { parsed, stderr: result.stderr?.trim(), killed: result.killed };
}

// ─── Truncation helpers ──────────────────────────────────────────────────────

interface TruncationInfo {
	truncated: boolean;
	rawText: string;
	savedTo?: string;
}

async function maybeTruncate(rawText: string): Promise<TruncationInfo> {
	const lines = rawText.split("\n");
	if (rawText.length <= MAX_BYTES && lines.length <= MAX_LINES) {
		return { truncated: false, rawText };
	}

	// Truncate to MAX_LINES, bounded by MAX_BYTES
	let byteCount = 0;
	const truncatedLines: string[] = [];
	for (const line of lines) {
		const lineBytes = Buffer.byteLength(line, "utf8") + 1; // +1 for newline
		if (truncatedLines.length >= MAX_LINES || byteCount + lineBytes > MAX_BYTES) break;
		truncatedLines.push(line);
		byteCount += lineBytes;
	}

	// Save full output to temp file
	const tmpDir = await mkdtemp(join(tmpdir(), "ketch-"));
	const tmpFile = join(tmpDir, "full-output.json");
	await writeFile(tmpFile, rawText, "utf8");

	return {
		truncated: true,
		rawText: truncatedLines.join("\n"),
		savedTo: tmpFile,
	};
}

// ─── Format helpers ──────────────────────────────────────────────────────────

function formatSearchResults(json: unknown): string {
	if (!json || typeof json !== "object") return String(json ?? "empty");
	const arr = Array.isArray(json) ? json : [json];
	const lines: string[] = [];
	for (let i = 0; i < arr.length; i++) {
		const item = arr[i] as Record<string, unknown>;
		const title = String(item.title ?? item.name ?? "?");
		const url = String(item.url ?? item.link ?? "");
		const snippet = String(item.snippet ?? item.description ?? "");
		lines.push(`${i + 1}. **${title}**`);
		if (url) lines.push(`   URL: ${url}`);
		if (snippet) lines.push(`   ${snippet}`);
		lines.push("");
	}
	return lines.join("\n").trim() || "(no results)";
}

function formatScrapeResult(json: unknown): string {
	if (!json || typeof json !== "object") return String(json ?? "empty");

	const pages = Array.isArray(json) ? json : [json];
	const parts: string[] = [];

	for (const page of pages) {
		const p = page as Record<string, unknown>;
		const title = String(p.title ?? p.url ?? "?");
		const url = String(p.url ?? "");
		const wordCount = p.wordCount ?? p.word_count ?? "";
		const content = String(p.content ?? p.markdown ?? p.text ?? "");

		parts.push(`## ${title}`);
		if (url) parts.push(`URL: ${url}`);
		if (wordCount) parts.push(`Words: ${wordCount}`);
		parts.push("");
		parts.push(content.slice(0, 5000));
		parts.push("");
	}

	return parts.join("\n").trim() || "(no content)";
}

function formatCodeResults(json: unknown): string {
	if (!json || typeof json !== "object") return String(json ?? "empty");
	const arr = Array.isArray(json) ? json : [json];
	const lines: string[] = [];
	for (let i = 0; i < arr.length; i++) {
		const item = arr[i] as Record<string, unknown>;
		const repo = String(item.repo ?? item.repository ?? "");
		const path = String(item.path ?? item.file ?? "");
		const line = String(item.line ?? item.lineNumber ?? "");
		const stars = String(item.stars ?? item.stargazers ?? "");
		const snippet = String(item.snippet ?? item.content ?? item.code ?? "");
		const url = String(item.url ?? "");

		lines.push(`${i + 1}. **${repo}** ${path}${line ? `:${line}` : ""}`);
		if (stars) lines.push(`   ⭐ ${stars}`);
		if (url) lines.push(`   URL: ${url}`);
		if (snippet) lines.push(`   \`\`\`\n${snippet.slice(0, 2000)}\n\`\`\``);
		lines.push("");
	}
	return lines.join("\n").trim() || "(no results)";
}

function formatDocsResults(json: unknown): string {
	if (!json || typeof json !== "object") return String(json ?? "empty");
	const arr = Array.isArray(json) ? json : [json];
	const lines: string[] = [];
	for (let i = 0; i < arr.length; i++) {
		const item = arr[i] as Record<string, unknown>;
		const library = String(item.library ?? item.package ?? "");
		const breadcrumb = String(item.breadcrumb ?? item.path ?? item.title ?? "");
		const snippet = String(item.snippet ?? item.content ?? item.text ?? "");
		const url = String(item.url ?? "");

		lines.push(`${i + 1}. **${library}** — ${breadcrumb}`);
		if (url) lines.push(`   URL: ${url}`);
		if (snippet) lines.push(`   ${snippet.slice(0, 2000)}`);
		lines.push("");
	}
	return lines.join("\n").trim() || "(no results)";
}

export default function ketchExtension(pi: ExtensionAPI) {
	// ─── Shared tool registration helper ────────────────────────────────────

	type FormatFn = (json: unknown) => string;

	function registerTool(
		name: string,
		label: string,
		description: string,
		promptSnippet: string,
		buildArgs: (params: Record<string, unknown>) => string[],
		format: FormatFn,
		parameters: Record<string, unknown>,
	) {
		pi.registerTool({
			name,
			label,
			description,
			promptSnippet,
			promptGuidelines: [
				`Use ${name} for external research via ketch CLI.`,
				"If a ketch tool fails with a missing API key, tell the user to configure the backend via `ketch config`.",
				"For web search, try switching backends if one fails (e.g. brave → ddg).",
				"ketch code search (grepapp backend) works zero-config.",
			],
			parameters: Type.Object(parameters),
			async execute(
				_toolCallId: string,
				params: Record<string, unknown>,
				signal: AbortSignal | undefined,
				onUpdate:
					| ((update: {
							content: { type: "text"; text: string }[];
					  }) => void)
					| undefined,
				ctx: { cwd: string },
			) {
				onUpdate?.({
					content: [{ type: "text", text: `Running ketch ${name}...` }],
				});

				const args = buildArgs(params);
				const { parsed, stderr, killed } = await ketchExec(
					pi,
					args,
					ctx,
					signal,
				);

				const formatted = format(parsed);

				const details: Record<string, unknown> = {
					json: parsed,
					killed,
				};
				if (stderr) details.warnings = stderr;

				const truncated = await maybeTruncate(formatted);
				let summary = truncated.rawText;

				if (killed) {
					summary = "(ketch was killed due to timeout)\n\n" + summary;
				}

				if (truncated.truncated) {
					summary +=
						`\n\n---\n_Output truncated. Full result saved to \`${truncated.savedTo}\`._`;
					details.fullOutputPath = truncated.savedTo;
				}

				return {
					content: [{ type: "text" as const, text: summary }],
					details,
				};
			},
		});
	}

	// ─── Tool 1: ketch_web_search ───────────────────────────────────────────

	registerTool(
		"ketch_web_search",
		"Web Search",
		"Search the web using ketch. Returns titles, URLs, descriptions. " +
			"Use --scrape flag to fetch full page content inline.",
		"Use ketch_web_search for web research with multiple backends",
		(params) => {
			const args = ["search", String(params.query)];
			const limit = params.limit as number | undefined;
			if (limit !== undefined) args.push("--limit", String(limit));
			if (params.backend) args.push("--backend", String(params.backend));
			if (params.scrape) args.push("--scrape");
			if (params.trim) args.push("--trim");
			const maxChars = params.maxChars as number | undefined;
			if (maxChars !== undefined) args.push("--max-chars", String(maxChars));
			return args;
		},
		formatSearchResults,
		{
			query: Type.String({ description: "Search query" }),
			limit: Type.Optional(
				Type.Number({
					description: "Number of results (default 5)",
					default: 5,
				}),
			),
			backend: Type.Optional(
				StringEnum(["brave", "ddg", "searxng"] as const, {
					description: "Search backend (default: from ketch config)",
				}),
			),
			scrape: Type.Optional(
				Type.Boolean({
					description: "Fetch full page content for each result",
				}),
			),
			trim: Type.Optional(
				Type.Boolean({
					description: "Trim page content to snippets",
				}),
			),
			maxChars: Type.Optional(
				Type.Number({
					description: "Maximum characters per page",
				}),
			),
		},
	);

	// ─── Tool 2: ketch_scrape ───────────────────────────────────────────────

	registerTool(
		"ketch_scrape",
		"Scrape URLs",
		"Scrape URLs to clean markdown content using ketch. " +
			"Supports multi-URL concurrent fetch with optional CSS selector.",
		"Use ketch_scrape to fetch full page content from known URLs",
		(params) => {
			const urls = params.urls as string[];
			const args = ["scrape", ...urls];
			if (params.selector)
				args.push("--selector", String(params.selector));
			if (params.trim) args.push("--trim");
			const maxChars = params.maxChars as number | undefined;
			if (maxChars !== undefined)
				args.push("--max-chars", String(maxChars));
			if (params.noCache) args.push("--no-cache");
			if (params.noLlmsTxt) args.push("--no-llms-txt");
			const concurrency = params.concurrency as number | undefined;
			if (concurrency !== undefined)
				args.push("--concurrency", String(concurrency));
			return args;
		},
		formatScrapeResult,
		{
			urls: Type.Array(Type.String(), {
				description: "URLs to scrape (one or more)",
			}),
			selector: Type.Optional(
				Type.String({
					description: "CSS selector to target specific content",
				}),
			),
			trim: Type.Optional(
				Type.Boolean({ description: "Trim content to snippets" }),
			),
			maxChars: Type.Optional(
				Type.Number({
					description: "Maximum characters per page",
				}),
			),
			noCache: Type.Optional(
				Type.Boolean({ description: "Bypass cache" }),
			),
			noLlmsTxt: Type.Optional(
				Type.Boolean({ description: "Skip llms.txt processing" }),
			),
			concurrency: Type.Optional(
				Type.Number({
					description: "Concurrent fetch count (default 5)",
					default: 5,
				}),
			),
		},
	);

	// ─── Tool 3: ketch_code_search ──────────────────────────────────────────

	registerTool(
		"ketch_code_search",
		"Code Search",
		"Search open-source code using ketch (Grep, Sourcegraph, or GitHub backends). " +
			"The grepapp backend works zero-config.",
		"Use ketch_code_search to find open-source code examples",
		(params) => {
			const args = ["code", String(params.query)];
			if (params.lang)
				args.push("--lang", String(params.lang));
			const limit = params.limit as number | undefined;
			if (limit !== undefined) args.push("--limit", String(limit));
			if (params.backend)
				args.push("--backend", String(params.backend));
			if (params.regex) args.push("--regex");
			return args;
		},
		formatCodeResults,
		{
			query: Type.String({ description: "Code search query" }),
			lang: Type.Optional(
				Type.String({
					description: "Filter by programming language",
				}),
			),
			limit: Type.Optional(
				Type.Number({
					description: "Number of results (default 5)",
					default: 5,
				}),
			),
			backend: Type.Optional(
				StringEnum(["grepapp", "sourcegraph", "github"] as const, {
					description: "Code search backend (default: from ketch config)",
				}),
			),
			regex: Type.Optional(
				Type.Boolean({ description: "Interpret query as regex" }),
			),
		},
	);

	// ─── Tool 4: ketch_docs_search ──────────────────────────────────────────

	registerTool(
		"ketch_docs_search",
		"Docs Search",
		"Search library/framework documentation using ketch (Context7 or local backends). " +
			"The context7 backend requires an API key.",
		"Use ketch_docs_search to find library API docs and examples",
		(params) => {
			const args = ["docs", String(params.query)];
			if (params.library)
				args.push("--library", String(params.library));
			const tokens = params.tokens as number | undefined;
			if (tokens !== undefined)
				args.push("--tokens", String(tokens));
			const limit = params.limit as number | undefined;
			if (limit !== undefined) args.push("--limit", String(limit));
			if (params.backend)
				args.push("--backend", String(params.backend));
			if (params.resolve) args.push("--resolve");
			return args;
		},
		formatDocsResults,
		{
			query: Type.String({ description: "Documentation search query" }),
			library: Type.Optional(
				Type.String({
					description:
						"Library/framework name or Context7 library ID",
				}),
			),
			tokens: Type.Optional(
				Type.Number({
					description: "Token budget for context (default 4000)",
					default: 4000,
				}),
			),
			limit: Type.Optional(
				Type.Number({
					description: "Number of results (default 5)",
					default: 5,
				}),
			),
			backend: Type.Optional(
				StringEnum(["context7", "local"] as const, {
					description: "Docs search backend (default: from ketch config)",
				}),
			),
			resolve: Type.Optional(
				Type.Boolean({
					description: "Resolve and include full doc content",
				}),
			),
		},
	);
}
