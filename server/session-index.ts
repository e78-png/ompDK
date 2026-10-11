/**
 * Read-only index of OMP session files (`<agentDir>/sessions/<encoded-cwd>/*.jsonl`).
 *
 * The format itself belongs to `./omp/session-file.ts`; this module only decides what
 * a session is *called* and keeps the answers cached by (mtime, size). A title comes
 * from the file's title slot or a `session_info` name, falling back to the first user
 * message, and the newest real message from the tail gives `activeAt`, because a
 * session file is also appended to by lifecycle records (`model_change`,
 * `session_exit`) that would otherwise make an untouched old conversation look like it
 * happened today.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { SessionSummary } from "../shared/api.ts";
import { config } from "./config.ts";
import { readLastMessageTime, readSessionHead } from "./omp/session-file.ts";

interface CacheEntry {
	mtimeMs: number;
	size: number;
	summary: SessionSummary | null;
	/** `providerPromptCacheKey`, kept out of the summary but needed to spot a save-as. */
	cacheKey?: string;
}

const cache = new Map<string, CacheEntry>();

export function titleFromText(text: string): string {
	const line = text.replace(/\s+/g, " ").trim();
	return line.length > 60 ? `${line.slice(0, 60)}…` : line;
}

/** What decides "omp saved this file away" from "the user branched it". */
export interface SessionHeadFacts {
	path: string;
	id: string;
	parent?: string;
	cacheKey?: string;
}

/**
 * Which sessions are omp's own saved-as copies, keyed by path and pointing at the original.
 * A save-away re-stamps `parentSession` with the previous id and carries over the prompt cache
 * key that header was already carrying (its own, or the previous id when it had none), so the
 * test is the child's key matching its parent's. A branch names a *path* in `parentSession`
 * instead, which resolves to no session here, so it cannot match. Following the key rather than
 * only the first hop matters: of the 13 saved-as siblings in a real profile scan, 5 were copies
 * of copies and would have gone unmarked.
 */
export function findCopies(items: SessionHeadFacts[]): Map<string, string> {
	const byId = new Map(items.filter(item => item.id).map(item => [item.id, item]));
	const copies = new Map<string, string>();
	for (const item of items) {
		if (!item.parent || !item.cacheKey) continue;
		const original = byId.get(item.parent);
		if (!original || original.path === item.path) continue;
		if (item.cacheKey === (original.cacheKey ?? original.id)) copies.set(item.path, original.path);
	}
	return copies;
}

/** Null when omp would not recognise the file, or when nothing in it was written by a user. */
async function summarize(file: string, mtimeMs: number, size: number): Promise<{ summary: SessionSummary | null; cacheKey?: string }> {
	const head = await readSessionHead(file);
	if (!head) return { summary: null };
	const created = head.header.timestamp ? Date.parse(head.header.timestamp) : mtimeMs;
	return {
		summary: {
			path: file,
			id: head.header.id,
			cwd: head.header.cwd ?? "",
			title: head.title.trim() || titleFromText(head.firstUser) || "新会话",
			created,
			modified: mtimeMs,
			// Falls back to the session's own start when the tail window holds no message.
			activeAt: (await readLastMessageTime(file, size)) ?? created,
			parent: head.header.parentSession,
		},
		cacheKey: head.header.providerPromptCacheKey,
	};
}

/** All sessions across projects, newest first. Empty sessions (no user message) are skipped unless live. */
export async function listSessions(): Promise<SessionSummary[]> {
	let dirs: string[];
	try {
		dirs = await fs.readdir(config.sessionsRoot);
	} catch {
		return [];
	}
	const files: string[] = [];
	await Promise.all(
		dirs.map(async dir => {
			try {
				for (const name of await fs.readdir(path.join(config.sessionsRoot, dir))) {
					if (name.endsWith(".jsonl")) files.push(path.join(config.sessionsRoot, dir, name));
				}
			} catch {
				// not a directory
			}
		}),
	);
	const seen = new Set(files);
	for (const key of cache.keys()) if (!seen.has(key)) cache.delete(key);

	const out: { summary: SessionSummary; cacheKey?: string }[] = [];
	await Promise.all(
		files.map(async file => {
			try {
				const stat = await fs.stat(file);
				let entry = cache.get(file);
				if (!entry || entry.mtimeMs !== stat.mtimeMs || entry.size !== stat.size) {
					const read = await summarize(file, stat.mtimeMs, stat.size);
					entry = { mtimeMs: stat.mtimeMs, size: stat.size, summary: read.summary, cacheKey: read.cacheKey };
					cache.set(file, entry);
				}
				if (entry.summary) out.push({ summary: entry.summary, cacheKey: entry.cacheKey });
			} catch {
				// vanished mid-scan
			}
		}),
	);
	// Every summary is assigned, not only the copies: cached objects outlive the header that made them a copy.
	const copies = findCopies(out.map(row => ({ path: row.summary.path, id: row.summary.id, parent: row.summary.parent, cacheKey: row.cacheKey })));
	for (const row of out) row.summary.copyOf = copies.get(row.summary.path);
	const sessions = out.map(row => row.summary);
	// Newest real activity first: the file mtime only tracks omp's own bookkeeping writes.
	return sessions.sort((a, b) => b.activeAt - a.activeAt);
}

export function samePath(a: string, b: string): boolean {
	const norm = (p: string) => {
		const r = path.resolve(p);
		return process.platform === "win32" ? r.toLowerCase() : r;
	};
	return norm(a) === norm(b);
}
