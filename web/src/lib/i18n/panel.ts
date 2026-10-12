/**
 * Right panel and the cards the conversation raises for an answer: inspector pages, subagents,
 * approval cards, collapsible bodies — plus the shared formatters in `lib/format.ts`.
 * Keys are `panel.*`; the pair is [中文, English].
 */
import type { Fragment } from "./index.ts";

export const panel = {
	// Durations and relative times (lib/format.ts).
	"panel.dur.sec": ["{n} 秒", "{n}s"],
	"panel.dur.minSec": ["{m} 分 {s} 秒", "{m}m {s}s"],
	"panel.dur.hourMin": ["{h} 小时 {m} 分", "{h}h {m}m"],
	"panel.time.justNow": ["刚刚", "just now"],
	"panel.time.minAgo": ["{n} 分钟前", "{n} min ago"],
	"panel.time.hourAgo": ["{n} 小时前", "{n} hr ago"],
	"panel.time.dayAgo": ["{n} 天前", "{n} d ago"],

	// Thinking levels (lib/format.ts).
	"panel.effort.off": ["关闭", "Off"],
	"panel.effort.minimal": ["极低", "Minimal"],
	"panel.effort.low": ["低", "Low"],
	"panel.effort.medium": ["中", "Medium"],
	"panel.effort.high": ["高", "High"],
	"panel.effort.xhigh": ["超高", "X-High"],
	"panel.effort.max": ["最高", "Max"],
	"panel.effort.auto": ["自动", "Auto"],
	"panel.effort.inherit": ["默认", "Default"],

	// Skill sources (lib/skills.ts).
	"panel.skillGroup.user": ["用户技能", "User skills"],
	"panel.skillGroup.project": ["项目技能", "Project skills"],
	"panel.skillGroup.plugin": ["插件提供", "Plugins"],
	"panel.skillGroup.managed": ["自动学习", "Auto-learned"],
	"panel.skillGroup.other": ["其他", "Other"],

	// Inspector shell.
	"panel.tab.info": ["信息", "Info"],
	"panel.tab.agents": ["子代理", "Subagents"],
	"panel.tab.files": ["文件", "Files"],
	"panel.tab.changes": ["改动", "Changes"],
	"panel.close": ["关闭", "Close"],
	"panel.noCwd": ["会话还没有工作目录", "This session has no working directory yet"],

	// Inspector info page.
	"panel.info.todos": ["待办", "Todos"],
	"panel.info.context": ["上下文", "Context"],
	"panel.info.noData": ["暂无数据", "No data"],
	"panel.info.session": ["会话", "Session"],
	"panel.info.model": ["模型", "Model"],
	"panel.info.thinking": ["思考", "Thinking"],
	"panel.info.messages": ["消息", "Messages"],
	"panel.info.dir": ["目录", "Directory"],
	"panel.info.file": ["文件", "File"],
	"panel.info.usage": ["{used} / {total} tokens（{percent}%）", "{used} / {total} tokens ({percent}%)"],

	// Inspector files page.
	"panel.files.empty": ["空目录", "Empty directory"],
	"panel.files.preview": ["文件预览", "File preview"],
	"panel.files.closePreview": ["关闭文件预览", "Close file preview"],
	"panel.files.binary": ["二进制文件，无法预览", "Binary file, cannot preview"],
	"panel.files.truncated": ["文件较大，仅显示前 256 KB", "File is large; showing the first 256 KB"],

	// Inspector changes page.
	"panel.changes.loading": ["正在读取改动…", "Reading changes…"],
	"panel.changes.notRepo": ["此项目不是 Git 仓库", "This project is not a Git repository"],
	"panel.changes.clean": ["工作区干净，没有改动", "Working tree clean, no changes"],
	"panel.changes.closePreview": ["关闭改动预览", "Close change preview"],
	"panel.changes.noDiff": ["（没有内容差异）", "(no content differences)"],
	"panel.changes.untracked": ["未跟踪的文件，按全新增显示", "Untracked file, shown as all new"],
	"panel.changes.truncated": ["diff 超过 512 KB，已截断", "diff exceeds 512 KB, truncated"],
	"panel.changes.readingDiff": ["正在读取 diff…", "Reading diff…"],

	// Subagents panel.
	"panel.agent.state.pending": ["等待", "Pending"],
	"panel.agent.state.running": ["运行中", "Running"],
	"panel.agent.state.completed": ["完成", "Completed"],
	"panel.agent.state.failed": ["失败", "Failed"],
	"panel.agent.state.aborted": ["已停止", "Stopped"],
	"panel.agent.state.unknown": ["未结束", "Unfinished"],
	"panel.agent.thinking": ["思考中", "Thinking"],
	"panel.agent.empty": [
		"这个会话还没有派发子代理。模型调用 task 工具后，进度会显示在这里。",
		"No subagents dispatched in this session yet. Progress appears here once the model calls the task tool.",
	],
	"panel.agent.steerFailed": ["追加指令失败：{msg}", "Failed to send instruction: {msg}"],
	"panel.agent.toolCalls": ["工具 {n} 次", "{n} tool calls"],
	"panel.agent.collapse": ["收起", "Collapse"],
	"panel.agent.expandTask": ["展开任务", "Expand task"],
	"panel.agent.reading": ["正在读取过程…", "Reading progress…"],
	"panel.agent.noOutput": ["还没有输出", "No output yet"],
	"panel.agent.steerPlaceholder": ["给它追加指令，Enter 发送", "Send it an instruction, Enter to submit"],
	"panel.agent.stopTitle": ["停止这个子代理", "Stop this subagent"],
	"panel.agent.stop": ["停止", "Stop"],

	// Inline request cards (UiCard.tsx).
	"panel.card.confirm": ["确认", "Confirm"],
	"panel.card.allow": ["允许", "Allow"],
	"panel.card.reject": ["拒绝", "Deny"],
	"panel.card.cancel": ["取消", "Cancel"],
	"panel.card.select": ["请选择", "Select"],
	"panel.card.input": ["请输入", "Enter a value"],
	"panel.card.submit": ["提交", "Submit"],
	"panel.card.skip": ["跳过", "Skip"],
	"panel.card.recommended": ["（推荐）", "(recommended)"],
	"panel.card.customPlaceholder": ["其他（自定义回答）", "Other (custom answer)"],
	"panel.card.countdown": ["{n} 秒后自动选择默认项", "Picks the default in {n}s"],

	// Folded message bodies and markdown code blocks.
	"panel.fold.collapse": ["收起消息", "Collapse message"],
	"panel.fold.expand": ["展开全部", "Expand all"],
	"panel.md.copy": ["复制", "Copy"],
	"panel.md.copied": ["已复制", "Copied"],
} as const satisfies Fragment;
