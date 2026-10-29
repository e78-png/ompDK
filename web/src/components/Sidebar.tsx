import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { SessionSummary } from "../../../shared/api.ts";
import { app, type ProjectFilter, useApp } from "../lib/app-store.ts";
import { relativeTime } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { t, type MessageKey } from "../lib/i18n/index.ts";
import { groupByTime, sessionTime, type TimeGroupKey } from "../lib/session-groups.ts";
import { baseName } from "../lib/turns.ts";
import { api, gateway } from "../lib/ws.ts";
import { isNarrow } from "../lib/viewport.ts";
import { Popover } from "./Popover.tsx";
import { FolderDialog } from "./ProjectPicker.tsx";
import { PanelResize } from "./PanelResize.tsx";
import { Seg } from "./settings/controls.tsx";
import { SidebarSkeleton } from "./Skeleton.tsx";

const PAGE = 6;
/** 時間模式每組先給 10 筆，剩下的用「顯示更多」展開。 */
const TIME_PAGE = 10;
const FILTERS: [ProjectFilter, MessageKey][] = [
	["all", "shell.filterAll"],
	["manual", "shell.filterManual"],
	["recent", "shell.filterRecent"],
];
const RECENT_DAYS = [1, 3, 7, 14, 30];
const DAY_MS = 24 * 60 * 60 * 1000;
const GROUP_TITLES: Record<TimeGroupKey, MessageKey> = {
	today: "shell.groupToday",
	yesterday: "shell.groupYesterday",
	week: "shell.groupWeek",
	older: "shell.groupOlder",
};

function key(p: string): string {
	return p.replace(/[\\/]+$/, "").toLowerCase();
}

