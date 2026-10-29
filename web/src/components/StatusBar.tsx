/**
 * 對話區底部的狀態列。
 *
 * 為什麼要有這一列：模型、思考等級、上下文用量與工作階段狀態本來都在右側
 * 面板裡，但那些資訊不該要點進去才看得到——「現在用的是哪個模型、還剩多少
 * 上下文」是每回合都會想知道的事。
 *
 * 為什麼每一格都可點：右側面板已經有這些資料了，點一下直接跳到對應的分頁，
 * 就不用把同樣的東西畫兩遍。
 */
import { app, useApp } from "../lib/app-store.ts";
import { effortName } from "../lib/format.ts";
import { t } from "../lib/i18n/index.ts";
import { Icon } from "../lib/icons.tsx";
import type { SessionStore } from "../lib/session-store.ts";

/** One clickable cell. */
function Cell({
	label,
	value,
	title,
	active,
	onClick,
}: {
	label: string;
	value: string;
	title?: string;
	/** Shown as a filled dot in front of the value; marks "something is happening". */
	active?: boolean;
	onClick: () => void;
}) {
	return (
		<button className="status-cell" onClick={onClick} title={title ?? `${label}：${value}`}>
			<span className="status-label">{label}</span>
			{active && <span className="status-dot" />}
			<span className="status-value">{value}</span>
		</button>
	);
}

export function StatusBar({ store }: { store: SessionStore }) {
	const a = useApp();
	const s = store.state;
	const usage = s?.contextUsage;
	const model = s?.model;
	const modelText = model ? (model.name || `${model.provider}/${model.id}`) : t("chat.status.unknown");
	const effort = effortName(s?.thinkingLevel);
	const running = store.isRunning;

	// 工作階段：待辦有幾個、做完了幾個。沒有待辦時顯示回合的忙碌狀態。
	const tasks = (s?.todoPhases ?? []).flatMap(p => p.tasks);
	const done = tasks.filter(task => task.status === "completed").length;
	const phaseText = tasks.length > 0 ? `${done}/${tasks.length}` : running ? t("chat.status.working") : t("chat.status.idle");

	const openPanel = (tab: "info" | "agents") => app.setPrefs({ inspectorOpen: true, inspectorTab: tab });

	return (
		<div className="status-bar">
			<Cell label={t("chat.status.model")} value={modelText} onClick={() => openPanel("info")} />
			{effort && <Cell label={t("chat.status.thinking")} value={effort} onClick={() => openPanel("info")} />}
			{usage?.contextWindow && (
				<Cell
					label={t("chat.status.context")}
					value={`${Math.round(usage.percent)}%`}
					title={t("chat.status.contextTitle", { used: usage.tokens, total: usage.contextWindow })}
					onClick={() => openPanel("info")}
				/>
			)}
			<Cell
				label={t("chat.status.phase")}
				value={phaseText}
				active={running}
				title={running ? t("chat.status.workingTitle") : t("chat.status.idleTitle")}
				onClick={() => openPanel("info")}
			/>
			{store.subagents.size > 0 && (
				<button className="status-cell" onClick={() => openPanel("agents")} title={t("chat.status.agentsTitle", { n: store.subagents.size })}>
					<Icon name="agent" size={13} />
					<span className="status-value">{store.subagents.size}</span>
				</button>
			)}
			<span className="status-spacer" />
			<a className="status-help" href="#/settings" title={t("chat.status.helpTitle")}>
				<Icon name="settings" size={13} />
			</a>
			{!a.prefs.inspectorOpen && <span className="status-hint">{t("chat.status.hint")}</span>}
		</div>
	);
}
