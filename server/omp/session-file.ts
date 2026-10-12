/**
 * omp's session file format: how a transcript announces itself and what its records
 * are called.
 *
 * The rules are omp's, and they are strict ones — its loader only treats line 0 as the
 * title slot when that line is a full slot (`v: 1` with `pad`), and it refuses to open a
 * file whose next record is not the `session` header. This app mirrors that exactly,
 * because listing a file omp cannot resume would offer the user a session that errors
 * the moment it is clicked.
 *
 * Source of these rules: omp 18.8.6, `packages/coding-agent/src/session/session-loader.ts`
 * and `session-title-slot.ts`.
 */
import * as fs from "node:fs/promises";
import { textOf } from "../../shared/omp/wire.ts";

/** How much of the head and of the tail is read: the header is at the top, the newest message at the bottom. */
export const HEAD_BYTES = 96 * 1024;
export const TAIL_BYTES = 32 * 1024;

/** Record types in a session file. Only the four the index needs. */
const RECORD_TITLE = "title";
const RECORD_SESSION = "session";
const RECORD_SESSION_INFO = "session_info";
const RECORD_MESSAGE = "message";

/** Line 0 of a session file: omp's fixed-size title slot. */
interface TitleSlot {
	type: typeof RECORD_TITLE;
	v: 1;
	title: string;
	updatedAt: string;
	pad: string;
	[k: string]: unknown;
}

/** The `session` header: what omp needs in order to resume the file at all. */
export interface OmpSessionHeader {
	id: string;
	cwd?: string;
	timestamp?: string;
	/** A path when the user branched or started a session from one; an id when omp saved away. */
	parentSession?: string;
	/**
	 * Kept across a save-as so the provider's prompt cache still hits: the id this file
	 * was copied from, or that original's key when the copy itself was copied again.
	 */
	providerPromptCacheKey?: string;
}

export interface OmpSessionHead {
	/** From the title slot or a later `session_info` name; empty when neither set one. */
	title: string;
	header: OmpSessionHeader;
	/** First user message, as the fallback title. */
	firstUser: string;
}

/** One JSONL line, or undefined when it is not a record (blank, or cut in half by the head window). */
function parseLine(line: string): Record<string, unknown> | undefined {
	if (!line.startsWith("{")) return undefined;
	try {
		const value: unknown = JSON.parse(line);
		return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
	} catch {
		return undefined;
	}
}

/** A full title slot, judged the way omp's loader judges it. */
function isTitleSlot(entry: Record<string, unknown> | undefined): entry is TitleSlot {
	return (
		!!entry &&
		entry.type === RECORD_TITLE &&
		entry.v === 1 &&
		typeof entry.title === "string" &&
		typeof entry.updatedAt === "string" &&
		typeof entry.pad === "string"
	);
}

/** Read the identity even when a new session has no user message or title yet. */
export async function readSessionId(file: string): Promise<string | undefined> {
	const lines = (await Bun.file(file).slice(0, HEAD_BYTES).text()).split("\n");
	const header = parseLine(lines[isTitleSlot(parseLine(lines[0] ?? "")) ? 1 : 0] ?? "");
	return header?.type === RECORD_SESSION && typeof header.id === "string" && header.id ? header.id : undefined;
}

/**
 * Read the head of a session file. Null when omp would not recognise the file: no
 * `session` header with an id, or nothing in it a user ever wrote.
 */
export async function readSessionHead(file: string): Promise<OmpSessionHead | null> {
	const head = await Bun.file(file).slice(0, HEAD_BYTES).text();
	const lines = head.split("\n");
	const slot = parseLine(lines[0] ?? "");
	const hasSlot = isTitleSlot(slot);
	let title = hasSlot ? slot.title : "";
	const headerEntry = parseLine(lines[hasSlot ? 1 : 0] ?? "");
	if (headerEntry?.type !== RECORD_SESSION || typeof headerEntry.id !== "string") return null;
	const header = headerEntry as unknown as OmpSessionHeader;
	let firstUser = "";
	for (const line of lines.slice(hasSlot ? 2 : 1)) {
		const entry = parseLine(line);
		if (!entry) continue;
		if (entry.type === RECORD_TITLE && typeof entry.title === "string") title = entry.title;
		else if (entry.type === RECORD_SESSION_INFO && typeof entry.name === "string" && entry.name) title = entry.name;
		else if (entry.type === RECORD_MESSAGE && !firstUser) {
			const message = entry.message as { role?: string; content?: unknown } | undefined;
			if (message?.role === "user") firstUser = textOf(message.content);
		}
		if (title && firstUser) break;
	}
	if (!header.id) return null;
	if (!firstUser && !title.trim()) return null;
	return { title, header, firstUser };
}

/**
 * Timestamp of the newest `message` record, read backwards from the end of the file.
 * A session file is also appended to by lifecycle records (`model_change`,
 * `session_exit`), so its mtime would make an untouched old conversation look like it
 * happened today.
 */
export async function readLastMessageTime(file: string, size: number): Promise<number | undefined> {
	if (size <= 0) return undefined;
	const start = Math.max(0, size - TAIL_BYTES);
	const handle = await fs.open(file, "r");
	try {
		const buffer = Buffer.allocUnsafe(size - start);
		await handle.read(buffer, 0, buffer.byteLength, start);
		const lines = buffer.toString("utf8").split("\n");
		for (let i = lines.length - 1; i >= 0; i--) {
			const entry = parseLine(lines[i].trim());
			if (entry?.type !== RECORD_MESSAGE || typeof entry.timestamp !== "string") continue;
			const stamp = Date.parse(entry.timestamp);
			if (Number.isFinite(stamp)) return stamp;
		}
	} finally {
		await handle.close();
	}
	return undefined;
}
