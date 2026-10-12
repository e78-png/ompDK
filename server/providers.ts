/**
 * Custom provider editing for `<agentDir>/models.yml`.
 *
 * omp owns this file and people hand-tune it (headers, compat, authHeader,
 * extra per-model fields). So edits are surgical: the file is parsed to read and
 * merge, then only the edited provider's own block is regenerated — every other
 * byte, comment included, is left alone. Each write keeps a timestamped backup.
 *
 * A surgical write is a positional splice, so it is checked twice: the written block
 * must round-trip through our own parser, and `omp models --json` must still read the
 * profile and list the providers it listed before. Either failing restores the backup.
 */
import * as path from "node:path";
import type { ProviderConfig, ProviderModel, ProvidersView } from "../shared/api.ts";
import { OMP_LAYOUT } from "../shared/omp/conventions.ts";
import { config } from "./config.ts";
import { type Lang, msg } from "./messages.ts";
import { ompModelsArgs, runOmp } from "./omp/cli.ts";

export type { ProviderConfig, ProviderModel, ProvidersView };

const ID_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

/** `<agentDir>/models.yml` — the file omp reads providers from. */
export function modelsFile(): string {
	return path.join(path.dirname(config.sessionsRoot), OMP_LAYOUT.modelsFile);
}

export function assertProviderId(id: string, lang: Lang = "zh"): string {
	const trimmed = id.trim();
	if (!ID_PATTERN.test(trimmed)) throw new Error(msg(lang, ["供应商 ID 只能包含字母、数字、下划线、点和横线", "A provider ID may only contain letters, digits, underscores, dots and dashes"]));
	return trimmed;
}

async function readText(): Promise<string | undefined> {
	try {
		return await Bun.file(modelsFile()).text();
	} catch {
		return undefined;
	}
}

function parseDocument(text: string | undefined): Record<string, unknown> {
	if (!text) return {};
	const doc = Bun.YAML.parse(text) as unknown;
	return doc && typeof doc === "object" ? (doc as Record<string, unknown>) : {};
}

function parsedProviders(text: string | undefined): Map<string, Record<string, unknown>> {
	const providers = parseDocument(text).providers;
	if (!providers || typeof providers !== "object" || Array.isArray(providers)) return new Map();
	return new Map(Object.entries(providers as Record<string, Record<string, unknown>>));
}

/** Providers `omp models --json` can list at all: one without a model names nothing. */
function listableIds(text: string | undefined): Set<string> {
	const ids = new Set<string>();
	for (const [id, value] of parsedProviders(text)) if (Array.isArray(value.models) && value.models.length > 0) ids.add(id);
	return ids;
}

interface OmpModelsRead {
	/** The provider ids omp reports; `undefined` when it does not answer with a usable list. */
	ids: Set<string> | undefined;
	/** omp's own complaint about the file, which arrives on stdout ahead of the JSON. */
	problem?: string;
}

/**
 * Ask omp to read the profile. Its exit code alone is not the signal: when one custom provider
 * fails omp's schema it prints `models.yml validation failed`, returns `{"models":[]}` and
 * disables every provider, so the preamble has to travel back with the list.
 */
async function readOmpModels(lang: Lang = "zh"): Promise<OmpModelsRead> {
	const run = await runOmp(ompModelsArgs());
	const jsonAt = run.stdout.indexOf("{");
	const complaint = [...run.stdout.slice(0, jsonAt < 0 ? run.stdout.length : jsonAt).split("\n"), ...run.stderr.split("\n")]
		.map(line => line.trim())
		.filter(Boolean)
		.join("；");
	if (run.code !== 0 || jsonAt < 0) return { ids: undefined, problem: complaint || msg(lang, ["omp 退出码 {code}", "omp exited with code {code}"], { code: run.code }) };
	let list: unknown;
	try {
		list = (JSON.parse(run.stdout.slice(jsonAt)) as { models?: unknown }).models;
	} catch {
		return { ids: undefined, problem: complaint };
	}
	if (!Array.isArray(list)) return { ids: undefined, problem: complaint };
	const ids = new Set<string>();
	for (const model of list) {
		const provider = (model as { provider?: unknown }).provider;
		if (typeof provider === "string" && provider) ids.add(provider);
	}
	return { ids, problem: complaint || undefined };
}

/**
 * What omp must still list (and must no longer list) after a write. Skipped when omp did not
 * answer before the write either: a profile it cannot read is not our doing, and refusing every
 * write would lock the settings page out of the one file that needs fixing. A complaint that was
 * already there before the write is likewise not ours, so only a newly introduced one rolls back.
 */
