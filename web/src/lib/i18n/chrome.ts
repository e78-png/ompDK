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
	"chrome.emptySkill": ["这个技能没有可显示的内容", "This skill has nothing to show"],
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
	"chrome.ompUpdateRestartHint": ["已在执行的工作阶段仍用旧版本，新开的工作阶段才会用到新版", "Sessions that are already running still use the old build; new sessions will use the new one"],
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
	"chrome.loadOmpConfigFailed": ["读取 OMP 设置失败：{error}", "Couldn't read OMP's settings: {error}"],
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

	// Command palette (web/src/lib/commands.ts, components/CommandPalette.tsx).
	"chrome.cmd.title": ["命令面板", "Command palette"],
	"chrome.cmd.placeholder": ["搜索命令…", "Search commands…"],
	"chrome.cmd.empty": ["没有匹配的命令", "No matching commands"],
	"chrome.cmd.hint": ["↑↓ 选择 · Enter 执行 · Esc 关闭", "↑↓ select · Enter run · Esc close"],
	"chrome.cmd.group.navigate": ["导航", "Navigate"],
	"chrome.cmd.group.sessions": ["会话", "Chats"],
	"chrome.cmd.group.view": ["视图", "View"],
	"chrome.cmd.group.app": ["应用", "App"],
	"chrome.cmd.group.help": ["帮助", "Help"],
	"chrome.cmd.newChat": ["新会话", "New chat"],
	"chrome.cmd.jumpTo": ["跳到会话", "Jump to a chat"],
	"chrome.cmd.jumpToHint": ["最近打开的会话", "Recently opened chats"],
	"chrome.cmd.plugins": ["插件页面", "Plugins page"],
	"chrome.cmd.settings": ["设置", "Settings"],
	"chrome.cmd.toggleSidebar": ["显示或隐藏侧栏", "Show or hide the sidebar"],
	"chrome.cmd.toggleSidebarMode": ["切换侧栏模式", "Switch the sidebar mode"],
	"chrome.cmd.toggleTheme": ["切换深色或浅色", "Switch between dark and light"],
	"chrome.cmd.refresh": ["重新读取会话", "Reload the chat list"],
	"chrome.cmd.showShortcuts": ["键盘快捷键", "Keyboard shortcuts"],
	"chrome.cmd.shortcutsTitle": ["键盘快捷键", "Keyboard shortcuts"],
	"chrome.cmd.shortcutsHint": ["这些快捷键在任何画面都有效。", "These shortcuts work on every screen."],
	"chrome.cmd.back": ["回到命令列表", "Back to the command list"],

	// Global shortcuts (web/src/lib/shortcuts.ts).
	"chrome.shortcut.palette": ["打开命令面板", "Open the command palette"],
	"chrome.shortcut.sidebar": ["显示或隐藏侧栏", "Show or hide the sidebar"],
	"chrome.shortcut.send": ["发送消息", "Send the message"],
	"chrome.shortcut.close": ["关闭当前窗口", "Close the current window"],
	"chrome.shortcut.settings": ["打开设置", "Open the settings"],
	"chrome.shortcut.mode": ["切换侧栏模式", "Switch the sidebar mode"],
	"chrome.shortcut.theme": ["切换深色或浅色", "Switch between dark and light"],
	"chrome.shortcut.refresh": ["重新读取会话", "Reload the chat list"],

	// Empty states that are not tied to one page.
	"chrome.empty.noChats": ["还没有会话", "No chats yet"],
	"chrome.empty.noChatsHint": ["从上面的「项目」开始：选一个项目，再按「新建会话」。", "Start from the projects above: pick one, then use “New chat”."],
	"chrome.empty.noSearchResults": ["没有匹配「{query}」的会话", "No chats match “{query}”"],
	"chrome.empty.noSearchResultsHint": ["换个关键词，或清除搜索框。", "Try another keyword, or clear the search box."],
	"chrome.empty.loadingList": ["正在读取…", "Loading…"],
	"chrome.empty.noShortcuts": ["这个列表还是空的", "This list is empty"],
	"chrome.empty.clearSearch": ["清除搜索", "Clear the search"],

	// New-session starter prompts (lib/starters.ts).
	"chrome.startersTitle": ["你可以这样开始", "You could start like this"],
	"chrome.starter.summarize": ["读一下这个项目的结构，给我一份摘要", "Read this project's structure and give me a summary"],
	"chrome.starter.summarizeLabel": ["项目摘要", "Project summary"],
	"chrome.starter.todos": ["找出这个项目里所有的 TODO，并按类型分类", "Find every TODO in this project and group them by kind"],
	"chrome.starter.todosLabel": ["整理待办", "Collect the TODOs"],
	"chrome.starter.tests": ["为这个项目里最核心的那个函数补上测试", "Write tests for the most central function in this project"],
	"chrome.starter.testsLabel": ["补测试", "Write tests"],
	"chrome.starter.explain": ["解释这个项目是怎么跑起来的，从入口讲起", "Explain how this project runs, starting from its entry point"],
	"chrome.starter.explainLabel": ["讲讲原理", "Explain the design"],
} as const satisfies Fragment;
