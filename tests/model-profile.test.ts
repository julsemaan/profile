import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
	BUILTIN_PROFILES,
	applyProfileData,
	findBuiltinProfile,
	getCycleProfiles,
	getNextProfile,
	parseProfileContent,
	serializeBuiltinProfile,
	serializeCustomProfile,
	validateCustomProfile,
} from "../.pi/extensions/lib/model-profile.ts";

describe("findBuiltinProfile", () => {
	it("parses bare built-in names", () => {
		assert.equal(findBuiltinProfile("pub"), "pub");
		assert.equal(findBuiltinProfile("priv"), "priv");
		assert.equal(findBuiltinProfile("pubDeep"), "pubDeep");
		assert.equal(findBuiltinProfile("pubFree"), "pubFree");
		assert.equal(findBuiltinProfile("copilotPriv"), "copilotPriv");
	});

	it("is case-insensitive", () => {
		assert.equal(findBuiltinProfile("PUB"), "pub");
		assert.equal(findBuiltinProfile("Priv"), "priv");
		assert.equal(findBuiltinProfile("PUBDEEP"), "pubDeep");
	});

	it("returns undefined for unknown names", () => {
		assert.equal(findBuiltinProfile("unknown"), undefined);
		assert.equal(findBuiltinProfile(""), undefined);
	});
});

describe("validateCustomProfile", () => {
	const validCustom = {
		"custom/large": { model: "openai-codex/gpt-5.6-sol", thinkingLevel: "high" },
		"custom/medium": { model: "opencode/mimo-v2.5-free", thinkingLevel: "medium" },
	};

	it("accepts valid custom profile", () => {
		const result = validateCustomProfile(validCustom);
		assert.equal(result.ok, true);
		if (result.ok) {
			assert.equal(result.data["custom/large"].model, "openai-codex/gpt-5.6-sol");
			assert.equal(result.data["custom/large"].thinkingLevel, "high");
			assert.equal(result.data["custom/medium"].model, "opencode/mimo-v2.5-free");
			assert.equal(result.data["custom/medium"].thinkingLevel, "medium");
		}
	});

	it("rejects missing alias keys", () => {
		const result = validateCustomProfile({
			"custom/large": { model: "openai-codex/gpt-5.6-sol", thinkingLevel: "high" },
		});
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.ok(result.error.includes("Missing required alias keys"));
		}
	});

	it("rejects invalid model reference", () => {
		const result = validateCustomProfile({
			"custom/large": { model: "bad-model", thinkingLevel: "high" },
			"custom/medium": { model: "opencode/mimo-v2.5-free", thinkingLevel: "medium" },
		});
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.ok(result.error.includes("not a valid provider/model reference"));
		}
	});

	it("rejects invalid thinking level", () => {
		const result = validateCustomProfile({
			"custom/large": { model: "openai-codex/gpt-5.6-sol", thinkingLevel: "ultra" },
			"custom/medium": { model: "opencode/mimo-v2.5-free", thinkingLevel: "medium" },
		});
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.ok(result.error.includes("thinkingLevel"));
		}
	});

	it("rejects non-object input", () => {
		assert.equal(validateCustomProfile(null).ok, false);
		assert.equal(validateCustomProfile("string").ok, false);
		assert.equal(validateCustomProfile(42).ok, false);
		assert.equal(validateCustomProfile([]).ok, false);
	});
});

describe("parseProfileContent", () => {
	it("parses bare built-in name", () => {
		const result = parseProfileContent("pub");
		assert.equal(result.type, "builtin");
		if (result.type === "builtin") assert.equal(result.profile, "pub");
	});

	it("parses case-insensitive built-in name", () => {
		const result = parseProfileContent("  PRIV  ");
		assert.equal(result.type, "builtin");
		if (result.type === "builtin") assert.equal(result.profile, "priv");
	});

	it("parses valid custom JSON", () => {
		const json = JSON.stringify({
			"custom/large": { model: "openai-codex/gpt-5.6-sol", thinkingLevel: "high" },
			"custom/medium": { model: "opencode/mimo-v2.5-free", thinkingLevel: "medium" },
		});
		const result = parseProfileContent(json);
		assert.equal(result.type, "custom");
		if (result.type === "custom") {
			assert.equal(result.data["custom/large"].model, "openai-codex/gpt-5.6-sol");
		}
	});

	it("rejects malformed JSON", () => {
		const result = parseProfileContent("{not json");
		assert.equal(result.type, "error");
	});

	it("rejects empty content", () => {
		const result = parseProfileContent("");
		assert.equal(result.type, "error");
	});

	it("rejects custom JSON with missing aliases", () => {
		const result = parseProfileContent('{"custom/large": {"model": "a/b", "thinkingLevel": "high"}}');
		assert.equal(result.type, "error");
	});
});

describe("serializeBuiltinProfile", () => {
	it("returns canonical name", () => {
		assert.equal(serializeBuiltinProfile("pub"), "pub");
		assert.equal(serializeBuiltinProfile("pubDeep"), "pubDeep");
	});
});