async function ompMismatch(baseline: OmpModelsRead, mustHave: Set<string>, mustNotHave?: string, lang: Lang = "zh"): Promise<string | undefined> {
	if (!baseline.ids) return undefined;
	const after = await readOmpModels(lang);
	const ids = after.ids;
	const detail = after.problem ? msg(lang, ["：{detail}", ": {detail}"], { detail: after.problem }) : "";
	if (!ids) return msg(lang, ["omp 写入后读不出 models.yml{detail}", "models.yml does not read back after omp's write{detail}"], { detail });
	if (!baseline.problem && after.problem) return msg(lang, ["omp 拒绝写入后的 models.yml：{detail}", "omp rejects models.yml as written: {detail}"], { detail: after.problem });
	const lost = [...mustHave].filter(id => !ids.has(id));
	if (lost.length) {
		const list = lost.join(msg(lang, ["、", ", "]));
		const why = after.problem ? msg(lang, ["（{detail}）", " ({detail})"], { detail: after.problem }) : "";
		return msg(lang, ["omp 写入后不再列出供应商 {list}{why}", "omp no longer lists {list} after the write{why}"], { list, why });
	}
	if (mustNotHave && ids.has(mustNotHave)) return msg(lang, ["omp 写入后仍列出供应商 {id}", "omp still lists {id} after the write"], { id: mustNotHave });
	return undefined;
}

export async function readProviders(): Promise<ProvidersView> {
	const path = modelsFile();
	const text = await readText();
	const providers = [...parsedProviders(text).entries()].map(([id, value]) => ({ id, ...value }) as ProviderConfig);
	return { path, exists: text !== undefined, providers };
}

interface Located {
	/** Index of the top-level `providers:` line, or -1 when the file has none. */
	providersLine: number;
	/** First and past-the-last line of the provider's block; `start` is -1 when absent. */
	start: number;
	end: number;
	/** Where a brand-new provider goes: the end of the `providers:` mapping. */
	insertAt: number;
}

/** Locate one provider's block by indentation: providers sit at two spaces. */
function locate(lines: string[], id: string): Located {
	let providersLine = -1;
	for (let i = 0; i < lines.length; i++) {
		if (/^providers:\s*$/.test(lines[i])) {
			providersLine = i;
			break;
		}
	}
	const located: Located = { providersLine, start: -1, end: lines.length, insertAt: lines.length };
	if (providersLine < 0) return located;
	// End of the mapping (before trailing blanks): the first top-level line after it.
	let insertAt = lines.length;
	for (let i = providersLine + 1; i < lines.length; i++) {
		if (/^\S/.test(lines[i]) && lines[i].trim() !== "") {
			insertAt = i;
			break;
		}
	}
	while (insertAt > providersLine + 1 && lines[insertAt - 1].trim() === "") insertAt--;
	located.insertAt = insertAt;
	for (let i = providersLine + 1; i < insertAt; i++) {
		const line = lines[i];
		const key = /^ {2}(\S.*?):\s*$/.exec(line);
		if (located.start < 0) {
			if (key && key[1] === id) located.start = i;
			continue;
		}
		if (key) {
			located.end = i;
			break;
		}
	}
	return located;
}

const PROVIDER_ORDER = ["baseUrl", "api", "apiKey", "authHeader", "headers", "models"];
const MODEL_ORDER = ["id", "name", "reasoning", "input", "contextWindow", "maxTokens", "cost", "compat"];

function ordered(source: Record<string, unknown>, order: string[]): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const key of order) if (source[key] !== undefined) out[key] = source[key];
	for (const [key, value] of Object.entries(source)) if (!(key in out) && value !== undefined) out[key] = value;
	return out;
}

function setOrDelete(target: Record<string, unknown>, key: string, value: unknown): void {
	if (value === undefined || value === null || value === "") delete target[key];
	else target[key] = value;
}

/** Keep whatever the file already had (compat, input, headers…) and apply the form's fields. */
function mergeProvider(existing: Record<string, unknown>, patch: ProviderConfig): Record<string, unknown> {
	const merged: Record<string, unknown> = { ...existing };
	setOrDelete(merged, "baseUrl", patch.baseUrl?.trim());
	setOrDelete(merged, "api", patch.api?.trim());
	setOrDelete(merged, "apiKey", patch.apiKey?.trim());
	if (patch.authHeader === undefined) delete merged.authHeader;
	else merged.authHeader = patch.authHeader;

	const before = Array.isArray(existing.models) ? (existing.models as Record<string, unknown>[]) : [];
	const models = (patch.models ?? []).map(model => {
		const next: Record<string, unknown> = { ...(before.find(b => String(b.id) === model.id) ?? {}) };
		next.id = model.id;
		for (const key of ["name", "reasoning", "contextWindow", "maxTokens"]) setOrDelete(next, key, (model as Record<string, unknown>)[key]);
		return ordered(next, MODEL_ORDER);
	});
	if (models.length > 0) merged.models = models;
	else delete merged.models;
	return ordered(merged, PROVIDER_ORDER);
}

