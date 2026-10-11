/**
 * The "agent and session" settings: OMP model roles, per-subagent overrides and
 * the plan-mode default. Values live in OMP's own config so the terminal and the
 * web UI agree; this module only translates between config records and the
 * `AgentSettings` shape the client renders.
 */
import type { AgentSettings, RoleValue } from "../shared/api.ts";
import { CONFIG_KEYS, MODEL_ROLES, type ModelRole } from "../shared/omp/conventions.ts";
import { config } from "./config.ts";
import { HttpError } from "./http-error.ts";
import { cachedModelSelectors } from "./models.ts";
import { assertAgentName, assertRoleValue, patchRecord, readSettings, writeSetting } from "./omp-config.ts";

export type Role = ModelRole;

function isRole(value: string): value is Role {
	return (MODEL_ROLES as readonly string[]).includes(value);
}

function parseRole(raw: string | undefined, known: Set<string> | undefined): RoleValue {
	if (!raw || !raw.trim()) return {};
	const [ref, level] = raw.split(":");
	const slash = ref.indexOf("/");
	const provider = ref.slice(0, slash);
	const id = ref.slice(slash + 1);
	// No verdict without a list, and guessing "missing" would be a false alarm. With the
	// stale-while-revalidate cache this is only the first read after startup, before the
	// disk cache or a refresh has produced anything.
	const missing = slash <= 0 || !id || (known ? !known.has(`${provider}/${id}`) : false);
	return { raw, provider: slash > 0 ? provider : undefined, id: slash > 0 ? id : undefined, level, missing };
}

export async function readAgentSettings(): Promise<AgentSettings> {
	const settings = await readSettings([CONFIG_KEYS.modelRoles, CONFIG_KEYS.agentModelOverrides, CONFIG_KEYS.planDefaultOnStartup]);
	// The list only decides `missing`, so take whatever is cached rather than waiting
	// ~11s on a cold `omp models`; the lookup refreshes an expired entry by itself.
	const known = cachedModelSelectors();
	const rolesRaw = (settings[CONFIG_KEYS.modelRoles] ?? {}) as Record<string, unknown>;
	const roles = {} as AgentSettings["roles"];
	for (const role of MODEL_ROLES) roles[role] = parseRole(typeof rolesRaw[role] === "string" ? (rolesRaw[role] as string) : undefined, known);
	const overridesRaw = (settings[CONFIG_KEYS.agentModelOverrides] ?? {}) as Record<string, unknown>;
	const agentOverrides: Record<string, RoleValue> = {};
	for (const [name, value] of Object.entries(overridesRaw)) if (typeof value === "string") agentOverrides[name] = parseRole(value, known);
	return {
		roles,
		agentOverrides,
		planDefault: settings[CONFIG_KEYS.planDefaultOnStartup] === true,
		locked: config.modelLock ? { provider: config.modelLock.provider, model: config.modelLock.model } : undefined,
	};
}

function assertEditable(): void {
	if (config.modelLock) throw new HttpError(`测试模式：所有会话锁定为 ${config.modelLock.provider}/${config.modelLock.model}`, 403);
}

export async function setRole(role: string, value: string | null): Promise<AgentSettings> {
	assertEditable();
	if (!isRole(role)) throw new HttpError(`未知角色：${role}`, 400);
	if (value !== null) assertRoleValue(value);
	await patchRecord(CONFIG_KEYS.modelRoles, role, value ?? undefined);
	return readAgentSettings();
}

export async function setAgentOverride(agent: string, value: string | null): Promise<AgentSettings> {
	assertEditable();
	assertAgentName(agent);
	if (value !== null) assertRoleValue(value);
	await patchRecord(CONFIG_KEYS.agentModelOverrides, agent, value ?? undefined);
	return readAgentSettings();
}

export async function setPlanDefault(enabled: boolean): Promise<AgentSettings> {
	assertEditable();
	await writeSetting(CONFIG_KEYS.planDefaultOnStartup, enabled);
	return readAgentSettings();
}
