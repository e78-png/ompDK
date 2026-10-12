/**
 * Slash-command catalog: which group each omp command belongs to, its Chinese title,
 * how it is matched and ordered, and when it needs a confirmation. Data and pure
 * functions only — the browser menu and the tests both read this file, and nothing in
 * it touches the DOM, the network or omp.
 */
import type { AvailableSlashCommand } from "./api.ts";
import { COMMAND_SOURCES, SKILL_EXTENSION_PREFIX, stripSkillPrefix } from "./omp/conventions.ts";

export type CommandGroup = "context" | "mode" | "session" | "workspace" | "system" | "skill" | "custom";

/** Display order of the sections; commands omp adds later land in `system`. */
export const GROUP_ORDER: CommandGroup[] = ["context", "mode", "session", "workspace", "system", "skill", "custom"];

/**
 * Interface language, pushed in by the browser (`setLocale`). Chinese is the default, so this
 * file keeps working — and keeps its tests passing — without anyone setting it.
 */
let uiLocale: "zh" | "en" = "zh";

export function setCommandLocale(locale: "zh" | "en"): void {
	uiLocale = locale;
}

const english = (): boolean => uiLocale === "en";

export const GROUP_LABEL: Record<CommandGroup, string> = {
	context: "对话与上下文",
	mode: "模式开关",
	session: "会话",
	workspace: "工作区与连接",
	system: "工具与系统",
	skill: "技能",
	custom: "扩展与自定义",
};

const GROUP_LABEL_EN: Record<CommandGroup, string> = {
	context: "Conversation",
	mode: "Modes",
	session: "Session",
	workspace: "Workspace",
	system: "Tools & system",
	skill: "Skills",
	custom: "Extensions",
};

/** Section header for a group, in the interface language. */
export function groupLabel(group: CommandGroup): string {
	return english() ? GROUP_LABEL_EN[group] : GROUP_LABEL[group];
}

/** Menu icons. `toggle` is the half-filled circle; the rest already exist in the icon set. */
export type CommandIcon = "terminal" | "toggle" | "sparkle" | "puzzle" | "file";

/** Builtins the app already does better with a control: pruned from the list, guided when typed. */
export const HIDDEN_COMMANDS = ["model", "models", "switch", "effort", "plugins", "plugin", "reload-plugins", "rename", "export"];

export type CommandGuidance = "model-menu" | "plugins-page" | "session-menu";

const GUIDANCE: Record<string, { text: string; action: CommandGuidance }> = {
	model: { text: "用右下角的模型菜单切换", action: "model-menu" },
	models: { text: "用右下角的模型菜单切换", action: "model-menu" },
	switch: { text: "用右下角的模型菜单切换", action: "model-menu" },
	effort: { text: "用右下角的模型菜单切换", action: "model-menu" },
	plugins: { text: "在「插件」页管理", action: "plugins-page" },
	plugin: { text: "在「插件」页管理", action: "plugins-page" },
	"reload-plugins": { text: "在「插件」页管理", action: "plugins-page" },
	rename: { text: "在侧栏会话菜单里操作", action: "session-menu" },
	export: { text: "在侧栏会话菜单里操作", action: "session-menu" },
};

const GUIDANCE_EN: Record<string, string> = {
	model: "Switch from the model menu in the composer",
	models: "Switch from the model menu in the composer",
	switch: "Switch from the model menu in the composer",
	effort: "Switch from the model menu in the composer",
	plugins: "Manage on the Plugins page",
	plugin: "Manage on the Plugins page",
	"reload-plugins": "Manage on the Plugins page",
	rename: "Use the session menu in the sidebar",
	export: "Use the session menu in the sidebar",
};

/** name → [group, Chinese title]. Commands absent here fall back to `system` + English description. */
const BUILTIN: Record<string, [CommandGroup, string]> = {
	compact: ["context", "压缩对话"],
	handoff: ["context", "交接并压缩"],
	shake: ["context", "清理上下文里的大块内容"],
	context: ["context", "上下文占用"],
	retry: ["context", "重试上一轮"],
	fresh: ["context", "重置流状态"],
	dump: ["context", "导出完整记录文本"],
	force: ["context", "强制下一轮使用某个工具"],
	fast: ["mode", "快速模式"],
	slow: ["mode", "慢速模式（低优先级、省钱）"],
	advisor: ["mode", "顾问模型"],
	prewalk: ["mode", "预走（强模型规划后交给快模型）"],
	skillful: ["mode", "技能列表注入"],
	"extended-context": ["mode", "扩展上下文"],
	computer: ["mode", "电脑操作"],
	browser: ["mode", "浏览器可见或无头"],
	modelpreset: ["mode", "模型预设"],
	session: ["session", "会话信息"],
	usage: ["session", "用量与额度"],
	todo: ["session", "待办"],
	jobs: ["session", "后台任务"],
	pin: ["session", "置顶会话"],
	move: ["session", "移动会话目录"],
	wt: ["session", "移到新的 worktree"],
	share: ["session", "加密分享"],
	trace: ["session", "查看追踪"],
	dirs: ["workspace", "工作目录列表"],
	"add-dir": ["workspace", "添加工作目录"],
	"remove-dir": ["workspace", "移除工作目录"],
	mcp: ["workspace", "MCP 服务器"],
	ssh: ["workspace", "SSH 连接"],
	tools: ["system", "可用工具"],
	memory: ["system", "记忆"],
	security: ["system", "安全扫描"],
	ratchet: ["system", "评测并自动迭代"],
	stats: ["system", "统计面板"],
	changelog: ["system", "更新日志"],
	marketplace: ["system", "插件市场"],
};

