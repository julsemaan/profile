import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

type PonytailMode = "off" | "lite" | "full" | "ultra" | "review";

const STATUS_KEY = "ponytail";
const DEFAULT_MODE: PonytailMode = "full";
const POLL_MS = 1000;
const VALID_MODES = new Set<PonytailMode>(["off", "lite", "full", "ultra", "review"]);

function normalizeMode(mode: unknown): PonytailMode | undefined {
	if (typeof mode !== "string") return undefined;
	const normalized = mode.trim().toLowerCase() as PonytailMode;
	return VALID_MODES.has(normalized) ? normalized : undefined;
}

function getConfigDir(): string {
	if (process.env.XDG_CONFIG_HOME) {
		return path.join(process.env.XDG_CONFIG_HOME, "ponytail");
	}
	if (process.platform === "win32") {
		return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "ponytail");
	}
	return path.join(os.homedir(), ".config", "ponytail");
}

function readDefaultMode(): PonytailMode {
	const envMode = normalizeMode(process.env.PONYTAIL_DEFAULT_MODE);
	if (envMode) return envMode;

	try {
		const configPath = path.join(getConfigDir(), "config.json");
		const config = JSON.parse(fs.readFileSync(configPath, "utf8")) as { defaultMode?: unknown };
		return normalizeMode(config.defaultMode) || DEFAULT_MODE;
	} catch {
		return DEFAULT_MODE;
	}
}

function readSessionMode(ctx: ExtensionContext): PonytailMode {
	const entries = ctx.sessionManager.getBranch?.() || ctx.sessionManager.getEntries?.() || [];
	for (let i = entries.length - 1; i >= 0; i -= 1) {
		const entry = entries[i] as any;
		if (entry?.type !== "custom" || entry?.customType !== "ponytail-mode") continue;
		const mode = normalizeMode(entry?.data?.mode);
		if (mode) return mode;
	}
	return readDefaultMode();
}

function renderStatus(ctx: ExtensionContext, mode: PonytailMode) {
	const color = mode === "off" ? "dim" : mode === "review" ? "warning" : "accent";
	ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg(color as any, `🐴 ${mode}`));
}

export default function ponytailStatus(pi: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | undefined;
	let activeCtx: ExtensionContext | undefined;
	let lastMode: PonytailMode | undefined;

	const clearPolling = () => {
		if (!timer) return;
		clearInterval(timer);
		timer = undefined;
	};

	const refresh = (ctx: ExtensionContext) => {
		const mode = readSessionMode(ctx);
		if (mode === lastMode) return;
		lastMode = mode;
		renderStatus(ctx, mode);
	};

	const startPolling = (ctx: ExtensionContext) => {
		activeCtx = ctx;
		clearPolling();
		refresh(ctx);
		timer = setInterval(() => {
			if (!activeCtx) return;
			refresh(activeCtx);
		}, POLL_MS);
		timer.unref?.();
	};

	pi.on("session_start", async (_event, ctx) => {
		startPolling(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		activeCtx = ctx;
		refresh(ctx);
	});

	pi.on("session_shutdown", async () => {
		clearPolling();
		activeCtx = undefined;
		lastMode = undefined;
	});
}