export function Sidebar() {
	const a = useApp();
	const [query, setQuery] = useState("");
	const [expanded, setExpanded] = useState<Record<string, number>>({});
	// 時間模式的展開狀態另記：專案路徑與分組名稱可能撞字，混用同一張表會互相污染。
	const [expandedGroups, setExpandedGroups] = useState<Record<string, number>>({});
	const [browse, setBrowse] = useState(false);
	const [filterOpen, setFilterOpen] = useState(false);
	const filterBtn = useRef<HTMLButtonElement>(null);
	const connected = useSyncExternalStore(gateway.onStatus.bind(gateway), () => gateway.connected);

	const byProject = useMemo(() => {
		const map = new Map<string, SessionSummary[]>();
		for (const s of a.sessions) {
			const k = key(s.cwd);
			let list = map.get(k);
			if (!list) map.set(k, (list = []));
			list.push(s);
		}
		return map;
	}, [a.sessions]);

	// Newest real session per project, by message time: a file mtime is bumped by
	// omp's own bookkeeping writes (model_change, session_exit), which used to make
	// idle projects — and pinned ones — look active forever.
	const activeAt = useMemo(() => {
		const map = new Map<string, number>();
		for (const s of a.sessions) {
			const k = key(s.cwd);
			const at = s.activeAt || s.modified;
			map.set(k, Math.max(map.get(k) ?? 0, at));
		}
		return map;
	}, [a.sessions]);

	// The project of the open session always stays listed, whatever the filter says.
	const routeProject = useMemo(() => {
		if (!a.route) return undefined;
		const session = a.sessions.find(s => key(s.path) === key(a.route as string));
		return session?.cwd ? key(session.cwd) : undefined;
	}, [a.route, a.sessions]);

	const projects = useMemo(() => {
		const { projectFilter, visibleProjects, recentDays } = a.prefs;
		if (projectFilter === "all") return a.projects;
		const cutoff = Date.now() - recentDays * DAY_MS;
		return a.projects.filter(p => {
			if (routeProject && key(p.path) === routeProject) return true;
			if (projectFilter === "manual") return visibleProjects.some(v => key(v) === key(p.path));
			return (activeAt.get(key(p.path)) ?? 0) > cutoff;
		});
	}, [a.projects, a.sessions, a.prefs.projectFilter, a.prefs.visibleProjects, a.prefs.recentDays, routeProject, activeAt]);
	const hiddenProjects = a.projects.length - projects.length;

	const q = query.trim().toLowerCase();
	const collapsed = new Set(a.prefs.collapsedProjects.map(key));
	const toggle = (path: string) => {
		const k = key(path);
		const next = collapsed.has(k) ? a.prefs.collapsedProjects.filter(p => key(p) !== k) : [...a.prefs.collapsedProjects, path];
		app.setPrefs({ collapsedProjects: next });
	};

	// 時間模式：像 ChatGPT 那樣把會話平鋪出來，只按時間分組，不受「項目範圍」篩選影響。
	const timeMode = a.prefs.sidebarMode !== "project";
	const timeGroups = useMemo(() => {
		const list = q ? a.sessions.filter(s => s.title.toLowerCase().includes(q)) : a.sessions;
		return groupByTime(list, Date.now());
	}, [a.sessions, q]);
	// 每列要標出所屬項目：先對到項目清單，沒有就用路徑最後一段。
	const projectNames = useMemo(() => {
		const map = new Map<string, string>();
		for (const p of a.projects) map.set(key(p.path), p.name);
		return map;
	}, [a.projects]);

	return (
		<aside className="sidebar">
			{!a.prefs.sidebarCollapsed && <PanelResize panel="sidebar" />}
			<div className="sb-top">
				<div className="brand">
					<span className="brand-mark">π</span>
					<span>ompDK</span>
				</div>
				<button className="icon-btn" title={t("shell.collapseSidebar")} onClick={() => (isNarrow() ? app.closeDrawer() : app.setPrefs({ sidebarCollapsed: true }))}>
					<Icon name="panelLeft" />
				</button>
			</div>
			<div className="sb-actions">
				<button className={`sb-item ${a.view === "home" ? "active" : ""}`} onClick={() => app.open(undefined)}>
					<Icon name="newChat" />
					<span>{t("shell.newChat")}</span>
				</button>
				<div className="sb-mode" title={t("shell.sidebarMode")}>
					<Seg
						value={a.prefs.sidebarMode}
						options={[["time", t("shell.modeTime")], ["project", t("shell.modeProject")]]}
						onChange={sidebarMode => app.setPrefs({ sidebarMode })}
					/>
				</div>
				<label className="sb-search">
					<Icon name="search" />
					<input placeholder={t("shell.searchChats")} value={query} onChange={e => setQuery(e.target.value)} />
				</label>
				<button className={`sb-item ${a.view === "plugins" ? "active" : ""}`} onClick={() => app.openPlugins()}>
					<Icon name="puzzle" />
					<span>{t("shell.plugins")}</span>
				</button>
			</div>
			{/* 標題隨模式切換：時間模式沒有「項目範圍」可篩，只有加項目按鈕還有用。 */}
			<div className="sb-section">
				<span>{timeMode ? t("shell.recentChats") : t("shell.projects")}</span>
				{!timeMode && (
					<button
						ref={filterBtn}
						className={`icon-btn ${filterOpen || a.prefs.projectFilter !== "all" ? "active" : ""}`}
						title={t("shell.projectScope")}
						onClick={() => setFilterOpen(o => !o)}
					>
						<Icon name="sliders" size={15} />
					</button>
				)}
				<button className="icon-btn" title={t("shell.addProject")} onClick={() => setBrowse(true)}>
					<Icon name="plus" size={15} />
				</button>
			</div>
			{filterOpen && !timeMode && (
				<Popover anchor={filterBtn} onClose={() => setFilterOpen(false)} width={270}>
					<div className="pop-title">{t("shell.scopeTitle")}</div>
					{FILTERS.map(([id, label]) => (
						<button key={id} className="pop-item" onClick={() => app.setProjectFilter(id)}>
							<span className="check">{a.prefs.projectFilter === id && <Icon name="check" size={15} />}</span>
							<span className="main-label">{t(label)}</span>
						</button>
					))}
					{a.prefs.projectFilter === "recent" && (
						<>
							<div className="pop-sep" />
							<div className="seg-row">
								<span>{t("shell.recent")}</span>
								<div className="seg">
									{RECENT_DAYS.map(d => (
										<button key={d} className={a.prefs.recentDays === d ? "on" : ""} onClick={() => app.setPrefs({ recentDays: d })}>
											{t("shell.days", { n: d })}
										</button>
									))}
								</div>
							</div>
							<div className="pop-note">{t("shell.recentFilterNote")}</div>
						</>
					)}
					{a.prefs.projectFilter === "manual" && (
						<>
							<div className="pop-sep" />
							<div className="pop-title">
								{t("shell.whichProjects")}
								<span className="pop-title-actions">
									<button onClick={() => app.setPrefs({ visibleProjects: a.projects.map(p => p.path) })}>{t("shell.selectAll")}</button>
									<button onClick={() => app.setPrefs({ visibleProjects: [] })}>{t("shell.selectNone")}</button>
								</span>
							</div>
							<div className="pop-list" style={{ maxHeight: 260 }}>
								{a.projects.map(p => {
									const on = a.prefs.visibleProjects.some(v => key(v) === key(p.path));
									return (
										<button key={p.path} className="pop-item" onClick={() => app.setProjectVisible(p.path, !on)}>
											<span className="check">{on && <Icon name="check" size={15} />}</span>
											<span className="main-label">{p.name}</span>
											<span className="sub">{t("shell.chatCount", { n: p.sessionCount })}</span>
										</button>
									);
								})}
								{a.projects.length === 0 && <div className="pop-note">{t("shell.noProjects")}</div>}
							</div>
							{a.prefs.visibleProjects.length === 0 && <div className="pop-note">{t("shell.manualNote")}</div>}
						</>
					)}
					{hiddenProjects > 0 && <div className="pop-note">{t("shell.hiddenProjects", { n: hiddenProjects })}</div>}
				</Popover>
			)}
			<div className="sb-scroll">
				{timeMode ? (
					timeGroups.map(g => {
						const limit = expandedGroups[g.key] ?? TIME_PAGE;
						return (
							<div key={g.key} className="sess-group">
								<div className="sess-group-title">{t(GROUP_TITLES[g.key])}</div>
								<div className="sess-list">
									{g.sessions.slice(0, limit).map(s => (
										<SessionRow
											key={s.path}
											s={s}
											active={a.route !== undefined && key(a.route) === key(s.path)}
											menuRequest={a.sessionMenuFor}
											showTime
											project={projectNames.get(key(s.cwd)) ?? baseName(s.cwd)}
										/>
									))}
									{g.sessions.length > limit && (
										<button className="more-row" onClick={() => setExpandedGroups(x => ({ ...x, [g.key]: g.sessions.length }))}>
											{t("shell.showMore", { n: g.sessions.length - limit })}
										</button>
									)}
								</div>
							</div>
						);
					})
				) : (
					projects.map(p => {
						let sessions = byProject.get(key(p.path)) ?? [];
						if (q) sessions = sessions.filter(s => s.title.toLowerCase().includes(q));
						if (q && sessions.length === 0 && !p.name.toLowerCase().includes(q)) return null;
						const isOpen = q ? true : !collapsed.has(key(p.path));
						const limit = expanded[key(p.path)] ?? PAGE;
						return (
							<div key={p.path}>
								<div className={`proj-row ${isOpen ? "open" : ""}`} role="button" tabIndex={0} title={p.path} onClick={() => toggle(p.path)}>
									<Icon name="chevronRight" size={13} className="chev" />
									<Icon name="folder" size={15} />
									<span className="name">{p.name}</span>
									<button
										className="icon-btn hover-only"
										title={t("shell.newChatHere")}
										onClick={e => {
											e.stopPropagation();
											app.setDraftProject(p.path);
											app.open(undefined);
										}}
									>
										<Icon name="newChat" size={14} />
									</button>
								</div>
								{isOpen && (
									<div className="sess-list">
										{sessions.slice(0, limit).map(s => (
											<SessionRow key={s.path} s={s} active={a.route !== undefined && key(a.route) === key(s.path)} menuRequest={a.sessionMenuFor} />
										))}
										{sessions.length > limit && (
											<button className="more-row" onClick={() => setExpanded(x => ({ ...x, [key(p.path)]: limit + 20 }))}>
												{t("shell.showMore", { n: sessions.length - limit })}
											</button>
										)}
										{sessions.length === 0 && !q && <div className="more-row" style={{ cursor: "default" }}>{t("shell.noChats")}</div>}
									</div>
								)}
							</div>
						);
					})
				)}
				{timeMode && timeGroups.length === 0 && q && (
					<div className="sb-empty">
						<Icon name="search" size={18} className="sb-empty-icon" />
						<div className="sb-empty-title">{t("chrome.empty.noSearchResults", { query: query.trim() })}</div>
						<div className="sb-empty-hint">{t("chrome.empty.noSearchResultsHint")}</div>
						<button className="sb-empty-action" onClick={() => setQuery("")}>
							{t("chrome.empty.clearSearch")}
						</button>
					</div>
				)}
				{timeMode && timeGroups.length === 0 && !q && a.indexLoaded && (
					<div className="sb-empty">
						<Icon name="newChat" size={18} className="sb-empty-icon" />
						<div className="sb-empty-title">{t("chrome.empty.noChats")}</div>
						<div className="sb-empty-hint">{t("chrome.empty.noChatsHint")}</div>
					</div>
				)}
				{!timeMode && a.indexLoaded && projects.length === 0 && (
					<div className="sb-empty">
						<Icon name="folder" size={18} className="sb-empty-icon" />
						<div className="sb-empty-title">{a.projects.length === 0 ? t("shell.emptyNoProjects") : t("shell.emptyFiltered")}</div>
					</div>
				)}
				{!a.indexLoaded && <SidebarSkeleton />}
			</div>
			<div className="sb-foot">
				<button className="sb-item" onClick={() => app.openSettings()}>
					<Icon name="settings" />
					<span>{t("shell.settings")}</span>
					{!connected && (
						<span className="offline" title={t("shell.offlineTitle")}>
							<i />
							{t("shell.offline")}
						</span>
					)}
				</button>
			</div>
			{browse && <FolderDialog onClose={() => setBrowse(false)} onPick={p => app.setDraftProject(p)} />}
		</aside>
	);
}

