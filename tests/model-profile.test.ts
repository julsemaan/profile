import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
	BUILTIN_ALIASES,
	BUILTIN_PROFILES,
	MODEL_PROFILES,
	VALID_THINKING_LEVELS,
	applyProfileData,
	findBuiltinProfile,
	getModelCompletionCandidates,
	getCycleProfiles,
	getNextProfile,
	isModelAlias,
	parseModelRef,
	parseMultiAliasArgs,
	parseProfileContent,
	serializeBuiltinProfile,
	serializeCustomProfile,
	resolveInitialMap,
	validateCustomProfile,
} from "../.pi/extensions/lib/model-profile.ts";

describe("findBuiltinProfile", () => {
	it("parses every built-in name", () => {
		for (const profile of BUILTIN_PROFILES) {
			assert.equal(findBuiltinProfile(profile), profile);
		}
	});

	it("is case-insensitive", () => {
		for (const profile of BUILTIN_PROFILES) {
			assert.equal(findBuiltinProfile(profile.toUpperCase()), profile);
		}
	});

	it("returns undefined for unknown names", () => {
		assert.equal(findBuiltinProfile("unknown"), undefined);
		assert.equal(findBuiltinProfile(""), undefined);
	});
});

describe("isModelAlias", () => {
	it("recognizes every configured alias", () => {
		for (const alias of BUILTIN_ALIASES) assert.equal(isModelAlias(alias), true);
	});

	it("rejects non-alias model references", () => {
		assert.equal(isModelAlias("openai-codex/gpt-5.6-sol"), false);
		assert.equal(isModelAlias("custom/unknown"), false);
	});
});

describe("MODEL_PROFILES", () => {
	it("contains every alias with a valid model reference", () => {
		for (const profile of BUILTIN_PROFILES) {
			const modelMap = MODEL_PROFILES[profile];
			for (const alias of BUILTIN_ALIASES) {
				assert.ok(alias in modelMap, `${profile} is missing ${alias}`);
				const config = modelMap[alias];
				if (config) assert.ok(parseModelRef(config.model), `${profile}/${alias} has an invalid model reference`);
			}
		}
	});
});

describe("getModelCompletionCandidates", () => {
	const model = (provider: string, id: string) => ({ provider, id });

	it("returns exactly the scoped models when a scope exists", () => {
		const available = [model("openai", "outside"), model("openai", "one"), model("openai", "two")];
		const scoped = [{ model: available[1] }, { model: available[2] }];

		assert.deepEqual(
			getModelCompletionCandidates(available, scoped, "openai/outside"),
			scoped.map(({ model: scopedModel }) => scopedModel),
		);
	});

	it("excludes an out-of-scope current alias value", () => {
		const available = [model("openai", "outside"), model("openai", "inside")];
		const scoped = [{ model: available[1] }];

		assert.deepEqual(
			getModelCompletionCandidates(available, scoped, "openai/outside"),
			[available[1]],
		);
	});

	it("returns all available models when the session is unscoped", () => {
		const available = [model("openai", "one"), model("anthropic", "two")];

		assert.deepEqual(
			getModelCompletionCandidates(available, [], "openai/one"),
			available,
		);
	});

	it("keeps an unavailable current alias value only when unscoped", () => {
		const available = [model("openai", "one")];

		assert.deepEqual(
			getModelCompletionCandidates(available, [], "anthropic/current"),
			[model("anthropic", "current"), ...available],
		);
		assert.deepEqual(
			getModelCompletionCandidates(available, [{ model: available[0] }], "anthropic/current"),
			available,
		);
	});
});

