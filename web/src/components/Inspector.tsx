import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { FileView, FsTree, GitDiff, GitStatus } from "../../../shared/api.ts";
import { app, type InspectorTab, useApp } from "../lib/app-store.ts";
import { effortName, tokens } from "../lib/format.ts";
import { t, type MessageKey } from "../lib/i18n/index.ts";
import { Icon } from "../lib/icons.tsx";
import { highlightCode, languageForFile } from "../lib/markdown.tsx";
import type { SessionStore } from "../lib/session-store.ts";
import { api } from "../lib/ws.ts";
import { AgentsPanel } from "./AgentsPanel.tsx";
import { Diff } from "./Turn.tsx";
import { PanelResize } from "./PanelResize.tsx";

const TABS: { id: InspectorTab; label: MessageKey }[] = [
	{ id: "info", label: "panel.tab.info" },
	{ id: "agents", label: "panel.tab.agents" },
	{ id: "files", label: "panel.tab.files" },
	{ id: "changes", label: "panel.tab.changes" },
];

/** Right panel: session facts, the project's files, and its git changes. */
export function Inspector({ store, onClose }: { store: SessionStore; onClose: () => void }) {
	const a = useApp();
	const saved = a.prefs.inspectorTab;
	const cwd = store.state?.cwd;
	// Without the subscription no lifecycle frame ever arrives, so the tab would be a
	// control that cannot change anything. It goes, and a stored preference for it falls
	// back to 信息.
	const tabs = store.capabilities?.subagentProgress === false ? TABS.filter(item => item.id !== "agents") : TABS;
	const tab = tabs.some(item => item.id === saved) ? saved : "info";
	const runningAgents = [...store.subagents.values()].filter(s => s.status === "running" || s.status === "pending").length;
	return (
		<aside className="inspector">
			<PanelResize panel="inspector" />
			<div className="ins-head">
				<div className="ins-tabs">
					{tabs.map(tabItem => (
						<button key={tabItem.id} className={tab === tabItem.id ? "on" : ""} onClick={() => app.setPrefs({ inspectorTab: tabItem.id })}>
							{t(tabItem.label)}
							{tabItem.id === "agents" && runningAgents > 0 && <span className="tab-badge">{runningAgents}</span>}
						</button>
					))}
				</div>
				<span className="spacer" />
				<button className="icon-btn" onClick={onClose} title={t("panel.close")}>
					<Icon name="x" />
				</button>
			</div>
			{tab === "info" && <InfoPage store={store} />}
			{tab === "agents" && <AgentsPanel store={store} />}
			{tab === "files" && (cwd ? <FilesPage key={cwd} cwd={cwd} /> : <div className="ins-empty">{t("panel.noCwd")}</div>)}
			{tab === "changes" && (cwd ? <ChangesPage key={cwd} cwd={cwd} /> : <div className="ins-empty">{t("panel.noCwd")}</div>)}
		</aside>
	);
}

function InfoPage({ store }: { store: SessionStore }) {
	const s = store.state;
	const usage = s?.contextUsage;
	const phases = s?.todoPhases ?? [];
	return (
		<div className="ins-body">
			{phases.some(p => p.tasks.length > 0) && (
				<section className="ins-sec">
					<h4>{t("panel.info.todos")}</h4>
					{phases.map(p => (
						<div key={p.name} className="todo-phase">
							{phases.length > 1 && <b>{p.name}</b>}
							{p.tasks.map((task, i) => (
								<div key={i} className={`todo-item ${task.status}`}>
									<span className="box">{task.status === "completed" && <Icon name="check" size={10} strokeWidth={3} />}</span>
									<span>{task.content}</span>
								</div>
							))}
						</div>
					))}
				</section>
			)}
			<section className="ins-sec">
				<h4>{t("panel.info.context")}</h4>
				{usage && usage.contextWindow ? (
					<>
						<div className="meter">
							<i style={{ width: `${Math.min(100, usage.percent)}%` }} />
						</div>
						<div className="muted" style={{ fontSize: "var(--fs-small)" }}>
							{t("panel.info.usage", { used: tokens(usage.tokens), total: tokens(usage.contextWindow), percent: usage.percent.toFixed(1) })}
						</div>
					</>
				) : (
					<div className="muted">{t("panel.info.noData")}</div>
				)}
			</section>
			<section className="ins-sec">
				<h4>{t("panel.info.session")}</h4>
				<dl className="kv">
					<dt>{t("panel.info.model")}</dt>
					<dd>{s?.model ? `${s.model.provider}/${s.model.id}` : "—"}</dd>
					<dt>{t("panel.info.thinking")}</dt>
					<dd>{effortName(s?.thinkingLevel) || "—"}</dd>
					<dt>{t("panel.info.messages")}</dt>
					<dd>{s?.messageCount ?? 0}</dd>
					<dt>{t("panel.info.dir")}</dt>
					<dd>{s?.cwd ?? "—"}</dd>
					<dt>{t("panel.info.file")}</dt>
					<dd className="muted" style={{ fontSize: "var(--fs-small)" }}>
						{s?.sessionFile ?? "—"}
					</dd>
				</dl>
			</section>
		</div>
	);
}

