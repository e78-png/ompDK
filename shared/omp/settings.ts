/**
 * OMP 自己設定的中文說明：使用者真正會去改的那些。
 *
 * 為什麼不是把全部 569 個鍵攤出來：`omp config list` 回的是完整 schema——569 個鍵、
 * 226 個布林、142 個數字。攤出來是雜訊，不是介面。要設定的是少數幾十項，
 * 這裡把它們挑出來，寫上中文的「這是什麼、什麼時候該改」，其餘的仍可在頁面上搜尋。
 *
 * 鍵名與型別來自 omp 自己（`omp config list --json` 的 `type` 欄），
 * 所以這個檔案放在 `shared/omp/`：它就是 omp 的知識。
 *
 * 可寫的清單是 `WRITABLE_KEYS`。閘道器寫入前會照 `kind` 驗證：布林只接受
 * true/false、列舉只接受清單裡的值、數字只接受數字。寫壞一個設定比不能改更麻煩。
 */
import { toZhHant } from "../zh-hant.ts";

/** 設定的分組。對應上游 `/settings` 面板的分頁，但更貼近這個 App 的用法。 */
export type SettingGroup = "model" | "thinking" | "tools" | "context" | "retry" | "advisor" | "system";

/** 分組的中文名與一句話說明。 */
export const SETTING_GROUP_LABEL: Record<SettingGroup, string> = {
	model: "模型与采样",
	thinking: "思考强度",
	tools: "工具与批准",
	context: "上下文与压缩",
	retry: "重试与后备",
	advisor: "顾问模型",
	system: "系统与工作区",
};

/** 分组是什麼、什麼時候該看這一組。 */
export const SETTING_GROUP_ABOUT: Record<SettingGroup, string> = {
	model: "用哪个模型、采样到什么程度。换了会话也会生效，所以先看这一组。",
	thinking: "模型想多久。强度越高越准也越贵，一般只在难题上临时调高。",
	tools: "工具要不要先问你一遍。改这里等于改你被允许做什么。",
	context: "上下文快满时怎么办：压缩、保留多少、留哪几段。",
	retry: "模型或网络出错时重试几次、要不要换一个模型顶上。",
	advisor: "第二个模型在每一轮之后审阅你的工作要不要开着。",
	system: "技能、后台任务、并行工作区这些跟机器打交道的设置。",
};

/** 分组的英文名。英文介面只有这一层是翻译的，设定本身用 OMP 自己的说明。 */
export const SETTING_GROUP_LABEL_EN: Record<SettingGroup, string> = {
	model: "Models & sampling",
	thinking: "Thinking",
	tools: "Tools & approvals",
	context: "Context & compaction",
	retry: "Retry & fallback",
	advisor: "Advisor",
	system: "System & workspace",
};

/** 英文介面用的名稱。沒有在這裡的設定，英文介面退回原始的 key。 */
export const SETTING_LABEL_EN: Record<string, string> = {
	modelRoles: "Model roles",
	modelRoleStorage: "Where role assignments live",
	defaultThinkingLevel: "Default thinking level",
	includeModelInPrompt: "Name the model in the prompt",
	temperature: "Temperature",
	topP: "Top-p",
	textVerbosity: "Response verbosity",
	personality: "Personality",
	enabledModels: "Allowed models",
	enabledProviders: "Allowed providers",
	hideThinkingBlock: "Hide thinking blocks",
	"providers.autoThinkingMaxEffort": "Automatic effort ceiling",
	"tools.approvalMode": "Tool approval mode",
	"tools.approval": "Per-tool approval",
	"tools.restrictedFolders": "Restricted folders",
	"tools.maxTimeout": "Tool timeout (ms)",
	"tools.outputMaxColumns": "Output width",
	"tools.format": "Tool output format",
	"tools.intentTracing": "Trace tool intents",
	"compaction.enabled": "Automatic compaction",
	"compaction.reserveTokens": "Tokens reserved when compacting",
	"retry.enabled": "Retry on failure",
	"retry.maxRetries": "Maximum retries",
	"retry.baseDelayMs": "First retry delay (ms)",
	"retry.maxDelayMs": "Longest retry delay (ms)",
	"retry.modelFallback": "Fall back to another model",
	"advisor.enabled": "Advisor model",
	"advisor.immuneTurns": "Advisor immunity (turns)",
	"advisor.continueSeverity": "Advisor interruption threshold",
	"advisor.reviewInterval": "Advisor review interval",
	"skills.enabled": "Skills on/off",
	"async.enabled": "Background jobs",
	"async.maxJobs": "Background job limit",
	"magicKeywords.enabled": "Magic keywords",
	"lsp.enabled": "Language servers",
};