function SessionRow({
	s,
	active,
	menuRequest,
	showTime,
	project,
}: {
	s: SessionSummary;
	active: boolean;
	menuRequest?: string;
	/** 時間模式：右側顯示相對時間與所屬項目。 */
	showTime?: boolean;
	project?: string;
}) {
	const more = useRef<HTMLButtonElement>(null);
	const [menu, setMenu] = useState(false);
	const [renaming, setRenaming] = useState(false);
	const [name, setName] = useState(s.title);
	const [busy, setBusy] = useState(false);

	// `/rename` and `/export` point here; the request is one-shot.
	useEffect(() => {
		if (!menuRequest || menuRequest.toLowerCase() !== s.path.toLowerCase()) return;
		setMenu(true);
		app.clearSessionMenuRequest();
	}, [menuRequest, s.path]);

	const close = () => setMenu(false);

	const rename = async () => {
		const next = name.trim();
		setRenaming(false);
		if (!next || next === s.title) return;
		try {
			await api("/api/sessions/rename", { method: "POST", body: JSON.stringify({ path: s.path, name: next }) });
			void app.refreshIndex();
		} catch (e) {
			app.notify("error", t("shell.renameFailed", { error: (e as Error).message }));
		}
	};

	const exportHtml = async () => {
		setBusy(true);
		close();
		try {
			const { name: file } = await api<{ name: string }>("/api/sessions/export", { method: "POST", body: JSON.stringify({ path: s.path }) });
			window.open(`/api/exports/${encodeURIComponent(file)}`, "_blank");
		} catch (e) {
			app.notify("error", t("shell.exportFailed", { error: (e as Error).message }));
		} finally {
			setBusy(false);
		}
	};

	if (renaming) {
		return (
			<div className="sess-row editing">
				<input
					autoFocus
					value={name}
					onChange={e => setName(e.target.value)}
					onKeyDown={e => {
						if (e.key === "Enter") void rename();
						if (e.key === "Escape") setRenaming(false);
					}}
					onBlur={() => setRenaming(false)}
				/>
			</div>
		);
	}

	return (
		<>
			<div className={`sess-row ${active ? "active" : ""} ${showTime ? "time" : ""}`}>
				{/* 專案模式不顯示時間：它會擠掉長標題，改由懸停提示。時間模式是平鋪清單，時間才是重點。 */}
				<button className="sess-open" onClick={() => app.open(s.path)} title={`${s.title}\n${relativeTime(sessionTime(s))}`}>
					{showTime ? (
						<>
							<span className="sess-main">
								<span className="title">{s.title}</span>
								{s.copyOf && <span className="copy-tag" title={t("shell.copyTagTitle")}>{t("shell.copyTag")}</span>}
								{s.live && <span className={`live-dot ${s.live === "running" ? "running" : ""}`} title={s.live === "running" ? t("shell.liveRunning") : t("shell.liveConnected")} />}
								<span className="sess-time">{relativeTime(sessionTime(s))}</span>
							</span>
							{project && <span className="sess-proj">{project}</span>}
						</>
					) : (
						<>
							<span className="title">{s.title}</span>
							{s.copyOf && <span className="copy-tag" title={t("shell.copyTagTitle")}>{t("shell.copyTag")}</span>}
							{s.live && <span className={`live-dot ${s.live === "running" ? "running" : ""}`} title={s.live === "running" ? t("shell.liveRunning") : t("shell.liveConnected")} />}
						</>
					)}
				</button>
				<button ref={more} className="icon-btn hover-only" title={t("shell.more")} onClick={() => setMenu(o => !o)}>
					<Icon name="more" size={15} />
				</button>
			</div>
			{menu && (
				<Popover anchor={more} onClose={close} width={200} align="end">
					<button className="pop-item" onClick={() => { close(); app.observe(s.path); }}>
						<Icon name="file" size={14} className="muted" />
						<span className="main-label">{t("shell.readOnly")}</span>
					</button>
					<button
						className="pop-item"
						onClick={() => {
							setName(s.title);
							setRenaming(true);
							close();
						}}
					>
						<Icon name="edit" size={14} className="muted" />
						<span className="main-label">{t("shell.rename")}</span>
					</button>
					<button className="pop-item" disabled={busy} onClick={() => void exportHtml()}>
						<Icon name="file" size={14} className="muted" />
						<span className="main-label">{t("shell.exportHtml")}</span>
					</button>
					<button
						className="pop-item"
						onClick={() => {
							close();
							void app.setArchived(s.path, true).then(
								() => app.notify("info", t("shell.archivedNotice", { title: s.title })),
								e => app.notify("error", t("shell.archiveFailed", { error: (e as Error).message })),
							);
						}}
					>
						<Icon name="archive" size={14} className="muted" />
						<span className="main-label">{t("shell.archive")}</span>
					</button>
				</Popover>
			)}
		</>
	);
}