/** `command/subcommand` → Chinese description. Anything not here shows omp's own text. */
const SUB_TITLE: Record<string, string> = {
	"fast/on": "开启（优先级通道）",
	"fast/ultra": "超快（OpenAI API 或支持的 Codex 模型）",
	"fast/off": "关闭",
	"fast/status": "查看状态",
	"slow/on": "开启（低优先级、省钱）",
	"slow/off": "关闭",
	"slow/status": "查看状态",
	"compact/soft": "用当前模型本地摘要",
	"compact/remote": "用服务端摘要，失败再本地",
	"compact/snapcompact": "把历史压成图片存档",
	"todo/edit": "在编辑器里打开待办",
	"todo/copy": "复制为 Markdown",
	"todo/expand": "展开完整待办",
	"todo/collapse": "收回预览高度",
	"todo/export": "写出到 Markdown 文件",
	"todo/import": "从 Markdown 文件读入",
	"todo/append": "追加一条任务",
	"todo/start": "开始某条任务",
	"todo/done": "标记完成",
	"todo/drop": "标记放弃",
	"todo/rm": "删除条目",
	"session/info": "会话信息与统计",
	"session/delete": "删除当前会话并返回选择器",
	"session/pin": "把当前供应商固定到某个账户",
	"usage/show": "显示用量与额度",
	"usage/reset": "花掉一次保存的额度重置机会",
	"memory/view": "查看当前注入的记忆",
	"memory/stats": "记忆后端统计",
	"memory/diagnose": "运行记忆后端诊断",
	"memory/queue": "查看待整理的增量",
	"memory/sync": "立即整理",
	"memory/clear": "清空已持久化的记忆",
	"memory/reset": "同 clear",
	"memory/enqueue": "排队一次整理",
	"memory/rebuild": "同 enqueue",
	"memory/mm list": "列出心智模型",
	"memory/mm show": "查看一个心智模型",
	"memory/mm refresh": "刷新心智模型",
	"memory/mm history": "对比心智模型的改动",
	"memory/mm seed": "补齐内置心智模型",
	"memory/mm delete": "删除一个心智模型",
	"memory/mm reload": "重新拉取缓存块",
	"mcp/add": "添加 MCP 服务器",
	"mcp/list": "列出已配置的服务器",
	"mcp/remove": "移除一个服务器",
	"mcp/test": "测试连接",
	"mcp/reauth": "重新授权",
	"mcp/unauth": "清除授权",
	"mcp/enable": "启用",
	"mcp/disable": "停用",
	"mcp/reconnect": "重连",
	"mcp/reload": "重新加载工具",
	"mcp/resources": "列出可用资源",
	"mcp/prompts": "列出可用提示词",
	"mcp/notifications": "查看通知能力",
	"mcp/help": "显示帮助",
	"shake/elide": "去掉工具结果和大块内容",
	"shake/images": "去掉图片块",
	"shake/thinking": "去掉思考块",
	"advisor/on": "开启顾问",
	"advisor/off": "关闭顾问",
	"advisor/status": "查看顾问状态",
	"advisor/dump": "复制顾问记录",
	"advisor/configure": "打开顾问配置",
	"modelpreset/list": "列出已存的预设",
	"modelpreset/save": "保存当前模型组合",
	"modelpreset/switch": "应用一个预设",
	"modelpreset/delete": "删除一个预设",
	"browser/headless": "切到无头模式",
	"browser/visible": "切到可见模式",
};

/** English argument names worth showing in Chinese inside a gray hint. */
const ARG_LABEL: Record<string, string> = {
	arguments: "补充说明",
	focus: "重点",
	instructions: "补充说明",
	path: "路径",
	name: "名称",
	port: "端口",
	host: "地址",
	url: "地址",
	"tool-name": "工具名",
	task: "任务",
	tasks: "任务",
	phase: "阶段",
	session: "会话",
	prompt: "提示词",
	subcommand: "子命令",
	keyword: "关键词",
	branch: "分支",
	source: "来源",
	account: "账户",
	id: "编号",
};

