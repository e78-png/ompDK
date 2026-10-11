/**
 * One gateway per omp profile.
 *
 * Two gateways pointed at the same profile do not know about each other: each opens its own
 * omp process for the same session file, and omp resolves that by copying the conversation to
 * a sibling — the duplicate entry again. The lock is claimed with an exclusive file create;
 * the health check still rejects stale or recycled process ids after the short startup window.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { config } from "./config.ts";

export interface ProfileLock {
	pid: number;
	port: number;
	startedAt: number;
}

const LOCK = "web-gateway.lock";
const CLAIM_RETRY_COUNT = 40;
const CLAIM_RETRY_MS = 50;
/** A newly written lock may precede the gateway listener by a short startup window. */
const STARTUP_GRACE_MS = 10_000;

let claimed: { file: string; record: ProfileLock } | undefined;

/** The profile this gateway writes into; `sessionsRoot` is always `<profile>/sessions`. */
export function profileDir(): string {
	return path.dirname(config.sessionsRoot);
}

export function lockFile(): string {
	return path.join(profileDir(), LOCK);
}

export async function readLock(file = lockFile()): Promise<ProfileLock | undefined> {
	try {
		const value = (await Bun.file(file).json()) as Partial<ProfileLock>;
		if (typeof value.pid !== "number" || typeof value.port !== "number") return undefined;
		return { pid: value.pid, port: value.port, startedAt: Number(value.startedAt) || 0 };
	} catch {
		return undefined;
	}
}

function pidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/** The pid a running gateway reports on that port, or nothing when nobody answers. */
export async function gatewayPid(port: number): Promise<number | undefined> {
	try {
		const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(700) });
		if (!res.ok) return undefined;
		const pid = ((await res.json()) as { pid?: unknown }).pid;
		return typeof pid === "number" ? pid : undefined;
	} catch {
		return undefined;
	}
}

/** Somebody else is really serving this profile right now. */
export async function activeOwner(): Promise<ProfileLock | undefined> {
	const owner = await readLock();
	if (!owner || owner.pid === process.pid) return undefined;
	if (!pidAlive(owner.pid)) return undefined;
	// The pid alone is not enough: Windows reuses pids, and the lock may predate a crash.
	return (await gatewayPid(owner.port)) === owner.pid ? owner : undefined;
}

/** Create the claim without a check-then-write window. */
async function tryCreateLock(file: string, record: ProfileLock): Promise<boolean> {
	try {
		const handle = await fs.open(file, "wx");
		try {
			await handle.writeFile(JSON.stringify(record));
		} finally {
			await handle.close();
		}
		return true;
	} catch (error) {
		if ((error as { code?: string }).code === "EEXIST") return false;
		throw error;
	}
}

/** A contender can observe the exclusive file before its JSON body is visible. */
async function readAfterRace(file: string): Promise<ProfileLock | undefined> {
	for (let i = 0; i < CLAIM_RETRY_COUNT; i++) {
		const owner = await readLock(file);
		if (owner) return owner;
		if (!(await Bun.file(file).exists())) return undefined;
		await Bun.sleep(CLAIM_RETRY_MS);
	}
	return undefined;
}

/**
 * Take the profile for this process. A live lock whose listener is still starting is also an
 * owner; otherwise two gateways can both pass the health probe before either one listens.
 */
export async function claimProfileLock(): Promise<{ owner?: ProfileLock; file: string }> {
	const file = lockFile();
	const owner = await activeOwner();
	if (owner) return { owner, file };
	await fs.mkdir(path.dirname(file), { recursive: true });
	const record = { pid: process.pid, port: config.port, startedAt: Date.now() } satisfies ProfileLock;

	for (let attempt = 0; attempt < CLAIM_RETRY_COUNT; attempt++) {
		if (await tryCreateLock(file, record)) {
			claimed = { file, record };
			return { file };
		}

		const existing = await readAfterRace(file);
		if (!existing) {
			await fs.rm(file, { force: true });
			continue;
		}
		if (existing.pid === process.pid) {
			claimed = { file, record: existing };
			return { file };
		}
		if (!pidAlive(existing.pid)) {
			await fs.rm(file, { force: true });
			continue;
		}
		const serving = await gatewayPid(existing.port);
		if (serving === existing.pid || Date.now() - existing.startedAt <= STARTUP_GRACE_MS) return { owner: existing, file };
		// A live pid with an old, non-serving record is the recycled-pid case. Take it over.
		await fs.rm(file, { force: true });
	}
	throw new Error(`无法获取 OMP 配置目录锁：${file}`);
}

/** Drop only the exact record this process claimed; never remove a newer owner's lock. */
export async function releaseProfileLock(file = lockFile()): Promise<void> {
	const owner = await readLock(file);
	if (!owner || !claimed || claimed.file !== file || owner.pid !== claimed.record.pid || owner.port !== claimed.record.port || owner.startedAt !== claimed.record.startedAt) return;
	await fs.rm(file, { force: true }).catch(() => undefined);
	if (claimed.file === file) claimed = undefined;
}
