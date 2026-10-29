/**
 * Model list without a live session (`omp models --json`), for pickers shown
 * before any process runs, e.g. reopening a session whose saved model is gone.
 *
 * A cold `omp models` costs ~11s, so the list is served stale-while-revalidate:
 * an expired entry still answers immediately while one refresh runs behind it,
 * and the last good list survives a restart through a file under `dataDir`.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { config } from "./config.ts";
import { HttpError } from "./http-error.ts";
import { type Lang, msg } from "./messages.ts";
import { ompModelsArgs, runOmp } from "./omp/cli.ts";

interface ModelsEntry {
	models: unknown[];
	fetchedAt: number;
}

const TTL_MS = 60_000;

/** Kept after it expires: stale data still answers, which is the whole point. */
let entry: ModelsEntry | undefined;
/** One spawn at a time: the boot warm-up and the first picker can overlap. */
let inFlight: Promise<unknown[]> | undefined;
/** Bumped by `invalidateModels()`; a load that started before it may not store. */
let generation = 0;

const cacheFile = () => path.join(config.dataDir, "models-cache.json");
/** The disk file is shared by every profile directory, so it records its own. */
const agentKey = () => config.agentDir ?? "default";

function isFresh(e: ModelsEntry): boolean {
	return Date.now() - e.fetchedAt < TTL_MS;
}

/**
 * `omp models` answered with nothing usable. The load is shared by every caller and by the
 * boot warm-up, so it carries no wording of its own: `listModels` turns it into a 500 in the
 * language of the request that is actually waiting.
 */
class ModelsUnavailableError extends Error {}

async function spawnModels(): Promise<unknown[]> {
	const r = await runOmp(ompModelsArgs());
	if (r.code !== 0) throw new ModelsUnavailableError("omp models failed");
	try {
		const parsed = JSON.parse(r.stdout) as { models?: unknown[] };
		return (parsed.models ?? []).filter(m => (m as { kind?: string }).kind !== "image");
	} catch {
		throw new ModelsUnavailableError("omp models did not answer with JSON");
	}
}

function startLoad(): Promise<unknown[]> {
	const gen = generation;
	const load: Promise<unknown[]> = spawnModels()
		.then(models => {
			// A result from before an invalidate is thrown away rather than stored.
			if (generation === gen) {
				entry = { models, fetchedAt: Date.now() };
				void saveDisk();
			}
			return models;
		})
		.finally(() => {
			if (inFlight === load) inFlight = undefined;
		});
	inFlight = load;
	return load;
}

/** Refresh behind the caller, never failing on their behalf. */
function backgroundRefresh(): void {
	void (inFlight ?? startLoad()).catch(() => undefined);
}

function readDisk(): void {
	try {
		const data = JSON.parse(fs.readFileSync(cacheFile(), "utf8")) as { fetchedAt?: number; agentDir?: string; models?: unknown[] };
		if (!Array.isArray(data.models) || data.agentDir !== agentKey()) return;
		entry = { models: data.models, fetchedAt: Number(data.fetchedAt) || 0 };
	} catch {
		// no usable cache yet
	}
}

async function saveDisk(): Promise<void> {
	if (!entry) return;
	try {
		await Bun.write(cacheFile(), JSON.stringify({ fetchedAt: entry.fetchedAt, agentDir: agentKey(), models: entry.models }, null, 2));
	} catch {
		// one less layer of cache; the in-memory entry still works
	}
}

export async function listModels(lang: Lang = "zh"): Promise<{ models: unknown[]; stale: boolean }> {
	if (entry && isFresh(entry)) return { models: entry.models, stale: false };
	if (entry) {
		backgroundRefresh();
		return { models: entry.models, stale: true };
	}
	try {
		return { models: await (inFlight ?? startLoad()), stale: false };
	} catch (error) {
		if (error instanceof ModelsUnavailableError) throw new HttpError(msg(lang, ["无法读取模型列表", "Could not read the model list"]), 500);
		throw error;
	}
}

/**
 * Selectors for flagging config that points at a model which no longer exists.
 * Never blocks: any entry, however old, is better than no answer, and a refresh
 * of an expired one runs behind it. `undefined` means we have no data at all.
 */
export function cachedModelSelectors(): Set<string> | undefined {
	if (!entry) return undefined;
	if (!isFresh(entry)) backgroundRefresh();
	return new Set((entry.models as { provider?: string; id?: string }[]).map(m => `${m.provider}/${m.id}`));
}

/** Drop everything: used when a write changes `models.yml`. */
export function invalidateModels(): void {
	generation++;
	entry = undefined;
	inFlight = undefined;
	// 同步刪除：非同步的 rm 會在呼叫端返回之後才落地，可能把之後才寫進來的
	// 快取檔一起刪掉（讀到舊磁碟檔的冷啟動路徑就會多跑一次 `omp models`）。
	// 這裡的量級是一個小 JSON 檔，同步寫入的等待時間可以忽略。
	try {
		fs.rmSync(cacheFile(), { force: true });
	} catch {
		// 沒有檔案就沒有東西要清
	}
}

/** Load the last good list off disk before the first request needs it, then refresh. */
export function warmModels(): void {
	if (!entry) readDisk();
	backgroundRefresh();
}