/** omp prefixes skill commands in `name` itself, so the menu label already reads `/skill:<name>`. */
export function commandKey(c: AvailableSlashCommand): string {
	return c.source === COMMAND_SOURCES.skill ? stripSkillPrefix(c.name) : c.name;
}

export function slashNameOf(c: AvailableSlashCommand): string {
	return `/${c.name}`;
}

export function groupOf(c: AvailableSlashCommand): CommandGroup {
	if (c.source === COMMAND_SOURCES.skill) return "skill";
	if (c.source !== COMMAND_SOURCES.builtin) return "custom";
	return BUILTIN[c.name]?.[0] ?? "system";
}

/** Truncate to `max` characters, counting CJK as one each, on the first sentence boundary. */
function firstSentence(description: string | undefined, max: number): string {
	const flat = (description ?? "").replace(/\s+/g, " ").trim();
	if (!flat) return "";
	const cut = flat.search(/[。！？；!?;]/);
	const head = cut > 0 ? flat.slice(0, cut) : flat;
	return head.length > max ? `${head.slice(0, max)}…` : head;
}

export function titleOf(c: AvailableSlashCommand): string {
	// English mode keeps omp's own wording instead of the curated Chinese table.
	if (english()) return firstSentence(c.description, 40) || c.name;
	if (c.source === COMMAND_SOURCES.builtin) return BUILTIN[c.name]?.[1] || firstSentence(c.description, 40) || c.name;
	return firstSentence(c.description, 24) || c.name;
}

/** `description` is the command's own sub-description, used as the English subtitle. */
export function subTitleOf(commandName: string, subName: string, description?: string): string | undefined {
	if (english()) return description?.trim() || undefined;
	return SUB_TITLE[`${commandName}/${subName}`];
}

export function iconOf(c: AvailableSlashCommand): CommandIcon {
	if (c.source === COMMAND_SOURCES.skill) return "sparkle";
	if (c.source === COMMAND_SOURCES.extension) return "puzzle";
	if (c.source === COMMAND_SOURCES.custom || c.source === COMMAND_SOURCES.file) return "file";
	return groupOf(c) === "mode" ? "toggle" : "terminal";
}

/**
 * The same icon for a command word alone, which is all the thread keeps: omp records
 * no source for a submitted command. Anything outside the built-in table is a skill,
 * an extension or a custom command, and reads as one.
 */
export function iconOfName(word: string): CommandIcon {
	if (word.startsWith(SKILL_EXTENSION_PREFIX)) return "sparkle";
	const group = BUILTIN[word]?.[0];
	if (group === "mode") return "toggle";
	return group ? "terminal" : "file";
}

/** Menu-only pruning: typing a hidden command still reaches omp, which owns what it does. */
export function isHidden(c: AvailableSlashCommand): boolean {
	if (c.source !== COMMAND_SOURCES.builtin) return false;
	return [c.name, ...(c.aliases ?? [])].some(n => HIDDEN_COMMANDS.includes(n));
}

