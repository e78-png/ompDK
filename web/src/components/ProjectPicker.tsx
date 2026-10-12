import { useCallback, useEffect, useRef, useState } from "react";
import type { DirListing } from "../../../shared/api.ts";
import { app, useApp } from "../lib/app-store.ts";
import { Icon } from "../lib/icons.tsx";
import { t } from "../lib/i18n/index.ts";
import { baseName } from "../lib/turns.ts";
import { api } from "../lib/ws.ts";
import { Dialog, Popover } from "./Popover.tsx";

/** Composer chip that selects the working directory for a new session. */
export function ProjectPicker() {
	const a = useApp();
	const btn = useRef<HTMLButtonElement>(null);
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [browse, setBrowse] = useState(false);
	const close = useCallback(() => setOpen(false), []);
	const current = a.draftProject;
	const q = query.trim().toLowerCase();
	const list = a.projects.filter(p => !q || p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q));

	return (
		<>
			<button ref={btn} className={`chip ${open ? "active" : ""}`} onClick={() => setOpen(o => !o)} title={current}>
				<Icon name="folder" size={15} />
				<span className="label">{current ? baseName(current) : t("shell.chooseProject")}</span>
				<Icon name="chevronDown" size={13} />
			</button>
			{open && (
				<Popover anchor={btn} onClose={close} width={340} prefer="below">
					<div className="pop-search">
						<Icon name="search" size={14} />
						<input autoFocus placeholder={t("shell.searchProjects")} value={query} onChange={e => setQuery(e.target.value)} />
					</div>
					<div className="pop-list">
						{list.map(p => (
							<button
								key={p.path}
								className="pop-item"
								onClick={() => {
									app.setDraftProject(p.path);
									close();
								}}
							>
								<Icon name="folder" size={15} className="muted" />
								<span className="main-label">
									{p.name}
									<div className="sub">{p.path}</div>
								</span>
								<span className="check">{samePath(p.path, current) && <Icon name="check" size={15} />}</span>
							</button>
						))}
						{list.length === 0 && <div className="pop-note">{t("shell.noMatchingProjects")}</div>}
					</div>
					<div className="pop-sep" />
					<button
						className="pop-item"
						onClick={() => {
							close();
							setBrowse(true);
						}}
					>
						<Icon name="folderPlus" size={15} className="muted" />
						<span className="main-label">{t("shell.addProjectFolder")}</span>
					</button>
				</Popover>
			)}
			{browse && <FolderDialog initial={current} onClose={() => setBrowse(false)} onPick={p => app.setDraftProject(p)} />}
		</>
	);
}

function samePath(a: string | undefined, b: string | undefined): boolean {
	if (!a || !b) return false;
	const n = (s: string) => s.replace(/[\\/]+$/, "").toLowerCase();
	return n(a) === n(b);
}

/** Folder browser: up-arrow navigation, fixed-height list, absolute path input. */
export function FolderDialog({ initial, onClose, onPick }: { initial?: string; onClose: () => void; onPick: (path: string) => void }) {
	const [listing, setListing] = useState<DirListing>();
	const [typed, setTyped] = useState(initial ?? "");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);

	const load = useCallback(async (dir: string) => {
		setError("");
		try {
			const data = await api<DirListing>(`/api/fs?path=${encodeURIComponent(dir)}`);
			setListing(data);
			setTyped(data.path);
		} catch (e) {
			setError((e as Error).message);
		}
	}, []);

	useEffect(() => {
		void load(initial ? parentOf(initial) : "");
	}, [initial, load]);

	const choose = async (dir: string) => {
		if (!dir) return;
		setBusy(true);
		setError("");
		try {
			const { path } = await api<{ path: string }>("/api/projects", { method: "POST", body: JSON.stringify({ path: dir }) });
			onPick(path);
			await app.refreshIndex();
			onClose();
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setBusy(false);
		}
	};

	return (
		<Dialog
			title={
				<>
					<span>{t("shell.chooseFolder")}</span>
					<span className="spacer" />
					<button className="icon-btn" onClick={onClose} aria-label={t("shell.close")}>
						<Icon name="x" />
					</button>
				</>
			}
			onClose={onClose}
			footer={
				<>
					<input
						className="text-input"
						value={typed}
						placeholder={t("shell.pathPlaceholder")}
						onChange={e => setTyped(e.target.value)}
						onKeyDown={e => e.key === "Enter" && void load(typed)}
					/>
					<button className="btn primary" disabled={busy || !typed} onClick={() => void choose(typed)}>
						{t("shell.useThisFolder")}
					</button>
				</>
			}
		>
			<div className="path-bar">
				<button className="icon-btn" disabled={listing?.parent === null || listing?.parent === undefined} onClick={() => listing?.parent !== null && listing?.parent !== undefined && void load(listing.parent)} title={t("shell.upOneLevel")}>
					<Icon name="arrowUp" />
				</button>
				<span className="cur">{listing?.path || t("shell.thisPc")}</span>
			</div>
			<div className="dir-list">
				{listing?.dirs.map(d => {
					const full = listing.path ? joinPath(listing.path, d) : d;
					return (
						<button key={d} className="dir-row" onClick={() => void load(full)} onDoubleClick={() => void choose(full)}>
							<Icon name="folder" size={15} />
							<span>{d}</span>
						</button>
					);
				})}
				{listing && listing.dirs.length === 0 && <div className="empty-dir">{t("shell.noSubfolders")}</div>}
			</div>
			{error && <div className="err-text" style={{ paddingTop: 8 }}>{error}</div>}
		</Dialog>
	);
}

function parentOf(p: string): string {
	const trimmed = p.replace(/[\\/]+$/, "");
	const i = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
	return i > 0 ? trimmed.slice(0, i + (trimmed[i - 1] === ":" ? 1 : 0)) : "";
}

function joinPath(dir: string, name: string): string {
	const sep = dir.includes("\\") || /^[A-Za-z]:/.test(dir) ? "\\" : "/";
	return dir.endsWith(sep) ? dir + name : dir + sep + name;
}
