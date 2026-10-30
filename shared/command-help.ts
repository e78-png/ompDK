/**
 * 指令的中文教學：每一條指令是什麼、拿來做什麼、怎麼用。
 *
 * 為什麼需要這張表：omp 自己給的 `description` 是一句英文，講的是「這條指令會做
 * 什麼動作」，不是「我該在什麼時候用它、參數怎麼寫、會不會弄壞東西」。使用者在
 * 中文介面裡看到英文，學不到用法，只能去猜或去翻英文文件。
 *
 * 這張表只收**內建**指令：skill、extension、custom 指令是使用者自己或第三方帶進來的，
 * 說明文字是他們的責任，翻譯反而會跟原文脫節。
 *
 * 鍵是 omp 的指令名（不含斜線）。指令改名時上游有 `builtin-registry.ts` 可以對照；
 * 對不上的指令會退回 omp 自己的英文說明，不會露出空白。
 *
 * 英文介面沿用 omp 的原文：這份教學是中文介面的加值，不是 omp 的替代品。
 */

/** 一條指令的教學。沒有填的欄位就不顯示，不留空白。 */
export interface CommandHelp {
	/** 這條指令是什麼、什麼時候該用。 */
	purpose: string;
	/** 怎麼用：參數怎麼寫。 */
	usage?: string;
	/** 實際的例子。 */
	examples?: string[];
	/** 會不會弄壞東西、什麼時候不要用。 */
	note?: string;
	/**
	 * 這個 App 用自己的控制取代了它（模型選單、設定頁……）。
	 * 指令仍然可以打，只是介面不推薦。
	 */
	via?: string;
}

