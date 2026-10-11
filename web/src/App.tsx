import { useEffect } from "react";
import { Home } from "./components/Home.tsx";
import { PluginsPage } from "./components/PluginsPage.tsx";
import { SkillDrawer } from "./components/SkillDrawer.tsx";
import { SettingsDialog } from "./components/SettingsDialog.tsx";
import { SessionView } from "./components/SessionView.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { app, useApp } from "./lib/app-store.ts";
import { Icon } from "./lib/icons.tsx";
import { useSession } from "./lib/app-store.ts";
import { gateway } from "./lib/ws.ts";

gateway.connect();
void app.refreshIndex();

export function App() {
	const a = useApp();
	useEffect(() => {
		const t = setInterval(() => void app.refreshIndex(), 30_000);
		return () => clearInterval(t);
	}, []);
	return (
		<div className={`app ${a.prefs.sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
			<Sidebar />
			{a.view === "plugins" ? <PluginsPage /> : a.route ? <SessionView key={a.route} sessionKey={a.route} /> : <Home />}
			<OmpBanner />
			{a.route && <Toasts sessionKey={a.route} />}
			<AppToasts />
			{a.inspectSkill && <SkillDrawer name={a.inspectSkill.name} cwd={a.inspectSkill.cwd} onClose={() => app.closeSkillDetail()} />}
			<SettingsDialog />
		</div>
	);
}

/**
 * The startup check found something required missing. This is not a toast: on a broken
 * omp every session fails to open, and the reason has to be on screen before the user
 * goes looking for it.
 */
function OmpBanner() {
	const a = useApp();
	if (a.omp?.compat !== "broken" || a.ompBannerClosed) return null;
	return (
		<div className="omp-banner">
			<Icon name="alert" size={15} />
			<span>
				omp {a.omp.version ?? "?"} 与本应用不兼容：{a.omp.problems.join("；") || "启动检查失败"}　运行 <code>bun run omp:check</code> 查看全部差异。
			</span>
			<button className="icon-btn" onClick={() => app.closeOmpBanner()} title="关闭">
				<Icon name="x" size={13} />
			</button>
		</div>
	);
}

/** Toasts for actions that are not tied to a session (rename, export, trash). */
function AppToasts() {
	const a = useApp();
	if (a.notices.length === 0) return null;
	return (
		<div className="toasts">
			{a.notices.map(n => (
				<div key={n.id} className={`toast ${n.level}`}>
					<span>{n.text}</span>
					<button className="icon-btn" onClick={() => app.dismiss(n.id)}>
						<Icon name="x" size={13} />
					</button>
				</div>
			))}
		</div>
	);
}

function Toasts({ sessionKey }: { sessionKey: string }) {
	const store = useSession(app.store(sessionKey));
	if (store.notices.length === 0) return null;
	return (
		<div className="toasts">
			{store.notices.map(n => (
				<div key={n.id} className={`toast ${n.level}`}>
					<span>{n.text}</span>
					<button className="icon-btn" onClick={() => store.dismiss(n.id)}>
						<Icon name="x" size={13} />
					</button>
				</div>
			))}
		</div>
	);
}
