/**
 * Read and write OMP's own configuration through the `omp config` CLI instead of
 * editing `config.yml` by hand, so OMP validates and persists exactly the way the
 * terminal's `/settings` does, and terminal sessions see the same values.
 *
 * Reads are cached briefly; every write is a read-modify-write of a whole record
 * or array, so writes run one at a time through a promise chain.
 */
import { CONFIG_KEYS } from "../shared/omp/conventions.ts";
import { RECORD_SETTINGS, specOf, validateRecordField, validateSetting, WRITABLE_KEYS } from "../shared/omp/settings.ts";
import { HttpError } from "./http-error.ts";
import { type Lang, msg } from "./messages.ts";
import { ompConfigListArgs, ompConfigSetArgs, runOmp } from "./omp/cli.ts";

const CACHE_MS = 30_000;

/** The only keys the gateway may write; anything else is refused. */
const WRITEABLE = new Set<string>([...Object.values(CONFIG_KEYS), ...WRITABLE_KEYS, ...RECORD_SETTINGS.map(s => s.key)]);

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

export function assertRoleValue(value: string, lang: Lang = "zh"): void {
	if (!ROLE_VALUE.test(value)) throw new HttpError(msg(lang, ["模型值格式不对：{value}", "Bad model value: {value}"], { value }), 400);
}

export function assertAgentName(name: string, lang: Lang = "zh"): void {
	if (!AGENT_NAME.test(name)) throw new HttpError(msg(lang, ["子代理名不合法：{name}", "Invalid subagent name: {name}"], { name }), 400);
}

export function assertSkillName(name: string, lang: Lang = "zh"): void {
	if (!SKILL_NAME.test(name)) throw new HttpError(msg(lang, ["技能名不合法：{name}", "Invalid skill name: {name}"], { name }), 400);
}

function assertWritable(key: string, lang: Lang): void {
	if (!WRITEABLE.has(key)) throw new HttpError(msg(lang, ["不允许写入配置键：{key}", "Config key not writable: {key}"], { key }), 403);
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

async function listAll(fresh = false, lang: Lang = "zh"): Promise<ConfigAll> {
	if (!fresh && cache && Date.now() - cache.at < CACHE_MS) return cache.all;
	const startedAt = Date.now();
	const r = await runOmp(ompConfigListArgs());
	if (r.code !== 0) throw new HttpError(stderrTail(r.stderr) || msg(lang, ["无法读取 OMP 配置", "Could not read the OMP config"]), 500);
	let all: ConfigAll;
	try {
		all = JSON.parse(r.stdout) as ConfigAll;
	} catch {
		throw new HttpError(msg(lang, ["无法解析 OMP 配置", "Could not parse the OMP config"]), 500);
	}
	if (!fresh && startedAt > lastWriteAt) cache = { at: Date.now(), all };
	return all;
}

/** Current values of the given keys; keys OMP does not report come back undefined. */
export async function readSettings(keys: string[], lang: Lang = "zh"): Promise<Record<string, unknown>> {
	const all = await listAll(false, lang);
	const out: Record<string, unknown> = {};
	for (const key of keys) out[key] = all[key]?.value;
	return out;
}

/**
 * Every setting OMP reports, with its type and its own description.
 *
 * 用在哪裡：設定頁要讓人看得到並改得動 OMP 自己的設定。OMP 的 schema 有五百多個鍵，
 * 全部回傳是幾十 KB；客戶端只挑出值得改的那些，其餘留給搜尋。
 */
export async function readAllSettings(lang: Lang = "zh"): Promise<Record<string, ConfigEntry>> {
	return await listAll(false, lang);
}

/**
 * Write one curated setting, after checking the value is the shape it accepts.
 *
 * 為什麼要先擋：`omp config set` 會照寫任何東西。壞掉的設定比不能改更麻煩，
 * 而且使用者看不出是哪裡壞了。
 */
export async function writeSettingValue(key: string, raw: string, lang: Lang = "zh"): Promise<void> {
	const spec = specOf(key);
	if (!spec) throw new HttpError(msg(lang, ["不允许写入配置键：{key}", "Config key not writable: {key}"], { key }), 403);
	const checked = validateSetting(spec, raw);
	if (!checked.ok) throw new HttpError(msg(lang, ["{key} 的值不合法：{reason}", "Bad value for {key}: {reason}"], { key, reason: checked.reason }), 400);
	await writeSetting(key, checked.value, lang);
}

/**
 * Write one field of a record-shaped setting, leaving the other fields alone.
 *
 * 記錄型設定（模型角色、逐工具批准）要逐欄位改：整鍵寫回去會把沒動到的欄位一起
 * 蓋掉，所以走讀出來、只改一個欄位、寫回去。
 */
export async function writeRecordField(key: string, field: string, raw: string, lang: Lang = "zh"): Promise<void> {
	const spec = RECORD_SETTINGS.find(s => s.key === key);
	if (!spec) throw new HttpError(msg(lang, ["不允许写入配置键：{key}", "Config key not writable: {key}"], { key }), 403);
	const checked = validateRecordField(spec, field, raw);
	if (!checked.ok) throw new HttpError(msg(lang, ["{key} 的值不合法：{reason}", "Bad value for {key}: {reason}"], { key, reason: checked.reason }), 400);
	await patchRecord(key, field, checked.value, lang);
}

/** One key's full entry (value plus shadowing info), bypassing the cache. */
export async function readEntry(key: string, lang: Lang = "zh"): Promise<ConfigEntry | undefined> {
	return (await listAll(true, lang))[key];
}

async function set(key: string, value: unknown, lang: Lang): Promise<void> {
	const r = await runOmp(ompConfigSetArgs(key, JSON.stringify(value)));
	if (r.code !== 0) throw new HttpError(stderrTail(r.stderr) || msg(lang, ["写入 {key} 失败", "Could not write {key}"], { key }), 400);
	lastWriteAt = Date.now();
	cache = undefined;
}

function queued<T>(fn: () => Promise<T>): Promise<T> {
	const next = queue.then(fn, fn);
	queue = next.catch(() => undefined);
	return next;
}

/** Write one key wholesale; the value reaches `omp config set` as JSON text. */
export async function writeSetting(key: string, value: unknown, lang: Lang = "zh"): Promise<void> {
	assertWritable(key, lang);
	await queued(() => set(key, value, lang));
}

/** Change one field of a record-valued key, or delete it when value is undefined. */
export async function patchRecord(key: string, field: string, value: string | undefined, lang: Lang = "zh"): Promise<void> {
	assertWritable(key, lang);
	await queued(async () => {
		const current = (await listAll(true, lang))[key]?.value;
		if (current !== undefined && (typeof current !== "object" || Array.isArray(current))) throw new HttpError(msg(lang, ["{key} 不是对象", "{key} is not an object"], { key }), 409);
		const next = { ...(current as Record<string, unknown> | undefined) };
		if (value === undefined) delete next[field];
		else next[field] = value;
		await set(key, next, lang);
	});
}

/** Add or remove one element of an array-valued key; adding an existing element is a no-op. */
export async function toggleInArray(key: string, item: string, present: boolean, lang: Lang = "zh"): Promise<void> {
	assertWritable(key, lang);
	await queued(async () => {
		const current = (await listAll(true, lang))[key]?.value;
		if (current !== undefined && !Array.isArray(current)) throw new HttpError(msg(lang, ["{key} 不是数组", "{key} is not an array"], { key }), 409);
		const array = (current ?? []) as string[];
		const has = array.includes(item);
		if (has === present) return;
		await set(key, present ? [...array, item] : array.filter(x => x !== item), lang);
	});
}