/** 指令名 → 教學。 */
export const COMMAND_HELP: Record<string, CommandHelp> = {
	// ── 模式 ────────────────────────────────────────────────────────────────
	fast: {
		purpose: "切换快速服务层：让供应商用更快的通道回应，通常更贵或有限额。",
		usage: "/fast on | ultra | off | status",
		examples: ["/fast on  打开快速通道", "/fast status  看现在是什么状态"],
		note: "ultra 只有 OpenAI 或支持的 Codex 模型能用；其他供应商会当成一般 on。",
	},
	slow: {
		purpose: "切换慢速模式：低优先顺位跑，省钱但慢。",
		usage: "/slow on | off | status",
		examples: ["/slow on  接下来用慢速模式", "/slow status  看现在是什么状态"],
		note: "OpenAI 与 Google 是 flex tier；Anthropic 是过了额度后降级续跑。",
	},
	effort: {
		purpose: "设置这一轮的思考强度（推理量）。强度越高模型想得越久、越贵。",
		usage: "/effort minimal | low | medium | high | xhigh | max | auto",
		examples: ["/effort high  接下来仔细想", "/effort auto  交给模型自己决定"],
		note: "也可以用 Shift+Tab 直接循环切换。",
		via: "状态栏的模型菜单里有同一个控制。",
	},
	advisor: {
		purpose: "开关顾问模型：另一个模型会在每一轮之后审阅并把建议写回来。",
		usage: "/advisor on | off | status | dump | configure",
		examples: ["/advisor on  打开顾问", "/advisor dump  看顾问写了什么"],
		note: "顾问会多花一份 token；排查「模型老是做错同一件事」时特别有用。",
	},
	prewalk: {
		purpose: "预走：先用强模型把计划想好，再交给快模型运行。适合又难又重的任务。",
		usage: "/prewalk restart | off",
		examples: ["/prewalk restart  重新走一次预走", "/prewalk off  取消"],
	},
	skillful: {
		purpose: "控制要不要把可用技能清单塞进系统提示词。",
		usage: "/skillful on | off | status",
		examples: ["/skillful on  让模型知道有哪些技能"],
		note: "技能很多时会吃掉上下文；不确定就 on，需要省上下文就 off。",
	},
	"extended-context": {
		purpose: "切换扩展上下文窗口，让模型能看更长的对话。",
		usage: "/extended-context on | off | status",
		examples: ["/extended-context on  打开长上下文"],
		note: "扩展窗口会让每次请求更贵。",
	},
	computer: {
		purpose: "开关电脑操作能力：让模型能看画面、点击、输入。",
		usage: "/computer on | off | status",
		examples: ["/computer on  让模型操作电脑"],
		note: "开着模型可能真的会动到你的鼠标与键盘。",
	},
	browser: {
		purpose: "切换浏览器评测环境是无头还是有画面。",
		usage: "/browser headless | visible",
		examples: ["/browser visible  想看它操作的话"],
		note: "有画面比较好调试，但慢而且会抢焦点。",
	},
	modelpreset: {
		purpose: "管理模型预设：把一组「模型角色 + 思考强度」存成一个名字，之后一键切换。",
		usage: "/modelpreset list | save | switch | delete [名称]",
		examples: ["/modelpreset save 省钱  存成「省钱」", "/modelpreset switch 省钱  切过去"],
	},

	// ── 對話內容 ────────────────────────────────────────────────────────────
	compact: {
		purpose: "压缩对话：把前面的内容摘要成一条，把上下文空间省下来。",
		usage: "/compact soft | remote | snapcompact [重点]",
		examples: ["/compact soft  用现在的模型本地摘要", "/compact 把重点放在错误处理上"],
		note: "摘要之后原话就找不回来了，重要内容先写进文件。",
	},
	shake: {
		purpose: "把上下文里笨重的东西（工具输出、大段图片）丢掉，只留骨架。",
		usage: "/shake elide | images | thinking",
		examples: ["/shake elide  丢掉工具的大段输出", "/shake images  丢掉图片"],
		note: "丢掉的内容模型就看不到了；需要它时会再问一次工具。",
	},
	handoff: {
		purpose: "把目前的对话写成一份交接文档，并顺便压缩上下文。适合换机器或换人接手。",
		usage: "/handoff [交接重点]",
		examples: ["/handoff 重点在数据库那个问题"],
	},
	context: {
		purpose: "看上下文用了多少、里面装了什么。",
		examples: ["/context  看占用与内容"],
	},
	retry: {
		purpose: "重跑上一轮失败的 agent 回合。",
		examples: ["/retry  刚才那轮再试一次"],
	},
	fresh: {
		purpose: "重置供应商的串流状态，但保留本地的对话纪录。串流卡住时用。",
		examples: ["/fresh  串流卡住了，重来"],
	},
	dump: {
		purpose: "把完整对话记录导出来（纯文字），并把送给模型的请求 JSON 写到暂存目录。",
		usage: "/dump all | anon",
		examples: ["/dump all  导出全部", "/dump anon  导出但去掉敏感内容"],
		note: "调试用。导出内容含整段对话，别随便贴到公开的地方。",
	},
	force: {
		purpose: "强制下一轮只能用某个工具（例如先看文件再说话）。",
		usage: "/force <工具名> [提示]",
		examples: ["/force read 先读这个文件"],
	},
	todo: {
		purpose: "管理 agent 的待办清单：看、编辑、导出、标记完成。",
		usage: "/todo edit | copy | expand | collapse | export | import | append | start | done | drop | rm",
		examples: ["/todo copy  拷贝成 Markdown", "/todo done  完成这一项"],
	},
	usage: {
		purpose: "看供应商的使用量与额度。",
		usage: "/usage show | reset",
		examples: ["/usage show  看目前用量"],
		note: "reset 是真的把额度纪录归零，不是重设查找。",
	},

	// ── 會話 ────────────────────────────────────────────────────────────────
	session: {
		purpose: "看目前会话的信息，或删除、钉选它。",
		usage: "/session info | delete | pin [帐号]",
		examples: ["/session info  看这是什么会话"],
		note: "delete 会删掉整个会话档，不可逆。",
	},
	pin: {
		purpose: "把会话钉在「继续上一个」清单的最前面。",
		examples: ["/pin  钉住这一个"],
	},
	rename: {
		purpose: "重命名目前会话（不给名字就让模型产生一个）。",
		usage: "/rename [新名称]",
		examples: ["/rename 数据库迁移  改名"],
		via: "侧栏的「更多」菜单里有「重命名」。",
	},
	move: {
		purpose: "把目前会话移到别的目录。",
		examples: ["/move C:\\work\\other  搬走"],
		note: "搬过去之后原本目录的项目清单里就看不到它了。",
	},
	wt: {
		purpose: "把这个会话连同变更搬到新的 git worktree。",
		usage: "/wt [分支名]",
		examples: ["/wt feature-x  开一个新 worktree 来做这件事"],
		note: "会真的开新的工作目录并带着未提交的变更。",
	},
	"add-dir": {
		purpose: "把另一个目录加进这个会话的工作范围（多根工作区）。",
		usage: "/add-dir <路径>",
		examples: ["/add-dir C:\\work\\shared  加一个共用目录"],
	},
	"remove-dir": {
		purpose: "从这个会话的工作范围移除一个目录。",
		usage: "/remove-dir <路径>",
		examples: ["/remove-dir C:\\work\\shared"],
	},
	dirs: {
		purpose: "列出这个会话目前的工作目录。",
		examples: ["/dirs  看现在能用哪些目录"],
	},
	jobs: {
		purpose: "看背景运行中的任务（长指令、背景 agent）。",
		usage: "/jobs full | kill <id> | kill all",
		examples: ["/jobs  看有什么在跑", "/jobs kill all  全部收掉"],
	},
	stats: {
		purpose: "打开本机的统计面板（token、速度、历史）。",
		examples: ["/stats  看用量统计"],
	},
	changelog: {
		purpose: "看 omp 的更新日志。",
		usage: "/changelog last | full",
		examples: ["/changelog last  只看最近一次"],
	},
	tools: {
		purpose: "列出目前对模型可见的工具。",
		examples: ["/tools  看它能用什么"],
	},
	trace: {
		purpose: "在统计面板里打开这个会话的运行追踪。",
		examples: ["/trace  看这一轮到底做了什么"],
	},
	share: {
		purpose: "用加密链接分享这个会话。",
		examples: ["/share  生成分享链接"],
		note: "链接是加密的，但拿到链接的人就能读这个会话。",
	},
	export: {
		purpose: "把会话导出成 HTML 档。",
		usage: "/export [路径]",
		examples: ["/export  导出成 HTML"],
		via: "侧栏的「更多」菜单里有「导出」。",
	},

	// ── 工作區 ──────────────────────────────────────────────────────────────
	mcp: {
		purpose: "管理 MCP 服务器：添加、移除、测试连接。",
		usage: "/mcp add | list | remove | test | enable | disable | reload | help",
		examples: ["/mcp list  看有哪些 MCP", "/mcp test 名称  试连接"],
		note: "添加服务器会改到 omp 的设置档，改完要 reload 才会生效。",
	},
	ssh: {
		purpose: "管理 SSH 主机。",
		usage: "/ssh add | list | remove | help",
		examples: ["/ssh add  把新主机加进来"],
	},
	security: {
		purpose: "OMP 原生的安全扫描：排计划、运行扫描、查看结果、导入导出比对。",
		usage: "/security plan | scan | status | cancel | scans | show | import | export | validate | compare | disposition",
		examples: ["/security plan  先排计划", "/security scan  运行扫描"],
		note: "扫描会调用外部工具，先看 plan 再决定要不要跑。",
	},
	memory: {
		purpose: "查看与维护 agent 的记忆：查看、同步、清除、重建。",
		usage: "/memory view | stats | diagnose | queue | sync | clear | reset | enqueue | rebuild",
		examples: ["/memory stats  看记忆用了多少", "/memory sync  同步记忆"],
		note: "clear 与 reset 会丢掉记忆，重要就先用 view 导出。",
	},
	ratchet: {
		purpose: "为一个 LLM 流程创建（或沿用）评测，然后无人值守地自动迭代改进。",
		usage: "/ratchet [流程与目标]",
		examples: ["/ratchet 让这个流程每次都通过测试"],
		note: "它会自己反复跑并修改东西，开始前先确认流程有评测可跑。",
	},

	// ── 外掛 ────────────────────────────────────────────────────────────────
	plugins: {
		purpose: "查看与管理已安装的插件。",
		usage: "/plugins list | enable | disable [名称]",
		examples: ["/plugins list  看装了什么"],
		via: "侧栏的「插件」页有完整的插件管理。",
	},
	"reload-plugins": {
		purpose: "重载所有插件（技能、指令、hook、工具、agent、MCP）。",
		examples: ["/reload-plugins  刚装的插件没出来，重载一下"],
		via: "侧栏的「插件」页有「重新加载」。",
	},
	marketplace: {
		purpose: "管理插件市集：加来源、搜索、安装、升级、移除。",
		usage: "/marketplace add | list | discover | install | uninstall | installed | upgrade | remove | update",
		examples: ["/marketplace discover  看看有什么可装", "/marketplace install 名称@来源"],
		note: "装插件等于把别人的代码放进来设备，先看来源。",
	},
	model: {
		purpose: "看或切换这个会话用的模型。",
		usage: "/model [模型选择器]",
		examples: ["/model  打开模型菜单", "/model minimax-code/MiniMax-M3.1-Flash  指定模型"],
		via: "状态栏的模型菜单就是同一件事。",
	},
	switch: {
		purpose: "只为这个会话换模型（不影响其他会话与全域预设）。",
		usage: "/switch [模型选择器]",
		examples: ["/switch opus  这个会话改用 Opus"],
		note: "接受模糊名称、provider/id、@角色与 :等级。",
		via: "状态栏的模型菜单就是同一件事。",
	},
	"forget-approvals": {
		purpose: "忘掉「Ask and remember」记下来的文件与文件夹许可。",
		examples: ["/forget-approvals  全部重新问一次"],
		note: "下次碰到同一个路径会再问一次。",
	},
};

