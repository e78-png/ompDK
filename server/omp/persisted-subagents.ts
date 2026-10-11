/** Recover CLI/Web child agents from OMP's sibling artifact directory. */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { AgentMessage, SubagentSnapshot } from "../../shared/omp/wire.ts";
import { branchEntries, TranscriptReader } from "./transcript.ts";

export class PersistedSubagents {
	#files = new Map<string, string>();
	#reader = new TranscriptReader();

	has(id: string): boolean {
		return this.#files.has(id);
	}

	async list(sessionFile: string, messages: AgentMessage[], observing = false): Promise<SubagentSnapshot[]> {
		const root = sessionFile.replace(/\.jsonl$/i, "");
		if (root === sessionFile) return [];
		const results = new Map<string, Record<string, unknown>>();
		const calls: { id: string; name?: string; task?: string; agent?: string }[] = [];
		const collectOwners = (messages: AgentMessage[]) => {
			for (const message of messages) {
				const detail = message.details as { results?: Record<string, unknown>[] } | undefined;
				if (message.toolName === "task" && Array.isArray(detail?.results)) {
					for (const result of detail.results) {
						if (result && typeof result.id === "string") results.set(result.id, { ...result, parentToolCallId: message.toolCallId, recordedAt: message.timestamp });
					}
				}
				if (!Array.isArray(message.content)) continue;
				for (const block of message.content) {
					if (block.type !== "toolCall" || block.name !== "task") continue;
					const args = block.arguments as { tasks?: { name?: string; task?: string }[]; agent?: string } | undefined;
					if (Array.isArray(args?.tasks)) {
						for (const task of args.tasks) calls.push({ id: block.id ?? "", agent: args.agent, ...task });
					}
				}
			}
		};
		collectOwners(messages);
		const all: SubagentSnapshot[] = [];
		this.#files.clear();
		const scan = async (dir: string) => {
			let files;
			try {
				files = await fs.readdir(dir, { withFileTypes: true });
			} catch (error) {
				if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return;
				throw error;
			}
			for (const file of files) {
				if (!file.isFile() || !file.name.endsWith(".jsonl") || file.name.includes(".bak") || file.name.startsWith("__advisor")) continue;
				const sessionFile = path.join(dir, file.name);
				const id = file.name.slice(0, -6);
				const history = await this.#reader.read(sessionFile).catch(error => {
					if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
					throw error;
				});
				if (!history) continue;
				const branch = branchEntries(history.entries);
				const init = branch.find(e => e.type === "session_init");
				const storedResult = results.get(id);
				const last = history.messages.at(-1);
				const result = Number(last?.timestamp ?? 0) > Number(storedResult?.recordedAt ?? Infinity) ? undefined : storedResult;
				const task = typeof init?.task === "string" ? init.task : undefined;
				const call = calls.find(c => c.name === id || (c.task && task?.includes(c.task)));
				// An artifact may belong to an abandoned branch. Keep only current task owners.
				if (!result && !call) continue;
				let status: SubagentSnapshot["status"] = "unknown";
				const progress: Record<string, unknown> = { toolCount: 0, tokens: 0 };
				for (const message of history.messages) {
					if (message.role !== "assistant") continue;
					if (Array.isArray(message.content)) progress.toolCount = Number(progress.toolCount) + message.content.filter(b => b.type === "toolCall").length;
					const usage = message.usage as { totalTokens?: number } | undefined;
					progress.tokens = Number(progress.tokens) + (usage?.totalTokens ?? 0);
				}
				const hasYield = Array.isArray(last?.content) && last.content.some(b => b.type === "toolCall" && b.name === "yield");
				const output = await fs.stat(path.join(dir, `${id}.md`)).catch(error => {
					if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
					throw error;
				});
				if (result?.aborted || last?.stopReason === "aborted") status = "aborted";
				else if (last?.stopReason === "error" || (typeof result?.exitCode === "number" && result.exitCode !== 0)) status = "failed";
				else if (hasYield || (output && output.mtimeMs >= history.modified) || result?.exitCode === 0) status = "completed";
				else if (observing) status = "running";
				all.push({ id, index: typeof result?.index === "number" ? result.index : all.length, agent: String(result?.agent ?? init?.agent ?? call?.agent ?? "子代理"), status, lastUpdate: history.modified, task, description: typeof result?.description === "string" ? result.description : call?.task, parentToolCallId: String(result?.parentToolCallId ?? call?.id ?? ""), sessionFile, progress, readOnly: true });
				this.#files.set(id, sessionFile);
				// Nested transcripts use a directory named after their owning child.
				collectOwners(history.messages);
				await scan(path.join(dir, id));
			}
		};
		await scan(root);
		return all;
	}

	async transcript(id: string, fromByte: unknown): Promise<{ messages: AgentMessage[]; nextByte: number; reset: boolean }> {
		const file = this.#files.get(id);
		if (!file) throw new Error("找不到这个子代理的过程记录");
		const history = await this.#reader.read(file);
		// Full branch replacement avoids duplicates when a child rewinds or compacts.
		const unchanged = typeof fromByte === "number" && fromByte === history.modified;
		return { messages: unchanged ? [] : history.messages, nextByte: history.modified, reset: !unchanged };
	}
}
