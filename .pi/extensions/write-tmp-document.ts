import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createEditToolDefinition, withFileMutationQueue } from "@mariozechner/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const ALLOWED_EXTENSIONS = new Set([".md", ".html"]);

const WriteTmpParams = Type.Object({
	path: Type.String({ description: "Relative target path under julsemaan-tmp/ (e.g. plan.md, nested/report.html)" }),
	content: Type.String({ description: "Full file contents to write" }),
});

const EditTmpParams = Type.Object({
	path: Type.String({ description: "Relative target path under julsemaan-tmp/ (e.g. plan.md, nested/report.html)" }),
	edits: Type.Array(
		Type.Object({
			oldText: Type.String({ description: "Exact text for one targeted replacement. Must be unique in the file." }),
			newText: Type.String({ description: "Replacement text for this targeted edit." }),
		}),
		{ description: "One or more targeted replacements, matched against the original file." },
	),
});

interface WriteTmpDetails {
	path: string;
	bytes: number;
	extension: string;
}

interface TmpTarget {
	normalized: string;
	resolved: string;
	ext: string;
}

function normalizeInputPath(raw: string): string {
	let p = raw.replace(/^@/, "");
	// Strip optional leading julsemaan-tmp/
	if (p.startsWith("julsemaan-tmp/")) {
		p = p.slice("julsemaan-tmp/".length);
	}
	return p;
}

function resolveTmpTarget(rawPath: string, cwd: string): TmpTarget {
	const normalized = normalizeInputPath(rawPath);
	if (!normalized) {
		throw new Error("Error: empty path");
	}

	const ext = path.extname(normalized).toLowerCase();
	if (!ALLOWED_EXTENSIONS.has(ext)) {
		throw new Error(`Error: extension "${ext}" not allowed. Use .md or .html.`);
	}

	const baseDir = path.resolve(cwd, "julsemaan-tmp");
	const resolved = path.resolve(baseDir, normalized);

	// Security: resolved path must be under base dir
	if (!resolved.startsWith(baseDir + path.sep) && resolved !== baseDir) {
		throw new Error("Error: path resolves outside julsemaan-tmp/");
	}

	return { normalized, resolved, ext };
}

export default function writeTmpDocument(pi: ExtensionAPI) {
	pi.registerTool({
		name: "write_tmp_document",
		label: "Write Tmp Document",
		description: "Save .md or .html files into julsemaan-tmp/. Works in plan mode.",
		promptSnippet: "Save markdown/HTML documents to julsemaan-tmp/ directory",
		promptGuidelines: [
			"Use write_tmp_document when user wants plan/report/html/markdown saved to disk.",
			"Use write_tmp_document instead of built-in write for files under julsemaan-tmp/.",
			"Use write_tmp_document in plan mode when output must be persisted as .md or .html.",
		],
		parameters: WriteTmpParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { normalized, resolved, ext } = resolveTmpTarget(params.path, ctx.cwd);

			await fs.mkdir(path.dirname(resolved), { recursive: true });

			const content = params.content;
			const bytes = Buffer.byteLength(content, "utf-8");

			await withFileMutationQueue(resolved, async () => {
				await fs.writeFile(resolved, content, { encoding: "utf-8" });
			});

			const displayPath = `julsemaan-tmp/${normalized}`;
			const details: WriteTmpDetails = { path: displayPath, bytes, extension: ext };

			return {
				content: [{ type: "text", text: `Saved ${displayPath} (${bytes} bytes)` }],
				details,
			};
		},

		renderCall(args, theme) {
			const p = typeof args.path === "string" ? args.path : "?";
			let text = theme.fg("toolTitle", theme.bold("write_tmp_document "));
			text += theme.fg("muted", `julsemaan-tmp/${p}`);
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as WriteTmpDetails | undefined;
			if (details) {
				return new Text(theme.fg("success", `Saved ${details.path} (${details.bytes} bytes)`), 0, 0);
			}
			const text = result.content[0];
			return new Text(text?.type === "text" ? text.text : "", 0, 0);
		},
	});

	pi.registerTool({
		name: "edit_tmp_document",
		label: "Edit Tmp Document",
		description:
			"Edit an existing .md or .html file under julsemaan-tmp/ using exact text replacement. Works in plan mode.",
		promptSnippet: "Make precise edits to existing markdown/HTML documents in julsemaan-tmp/",
		promptGuidelines: [
			"Use edit_tmp_document for targeted changes to an existing julsemaan-tmp document instead of rewriting it with write_tmp_document.",
			"Each edits[].oldText must match exactly and be unique; batch disjoint edits in one call.",
		],
		parameters: EditTmpParams,

		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const { normalized } = resolveTmpTarget(params.path, ctx.cwd);
			const baseDir = path.resolve(ctx.cwd, "julsemaan-tmp");
			const editTool = createEditToolDefinition(baseDir);
			return editTool.execute(toolCallId, { path: normalized, edits: params.edits }, signal, onUpdate, ctx);
		},

		renderCall(args, theme) {
			const p = typeof args.path === "string" ? args.path : "?";
			const count = Array.isArray(args.edits) ? args.edits.length : 0;
			let text = theme.fg("toolTitle", theme.bold("edit_tmp_document "));
			text += theme.fg("muted", `julsemaan-tmp/${p}`);
			if (count > 0) {
				text += theme.fg("muted", ` (${count} ${count === 1 ? "edit" : "edits"})`);
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, _theme) {
			const text = result.content[0];
			return new Text(text?.type === "text" ? text.text : "", 0, 0);
		},
	});
}