/** The provider's YAML block, indented to sit under `providers:`. */
function emitBlock(id: string, provider: Record<string, unknown>): string[] {
	const key = /^[A-Za-z0-9_.-]+$/.test(id) ? id : JSON.stringify(id);
	return Bun.YAML.stringify({ [key]: provider }, null, 2)
		.replace(/\n+$/, "")
		.split("\n")
		.map(line => `  ${line}`.replace(/[ \t]+$/, ""));
}

async function backup(file: string): Promise<string | undefined> {
	try {
		const stamp = new Date().toISOString().replace(/[:.]/g, "-");
		const dest = `${file}.bak-${stamp}`;
		await Bun.write(dest, Bun.file(file));
		return dest;
	} catch {
		return undefined; // nothing to back up yet (first write)
	}
}

/** Order-insensitive serialization, for verifying a surgical write round-trips. */
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object") {
		const obj = value as Record<string, unknown>;
		return `{${Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
	}
	return JSON.stringify(value ?? null);
}

/** Create or replace one provider, leaving the rest of the file untouched. */
export async function writeProvider(id: string, patch: ProviderConfig, lang: Lang = "zh"): Promise<ProvidersView> {
	const providerId = assertProviderId(id, lang);
	const file = modelsFile();
	const text = (await readText()) ?? "";
	const existing = parsedProviders(text).get(providerId) ?? {};
	const intended = mergeProvider(existing, patch);
	const block = emitBlock(providerId, intended);

	const lines = text ? text.split("\n") : [];
	const located = locate(lines, providerId);
	if (located.start >= 0) {
		lines.splice(located.start, located.end - located.start, ...block);
	} else if (located.providersLine >= 0) {
		// Append inside the existing mapping, so the file keeps its own order.
		lines.splice(located.insertAt, 0, ...block);
	} else {
		while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
		if (lines.length > 0) lines.push("");
		lines.push("providers:", ...block);
	}
	const next = `${lines.join("\n").replace(/\n+$/, "")}\n`;
	// omp's reading of the profile, taken while the file is still the old one.
	const baseline = await readOmpModels(lang);
	const bak = await backup(file);
	await Bun.write(file, next);
	const restore = async () => {
		if (bak) await Bun.write(file, Bun.file(bak));
		else await Bun.write(file, text);
	};
	// The splice is positional; if the block landed wrong, undo rather than
	// leave omp a models.yml it cannot read.
	const written = parsedProviders(next).get(providerId);
	if (canonical(written) !== canonical(intended)) {
		await restore();
		throw new Error(msg(lang, ["写入后校验失败，已回滚 models.yml", "Verification failed after the write; models.yml was rolled back"]));
	}
	const kept = new Set([...listableIds(text)].filter(id => listableIds(next).has(id)));
	if (Array.isArray(intended.models) && intended.models.length > 0) kept.add(providerId);
	const mismatch = await ompMismatch(baseline, kept, undefined, lang);
	if (mismatch) {
		await restore();
		throw new Error(msg(lang, ["{mismatch}，已回滚 models.yml", "{mismatch}; models.yml was rolled back"], { mismatch }));
	}
	return readProviders();
}

export async function removeProvider(id: string, lang: Lang = "zh"): Promise<ProvidersView> {
	const providerId = assertProviderId(id, lang);
	const file = modelsFile();
	const text = await readText();
	if (text !== undefined) {
		const lines = text.split("\n");
		const located = locate(lines, providerId);
		if (located.start >= 0) {
			lines.splice(located.start, located.end - located.start);
			while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
			const next = `${lines.join("\n")}\n`;
			const baseline = await readOmpModels(lang);
			const bak = await backup(file);
			await Bun.write(file, next);
			const mismatch = await ompMismatch(baseline, listableIds(next), baseline.ids?.has(providerId) ? providerId : undefined, lang);
			if (mismatch) {
				if (bak) await Bun.write(file, Bun.file(bak));
				else await Bun.write(file, text);
				throw new Error(msg(lang, ["{mismatch}，已回滚 models.yml", "{mismatch}; models.yml was rolled back"], { mismatch }));
			}
		}
	}
	return readProviders();
}
