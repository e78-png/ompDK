/**
 * Everything else the shell shows: model and project pickers, the pairing screen, the skill
 * drawer, and the notices, activity lines and connection text the stores produce.
 * Keys are `chrome.*`; the pair is [中文, English].
 */
import type { Fragment } from "./index.ts";

export const chrome = {
	// Model picker
	"chrome.defaultModel": ["默认模型", "Default model"],
	"chrome.moreModels": ["更多模型", "More models"],
	"chrome.modelsLoading": ["正在读取模型列表…", "Loading models…"],
	"chrome.modelsNoMatch": ["没有匹配的模型", "No matching models"],
	"chrome.modelChangeCache": ["切换模型或思考等级会让已有的提示词缓存失效。", "Switching model or thinking level invalidates the prompt cache."],
	"chrome.thinking": ["思考", "Thinking"],
	"chrome.back": ["返回", "Back"],
	"chrome.searchModels": ["搜索模型", "Search models"],
	"chrome.switchModelFailed": ["切换模型失败：{error}", "Couldn't switch model: {error}"],

	// Pairing screen
	"chrome.pairTitle": ["输入访问码", "Enter access code"],
	"chrome.pairLead": ["访问码显示在电脑的终端里，或电脑上的「设置 → 手机访问」。", "The code is shown in your computer's terminal, or under Settings → Mobile access."],
	"chrome.accessCode": ["访问码", "Access code"],
	"chrome.pairNote": ["六位数字，输满自动提交", "Six digits, submitted automatically"],
	"chrome.pairEnter": ["进入", "Continue"],
	"chrome.pairWrongCode": ["访问码不对，还能试 {left} 次", "Wrong code, {left} attempts left"],
	"chrome.pairTooMany": ["试错次数太多，请 {minutes} 分钟后再试", "Too many attempts. Try again in {minutes} minutes."],
	"chrome.pairFailed": ["配对失败，请稍后再试", "Pairing failed. Try again later."],

	// Skill drawer
	"chrome.copyFailed": ["复制失败", "Copy failed"],
	"chrome.manualOnly": ["仅手动", "Manual only"],
	"chrome.close": ["关闭", "Close"],
	"chrome.copyPath": ["复制路径", "Copy path"],
	"chrome.revealInExplorer": ["在资源管理器中显示", "Show in file explorer"],
	"chrome.readingSkill": ["正在读取 SKILL.md…", "Reading SKILL.md…"],
	"chrome.useInNewSession": ["在新会话中使用", "Use in new session"],

	// Sidebar and panels
	"chrome.openSidebar": ["打开侧栏", "Open sidebar"],
	"chrome.expandSidebar": ["展开侧栏", "Expand sidebar"],
	"chrome.resizeSidebar": ["调整左侧栏宽度", "Resize left panel"],
	"chrome.resizeInspector": ["调整右侧栏宽度", "Resize right panel"],
	"chrome.resizeHint": ["拖动调整宽度，双击恢复默认", "Drag to resize, double-click to reset"],

	// omp compatibility banner
	"chrome.ompIncompatible": ["omp {version} 与本应用不兼容：", "omp {version} is incompatible with this app: "],
	"chrome.ompProblemsUnknown": ["启动检查失败", "startup check failed"],
	"chrome.problemSep": ["；", "; "],
	"chrome.ompRunCheck": ["运行", "Run"],
	"chrome.ompCheckSuffix": ["查看全部差异。", "to see all differences."],
	"chrome.ompUntested": ["omp {version} 未经校验，功能通常正常。", "omp {version} is unverified; things usually work."],
	"chrome.ompVerify": ["验证", "Verify"],
	"chrome.ompVerifying": ["验证中…", "Verifying…"],
	"chrome.ompUpdated": ["已更新到 omp {version}", "Updated to omp {version}"],
	"chrome.ompUpdateFailed": ["更新失败：{error}", "The update failed: {error}"],
	"chrome.ompUpdateCheckFailed": ["检查更新失败：{error}", "Could not check for updates: {error}"],
	"chrome.ompCheckPassed": ["兼容性检查通过（{count} 项）", "The compatibility check passed ({count} items)"],
	"chrome.ompCheckFailed": ["兼容性检查有 {count} 项失败", "The compatibility check has {count} failing items"],
	"chrome.ompCheckError": ["兼容性检查失败：{error}", "The compatibility check failed: {error}"],

	// App-level toasts and notifications
	"chrome.newSessionFailed": ["新建会话失败：{error}", "Couldn't create session: {error}"],
	"chrome.sendFailed": ["发送失败：{error}", "Couldn't send: {error}"],
	"chrome.sessionExited": ["会话进程已退出", "Session process exited"],
	"chrome.loadAgentSettingsFailed": ["读取智能体设置失败：{error}", "Couldn't load agent settings: {error}"],
	"chrome.loadPluginsFailed": ["读取技能与插件失败：{error}", "Couldn't load skills and plugins: {error}"],
	"chrome.serverStale": ["服务端还是旧版本，部分界面不可用：请重启服务（Ctrl+C 后重新运行 ompweb，或 ompweb --restart）", "The server is running an older version, so some screens are unavailable: restart it (Ctrl+C, then ompweb again, or ompweb --restart)"],
	"chrome.rotateCodeFailed": ["换码失败：{error}", "Couldn't rotate code: {error}"],
	"chrome.revokeFailed": ["退出登录失败：{error}", "Couldn't sign out: {error}"],
	"chrome.notifyAsk": ["需要你的回复 · {title}", "Reply needed · {title}"],
	"chrome.notifyDone": ["已完成 · {title}", "Finished · {title}"],

	// Session activity and notices
	"chrome.startingSession": ["正在启动会话…", "Starting session…"],
	"chrome.compacting": ["正在压缩上下文…", "Compacting context…"],
	"chrome.retrying": ["请求失败，正在重试（第 {n} 次）…", "Request failed, retrying (attempt {n})…"],
	"chrome.requestFailed": ["请求失败", "Request failed"],
	"chrome.extensionError": ["扩展错误：{error}", "Extension error: {error}"],
	"chrome.questionWaiting": ["有一个问题等你回答", "A question is waiting for you"],
	"chrome.turnDone": ["回合已完成", "Turn finished"],

	// Connection
	"chrome.connectionLost": ["连接已断开", "Connection lost"],
	"chrome.failed": ["失败", "Failed"],
} as const satisfies Fragment;