/** Expandable project tree; clicking a file previews it below the tree. */
function FilesPage({ cwd }: { cwd: string }) {
	const [children, setChildren] = useState<Record<string, FsTree["entries"]>>({});
	const [openDirs, setOpenDirs] = useState<string[]>([]);
	const [preview, setPreview] = useState<FileView>();
	const [error, setError] = useState<string>();
	const previewRequest = useRef(0);

	const load = useCallback(
		async (rel: string) => {
			try {
				const data = await api<FsTree>(`/api/fs/tree?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(rel)}`);
				setChildren(prev => ({ ...prev, [rel]: data.entries }));
			} catch (e) {
				setError((e as Error).message);
			}
		},
		[cwd],
	);

	useEffect(() => {
		setChildren({});
		setPreview(undefined);
		setOpenDirs([]);
		void load("");
		return () => { previewRequest.current++; };
	}, [load]);

	const toggle = (rel: string) => {
		setOpenDirs(prev => (prev.includes(rel) ? prev.filter(p => p !== rel) : [...prev, rel]));
		if (!children[rel]) void load(rel);
	};

	const openFile = async (rel: string) => {
		const request = ++previewRequest.current;
		setError(undefined);
		try {
			const view = await api<FileView>(`/api/fs/file?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(rel)}`);
			if (request === previewRequest.current) setPreview(view);
		} catch (e) {
			if (request === previewRequest.current) setError((e as Error).message);
		}
	};
	const closePreview = () => {
		previewRequest.current++;
		setPreview(undefined);
		setError(undefined);
	};

	const rows: ReactNode[] = [];
	const walk = (rel: string, depth: number) => {
		for (const entry of children[rel] ?? []) {
			const child = rel ? `${rel}/${entry.name}` : entry.name;
			const open = openDirs.includes(child);
			rows.push(
				<button
					key={child}
					className={`tree-row ${preview?.path === child ? "on" : ""}`}
					style={{ paddingLeft: 8 + depth * 12 }}
					title={child}
					onClick={() => (entry.dir ? toggle(child) : void openFile(child))}
				>
					<Icon name={entry.dir ? (open ? "chevronDown" : "chevronRight") : "file"} size={13} className={entry.dir ? "" : "muted"} />
					<span className="tree-name">{entry.name}</span>
				</button>,
			);
			if (entry.dir && open) walk(child, depth + 1);
		}
	};
	walk("", 0);

	return (
		<>
			<div className={`ins-tree ${preview || error ? "" : "full"}`}>{rows.length > 0 ? rows : <div className="ins-empty">{t("panel.files.empty")}</div>}</div>
			{(preview || error) && (
				<div className="ins-preview">
					<PreviewHeader path={preview?.path ?? t("panel.files.preview")} detail={preview && formatBytes(preview.size)} onClose={closePreview} closeLabel={t("panel.files.closePreview")} />
					<div className="ins-preview-body">
						{preview && <FilePreview view={preview} cwd={cwd} />}
						{error && <div className="err-text">{error}</div>}
					</div>
				</div>
			)}
		</>
	);
}

function PreviewHeader({ path, detail, onClose, closeLabel }: { path: string; detail?: ReactNode; onClose: () => void; closeLabel: string }) {
	return (
		<div className="ins-preview-head">
			<span className="tree-name" title={path}>
				{path}
			</span>
			{detail && <span className="muted ins-preview-meta">{detail}</span>}
			<button className="icon-btn" type="button" onClick={onClose} title={closeLabel} aria-label={closeLabel}>
				<Icon name="x" />
			</button>
		</div>
	);
}

