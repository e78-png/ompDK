/**
 * Read and write OMP's own configuration through the `omp config` CLI instead of
 * editing `config.yml` by hand, so OMP validates and persists exactly the way the
 * terminal's `/settings` does, and terminal sessions see the same values.
 *
 * Reads are cached briefly; every write is a read-modify-write of a whole record
 * or array, so writes run one at a time through a promise chain.
 */
import { CONFIG_KEYS } from "../shared/omp/conventions.ts";
import { HttpError } from "./http-error.ts";
import { ompConfigListArgs, ompConfigSetArgs, runOmp } from "./omp/cli.ts";

const CACHE_MS = 30_000;

/** The only keys the gateway may write; anything else is refused. */
const WRITEABLE = new Set<string>(Object.values(CONFIG_KEYS));

const ROLE_VALUE = /^[^\s/]+\/[^\s:]+(:(off|minimal|low|medium|high|xhigh|max))?$/;
const AGENT_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export interface ConfigEntry {
	value?: unknown;
	type?: string;
	description?: string;
	/** Set when a project setting or env var overrides the written value. */
	shadowingSource?: string;
}
type ConfigAll = Record<string, ConfigEntry>;

let cache: { at: number; all: ConfigAll } | undefined;
/**
 * Reads are not queued behind writes, so one can be in flight when a write lands and
 * come back holding the pre-write config. A read that started before the last write may
 * not refill the cache, or a setting would appear to snap back to its old value for 30s.
 */
let lastWriteAt = 0;
/** Writes run one at a time so two read-modify-write cycles cannot interleave. */
let queue: Promise<unknown> = Promise.resolve();

export function assertRoleValue(value: string): void {
	if (!ROLE_VALUE.test(value)) throw new HttpError(`模型值格式不对：${value}`, 400);
}

export function assertAgentName(name: string): void {
	if (!AGENT_NAME.test(name)) throw new HttpError(`子代理名不合法：${name}`, 400);
}

export function assertSkillName(name: string): void {
	if (!SKILL_NAME.test(name)) throw new HttpError(`技能名不合法：${name}`, 400);
}

function assertWritable(key: string): void {
	if (!WRITEABLE.has(key)) throw new HttpError(`不允许写入配置键：${key}`, 403);
}

function stderrTail(stderr: string): string {
	return stderr
		.trim()
		.split("\n")
		.filter(Boolean)
		.slice(-3)
		.join("\n");
}

/** Drop the read cache; called after writes and by the refresh endpoints. */
export function invalidateSettings(): void {
	cache = undefined;
}

async function listAll(fresh = false): Promise<ConfigAll> {
	if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.all;
	const startedAt = Date.now();
	const r = await runOmp(ompConfigListArgs());
	if (r.code !== 0) throw new HttpError(stderrTail(r.stderr) || "无法读取 OMP 配置", 500);
	let all: ConfigAll;
	try {
		all = JSON.parse(r.stdout) as ConfigAll;
	} catch {
		throw new HttpError("无法解析 OMP 配置", 500);
	}
	if (!fresh && startedAt > lastWriteAt) cache = { at: Date.now(), all };
	return all;
}

/** Current values of the given keys; keys OMP does not report come back undefined. */
export async function readSettings(keys: string[]): Promise<Record<string, unknown>> {
	const all = await listAll();
	const out: Record<string, unknown> = {};
	for (const key of keys) out[key] = all[key]?.value;
	return out;
}

/** One key's full entry (value plus shadowing info), bypassing the cache. */
export async function readEntry(key: string): Promise<ConfigEntry | undefined> {
	return (await listAll(true))[key];
}

async function set(key: string, value: unknown): Promise<void> {
	const r = await runOmp(ompConfigSetArgs(key, JSON.stringify(value)));
	if (r.code !== 0) throw new HttpError(stderrTail(r.stderr) || `写入 ${key} 失败`, 400);
	lastWriteAt = Date.now();
	cache = undefined;
}

function queued<T>(fn: () => Promise<T>): Promise<T> {
	const next = queue.then(fn, fn);
	queue = next.catch(() => undefined);
	return next;
}

/** Write one key wholesale; the value reaches `omp config set` as JSON text. */
export async function writeSetting(key: string, value: unknown): Promise<void> {
	assertWritable(key);
	await queued(() => set(key, value));
}

/** Change one field of a record-valued key, or delete it when value is undefined. */
export async function patchRecord(key: string, field: string, value: string | undefined): Promise<void> {
	assertWritable(key);
	await queued(async () => {
		const current = (await listAll(true))[key]?.value;
		if (current !== undefined && (typeof current !== "object" || Array.isArray(current))) throw new HttpError(`${key} 不是对象`, 409);
		const next = { ...(current as Record<string, unknown> | undefined) };
		if (value === undefined) delete next[field];
		else next[field] = value;
		await set(key, next);
	});
}

/** Add or remove one element of an array-valued key; adding an existing element is a no-op. */
export async function toggleInArray(key: string, item: string, present: boolean): Promise<void> {
	assertWritable(key);
	await queued(async () => {
		const current = (await listAll(true))[key]?.value;
		if (current !== undefined && !Array.isArray(current)) throw new HttpError(`${key} 不是数组`, 409);
		const array = (current ?? []) as string[];
		const has = array.includes(item);
		if (has === present) return;
		await set(key, present ? [...array, item] : array.filter(x => x !== item));
	});
}
