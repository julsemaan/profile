import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { loadExtensions, createExtensionRuntime } from "/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/index.js";
import { createEventBus } from "/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/event-bus.js";

// Resolve the same TUI instance that Pi supplies to its extensions.
const require = createRequire("/usr/local/lib/node_modules/@earendil-works/pi-coding-agent/package.json");
const { Markdown, visibleWidth } = await import(require.resolve("@earendil-works/pi-tui"));
const identity = (text: string) => text;
const markdownTheme = Object.fromEntries(
	["heading", "link", "linkUrl", "code", "codeBlock", "codeBlockBorder", "quote", "quoteBorder", "hr", "listBullet", "bold", "italic", "strikethrough", "underline"].map(key => [key, identity]),
);

// Run with: node --test tests/code-cards.test.ts
// This checks OSC 52 bytes, not whether the physical terminal accepts them.
test("code cards copy exact block text through Pi's headless clipboard and restore on reload", async (t) => {
	const originalRender = Markdown.prototype.render;
	const originalMouse = Markdown.prototype.handleMouse;
	const result = await loadExtensions([".pi/extensions/code-cards.ts"], process.cwd(), createEventBus(), createExtensionRuntime());
	assert.deepEqual(result.errors, []);
	const extension = result.extensions[0];
	const warnings: string[] = [];
	const ctx = {
		mode: "tui",
		ui: {
			theme: { bg: (_color: string, text: string) => text, fg: (_color: string, text: string) => text },
			setStatus() {},
			notify(message: string) { warnings.push(message); },
		},
	};
	const emit = async (name: string) => {
		for (const handler of extension.handlers.get(name) ?? []) await handler({}, ctx);
	};
	const copyShortcut = [...extension.shortcuts.values()][0];
	const envKeys = ["DISPLAY", "WAYLAND_DISPLAY", "TERMUX_VERSION", "SSH_CONNECTION", "SSH_CLIENT", "MOSH_CONNECTION"];
	const savedEnv = envKeys.map(key => [key, process.env[key]] as const);
	for (const key of envKeys) delete process.env[key];
	t.after(async () => {
		await emit("session_shutdown");
		for (const [key, value] of savedEnv) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});
	await emit("session_start");

	const first = '  printf "héllo 世界\\n"\n    echo "' + "long ".repeat(40) + '"';
	const second = "  plain text\n    keeps indentation";
	const markdown = new Markdown("```bash\n" + first + "\n```\n\n```text\n" + second + "\n```", 0, 0, markdownTheme);
	let lines = markdown.render(60);
	assert.equal(lines.filter((line: string) => line.includes("[COPY]")).length, 2);
	assert.ok(lines.every((line: string) => visibleWidth(line) <= 60));

	const copyAndRead = async (action: () => unknown) => {
		let output = "";
		const writer = t.mock.method(process.stdout, "write", (chunk: string) => { output += chunk; return true; });
		try {
			await action();
			await new Promise(resolve => setImmediate(resolve));
		} finally {
			writer.mock.restore();
		}
		assert.deepEqual(warnings, []);
		const match = output.match(/\x1b\]52;c;([^\x07]*)\x07/);
		assert.ok(match, "copy must emit OSC 52 without a desktop clipboard");
		return Buffer.from(match[1], "base64").toString("utf8");
	};
	assert.equal(await copyAndRead(() => copyShortcut.handler(ctx)), second);

	const click = (x: number, y: number) => {
		assert.equal(markdown.handleMouse({ type: "press", button: "left", x, y })?.capture, true);
		return markdown.handleMouse({ type: "release", button: "left", x, y });
	};
	const firstButtonY = lines.findIndex((line: string) => line.includes("[COPY]"));
	const firstButtonX = visibleWidth(lines[firstButtonY].split("[COPY]")[0]);
	assert.equal(await copyAndRead(() => click(firstButtonX, firstButtonY)), first);

	// Theme changes invalidate Markdown without changing its text or width.
	ctx.ui.theme.fg = (_color: string, text: string) => `\x1b[36m${text}\x1b[0m`;
	markdown.invalidate();
	assert.ok(markdown.render(60).some((line: string) => line.includes("\x1b[36m")));

	// Clicking the card body toggles raw text, and resizing rebuilds targets.
	assert.equal(click(2, firstButtonY + 1)?.render, true);
	lines = markdown.render(35);
	assert.ok(lines.some((line: string) => line.includes("```bash")));
	assert.equal(lines.filter((line: string) => line.includes("[COPY]")).length, 1);
	markdown.setText("```bash\necho streaming");
	assert.ok(markdown.render(45).some((line: string) => line.includes("[COPY]")));
	markdown.setText("```bash\necho complete\n```");
	markdown.render(45);
	assert.equal(await copyAndRead(() => copyShortcut.handler(ctx)), "echo complete");

	const userMessage = new Markdown("```text\nuser input\n```", 0, 0, markdownTheme, { color: identity });
	assert.ok(!userMessage.render(60).some((line: string) => line.includes("[COPY]")));
	await emit("session_shutdown");
	assert.equal(Markdown.prototype.render, originalRender);
	assert.equal(Markdown.prototype.handleMouse, originalMouse);
	await emit("session_start");
	assert.notEqual(Markdown.prototype.render, originalRender);
	await emit("session_shutdown");
	ctx.mode = "print";
	await emit("session_start");
	assert.equal(Markdown.prototype.render, originalRender);
});
