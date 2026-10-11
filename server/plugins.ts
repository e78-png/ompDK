/**
 * Skills and plugins for the 插件 page. Both come from the `omp` CLI; skills are
 * listed inside the project directory because project-level skills depend on cwd.
 *
 * `omp skill list` omits disabled skills entirely (OMP filters them out through
 * `disabledExtensions`), so the gateway adds them back from that config key and
 * fills in their metadata from `<dataDir>/skills-seen.json`, written on every
 * successful listing. A skill disabled outside the web UI before it was ever
 * listed therefore shows by name only.
 */
import * as path from "node:path";
import type { PluginItem, SkillItem } from "../shared/api.ts";
import { CONFIG_KEYS, SKILL_EXTENSION_PREFIX } from "../shared/omp/conventions.ts";
import { config } from "./config.ts";
import { HttpError } from "./http-error.ts";
import { assertSkillName, readSettings, toggleInArray } from "./omp-config.ts";
import { ompPluginListArgs, ompPluginToggleArgs, ompSkillListArgs, runOmp } from "./omp/cli.ts";

interface SeenSkill {
	description?: string;
	filePath?: string;
	baseDir?: string;
	source?: string;
	hide?: boolean;
}

const CACHE_MS = 30_000;
const MAX_SKILL_FILE = 256 * 1024;
const PLUGIN_ID = /^[A-Za-z0-9@._:/+-]{1,160}$/;

const skillCache = new Map<string, { at: number; skills: SkillItem[] }>();
let pluginCache: { at: number; result: { npm: PluginItem[]; marketplace: PluginItem[] } } | undefined;
let seenCache: Record<string, SeenSkill> | undefined;

function fail(stderr: string, fallback: string, status = 500): never {
	const tail = stderr
		.trim()
		.split("\n")
		.filter(Boolean)
		.slice(-3)
		.join("\n");
	throw new HttpError(tail || fallback, status);
}

/** Drop every cache; called after writes and by the refresh endpoint. */
export function invalidate(): void {
	skillCache.clear();
	pluginCache = undefined;
	seenCache = undefined;
}

function seenFile(): string {
	return path.join(config.dataDir, "skills-seen.json");
}

async function loadSeen(): Promise<Record<string, SeenSkill>> {
	if (seenCache) return seenCache;
	try {
		seenCache = (await Bun.file(seenFile()).json()) as Record<string, SeenSkill>;
	} catch {
		seenCache = {};
	}
	return seenCache;
}

async function saveSeen(seen: Record<string, SeenSkill>): Promise<void> {
	try {
		await Bun.write(seenFile(), JSON.stringify(seen, null, 2));
	} catch {
		// the cache only improves display; losing it is not an error
	}
}

async function disabledSkillNames(): Promise<Set<string>> {
	try {
		const list = (await readSettings([CONFIG_KEYS.disabledExtensions]))[CONFIG_KEYS.disabledExtensions];
		if (!Array.isArray(list)) return new Set();
		return new Set(
			list
				.filter((x): x is string => typeof x === "string" && x.startsWith(SKILL_EXTENSION_PREFIX))
				.map(x => x.slice(SKILL_EXTENSION_PREFIX.length)),
		);
	} catch {
		return new Set();
	}
}

export async function listSkills(cwd: string): Promise<SkillItem[]> {
	const hit = skillCache.get(cwd);
	if (hit && Date.now() - hit.at < CACHE_MS) return hit.skills;
	const r = await runOmp(ompSkillListArgs(), cwd);
	if (r.code !== 0) fail(r.stderr, "无法读取技能列表");
	let listed: Omit<SkillItem, "enabled">[];
	try {
		listed = ((JSON.parse(r.stdout) as { skills?: Omit<SkillItem, "enabled">[] }).skills ?? []).map(s => ({ ...s, source: s.source ?? "" }));
	} catch {
		throw new HttpError("无法解析技能列表", 500);
	}
	const seen = await loadSeen();
	for (const s of listed) seen[s.name] = { description: s.description, filePath: s.filePath, baseDir: s.baseDir, source: s.source, hide: s.hide };
	await saveSeen(seen);

	const disabled = await disabledSkillNames();
	const out: SkillItem[] = listed.map(s => ({ ...s, enabled: !disabled.has(s.name) }));
	for (const name of disabled) {
		if (listed.some(s => s.name === name)) continue;
		const meta = seen[name];
		out.push({
			name,
			description: meta?.description ?? "已停用（在 Web 之外停用，无详细信息）",
			filePath: meta?.filePath,
			baseDir: meta?.baseDir,
			source: meta?.source ?? "",
			hide: meta?.hide === true,
			enabled: false,
		});
	}
	const skills = out.sort((a, b) => a.name.localeCompare(b.name));
	skillCache.set(cwd, { at: Date.now(), skills });
	return skills;
}

export async function setSkillEnabled(name: string, enabled: boolean): Promise<void> {
	assertSkillName(name);
	await toggleInArray(CONFIG_KEYS.disabledExtensions, `${SKILL_EXTENSION_PREFIX}${name}`, !enabled);
	invalidate();
}

/** Path of a skill's SKILL.md, taken only from a known record — never from the client. */
export async function skillFilePath(name: string, cwd: string): Promise<string> {
	assertSkillName(name);
	const known = (await listSkills(cwd)).find(s => s.name === name);
	const file = known?.filePath ?? (await loadSeen())[name]?.filePath;
	if (!file) throw new HttpError("未知技能，或该技能没有可读文件", 404);
	return file;
}

export async function readSkillFile(name: string, cwd: string): Promise<string> {
	const file = await skillFilePath(name, cwd);
	const text = await Bun.file(file).text().catch(() => {
		throw new HttpError("读取技能文件失败", 500);
	});
	if (Buffer.byteLength(text, "utf8") > MAX_SKILL_FILE) return `${text.slice(0, MAX_SKILL_FILE)}\n\n…文件超过 256 KB，已截断。`;
	return text;
}

function toPlugin(raw: Record<string, unknown>, kind: "npm" | "marketplace"): PluginItem {
	const name = String(raw.name ?? raw.package ?? raw.id ?? "");
	const id = String(raw.id ?? (typeof raw.marketplace === "string" ? `${name}@${raw.marketplace}` : name));
	return { ...raw, id, name, kind };
}

export async function listPlugins(): Promise<{ npm: PluginItem[]; marketplace: PluginItem[] }> {
	if (pluginCache && Date.now() - pluginCache.at < CACHE_MS) return pluginCache.result;
	const r = await runOmp(ompPluginListArgs());
	if (r.code !== 0) fail(r.stderr, "无法读取插件列表");
	let parsed: { npm?: Record<string, unknown>[]; marketplace?: Record<string, unknown>[] };
	try {
		parsed = JSON.parse(r.stdout) as typeof parsed;
	} catch {
		throw new HttpError("无法解析插件列表", 500);
	}
	const result = {
		npm: (parsed.npm ?? []).map(p => toPlugin(p, "npm")),
		marketplace: (parsed.marketplace ?? []).map(p => toPlugin(p, "marketplace")),
	};
	pluginCache = { at: Date.now(), result };
	return result;
}

/** Only marketplace plugins are switchable, matching `omp plugin enable|disable`. */
export async function setPluginEnabled(id: string, enabled: boolean): Promise<void> {
	if (!PLUGIN_ID.test(id)) throw new HttpError("插件 ID 不合法", 400);
	const r = await runOmp(ompPluginToggleArgs(id, enabled));
	if (r.code !== 0) fail(r.stderr, enabled ? "启用插件失败" : "停用插件失败", 400);
	pluginCache = undefined;
}
