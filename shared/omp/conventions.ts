/**
 * Every name omp and this app both spell out: its config keys, the message roles and
 * `customType` values the thread renders, how a skill is invoked and recorded, the
 * dialog methods that need an answer, and the file names of its profile layout.
 *
 * These are the strings that break silently when omp renames something — a typo in one
 * of them is a feature that stops working, not a compile error. So they live here once,
 * and `bun run lint:omp` fails if any of them reappears outside `server/omp/` and
 * `shared/omp/`.
 */
import { textOf } from "./wire.ts";

/** Keys of omp's own config, spelled as `omp config list --json` reports them. */
export const CONFIG_KEYS = {
	modelRoles: "modelRoles",
	agentModelOverrides: "task.agentModelOverrides",
	planDefaultOnStartup: "plan.defaultOnStartup",
	disabledExtensions: "disabledExtensions",
} as const;

/** The model roles omp resolves a session against. `tiny` is what the title summarizer asks for. */
export const MODEL_ROLES = ["default", "task", "smol", "slow", "tiny"] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];

/** `customType` of the `custom` messages this app draws. */
export const CUSTOM_TYPES = {
	skillPrompt: "skill-prompt",
	/** A command's answer, mirrored out of the live frame stream. */
	commandOutput: "command-output",
	/** The gateway's record of a command that printed nothing. */
	commandEcho: "command-echo",
} as const;

/** Message roles in a session transcript. `user`/`assistant` are the model's; the rest are omp's. */
export const MESSAGE_ROLES = {
	user: "user",
	assistant: "assistant",
	toolResult: "toolResult",
	bashExecution: "bashExecution",
	custom: "custom",
} as const;

/** The two summary roles that split a transcript; each one opens a turn with a divider. */
export const SUMMARY_ROLES = { compaction: "compactionSummary", branch: "branchSummary" } as const;

/** `source` values in `available_commands_update` (omp 18.8.6). Anything new reads as a custom command. */
export const COMMAND_SOURCES = {
	builtin: "builtin",
	skill: "skill",
	extension: "extension",
	custom: "custom",
	mcpPrompt: "mcp_prompt",
	file: "file",
} as const;

/** How a skill is invoked by name. omp also prefixes skill commands with it in `name`. */
export const SKILL_COMMAND_PREFIX = "/skill:";
/** How a skill is listed in the `disabledExtensions` array, and prefixed on its command `name`. */
export const SKILL_EXTENSION_PREFIX = "skill:";

/** omp's `skill:` prefix off a command name, if it carries one. */
export function stripSkillPrefix(name: string): string {
	return name.startsWith(SKILL_EXTENSION_PREFIX) ? name.slice(SKILL_EXTENSION_PREFIX.length) : name;
}

/**
 * omp expands `/skill:<name>` into this prose before the skill body. Kept as the
 * fallback: the name is in `details.name` on records omp writes itself, and this is
 * what a transcript without those details still carries. (omp 18.8.6)
 */
const SKILL_INVOCATION = /User invoked the "([^"]+)" skill/;

/** The skill a `skill-prompt` message invoked, from its details when omp wrote them. */
export function skillNameOf(message: unknown): string | undefined {
	if (!message || typeof message !== "object") return undefined;
	const m = message as { details?: unknown; content?: unknown };
	const named = (m.details as { name?: unknown } | undefined)?.name;
	if (typeof named === "string" && named) return named;
	return SKILL_INVOCATION.exec(textOf(m.content))?.[1] ?? undefined;
}

/**
 * `extension_ui_request` methods that are a dialog: they block the session until a
 * browser answers, so the hub holds them until one does.
 */
export const DIALOG_METHODS = ["select", "confirm", "input", "editor", "ask"] as const;

/** omp's profile layout, relative to the agent directory. */
export const OMP_LAYOUT = {
	/** The default agent directory under the user's home when none is configured. */
	defaultAgentDir: [".omp", "agent"],
	sessionsDir: "sessions",
	modelsFile: "models.yml",
} as const;
