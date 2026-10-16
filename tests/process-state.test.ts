import { it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { syncBuiltinESMExports } from "node:module";
import * as state from "../.pi/extensions/lib/process-state.ts";

it("isolates same-PID containers while preserving state across extension reloads", async (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "process-state-test-"));
	let hostname = "container-a";
	t.mock.method(os, "tmpdir", () => dir);
	t.mock.method(os, "hostname", () => hostname);
	syncBuiltinESMExports();
	t.after(() => {
		t.mock.restoreAll();
		syncBuiltinESMExports();
		fs.rmSync(dir, { recursive: true, force: true });
	});

	// Both simulated containers use this process's PID and the same storage.
	for (const key of ["model-profile", "fast-mode"]) {
		const legacyPath = path.join(dir, `pi-${key}-${process.pid}.json`);
		fs.writeFileSync(legacyPath, JSON.stringify("ambiguous legacy state"));
		hostname = "container-a";
		assert.equal(state.readProcessState(key), undefined);
		state.writeProcessState(key, { owner: "a" });
		const pathA = state.processStatePath(key);

		hostname = "container-b";
		assert.notEqual(state.processStatePath(key), pathA);
		assert.equal(state.readProcessState(key), undefined);
		state.clearProcessState(key);
		assert.ok(fs.existsSync(pathA));
		state.writeProcessState(key, { owner: "b" });
		const pathB = state.processStatePath(key);

		hostname = "container-a";
		assert.deepEqual(state.readProcessState(key), { owner: "a" });
		// A fresh module instance must recover the same process's file.
		const reloaded = await import(`../.pi/extensions/lib/process-state.ts?reload=${key}`);
		assert.notEqual(reloaded, state);
		assert.equal(reloaded.processStatePath(key), pathA);
		assert.deepEqual(reloaded.readProcessState(key), { owner: "a" });
		reloaded.writeProcessState(key, { owner: "a", reloaded: true });
		assert.deepEqual(state.readProcessState(key), { owner: "a", reloaded: true });
		reloaded.clearProcessState(key);
		assert.equal(state.readProcessState(key), undefined);
		assert.ok(fs.existsSync(pathB));

		hostname = "container-b";
		assert.deepEqual(state.readProcessState(key), { owner: "b" });
		state.clearProcessState(key);
		assert.equal(state.readProcessState(key), undefined);
		assert.equal(fs.readFileSync(legacyPath, "utf-8"), JSON.stringify("ambiguous legacy state"));
	}
});
