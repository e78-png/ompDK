/**
 * The shell around the conversation: entry, sidebar, home, plugins page, pairing, notices,
 * dialogs and the data the store itself renders.
 * Keys are `shell.*`; the pair is [中文, English].
 */
import type { Fragment } from "./index.ts";

export const shell = {
	// Brand bar and sidebar sections.
	"shell.collapseSidebar": ["收起侧栏", "Collapse sidebar"],
	"shell.searchChats": ["搜索会话", "Search chats"],
	"shell.newChat": ["新会话", "New chat"],
	"shell.plugins": ["插件", "Plugins"],
	"shell.settings": ["设置", "Settings"],
	"shell.offline": ["连接中断", "Offline"],
	"shell.offlineTitle": ["与本机服务的连接已中断，正在自动重连", "Disconnected from the local server; reconnecting automatically"],

	// Project list and its filter popover.
	"shell.projects": ["项目", "Projects"],
	"shell.projectScope": ["项目显示范围", "Which projects to show"],
	"shell.addProject": ["添加项目", "Add project"],
	"shell.scopeTitle": ["显示范围", "Scope"],
	"shell.filterAll": ["全部项目", "All projects"],
	"shell.filterManual": ["仅手动选择", "Manual only"],
	"shell.filterRecent": ["按最近活动", "By recent activity"],
	"shell.recent": ["最近", "Recent"],
	"shell.days": ["{n} 天", "{n}d"],
	"shell.recentFilterNote": [
		"按最新会话的时间筛选：只钉住、还没聊过的项目也会隐藏；当前打开的会话所属项目保留",
		"Filters by the newest chat's time: projects you only pinned and never chatted in are hidden too; the open chat's project stays listed",
	],
	"shell.whichProjects": ["显示哪些项目", "Which projects to show"],
	"shell.selectAll": ["全选", "All"],
	"shell.selectNone": ["全不选", "None"],
	"shell.chatCount": ["{n} 个会话", "{n} chats"],
	"shell.noProjects": ["还没有项目", "No projects yet"],
	"shell.manualNote": ["勾选要显示的项目；当前打开的会话所属项目始终保留", "Pick the projects to show; the open chat's project always stays listed"],
	"shell.hiddenProjects": ["当前隐藏了 {n} 个项目", "{n} projects hidden"],
	"shell.newChatHere": ["在此项目新建会话", "New chat in this project"],
	"shell.showMore": ["显示更多（{n}）", "Show {n} more"],
	"shell.noChats": ["暂无会话", "No chats"],

	// Sidebar mode switch and the time-group headings.
	"shell.sidebarMode": ["侧栏模式", "Sidebar"],
	"shell.modeTime": ["时间", "Time"],
	"shell.modeProject": ["项目", "Projects"],
	"shell.groupToday": ["今天", "Today"],
	"shell.groupYesterday": ["昨天", "Yesterday"],
	"shell.groupWeek": ["近 7 天", "Previous 7 days"],
	"shell.groupOlder": ["更早", "Earlier"],
	"shell.noRecentChats": ["没有会话", "No chats yet"],
	"shell.emptyNoProjects": ["还没有项目，点上方 + 添加", "No projects yet — add one with + above"],
	"shell.emptyFiltered": ["当前显示范围内没有项目，点漏斗图标调整", "No projects in this range — adjust with the filter icon"],

	// A session row and its menu.
	"shell.copyTag": ["副本", "Copy"],
	"shell.copyTagTitle": ["omp 在原会话被占用时自动另存的", "Saved by omp because the original chat was in use"],
	"shell.liveRunning": ["运行中", "Running"],
	"shell.liveConnected": ["已连接", "Connected"],
	"shell.more": ["更多", "More"],
	"shell.readOnly": ["只读查看（CLI 会话）", "Read-only (CLI session)"],
	"shell.rename": ["重命名", "Rename"],
	"shell.exportHtml": ["导出 HTML", "Export HTML"],
	"shell.archive": ["归档", "Archive"],
	"shell.renameFailed": ["重命名失败：{error}", "Couldn't rename: {error}"],
	"shell.exportFailed": ["导出失败：{error}", "Couldn't export: {error}"],
	"shell.archiveFailed": ["归档失败：{error}", "Couldn't archive: {error}"],
	"shell.archivedNotice": ["已归档「{title}」，可在 设置 → 已归档的会话 中恢复", "Archived “{title}”. Restore it under Settings → Archived sessions"],

	// Home screen.
	"shell.homeTitle": ["有什么要做的？", "What do you want to do?"],
	"shell.composerPlaceholder": ["描述任务，Enter 发送", "Describe a task, Enter to send"],
	"shell.pickProjectFirst": ["请先选择项目文件夹", "Choose a project folder first"],
	"shell.expand": ["展开", "Expand"],
	"shell.collapse": ["收起", "Collapse"],
	"shell.recentChats": ["最近会话", "Recent chats"],
	"shell.restoreHidden": ["恢复隐藏（{n}）", "Restore {n} hidden"],
	"shell.hideRecent": ["从最近会话里隐藏", "Hide from recent chats"],
	"shell.recentAllHidden": ["最近会话都隐藏了", "All recent chats are hidden"],

	// Plugins page.
	"shell.pluginsSub": ["让 OMP 使用的技能与插件", "Skills and plugins OMP uses"],
	"shell.searchPlugins": ["搜索插件和技能", "Search plugins and skills"],
	"shell.reload": ["重新读取", "Reload"],
	"shell.tabSkills": ["技能 {n}", "Skills {n}"],
	"shell.tabPlugins": ["插件 {n}", "Plugins {n}"],
	"shell.loading": ["正在读取…", "Loading…"],
	"shell.noSkillMatch": ["没有匹配「{query}」的技能", "No skills match “{query}”"],
	"shell.noPluginMatch": ["没有匹配「{query}」的插件", "No plugins match “{query}”"],
	"shell.disabled": ["已停用 · {n}", "Disabled · {n}"],
	"shell.manualOnly": ["仅手动", "Manual only"],
	"shell.marketplacePlugins": ["市场插件", "Marketplace plugins"],
	"shell.npmPlugins": ["npm 插件", "npm plugins"],
	"shell.skillPath": ["~/.agents/skills/<名称>/SKILL.md", "~/.agents/skills/<name>/SKILL.md"],
	"shell.emptySkillsLead": ["还没有技能。把技能放到 ", "No skills yet. Put skills in "],
	"shell.emptySkillsMid": [" 或项目的 ", " or the project's "],
	"shell.emptySkillsTail": [" 下，然后点刷新。", ", then hit reload."],
	"shell.emptySkillsNoProjects": ["先在侧栏添加一个项目，技能是按项目列出的。", "Add a project in the sidebar first; skills are listed per project."],
	"shell.emptyPluginsLead": [
		"还没有安装插件。插件市场会在下一版提供；现在可以在终端用 ",
		"No plugins installed. A marketplace comes in a later version; for now install from a terminal with ",
	],
	"shell.pluginInstallCmd": ["omp plugin install <包名>", "omp plugin install <name>"],
	"shell.emptyPluginsTail": [" 安装。", "."],

	// Project picker chip and folder browser.
	"shell.chooseProject": ["选择项目", "Choose project"],
	"shell.searchProjects": ["搜索项目", "Search projects"],
	"shell.noMatchingProjects": ["没有匹配的项目", "No matching projects"],
	"shell.addProjectFolder": ["添加项目文件夹…", "Add project folder…"],
	"shell.chooseFolder": ["选择项目文件夹", "Choose project folder"],
	"shell.close": ["关闭", "Close"],
	"shell.pathPlaceholder": ["输入绝对路径，回车跳转", "Type an absolute path, Enter to go"],
	"shell.useThisFolder": ["选择此文件夹", "Use this folder"],
	"shell.upOneLevel": ["上一级", "Up one level"],
	"shell.thisPc": ["此电脑", "This PC"],
	"shell.noSubfolders": ["没有子文件夹", "No subfolders"],
} as const satisfies Fragment;