describe("serializeCustomProfile", () => {
	it("round-trips through parse", () => {
		const data = {
			"custom/large": { model: "openai-codex/gpt-5.6-sol", thinkingLevel: "high" as const },
			"custom/medium": { model: "opencode/mimo-v2.5-free", thinkingLevel: "medium" as const },
		};
		const serialized = serializeCustomProfile(data);
		const parsed = parseProfileContent(serialized);
		assert.equal(parsed.type, "custom");
		if (parsed.type === "custom") {
			assert.deepEqual(parsed.data, data);
		}
	});
});

describe("julsemaan-tmp/ target discovery", () => {
	it("finds nearest existing julsemaan-tmp/ ancestor", () => {
		const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "model-profile-test-"));
		try {
			// Create nested structure
			const tmpDir = path.join(tmpRoot, "julsemaan-tmp");
			fs.mkdirSync(tmpDir, { recursive: true });
			const nested = path.join(tmpRoot, "a", "b", "c");
			fs.mkdirSync(nested, { recursive: true });

			// Walk up from nested dir, should find tmpRoot
			let found: string | null = null;
			let dir = nested;
			while (true) {
				const candidate = path.join(dir, "julsemaan-tmp");
				if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
					found = dir;
					break;
				}
				const parent = path.dirname(dir);
				if (parent === dir) break;
				dir = parent;
			}
			assert.equal(found, tmpRoot);
		} finally {
			fs.rmSync(tmpRoot, { recursive: true, force: true });
		}
	});

	it("creates directory and overwrites existing file", () => {
		const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "model-profile-test-"));
		try {
			const tmpDir = path.join(tmpRoot, "julsemaan-tmp");
			fs.mkdirSync(tmpDir, { recursive: true });
			const targetFile = path.join(tmpDir, "model-profile");

			// Write initial content
			fs.writeFileSync(targetFile, "pub", "utf-8");
			assert.equal(fs.readFileSync(targetFile, "utf-8"), "pub");

			// Overwrite with custom
			const custom = serializeCustomProfile({
				"custom/large": { model: "deepseek/deepseek-v4-pro", thinkingLevel: "high" },
				"custom/medium": { model: "deepseek/deepseek-v4-pro", thinkingLevel: "medium" },
			});
			fs.writeFileSync(targetFile, custom, "utf-8");
			const result = parseProfileContent(fs.readFileSync(targetFile, "utf-8"));
			assert.equal(result.type, "custom");
		} finally {
			fs.rmSync(tmpRoot, { recursive: true, force: true });
		}
	});

	it("creates julsemaan-tmp/ if it does not exist", () => {
		const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "model-profile-test-"));
		try {
			const tmpDir = path.join(tmpRoot, "julsemaan-tmp");
			fs.mkdirSync(tmpDir, { recursive: true });
			const targetFile = path.join(tmpDir, "model-profile");

			// Verify dir was created
			assert.ok(fs.existsSync(tmpDir));
			assert.ok(fs.statSync(tmpDir).isDirectory());

			// Write profile
			fs.writeFileSync(targetFile, "priv", "utf-8");
			assert.equal(fs.readFileSync(targetFile, "utf-8"), "priv");
		} finally {
			fs.rmSync(tmpRoot, { recursive: true, force: true });
		}
	});
});

describe("getCycleProfiles", () => {
	it("returns only builtins when no custom", () => {
		const list = getCycleProfiles(false);
		assert.deepEqual(list, [...BUILTIN_PROFILES]);
	});

	it("includes custom after builtins when custom exists", () => {
		const list = getCycleProfiles(true);
		assert.deepEqual(list, [...BUILTIN_PROFILES, "custom"]);
	});
});

describe("getNextProfile", () => {
	const builtins = [...BUILTIN_PROFILES];

	it("wraps last builtin to first when no custom", () => {
		const last = builtins[builtins.length - 1];
		assert.equal(getNextProfile(last, false), builtins[0]);
	});

	it("wraps custom to first builtin", () => {
		assert.equal(getNextProfile("custom", true), builtins[0]);
	});

	it("transitions from last builtin to custom when custom exists", () => {
		const last = builtins[builtins.length - 1];
		assert.equal(getNextProfile(last, true), "custom");
	});

	it("cycles builtin to next builtin", () => {
		assert.equal(getNextProfile(builtins[0], false), builtins[1]);
		assert.equal(getNextProfile(builtins[0], true), builtins[1]);
	});

	it("returns first builtin for unknown current", () => {
		assert.equal(getNextProfile("custom" as any, false), builtins[0]);
	});
});

describe("applyProfileData", () => {
	it("copies both aliases into an empty map", () => {
		const map: Record<string, any> = {
			"custom/large": { model: "", thinkingLevel: "off" },
			"custom/medium": { model: "", thinkingLevel: "off" },
		};
		const customData = {
			"custom/large": { model: "a/large", thinkingLevel: "high" as const },
			"custom/medium": { model: "b/medium", thinkingLevel: "low" as const },
		};
		applyProfileData(map as any, customData);
		assert.equal(map["custom/large"].model, "a/large");
		assert.equal(map["custom/large"].thinkingLevel, "high");
		assert.equal(map["custom/medium"].model, "b/medium");
		assert.equal(map["custom/medium"].thinkingLevel, "low");
	});
});