/** What a hidden command is replaced by, in the interface language. */
export function guidanceOf(name: string): { text: string; action: CommandGuidance } | undefined {
	const key = name.replace(/^\//, "");
	const entry = GUIDANCE[key];
	if (!entry) return undefined;
	return english() ? { text: GUIDANCE_EN[key] ?? entry.text, action: entry.action } : entry;
}

const DESTRUCTIVE = ["delete", "clear", "reset", "remove", "uninstall"];

/**
 * A built-in subcommand that destroys something. omp writes `mm delete` as one subcommand
 * name, so the last word decides; skills and templates never need a confirmation.
 */
export function isDestructive(c: AvailableSlashCommand, subName?: string): boolean {
	if (c.source !== COMMAND_SOURCES.builtin || !subName) return false;
	const last = subName.trim().split(/\s+/).pop() ?? "";
	return DESTRUCTIVE.includes(last);
}

/** Split a hint on whitespace, keeping bracketed groups intact. */
function splitTokens(hint: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let current = "";
	for (const ch of hint) {
		if (ch === "[" || ch === "<") depth++;
		else if (ch === "]" || ch === ">") depth = Math.max(0, depth - 1);
		if (/\s/.test(ch) && depth === 0) {
			if (current) out.push(current);
			current = "";
			continue;
		}
		current += ch;
	}
	if (current) out.push(current);
	return out;
}

function labelWord(word: string): string {
	const bare = word.replace(/\.\.\.$/, "");
	return ARG_LABEL[bare] ?? ARG_LABEL[bare.toLowerCase()] ?? bare;
}

/** omp's hint grammar → the gray hint the composer shows after a pick. */
export function hintText(hint: string | undefined): string {
	const raw = (hint ?? "").trim();
	if (!raw) return "";
	// omp writes hints in its own (English) grammar, so English mode shows them as they are.
	if (english()) return raw === "arguments" ? "optional note" : raw;
	if (raw === "arguments") return "补充说明（可选）";
	return splitTokens(raw)
		.map(token => {
			const bracketed = /^\[(.*)\]$/.exec(token)?.[1];
			const optional = bracketed !== undefined;
			const inner = bracketed ?? token;
			const angle = /^<(.*)>$/.exec(inner)?.[1];
			const core = angle ?? inner;
			const label = core.includes("|") ? core : core.split(/\s+/).map(labelWord).join(" ");
			return optional ? `${label}（可选）` : label;
		})
		.join(" ");
}

export interface RankedCommand {
	command: AvailableSlashCommand;
	group: CommandGroup;
	/** Chinese title, or omp's description when there is no translation. */
	title: string;
	/** Lower is a better match; the tier the query hit, see `MATCH_TIERS`. */
	tier: number;
}

/**
 * Relevance tiers for a query: exact name, name prefix, alias prefix, name contains,
 * Chinese title contains, anything else contains.
 */
const TIER_EXACT = 0;
const TIER_NAME_PREFIX = 1;
const TIER_ALIAS_PREFIX = 2;
const TIER_NAME_CONTAINS = 3;
const TIER_TITLE = 4;
const TIER_DESCRIPTION = 5;

function tierOf(c: AvailableSlashCommand, title: string, q: string): number {
	const key = commandKey(c).toLowerCase();
	const names = [c.name, commandKey(c), ...(c.aliases ?? [])].map(n => n.toLowerCase());
	const description = (c.description ?? "").toLowerCase();
	if (names.includes(q)) return TIER_EXACT;
	if (key.startsWith(q) || c.name.toLowerCase().startsWith(q)) return TIER_NAME_PREFIX;
	if ((c.aliases ?? []).some(a => a.toLowerCase().startsWith(q))) return TIER_ALIAS_PREFIX;
	if (names.some(n => n.includes(q))) return TIER_NAME_CONTAINS;
	if (title.toLowerCase().includes(q)) return TIER_TITLE;
	if (description.includes(q)) return TIER_DESCRIPTION;
	return -1;
}

/**
 * Menu order. Empty query: grouped, by `GROUP_ORDER` then name, hidden commands dropped.
 * With a query: flat by relevance, capped at `MAX_MATCHES`, recents first inside a tier.
 */
export const MAX_MATCHES = 50;
export const RECENT_LIMIT = 5;

export function rankCommands(commands: readonly AvailableSlashCommand[], query: string, recent: readonly string[] = []): RankedCommand[] {
	const visible = commands.filter(c => !isHidden(c));
	const titles = new Map<AvailableSlashCommand, string>(visible.map(c => [c, titleOf(c)]));
	if (!query.trim()) {
		return visible
			.map(c => ({ command: c, group: groupOf(c), title: titles.get(c) ?? "", tier: 0 }))
			.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || commandKey(a.command).localeCompare(commandKey(b.command)));
	}
	const q = query.trim().toLowerCase();
	const rank = new Map(recent.map((name, i) => [name.toLowerCase(), i]));
	const scored: RankedCommand[] = [];
	for (const c of visible) {
		const title = titles.get(c) ?? "";
		const tier = tierOf(c, title, q);
		if (tier < 0) continue;
		scored.push({ command: c, group: groupOf(c), title, tier });
	}
	const recency = (c: AvailableSlashCommand) => rank.get(commandKey(c).toLowerCase()) ?? rank.get(c.name.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
	return scored.sort((a, b) => a.tier - b.tier || recency(a.command) - recency(b.command) || commandKey(a.command).localeCompare(commandKey(b.command))).slice(0, MAX_MATCHES);
}

/** Recently used commands, still advertised by omp, newest first. */
export function recentCommands(commands: readonly AvailableSlashCommand[], recent: readonly string[], limit = RECENT_LIMIT): RankedCommand[] {
	const byName = new Map<string, AvailableSlashCommand>();
	for (const c of commands) {
		if (isHidden(c)) continue;
		byName.set(c.name.toLowerCase(), c);
		byName.set(commandKey(c).toLowerCase(), c);
	}
	const out: RankedCommand[] = [];
	const seen = new Set<string>();
	for (const name of recent) {
		const c = byName.get(name.toLowerCase());
		if (!c || seen.has(c.name)) continue;
		seen.add(c.name);
		out.push({ command: c, group: groupOf(c), title: titleOf(c), tier: 0 });
		if (out.length >= limit) break;
	}
	return out;
}