/** 英文介面用的一句話說明。 */
export const SETTING_ABOUT_EN: Record<string, string> = {
	modelRoles: "Which model serves which job: default is the main one, smol handles light work, slow handles the heavy lifting.",
	modelRoleStorage: "Whether role assignments are global or follow the project.",
	defaultThinkingLevel: "How deep the model thinks by default. It drives cost too.",
	includeModelInPrompt: "Let the model know its own identity. Useful when handing work between models.",
	temperature: "0 is steady, 1 is inventive. Lower it for code.",
	topP: "Another way to control randomness. Usually move one or the other.",
	textVerbosity: "How long OpenAI-style answers are: low is terse, high is detailed.",
	personality: "The tone written into the system prompt.",
	enabledModels: "Only these models show up in the picker. Empty means all of them.",
	enabledProviders: "Only these providers are offered. Empty means all of them.",
	hideThinkingBlock: "Keep the model's reasoning out of the transcript.",
	"providers.autoThinkingMaxEffort": "The highest effort automatic picking may choose.",
	"tools.approvalMode": "Whether the model asks before touching your files. always-ask asks every time; yolo allows everything.",
	"tools.approval": "Per-tool policy: allow runs it, deny blocks it, prompt asks.",
	"tools.restrictedFolders": "Nothing in these folders is read, written or searched.",
	"tools.maxTimeout": "How long one tool call may run.",
	"tools.outputMaxColumns": "Where long output wraps.",
	"tools.format": "How tool results are handed to the model.",
	"tools.intentTracing": "Record what the model intends to do, so you can retrace it.",
	"compaction.enabled": "Summarise the conversation when the context fills up.",
	"compaction.reserveTokens": "Room kept for the next turn. Too little squeezes it; too much is no compaction at all.",
	"retry.enabled": "Try again when the model or the network fails.",
	"retry.maxRetries": "How many more attempts before giving up.",
	"retry.baseDelayMs": "How long the first wait is; later ones grow.",
	"retry.maxDelayMs": "The ceiling on that wait. Raise it when a provider rate-limits you.",
	"retry.modelFallback": "Switch to a different model after a few failed attempts.",
	"advisor.enabled": "A second model reviews each turn and writes back notes. It costs an extra share of tokens.",
	"advisor.immuneTurns": "How many recent turns the advisor ignores. Some work should not be interrupted.",
	"advisor.continueSeverity": "How serious a note has to be before it interrupts you.",
	"advisor.reviewInterval": "Review every few turns instead of every turn.",
	"skills.enabled": "Turn it off to load no skills at all. Useful when there are many.",
	"async.enabled": "Let the model hand work to the background without holding the turn.",
	"async.maxJobs": "How many background jobs may run at once.",
	"magicKeywords.enabled": "Certain keywords trigger special behaviour instead of going to the model.",
	"lsp.enabled": "Give the model real symbols and diagnostics instead of grep guesses.",
};

/**
 * 介面語系，由 `setLocale` 推進來。
 *
 * 為什麼要自己記一份：這張表的文案不在 i18n 片段裡（它是資料，不是 UI 字串），
 * 但繁體介面一樣要顯示繁體。跟指令表的做法一致。
 *
 * 英文版另外寫：教學是中文介面的加值，英文介面下這份設定表由 OMP 自己的英文
 * 說明撐著，但**標題**不能直接丟原始的 key 給使用者看——那是設定檔裡的名字，
 * 不是人話。
 */
let uiLocale: "zh" | "zh-Hant" | "en" = "zh";

export function setSettingsLocale(locale: "zh" | "zh-Hant" | "en"): void {
	uiLocale = locale;
}

/** 繁體模式由簡體原文轉出來；表裡查不到就維持原文。 */
function zh(text: string): string {
	return uiLocale === "zh-Hant" ? toZhHant(text) : text;
}

/** 介面語系是英文時回傳英文分組名。 */
export function groupLabelOf(group: SettingGroup): string {
	return uiLocale === "en" ? SETTING_GROUP_LABEL_EN[group] : zh(SETTING_GROUP_LABEL[group]);
}

/** 這一組是什麼、什麼時候該看它。 */
export function groupAboutOf(group: SettingGroup): string {
	return zh(SETTING_GROUP_ABOUT[group]);
}

/**
 * 這個設定怎麼稱呼。
 *
 * 英文介面優先用這裡寫的名稱；沒有就退回原始的 key——那是設定檔裡的名字，
 * 至少看得出是哪一個。
 */