describe("validateCustomProfile", () => {
	const validCustom = {
		"custom/large": { model: "openai-codex/gpt-5.6-sol", thinkingLevel: "high" },
		"custom/medium": { model: "opencode/mimo-v2.5-free", thinkingLevel: "medium" },
		"custom/small": { model: "opencode/mimo-v2.5-free", thinkingLevel: "low" },
	};

	it("accepts valid custom profile", () => {
		const result = validateCustomProfile(validCustom);
		assert.equal(result.ok, true);
		if (result.ok) {
			assert.equal(result.data["custom/large"].model, "openai-codex/gpt-5.6-sol");
			assert.equal(result.data["custom/large"].thinkingLevel, "high");
			assert.equal(result.data["custom/medium"].model, "opencode/mimo-v2.5-free");
			assert.equal(result.data["custom/medium"].thinkingLevel, "medium");
			assert.equal(result.data["custom/small"].model, "opencode/mimo-v2.5-free");
			assert.equal(result.data["custom/small"].thinkingLevel, "low");
		}
	});

	it("accepts and preserves every pi thinking level", () => {
		for (const thinkingLevel of VALID_THINKING_LEVELS) {
			const profile = {
				"custom/large": { model: "openai-codex/gpt-5.6-sol", thinkingLevel },
				"custom/medium": { model: "opencode/mimo-v2.5-free", thinkingLevel: "medium" },
				"custom/small": { model: "opencode/mimo-v2.5-free", thinkingLevel: "low" },
			};
			const result = validateCustomProfile(profile);
			assert.equal(result.ok, true);
			if (result.ok) {
				assert.equal(result.data["custom/large"].thinkingLevel, thinkingLevel);
				const parsed = parseProfileContent(serializeCustomProfile(result.data));
				assert.equal(parsed.type, "custom");
				if (parsed.type === "custom") assert.deepEqual(parsed.data, result.data);
			}
		}
	});

	it("rejects missing alias keys", () => {
		const result = validateCustomProfile({
			"custom/large": { model: "openai-codex/gpt-5.6-sol", thinkingLevel: "high" },
		});
		assert.equal(result.ok, false);
		if (!result.ok) {
			assert.equal(result.error, "Missing required alias keys: custom/medium, custom/small");
		}
	});

	it("rejects a legacy two-alias profile", () => {
		const result = validateCustomProfile({
			"custom/large": { model: "openai-codex/gpt-5.6-sol", thinkingLevel: "high" },
			"custom/medium": { model: "opencode/mimo-v2.5-free", thinkingLevel: "medium" },
		});
		assert.equal(result.ok, false);
		if (!result.ok) assert.ok(result.error.includes("custom/small"));
	});

	it("rejects invalid model reference", () => {
		const result = validateCustomProfile({
			"custom/large": { model: "bad-model", thinkingLevel: "high" },
			"custom/medium": { model: "opencode/mimo-v2.5-free", thinkingLevel: "medium" },
			"custom/small": { model: "opencode/mimo-v2.5-free", thinkingLevel: "low" },
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
			"custom/small": { model: "opencode/mimo-v2.5-free", thinkingLevel: "low" },
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
	it("parses a bare built-in name", () => {
		const result = parseProfileContent("opencode");
		assert.equal(result.type, "builtin");
		if (result.type === "builtin") assert.equal(result.profile, "opencode");
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
			"custom/small": { model: "opencode/mimo-v2.5-free", thinkingLevel: "low" },
		});
		const result = parseProfileContent(json);
		assert.equal(result.type, "custom");
		if (result.type === "custom") {
			assert.equal(result.data["custom/large"].model, "openai-codex/gpt-5.6-sol");
			assert.equal(result.data["custom/small"].model, "opencode/mimo-v2.5-free");
			assert.equal(result.data["custom/small"].thinkingLevel, "low");
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
		assert.equal(serializeBuiltinProfile("opencode"), "opencode");
		assert.equal(serializeBuiltinProfile("openrouter"), "openrouter");
	});
});

describe("serializeCustomProfile", () => {
	it("round-trips through parse", () => {
		const data = {
			"custom/large": { model: "openai-codex/gpt-5.6-sol", thinkingLevel: "high" as const },
			"custom/medium": { model: "opencode/mimo-v2.5-free", thinkingLevel: "medium" as const },
			"custom/small": { model: "opencode/mimo-v2.5-free", thinkingLevel: "low" as const },
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
			fs.writeFileSync(targetFile, "openrouter", "utf-8");
			assert.equal(fs.readFileSync(targetFile, "utf-8"), "openrouter");

			// Overwrite with custom
			const custom = serializeCustomProfile({
				"custom/large": { model: "deepseek/deepseek-v4-pro", thinkingLevel: "high" },
				"custom/medium": { model: "deepseek/deepseek-v4-pro", thinkingLevel: "medium" },
				"custom/small": { model: "deepseek/deepseek-v4-flash", thinkingLevel: "low" },
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

	it("cycles each builtin to the next builtin", () => {
		for (let i = 0; i < builtins.length - 1; i++) {
			assert.equal(getNextProfile(builtins[i], false), builtins[i + 1]);
			assert.equal(getNextProfile(builtins[i], true), builtins[i + 1]);
		}
	});

	it("returns first builtin for unknown current", () => {
		assert.equal(getNextProfile("custom" as any, false), builtins[0]);
	});
});

describe("applyProfileData", () => {
	it("copies all aliases into an empty map", () => {
		const map: Record<string, any> = {
			"custom/large": { model: "", thinkingLevel: "off" },
			"custom/medium": { model: "", thinkingLevel: "off" },
			"custom/small": { model: "", thinkingLevel: "off" },
		};
		const customData = {
			"custom/large": { model: "a/large", thinkingLevel: "high" as const },
			"custom/medium": { model: "b/medium", thinkingLevel: "low" as const },
			"custom/small": { model: "c/small", thinkingLevel: "minimal" as const },
		};
		applyProfileData(map as any, customData);
		assert.equal(map["custom/large"].model, "a/large");
		assert.equal(map["custom/large"].thinkingLevel, "high");
		assert.equal(map["custom/medium"].model, "b/medium");
		assert.equal(map["custom/medium"].thinkingLevel, "low");
		assert.equal(map["custom/small"].model, "c/small");
		assert.equal(map["custom/small"].thinkingLevel, "minimal");
	});
});

describe("resolveInitialMap", () => {
	const builtinMaps = MODEL_PROFILES;
	const defaultMap = structuredClone(MODEL_PROFILES.priv);
	const customFileData = {
		"custom/large": { model: "f/large", thinkingLevel: "high" as const },
		"custom/medium": { model: "f/medium", thinkingLevel: "medium" as const },
		"custom/small": { model: "f/small", thinkingLevel: "low" as const },
	};
	const sessionMap = {
		"custom/large": { model: "stale/large", thinkingLevel: "max" as const },
	};

	it("reload file beats session", () => {
		const modelMap = resolveInitialMap(
			{ reason: "reload", fileProfile: "openrouterHybrid", sessionMap },
			defaultMap,
			builtinMaps,
		);
		assert.deepEqual(modelMap, MODEL_PROFILES.openrouterHybrid);
	});

	it("reload env beats file", () => {
		const modelMap = resolveInitialMap(
			{ reason: "reload", envProfile: "deep", fileProfile: "openrouterHybrid", fileCustomData: customFileData, sessionMap },
			defaultMap,
			builtinMaps,
		);
		assert.deepEqual(modelMap, MODEL_PROFILES.deep);
	});

	it("non reload session beats file", () => {
		const modelMap = resolveInitialMap(
			{ reason: "startup", fileProfile: "openrouterHybrid", fileCustomData: customFileData, sessionMap },
			defaultMap,
			builtinMaps,
		);
		assert.equal(modelMap["custom/large"].model, "stale/large");
		assert.equal(modelMap["custom/medium"].model, MODEL_PROFILES.priv["custom/medium"].model);
	});

	it("file used with no session", () => {
		const modelMap = resolveInitialMap(
			{ reason: "startup", fileCustomData: customFileData },
			defaultMap,
			builtinMaps,
		);
		assert.deepEqual(modelMap, customFileData);
	});

	it("default with nothing set", () => {
		const modelMap = resolveInitialMap(
			{ reason: "startup" },
			defaultMap,
			builtinMaps,
		);
		assert.deepEqual(modelMap, defaultMap);
	});
});

describe("parseMultiAliasArgs", () => {
	const LARGE = "openai-codex/gpt-5.6-sol";
	const MEDIUM = "opencode/mimo-v2.5-free";
	const SMALL = "deepseek/deepseek-v4-flash";

	it("returns empty updates for empty input", () => {
		assert.deepEqual(parseMultiAliasArgs(""), { ok: true, updates: {} });
		assert.deepEqual(parseMultiAliasArgs("   "), { ok: true, updates: {} });
	});

	it("parses a single alias", () => {
		const result = parseMultiAliasArgs(`--large ${LARGE}`);
		assert.equal(result.ok, true);
		if (result.ok) {
			assert.deepEqual(result.updates, { "custom/large": { model: LARGE } });
		}
	});

	it("parses all three aliases", () => {
		const result = parseMultiAliasArgs(`--large ${LARGE} --medium ${MEDIUM} --small ${SMALL}`);
		assert.equal(result.ok, true);
		if (result.ok) {
			assert.deepEqual(result.updates, {
				"custom/large": { model: LARGE },
				"custom/medium": { model: MEDIUM },
				"custom/small": { model: SMALL },
			});
		}
	});

	it("accepts inline = forms", () => {
		const result = parseMultiAliasArgs(`--large=${LARGE} medium=${MEDIUM}`);
		assert.equal(result.ok, true);
		if (result.ok) {
			assert.deepEqual(result.updates, {
				"custom/large": { model: LARGE },
				"custom/medium": { model: MEDIUM },
			});
		}
	});

	it("parses per-alias thinking levels", () => {
		const result = parseMultiAliasArgs(`--large ${LARGE} high --medium ${MEDIUM} low --small ${SMALL}`);
		assert.equal(result.ok, true);
		if (result.ok) {
			assert.deepEqual(result.updates, {
				"custom/large": { model: LARGE, thinkingLevel: "high" },
				"custom/medium": { model: MEDIUM, thinkingLevel: "low" },
				"custom/small": { model: SMALL },
			});
		}
	});

	it("parses a subset of aliases", () => {
		const result = parseMultiAliasArgs(`--small ${SMALL} low`);
		assert.equal(result.ok, true);
		if (result.ok) {
			assert.deepEqual(Object.keys(result.updates), ["custom/small"]);
			assert.deepEqual(result.updates["custom/small"], { model: SMALL, thinkingLevel: "low" });
		}
	});

	it("lets a duplicate flag overwrite left to right", () => {
		const result = parseMultiAliasArgs(`--large ${LARGE} --large ${MEDIUM}`);
		assert.equal(result.ok, true);
		if (result.ok) {
			assert.deepEqual(result.updates, { "custom/large": { model: MEDIUM } });
		}
	});

	it("expands --all to all three aliases", () => {
		const result = parseMultiAliasArgs(`--all ${LARGE}`);
		assert.equal(result.ok, true);
		if (result.ok) {
			assert.deepEqual(result.updates, {
				"custom/large": { model: LARGE },
				"custom/medium": { model: LARGE },
				"custom/small": { model: LARGE },
			});
		}
	});

	it("applies thinking to --all", () => {
		const result = parseMultiAliasArgs(`--all=${LARGE} high`);
		assert.equal(result.ok, true);
		if (result.ok) {
			for (const alias of BUILTIN_ALIASES) {
				assert.deepEqual(result.updates[alias], { model: LARGE, thinkingLevel: "high" });
			}
		}
	});

	it("lets a later per-alias flag overwrite --all", () => {
		const result = parseMultiAliasArgs(`--all ${LARGE} high --small ${SMALL} low`);
		assert.equal(result.ok, true);
		if (result.ok) {
			assert.deepEqual(result.updates["custom/large"], { model: LARGE, thinkingLevel: "high" });
			assert.deepEqual(result.updates["custom/medium"], { model: LARGE, thinkingLevel: "high" });
			assert.deepEqual(result.updates["custom/small"], { model: SMALL, thinkingLevel: "low" });
		}
	});

	it("lets a later --all overwrite a per-alias flag", () => {
		const result = parseMultiAliasArgs(`--small ${SMALL} low --all ${LARGE}`);
		assert.equal(result.ok, true);
		if (result.ok) {
			for (const alias of BUILTIN_ALIASES) {
				assert.deepEqual(result.updates[alias], { model: LARGE });
			}
		}
	});

	it("rejects --all with a missing model", () => {
		assert.equal(parseMultiAliasArgs("--all").ok, false);
		assert.equal(parseMultiAliasArgs(`--all --small ${SMALL}`).ok, false);
	});

	it("rejects invalid model references without applying anything", () => {
		const result = parseMultiAliasArgs(`--large ${LARGE} --medium notamodel`);
		assert.equal(result.ok, false);
		assert.ok(!("updates" in result));
	});

	it("rejects invalid thinking levels", () => {
		assert.equal(parseMultiAliasArgs(`--large ${LARGE} ultra`).ok, false);
	});

	it("rejects unknown flags", () => {
		assert.equal(parseMultiAliasArgs(`--bogus ${LARGE}`).ok, false);
	});
});
