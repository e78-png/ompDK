/** Presentation helpers shared by the skills list and the skill drawer. */
import { t, type MessageKey } from "./i18n/index.ts";

/** Skill sources grouped by who provided them; anything unlisted lands in 其他. */
const GROUPS: [MessageKey, string[]][] = [
	["panel.skillGroup.user", ["native:user", "agents:user", "claude:user", "codex:user", "opencode:user"]],
	["panel.skillGroup.project", ["native:project", "agents:project", "claude:project", "codex:project", "opencode:project", "github"]],
	["panel.skillGroup.plugin", ["omp-plugins", "agent-plugins", "claude-plugins"]],
	["panel.skillGroup.managed", ["omp-managed"]],
];

/** Only `agents:user` was ever observed on this machine; the rest of the table is omp's documented set. */
export function groupName(source: string): string {
	for (const [label, keys] of GROUPS) if (keys.some(k => source === k || source.startsWith(`${k}/`) || source.startsWith(`${k}:`))) return t(label);
	return t("panel.skillGroup.other");
}

/** Six muted hues; the same name always lands on the same one. */
export function avatarClass(name: string): string {
	let h = 0;
	for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
	return `pl-av av-${h % 6}`;
}

export function initial(name: string): string {
	return (name.trim().charAt(0) || "?").toUpperCase();
}

/** SKILL.md opens with a YAML block whose fields the drawer already shows as rows. */
export function stripFrontmatter(src: string): string {
	const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(src);
	return m ? src.slice(m[0].length) : src;
}
