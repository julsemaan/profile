import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { loadExtensions, createExtensionRuntime } from "/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/index.js";
import { createEventBus } from "/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/event-bus.js";

const EXTENSION_PATH = ".pi/extensions/write-tmp-document.ts";

const tempDirs: string[] = [];

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function makeCwd(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pi-tmp-doc-"));
	tempDirs.push(dir);
	return dir;
}

async function loadTools() {
	const runtime = createExtensionRuntime();
	const result = await loadExtensions([EXTENSION_PATH], process.cwd(), createEventBus(), runtime);
	assert.equal(result.errors.length, 0, result.errors.map((error) => error.error).join("\n"));
	const extension = result.extensions[0];
	assert.ok(extension);
	const write = extension.tools.get("write_tmp_document")?.definition;
	const edit = extension.tools.get("edit_tmp_document")?.definition;
	assert.ok(write, "missing write_tmp_document");
	assert.ok(edit, "missing edit_tmp_document");
	return { write, edit };
}

function ctx(cwd: string) {
	return { cwd } as any;
}

async function readDoc(cwd: string, relative: string): Promise<string> {
	return fs.readFile(path.join(cwd, "julsemaan-tmp", relative), "utf-8");
}

describe("write_tmp_document + edit_tmp_document", () => {
	it("replaces a unique block and leaves the rest unchanged", async () => {
		const { write, edit } = await loadTools();
		const cwd = await makeCwd();
		const original = "# Plan\n\nAlpha section\n\nBeta section\n";
		await write.execute("w1", { path: "plan.md", content: original }, undefined, undefined, ctx(cwd));

		const result = await edit.execute(
			"e1",
			{ path: "plan.md", edits: [{ oldText: "Alpha section", newText: "Gamma section" }] },
			undefined,
			undefined,
			ctx(cwd),
		);

		assert.match(result.content[0].text, /Successfully replaced 1 block/);
		assert.equal(await readDoc(cwd, "plan.md"), "# Plan\n\nGamma section\n\nBeta section\n");
	});

	it("applies two disjoint edits in one call", async () => {
		const { write, edit } = await loadTools();
		const cwd = await makeCwd();
		await write.execute("w1", { path: "plan.md", content: "# Plan\n\nAlpha\n\nBeta\n" }, undefined, undefined, ctx(cwd));

		await edit.execute(
			"e1",
			{
				path: "plan.md",
				edits: [
					{ oldText: "Alpha", newText: "One" },
					{ oldText: "Beta", newText: "Two" },
				],
			},
			undefined,
			undefined,
			ctx(cwd),
		);

		assert.equal(await readDoc(cwd, "plan.md"), "# Plan\n\nOne\n\nTwo\n");
	});

	it("throws when oldText is not unique", async () => {
		const { write, edit } = await loadTools();
		const cwd = await makeCwd();
		await write.execute("w1", { path: "plan.md", content: "same\nsame\n" }, undefined, undefined, ctx(cwd));

		await assert.rejects(
			() =>
				edit.execute("e1", { path: "plan.md", edits: [{ oldText: "same", newText: "other" }] }, undefined, undefined, ctx(cwd)),
			/occurrences|unique/i,
		);
	});

	it("throws when the file does not exist", async () => {
		const { edit } = await loadTools();
		const cwd = await makeCwd();

		await assert.rejects(
			() =>
				edit.execute("e1", { path: "missing.md", edits: [{ oldText: "a", newText: "b" }] }, undefined, undefined, ctx(cwd)),
			/Could not edit file/,
		);
	});

	it("rejects non-markdown/HTML extensions", async () => {
		const { edit } = await loadTools();
		const cwd = await makeCwd();

		await assert.rejects(
			() =>
				edit.execute("e1", { path: "notes.txt", edits: [{ oldText: "a", newText: "b" }] }, undefined, undefined, ctx(cwd)),
			/extension "\.txt" not allowed/,
		);
	});

	it("rejects paths that escape julsemaan-tmp", async () => {
		const { edit } = await loadTools();
		const cwd = await makeCwd();

		await assert.rejects(
			() =>
				edit.execute("e1", { path: "../escape.md", edits: [{ oldText: "a", newText: "b" }] }, undefined, undefined, ctx(cwd)),
			/outside julsemaan-tmp/,
		);
	});

	it("edits HTML documents under julsemaan-tmp", async () => {
		const { write, edit } = await loadTools();
		const cwd = await makeCwd();
		await write.execute(
			"w1",
			{ path: "html-plans/plan.html", content: "<main><h1>Old</h1></main>" },
			undefined,
			undefined,
			ctx(cwd),
		);

		await edit.execute(
			"e1",
			{ path: "html-plans/plan.html", edits: [{ oldText: "<h1>Old</h1>", newText: "<h1>New</h1>" }] },
			undefined,
			undefined,
			ctx(cwd),
		);

		assert.equal(await readDoc(cwd, "html-plans/plan.html"), "<main><h1>New</h1></main>");
	});
});
