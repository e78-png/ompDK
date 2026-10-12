import { useEffect, useState } from "react";
import { Home } from "./components/Home.tsx";
import { PairScreen } from "./components/PairScreen.tsx";
import { PluginsPage } from "./components/PluginsPage.tsx";
import { SkillDrawer } from "./components/SkillDrawer.tsx";
import { SettingsDialog } from "./components/SettingsDialog.tsx";
import { SessionView } from "./components/SessionView.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { app, useApp } from "./lib/app-store.ts";
import { Icon } from "./lib/icons.tsx";
import { t } from "./lib/i18n/index.ts";
import { useSession } from "./lib/app-store.ts";
import { api, gateway, onPairRequired } from "./lib/ws.ts";

/**
 * A phone has to pair before anything else happens: no socket, no session list. The code
 * path stays the same on the machine itself, where `/api/pair` answers `required: false`.
 * The code it was asked for is consumed once, then the page reloads into the app.
 */
export function App({ pairCode }: { pairCode?: string }) {
	const [pairing, setPairing] = useState<boolean | undefined>(undefined);

	useEffect(() => {
		let alive = true;
		const ask = () => {
			void api<{ required: boolean; paired: boolean }>("/api/pair").then(
				state => {
					if (alive) setPairing(state.required && !state.paired);
				},
				() => {
					// The gateway is not answering yet: it will, and a rejected socket asks again.
					if (alive) setPairing(false);
				},
			);
		};
		ask();
		const off = onPairRequired(ask);
		return () => {
			alive = false;
			off();
		};
	}, []);

	useEffect(() => {
		if (pairing !== false) return;
		gateway.connect();
		void app.refreshIndex();
	}, [pairing]);

	if (pairing === undefined) return null;
	if (pairing) return <PairScreen initialCode={pairCode} onPaired={() => location.reload()} />;
	return <Workspace />;
}

function Workspace() {
	const a = useApp();
	useEffect(() => {
		const t = setInterval(() => void app.refreshIndex(), 30_000);
		return () => clearInterval(t);
	}, []);
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || !a.drawerOpen) return;
			// A dialog owns Escape while it is up; the drawer is the next thing behind it.
			if (document.querySelector(".scrim, .pop")) return;
			app.closeDrawer();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [a.drawerOpen]);
	return (
		<div className={`app ${a.prefs.sidebarCollapsed ? "sidebar-collapsed" : ""} ${a.drawerOpen ? "drawer-open" : ""}`}>
			<Sidebar />
			{a.view === "plugins" ? <PluginsPage /> : a.route ? <SessionView key={a.route} sessionKey={a.route} /> : <Home />}
			{a.drawerOpen && <div className="drawer-scrim" onClick={() => app.closeDrawer()} />}
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
				{t("chrome.ompIncompatible", { version: a.omp.version ?? "?" })}
				{a.omp.problems.join(t("chrome.problemSep")) || t("chrome.ompProblemsUnknown")}{" "}
				{t("chrome.ompRunCheck")} <code>bun run omp:check</code> {t("chrome.ompCheckSuffix")}
			</span>
			<button className="icon-btn" onClick={() => app.closeOmpBanner()} title={t("chrome.close")}>
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