export function labelOf(spec: SettingSpec): string {
	if (uiLocale === "en") return SETTING_LABEL_EN[spec.key] ?? spec.key;
	return zh(spec.label);
}

/**
 * 這個設定是什麼。
 *
 * 英文介面優先用 OMP 自己寫的說明（那是完整的英文），沒有才退回這裡寫的。
 */
export function aboutOf(spec: SettingSpec, ompDescription?: string): string {
	if (uiLocale === "en") return ompDescription?.trim() || SETTING_ABOUT_EN[spec.key] || zh(spec.about);
	return zh(spec.about);
}

/** 注意事项；英文介面沒有對應就留空。 */
export function noteOf(spec: SettingSpec): string | undefined {
	if (uiLocale === "en") return undefined;
	return spec.note ? zh(spec.note) : undefined;
}

/** 一个设置项长什么样。 */
export interface SettingSpec {
	/** omp 的设置键，完整路径。 */
	key: string;
	/** 中文名称。 */
	label: string;
	/** 这是什么、什么时候该改。 */
	about: string;
	group: SettingGroup;
	/** 要用什么编辑器；省略表示只读。 */
	kind?: "boolean" | "enum" | "number" | "text";
	/** 列舉型可以选的值。 */
	values?: string[];
	/** 改坏了会怎样。 */
	note?: string;
}

/**
 * 精选出来的设置项。
 *
 * 挑的标准：真的会改、改了立刻有感、而且知道自己改了什麼。
 * 上游 569 个键里，剩下的是给需要精调的人用的。
 */
