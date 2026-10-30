/** Display history follows the active leaf, without applying model compaction. */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { MESSAGE_ROLES, SUMMARY_ROLES } from "../../shared/omp/conventions.ts";
import type { AgentMessage } from "../../shared/omp/wire.ts";
import { config } from "../config.ts";

export interface HistoryEntry {
	type: string;
	id?: string;
	parentId?: string | null;
	timestamp?: string;
	message?: AgentMessage;
	[k: string]: unknown;
}

export function branchEntries(entries: HistoryEntry[], leafId?: string | null): HistoryEntry[] {
	const indexed = entries.filter(e => typeof e.id === "string" && e.type !== "session");
	if (indexed.length === 0) return entries.filter(e => e.type !== "session" && e.type !== "title");
	const byId = new Map(indexed.map(e => [e.id!, e]));
	let next = leafId === undefined ? indexed.at(-1)?.id : leafId;
	const seen = new Set<string>();
	const branch: HistoryEntry[] = [];
	while (next) {
		if (seen.has(next)) throw new Error("会话分支记录形成循环");
		seen.add(next);
		const entry = byId.get(next);
		if (!entry) throw new Error("会话分支记录不完整");
		branch.push(entry);
		next = entry.parentId;
	}
	return branch.reverse();
}

export function transcriptMessages(branch: HistoryEntry[]): AgentMessage[] {
	const messages: AgentMessage[] = [];
	const reset = branch.findLastIndex(e => e.type === "reset_boundary");
	for (const entry of branch.slice(reset + 1)) {
		if (entry.type === "message" && entry.message) messages.push(entry.message);
		else if (entry.type === "custom_message") {
			messages.push({ role: MESSAGE_ROLES.custom, customType: entry.customType, content: entry.content, display: entry.display, details: entry.details, timestamp: Date.parse(entry.timestamp ?? "") } as AgentMessage);
		} else if (entry.type === "compaction" || entry.type === "branch_summary") {
			messages.push({ role: entry.type === "compaction" ? SUMMARY_ROLES.compaction : SUMMARY_ROLES.branch, content: entry.summary ?? "", timestamp: Date.parse(entry.timestamp ?? "") } as AgentMessage);
		}
	}
	return messages;
}

export function changesTranscript(command: string): boolean {
	return /^\/(?:compact|clear|shake)(?:\s|$)/.test(command);
}

/** OMP externalizes image data as a content-addressed blob; reads never touch its mtime. */
export async function resolveHistoryImages(messages: AgentMessage[]): Promise<AgentMessage[]> {
	return Promise.all(messages.map(async message => {
		if (!Array.isArray(message.content)) return message;
		const content = await Promise.all(message.content.map(async block => {
			if (block.type !== "image" || typeof block.data !== "string") return block;
			const hash = /^blob:sha256:([a-f0-9]{64})$/.exec(block.data)?.[1];
			if (!hash) return block;
			const file = path.join(path.dirname(config.sessionsRoot), "blobs", hash);
			try {
				return { ...block, data: (await fs.readFile(file)).toString("base64") };
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				return { type: "text", text: "[历史图片文件缺失]" };
			}
		}));
		return { ...message, content };
	}));
}

/** Per-view cache: unchanged child transcripts need only a stat, not another full parse. */
export class TranscriptReader {
	#cache = new Map<string, { stamp: string; entries: HistoryEntry[]; messages: AgentMessage[]; size: number; head: string }>();

	async read(file: string): Promise<{ entries: HistoryEntry[]; messages: AgentMessage[]; stamp: string; modified: number }> {
		const stat = await fs.stat(file);
		const stamp = `${stat.size}:${stat.mtimeMs}`;
		const cached = this.#cache.get(file);
		if (cached?.stamp === stamp) return { ...cached, modified: stat.mtimeMs };
		// The whole file parsed again is the expensive part: a 20 MB session is 9,677
		// records and 50 ms of JSON.parse, and a CLI session grows by one record at a
		// time. Only the appended part is new, so only that part is parsed.
		const head = await readHead(file, stat.size);
		let entries: HistoryEntry[];
		if (cached && stat.size > cached.size && head === cached.head) {
			entries = [...cached.entries, ...parseEntries(await readFrom(file, cached.size, stat.size))];
		} else {
			entries = parseEntries(await fs.readFile(file, "utf8"));
		}
		const messages = await resolveHistoryImages(transcriptMessages(branchEntries(entries)));
		this.#cache.set(file, { stamp, entries, messages, size: stat.size, head });
		return { entries, messages, stamp, modified: stat.mtimeMs };
	}
}

/** One JSONL line to one entry; a half-written last line is skipped. */
function parseEntries(text: string): HistoryEntry[] {
	const entries: HistoryEntry[] = [];
	for (const line of text.split("\n")) {
		if (!line.trim()) continue;
		try {
			const entry = JSON.parse(line);
			if (entry && typeof entry.type === "string") entries.push(entry);
		} catch {
			// A writer may not have finished the final JSONL record yet.
		}
	}
	return entries;
}

/** The first few KB, so a rewritten file is not mistaken for an appended one. */
async function readHead(file: string, size: number): Promise<string> {
	const handle = await fs.open(file, "r");
	try {
		const buffer = Buffer.alloc(Math.min(4096, size));
		await handle.read(buffer, 0, buffer.length, 0);
		return buffer.toString("base64");
	} finally {
		await handle.close();
	}
}

/** The bytes between two offsets — the part a writer appended since the last read. */
async function readFrom(file: string, start: number, end: number): Promise<string> {
	const handle = await fs.open(file, "r");
	try {
		const buffer = Buffer.alloc(end - start);
		await handle.read(buffer, 0, buffer.length, start);
		return buffer.toString("utf8");
	} finally {
		await handle.close();
	}
}