function FilePreview({ view, cwd }: { view: FileView; cwd: string }) {
	if (view.image) {
		return <img className="ins-image" src={`/api/fs/raw?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(view.path)}`} alt={view.path} />;
	}
	if (view.binary) {
		return <div className="muted">{t("panel.files.binary")}</div>;
	}
	const language = languageForFile(view.path);
	return (
		<>
			<pre className="ins-code">
				<code className="hljs" dangerouslySetInnerHTML={{ __html: highlightCode(view.text ?? "", language) }} />
			</pre>
			{view.truncated && <div className="muted">{t("panel.files.truncated")}</div>}
		</>
	);
}

/** git prints work-tree relative paths; an edit card hands over cwd relative ones. */
function samePathName(a: string, b: string): boolean {
	const x = a.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
	const y = b.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
	return x === y || x.endsWith(`/${y}`) || y.endsWith(`/${x}`);
}

/** Git status list; a row shows its diff below. */
function ChangesPage({ cwd }: { cwd: string }) {
	const a = useApp();
	const [status, setStatus] = useState<GitStatus>();
	const [diff, setDiff] = useState<GitDiff>();
	const [error, setError] = useState<string>();
	const [diffError, setDiffError] = useState<string>();
	const selected = a.inspectFile;
	const files = status?.files ?? [];
	const rowPath = selected ? (files.find(f => samePathName(f.path, selected))?.path ?? selected) : undefined;

	useEffect(() => {
		// Closing only the preview keeps the existing file list and its scroll position.
		if (!selected && status) return;
		setStatus(undefined);
		setDiff(undefined);
		setError(undefined);
		let alive = true;
		void api<GitStatus>(`/api/git/status?cwd=${encodeURIComponent(cwd)}`)
			.then(data => alive && setStatus(data))
			.catch((e: Error) => alive && setError(e.message));
		return () => {
			alive = false;
		};
		// `selected` is included so a jump from a change card re-reads the list even
		// though this page was already mounted (and showing a stale, clean tree).
	}, [cwd, selected]);

	useEffect(() => {
		setDiff(undefined);
		setDiffError(undefined);
		if (!rowPath) {
			return;
		}
		let alive = true;
		void api<GitDiff>(`/api/git/diff?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(rowPath)}`)
			.then(data => alive && setDiff(data))
			.catch((e: Error) => alive && setDiffError(e.message));
		return () => {
			alive = false;
		};
	}, [cwd, rowPath]);

	if (error) return <div className="ins-empty">{error}</div>;
	if (!status) return <div className="ins-empty">{t("panel.changes.loading")}</div>;
	if (status.notRepo) return <div className="ins-empty">{t("panel.changes.notRepo")}</div>;
	if (files.length === 0) return <div className="ins-empty">{t("panel.changes.clean")}</div>;

	return (
		<>
			<div className={`ins-tree ${rowPath ? "" : "full"}`}>
				{files.map(f => (
					<button key={f.path} className={`git-row ${selected && samePathName(f.path, selected) ? "on" : ""}`} title={f.path} onClick={() => app.selectInspectFile(f.path)}>
						<span className={`git-flag ${f.x === "?" ? "new" : f.x === "D" || f.y === "D" ? "del" : "mod"}`}>{(f.x === "?" ? "??" : `${f.x}${f.y}`).trim()}</span>
						<span className="tree-name">{f.path}</span>
					</button>
				))}
			</div>
			{rowPath && (
				<div className="ins-preview">
					<PreviewHeader path={rowPath} onClose={() => app.selectInspectFile(undefined)} closeLabel={t("panel.changes.closePreview")} />
					<div className="ins-preview-body">
						{diffError ? <div className="err-text">{diffError}</div> : diff ? (
							<>
								<Diff text={diff.diff || t("panel.changes.noDiff")} />
								{diff.untracked && <div className="muted">{t("panel.changes.untracked")}</div>}
								{diff.truncated && <div className="muted">{t("panel.changes.truncated")}</div>}
							</>
						) : (
							<div className="muted">{t("panel.changes.readingDiff")}</div>
						)}
					</div>
				</div>
			)}
		</>
	);
}

function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