export const CURATED_SETTINGS: SettingSpec[] = [
	// ── 模型与采样 ──────────────────────────────────────────────────────────
	{
		key: "modelRoles",
		label: "模型角色",
		about: "把模型分给不同用途：default 是主力，smol 是轻量任务，slow 是重活，task 是子代理。写 provider/模型 id。",
		group: "model",
	},
	{
		key: "modelRoleStorage",
		label: "模型角色存在哪",
		about: "存在全局还是跟着项目走。选 project 时，这个项目用自己的模型组合。",
		group: "model",
		kind: "enum",
		values: ["global", "project"],
	},
	{
		key: "defaultThinkingLevel",
		label: "默认思考强度",
		about: "模型默认想多深。影响每一轮，价钱也跟着走。",
		group: "model",
		kind: "enum",
		values: ["minimal", "low", "medium", "high", "xhigh", "max", "auto"],
	},
	{
		key: "includeModelInPrompt",
		label: "在提示词里写出模型名",
		about: "让模型知道自己是谁。做跨模型接手或对照实验时有用。",
		group: "model",
		kind: "boolean",
	},
	{
		key: "temperature",
		label: "采样温度",
		about: "0 最稳定、1 最有创意。-1 表示用模型自己的预设。写代码时调低。",
		group: "model",
		kind: "number",
	},
	{
		key: "topP",
		label: "候选词累计概率",
		about: "另一种控制随机度的方式。通常跟温度只调一个。-1 表示不启用。",
		group: "model",
		kind: "number",
	},
	{
		key: "textVerbosity",
		label: "回答啰嗦度",
		about: "OpenAI 系的回答长度：low 精炼、high 详尽。只影响支持的模型。",
		group: "model",
		kind: "enum",
		values: ["low", "medium", "high"],
	},
	{
		key: "personality",
		label: "说话风格",
		about: "写进系统提示词的语气。default 最中性。",
		group: "model",
		kind: "enum",
		values: ["default", "friendly", "pragmatic", "none"],
		note: "会进系统提示词，换了之后新开的会话才看得到。",
	},
	{
		key: "enabledModels",
		label: "可用模型白名单",
		about: "只留这些模型，其他的不出现在选单里。空的表示全部可用。",
		group: "model",
	},
	{
		key: "enabledProviders",
		label: "可用供应商白名单",
		about: "只留这些供应商。空的表示全部可用。",
		group: "model",
	},

	// ── 思考强度 ────────────────────────────────────────────────────────────
	{
		key: "hideThinkingBlock",
		label: "隐藏思考内容",
		about: "回答里不显示模型的思考区块，只留结论。",
		group: "thinking",
		kind: "boolean",
	},
	{
		key: "providers.autoThinkingMaxEffort",
		label: "自动思考强度上限",
		about: "自动挑选强度时，最高可以到哪一档。",
		group: "thinking",
		kind: "enum",
		values: ["minimal", "low", "medium", "high", "xhigh", "max"],
	},

	// ── 工具与批准 ──────────────────────────────────────────────────────────
	{
		key: "tools.approvalMode",
		label: "工具批准方式",
		about: "模型要动你的东西时要不要先问。always-ask 每个动作都问；yolo 全放行。",
		group: "tools",
		kind: "enum",
		values: ["always-ask", "always-ask-cached", "write", "yolo"],
		note: "yolo 之下模型可以自己读写、跑命令。确定环境干净再用。",
	},
	{
		key: "tools.approval",
		label: "个别工具的批准",
		about: "逐个工具设定：allow 直接放行、deny 禁止、prompt 先问。",
		group: "tools",
	},
	{
		key: "tools.restrictedFolders",
		label: "禁止触碰的目录",
		about: "这些目录里的读写、搜索一律拒绝。放密钥、客户资料、别的项目。",
		group: "tools",
	},
	{
		key: "tools.maxTimeout",
		label: "工具超时（毫秒）",
		about: "单次工具调用最多跑多久。跑很久的编译或测试要调大。",
		group: "tools",
		kind: "number",
	},
	{
		key: "tools.outputMaxColumns",
		label: "输出最大宽度",
		about: "工具输出换行到多宽。太窄会让长行难读。",
		group: "tools",
		kind: "number",
	},
	{
		key: "tools.format",
		label: "工具输出格式",
		about: "工具结果怎么呈现给模型：文字、JSON 或精简。",
		group: "tools",
		kind: "enum",
		values: ["text", "json", "compact"],
	},
	{
		key: "tools.intentTracing",
		label: "记录工具意图",
		about: "把模型每次想做什么记下来，出问题时好回溯。",
		group: "tools",
		kind: "boolean",
	},

	// ── 上下文与压缩 ────────────────────────────────────────────────────────
	{
		key: "compaction.enabled",
		label: "自动压缩",
		about: "上下文快满时自动摘要，把前面的内容收起来。",
		group: "context",
		kind: "boolean",
	},
	{
		key: "compaction.reserveTokens",
		label: "压缩时保留的额度",
		about: "留给下一轮的空间。留太少会挤，留太多等于没压缩。",
		group: "context",
		kind: "number",
	},

	// ── 重试与后备 ──────────────────────────────────────────────────────────
	{
		key: "retry.enabled",
		label: "失败自动重试",
		about: "模型或网络出错时自己再试。",
		group: "retry",
		kind: "boolean",
	},
	{
		key: "retry.maxRetries",
		label: "最多重试几次",
		about: "连续失败时最多再试几轮。太多会烧额度，太少会误判失败。",
		group: "retry",
		kind: "number",
	},
	{
		key: "retry.baseDelayMs",
		label: "重试基础延迟（毫秒）",
		about: "每次重试之间先等多久，之后按倍数拉长。",
		group: "retry",
		kind: "number",
	},
	{
		key: "retry.maxDelayMs",
		label: "重试最长延迟（毫秒）",
		about: "等待的上限。供应商限流时要拉长。",
		group: "retry",
		kind: "number",
	},
	{
		key: "retry.modelFallback",
		label: "失败时换模型",
		about: "重试几次还不行就换一个模型顶上。设成 false 就不换。",
		group: "retry",
		kind: "boolean",
	},

	// ── 顾问模型 ────────────────────────────────────────────────────────────
	{
		key: "advisor.enabled",
		label: "顾问模型",
		about: "开另一个模型在每一轮之后审阅，把建议写回来。多花一份 token。",
		group: "advisor",
		kind: "boolean",
	},
	{
		key: "advisor.immuneTurns",
		label: "顾问免疫轮数",
		about: "最近几轮不看顾问建议。有些动作（例如连续调试）不希望被打断。",
		group: "advisor",
		kind: "number",
	},
	{
		key: "advisor.continueSeverity",
		label: "顾问打断门槛",
		about: "顾问的建议要多严重才值得打断你。调高就少打扰。",
		group: "advisor",
	},
	{
		key: "advisor.reviewInterval",
		label: "顾问复查间隔",
		about: "每隔几轮审一次，而不是每一轮。",
		group: "advisor",
		kind: "number",
	},

	// ── 系统与工作区 ────────────────────────────────────────────────────────
	{
		key: "skills.enabled",
		label: "技能总开关",
		about: "关掉就完全不加载技能。技能太多吃上下文时有用。",
		group: "system",
		kind: "boolean",
	},
	{
		key: "async.enabled",
		label: "后台任务",
		about: "允许模型把工作丢到后台跑，不占住这一轮。",
		group: "system",
		kind: "boolean",
	},
	{
		key: "async.maxJobs",
		label: "后台任务上限",
		about: "同时最多跑几个后台任务。",
		group: "system",
		kind: "number",
	},
	{
		key: "magicKeywords.enabled",
		label: "魔法关键字",
		about: "某些关键字会触发特殊动作（例如直接执行、不进模型）。",
		group: "system",
		kind: "boolean",
	},
	{
		key: "lsp.enabled",
		label: "语言服务",
		about: "接上 LSP，模型能拿到真实的符号与诊断，而不是用grep猜。",
		group: "system",
		kind: "boolean",
	},
];

