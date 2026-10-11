/**
 * Slash-command catalog per project directory, so the home screen can complete `/`.
 *
 * omp only pushes its command list to a running session, and the home composer has none
 * yet. Every live session therefore also records its list here, keyed by cwd, and the
 * last good lists survive a restart through a file under `dataDir`. A directory nobody
 * has opened gets a short-lived ephemeral omp probe (`ompRpcUiArgs` without a session
 * file): it sends no message and writes nothing to the profile, and stops as soon as the
 * catalog lands.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import type { AvailableSlashCommand } from "../shared/api.ts";
import { config } from "./config.ts";
import { OmpProcess } from "./omp-process.ts";

interface Entry {
	commands: AvailableSlashCommand[];
	/** When this directory's own list was last seen. */
	at: number;
}

/** Past this, a cached list still answers but one probe refreshes it behind the reply. */
const TTL_MS = 10 * 60_000;
/** omp answers in about a second; a cold machine with a huge repo may need more. */
const PROBE_TIMEOUT_MS = 10_000;
/** Projects accumulate over time; only the newest lists are worth keeping. */
const MAX_DIRS = 30;

const cacheFile = () => path.join(config.dataDir, "commands-cache.json");
/** The file is shared by every profile directory, so it records its own. */
const agentKey = () => config.agentDir ?? "default";
/** Same directory, however the caller spelled it. */
const dirKey = (cwd: string) => path.resolve(cwd).replace(/[\\/]+$/, "").toLowerCase();

const entries = new Map<string, Entry>();
const probing = new Map<string, Promise<AvailableSlashCommand[] | undefined>>();
let diskLoaded = false;

function loadDisk(): void {
	if (diskLoaded) return;
	diskLoaded = true;
	try {
		const data = JSON.parse(fs.readFileSync(cacheFile(), "utf8")) as { agentDir?: string; dirs?: Record<string, { at?: number; commands?: unknown }> };
		if (data.agentDir !== agentKey()) return;
		for (const [cwd, e] of Object.entries(data.dirs ?? {})) {
			if (!Array.isArray(e.commands)) continue;
			entries.set(dirKey(cwd), { commands: e.commands as AvailableSlashCommand[], at: Number(e.at) || 0 });
		}
	} catch {
		// no usable cache yet
	}
}

async function saveDisk(): Promise<void> {
	const newest = [...entries.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, MAX_DIRS);
	try {
		await Bun.write(cacheFile(), JSON.stringify({ agentDir: agentKey(), dirs: Object.fromEntries(newest) }, null, 1));
	} catch {
		// one less layer of cache; the in-memory entries still work
	}
}

/** Spawn a session process just to read its catalog, then stop it. */
async function probe(cwd: string): Promise<AvailableSlashCommand[] | undefined> {
	const { promise, resolve } = Promise.withResolvers<AvailableSlashCommand[] | undefined>();
	let settled = false;
	let proc: OmpProcess | undefined;
	const finish = (commands: AvailableSlashCommand[] | undefined) => {
		if (settled) return;
		settled = true;
		resolve(commands && commands.length > 0 ? commands : undefined);
		void proc?.stop(500);
	};
	proc = new OmpProcess({
		cwd,
		onFrame: frame => {
			if (frame.type === "available_commands_update") finish((frame.commands as AvailableSlashCommand[] | undefined) ?? []);
		},
		onExit: () => finish(undefined),
	});
	const timer = setTimeout(() => finish(undefined), PROBE_TIMEOUT_MS);
	void proc.ready
		.then(() => proc?.request({ type: "get_available_commands" }))
		.then(res => finish(res.success ? ((res.data as { commands?: AvailableSlashCommand[] } | undefined)?.commands ?? []) : []))
		.catch(() => finish(undefined))
		.finally(() => clearTimeout(timer));
	return promise;
}

/** One probe per directory at a time; the result fills that directory's entry. */
function startProbe(cwd: string): Promise<AvailableSlashCommand[] | undefined> {
	const key = dirKey(cwd);
	const running = probing.get(key);
	if (running) return running;
	const run = probe(cwd).then(commands => {
		if (commands) {
			entries.set(key, { commands, at: Date.now() });
			void saveDisk();
		}
		if (probing.get(key) === run) probing.delete(key);
		return commands;
	});
	probing.set(key, run);
	return run;
}

/** A session pushed its catalog: remember it for the home screen of the same project. */
export function rememberCommands(cwd: string, commands: AvailableSlashCommand[]): void {
	if (commands.length === 0) return;
	loadDisk();
	entries.set(dirKey(cwd), { commands, at: Date.now() });
	void saveDisk();
}

/**
 * Catalog for `cwd`. Its own list answers first; otherwise the newest list from any
 * project does (built-ins are the same everywhere, only project skills differ) while a
 * probe fills in the real one. Nothing cached at all is the only case that waits.
 * `exact: false` means "a stand-in is showing; ask again once the probe has had a moment".
 */
export async function getCommands(cwd: string): Promise<{ commands: AvailableSlashCommand[]; exact: boolean }> {
	loadDisk();
	const own = entries.get(dirKey(cwd));
	if (own) {
		if (Date.now() - own.at >= TTL_MS) void startProbe(cwd);
		return { commands: own.commands, exact: true };
	}
	const fallback = [...entries.values()].sort((a, b) => b.at - a.at)[0];
	if (fallback) {
		void startProbe(cwd);
		return { commands: fallback.commands, exact: false };
	}
	const probed = await startProbe(cwd);
	return { commands: probed ?? [], exact: Boolean(probed) };
}

/** Read the persisted cache at boot so the first home screen does not wait on a probe. */
export function warmCommands(): void {
	loadDisk();
}
