/**
 * Process-scoped state files.
 *
 * A small same-process convenience used to carry state across `/new` when pi
 * re-creates the extension instance. Session entries and the disk profile stay
 * authoritative; every failure here is silent.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export function processStatePath(key: string): string {
	return path.join(os.tmpdir(), `pi-${key}-${process.pid}.json`);
}

export function readProcessState<T>(key: string): T | undefined {
	try {
		const raw = fs.readFileSync(processStatePath(key), "utf-8");
		return JSON.parse(raw) as T;
	} catch {
		return undefined;
	}
}

export function writeProcessState(key: string, value: unknown): void {
	try {
		fs.writeFileSync(processStatePath(key), JSON.stringify(value), "utf-8");
	} catch {
		// best effort
	}
}

export function clearProcessState(key: string): void {
	try {
		fs.unlinkSync(processStatePath(key));
	} catch {
		// best effort
	}
}