/**
 * 子指令的教學補充：`指令/子指令` → 一句話。
 *
 * 為什麼另外一張表：子指令的說明是短句，跟「指令是什麼、怎麼用」的教學不同層級。
 * 沒有條目的子指令用 omp 自己的英文說明。
 */
export const SUB_HELP: Record<string, string> = {
	"fast/ultra": "超快通道：需要 OpenAI API 或支持的 Codex 模型。",
	"fast/status": "看快速模式现在的状态。",
	"slow/status": "看慢速模式现在的状态。",
	"compact/soft": "用目前的模型在本地做摘要，不调用服务器的压缩。",
	"compact/remote": "用服务器压缩；失败就退回本地摘要。",
	"compact/snapcompact": "把历史压成图片存盘，模型看图读回来，完全不调用模型。",
	"shake/elide": "丢掉工具输出里的大段内容。",
	"shake/images": "丢掉上下文里的图片。",
	"shake/thinking": "丢掉模型的思考区块。",
	"todo/edit": "在编辑器里打开待办清单。",
	"todo/copy": "把待办拷贝成 Markdown。",
	"todo/expand": "展开完整的待办内容。",
	"todo/collapse": "把待办收回成预览高度。",
	"todo/export": "把待办写成 Markdown 档。",
	"todo/import": "从 Markdown 档读入待办。",
	"todo/append": "追加一条任务。",
	"todo/start": "开始某一条任务。",
	"todo/done": "把任务标成完成。",
	"session/info": "显示目前会话的信息。",
	"session/delete": "删除这个会话。",
	"session/pin": "把会话钉在清单最前面。",
	"usage/show": "显示用量。",
	"usage/reset": "把用量纪录归零。",
	"jobs/full": "显示背景任务的完整信息。",
	"jobs/kill": "中止某个背景任务。",
	"changelog/last": "只看最近一次更新。",
	"changelog/full": "看完整更新日志。",
	"modelpreset/list": "列出所有预设。",
	"modelpreset/save": "把目前的模型组合存成一个预设。",
	"modelpreset/switch": "切到某个预设。",
	"modelpreset/delete": "删掉某个预设。",
	"advisor/dump": "把顾问写的笔记倒出来看。",
	"advisor/configure": "设置顾问模型与行为。",
	"mcp/add": "添加一个 MCP 服务器。",
	"mcp/list": "列出 MCP 服务器。",
	"mcp/remove": "移除一个 MCP 服务器。",
	"mcp/test": "测试某个 MCP 服务器的连接。",
	"mcp/enable": "激活某个 MCP 服务器。",
	"mcp/disable": "禁用某个 MCP 服务器。",
	"mcp/reload": "重新加载 MCP 设置。",
	"plugins/list": "列出已安装的插件。",
	"plugins/enable": "激活某个插件。",
	"plugins/disable": "禁用某个插件。",
	"marketplace/list": "列出已加的市集来源。",
	"marketplace/discover": "在市集里搜索可安装的插件。",
	"marketplace/install": "安装一个插件。",
	"marketplace/uninstall": "移除已安装的插件。",
	"marketplace/upgrade": "升级已安装的插件。",
	"memory/view": "查看记忆内容。",
	"memory/stats": "看记忆的统计。",
	"memory/sync": "同步记忆。",
	"memory/clear": "清掉记忆。",
	"memory/diagnose": "诊断记忆出了什么问题。",
};

/** 這個 App 用自己的控制取代了某條指令時，說明那是什麼控制。 */
export const HELP_VIA: Record<string, string> = {
	model: "状态栏的模型菜单",
	switch: "状态栏的模型菜单",
	effort: "状态栏的模型菜单",
	plugins: "侧栏的「插件」页",
	"reload-plugins": "侧栏的「插件」页",
	rename: "侧栏的「更多」菜单",
	export: "侧栏的「更多」菜单",
};