/** 可以从这个界面改的键。其余的设定仍由 omp 自己或配置文件管。 */
export const WRITABLE_KEYS = new Set(CURATED_SETTINGS.filter(s => s.kind).map(s => s.key));

/**
 * 记录型设定：值是一个 `{ 字段: 值 }` 的对象，要逐字段改。
 *
 * 为什么单独一类：整体读写一个 record 会把没打开的字段一起盖掉；omp 的
 * `config set` 又是整键写入。所以这边走「读出来、只改一个字段、写回去」的路子。
 */
export interface RecordSettingSpec {
	key: string;
	label: string;
	about: string;
	group: SettingGroup;
	/** 字段的合法值；空 = 自由文字。 */
	values?: string[];
	/** 字段名要用哪种格式校验。 */
	pattern?: "role";
	/** 字段清单从哪来。 */
	fields: "roles" | "existing";
	/** `existing` 时，新字段怎么取得。 */
	placeholder?: string;
}

/** 逐字段可改的设定。 */
export const RECORD_SETTINGS: RecordSettingSpec[] = [
	{
		key: "modelRoles",
		label: "模型角色",
		about: "把模型分给不同用途：default 是主力，smol 是轻量任务，slow 是重活，plan 是规划，advisor 是顾问。写 provider/模型 id，留空表示不指定。",
		group: "model",
		pattern: "role",
		fields: "roles",
	},
	{
		key: "tools.approval",
		label: "单个工具的批准",
		about: "逐个工具设定：allow 直接放行、deny 禁止、prompt 先问。没列出来的工具走 tools.approvalMode。",
		group: "tools",
		values: ["allow", "deny", "prompt"],
		fields: "existing",
		placeholder: "工具名",
	},
];

/** 模型角色名的格式：provider/模型 id，可选带思考等级。 */
export const ROLE_FIELD_VALUE = /^[^\s/]+\/[^\s:]+(:(off|minimal|low|medium|high|xhigh|max))?$/;

/**
 * 记录型设定的字段值检查。
 *
 * 与 `validateSetting` 同一个理由：写坏一个设定比不能改更麻烦，而 omp 会照写。
 */
export function validateRecordField(spec: RecordSettingSpec, field: string, raw: string): { ok: true; value: string | undefined } | { ok: false; reason: string } {
	if (!field.trim()) return { ok: false, reason: "字段名不能为空" };
	if (spec.pattern === "role" && raw && !ROLE_FIELD_VALUE.test(raw)) return { ok: false, reason: "格式要 provider/模型 id" };
	if (spec.values && raw && !spec.values.includes(raw)) return { ok: false, reason: `只接受 ${spec.values.join(" / ")}` };
	return { ok: true, value: raw || undefined };
}

/** 依键找设置项。 */
export function specOf(key: string): SettingSpec | undefined {
	return CURATED_SETTINGS.find(s => s.key === key);
}

/**
 * 写入前的检查：值必须是这个设置项能接受的样子。
 *
 * 为什么不直接丢给 omp：`omp config set` 收到乱七八糟的值会照写，
 * 写坏了要手动去改档案。这里先挡住，错误讯息也才有意义。
 */
export function validateSetting(spec: SettingSpec, raw: string): { ok: true; value: unknown } | { ok: false; reason: string } {
	switch (spec.kind) {
		case "boolean": {
			if (raw === "true") return { ok: true, value: true };
			if (raw === "false") return { ok: true, value: false };
			return { ok: false, reason: "只接受 true 或 false" };
		}
		case "enum": {
			const values = spec.values ?? [];
			if (values.includes(raw)) return { ok: true, value: raw };
			return { ok: false, reason: `只接受 ${values.join(" / ")}` };
		}
		case "number": {
			const n = Number(raw);
			if (!Number.isFinite(n)) return { ok: false, reason: "只接受数字" };
			return { ok: true, value: n };
		}
		case "text":
			return { ok: true, value: raw };
		default:
			return { ok: false, reason: "这个设置不能在这里改" };
	}
}
