import { useEffect, useMemo, useState } from "react";
import type { ImageContent } from "../../../shared/api.ts";
import { app, useApp } from "../lib/app-store.ts";
import { relativeTime } from "../lib/format.ts";
import { Icon } from "../lib/icons.tsx";
import { t } from "../lib/i18n/index.ts";
import { baseName } from "../lib/turns.ts";
import { starters } from "../lib/starters.ts";
import { Composer, type SendMode } from "./Composer.tsx";
import { type ModelChoice, ModelPicker } from "./ModelMenu.tsx";
import { ProjectPicker } from "./ProjectPicker.tsx";
import { SidebarToggle } from "./SidebarToggle.tsx";

/** How many recent sessions the home screen lists. */
const RECENT_LIMIT = 5;

function pathKey(p: string): string {
	return p.replace(/[\\/]+$/, "").toLowerCase();
}

/** New-session screen. No omp process exists until the first message is sent. */
const consumeRestore = () => app.consumeHomeRestore();

export function Home() {
	const a = useApp();
	const [error, setError] = useState("");
	/** Text pushed into the composer by one of the example prompts. */
	const [prefill, setPrefill] = useState<string>();
	const dismissed = new Set(a.prefs.dismissedRecent.map(pathKey));
	const recent = a.sessions.filter(s => !dismissed.has(pathKey(s.path))).slice(0, RECENT_LIMIT);
	const hiddenCount = a.sessions.filter(s => dismissed.has(pathKey(s.path))).length;
	/** Controls a hidden `/command` can be replaced by on this screen. */
	const guidance = useMemo(() => ({ "model-menu": () => app.requestModelMenu(), "plugins-page": () => app.openPlugins() }), []);

	useEffect(() => {
		document.title = "ompDK";
	}, []);

	// `/` completion needs the project's catalog; the gateway answers from its cache.
	useEffect(() => {
		void app.loadHomeCommands(a.draftProject);
	}, [a.draftProject]);

	const send = (text: string, _mode: SendMode, images?: ImageContent[]) => {
		if (!a.draftProject) {
			setError(t("shell.pickProjectFirst"));
			return;
		}
		setError("");
		// Switches to the conversation at once; start failures come back as a toast with the text restored.
		void app.startSession(a.draftProject, text, images);
	};

	return (
		<div className="main">
			<div className="main-col">
				<header className="header">
					<SidebarToggle />
				</header>
				<div className="home">
					<h1>
						<span className="brand-mark">π</span>
						{t("shell.homeTitle")}
					</h1>
					<div className="composer-wrap">
						<Composer
							autoFocus
							draftKey="home"
							restore={a.homeRestore}
							onRestored={consumeRestore}
							prefill={prefill}
							placeholder={t("shell.composerPlaceholder")}
							onSend={send}
							onNotice={text => setError(text)}
							left={<ProjectPicker />}
							right={<HomeModelPicker />}
							commands={a.homeCommands}
							guidance={guidance}
							fileCwd={a.draftProject}
						/>
					</div>
					{error && <div className="err-text" style={{ marginTop: 10 }}>{error}</div>}
					<div className="home-starters">
						<div className="home-starters-title">{t("chrome.startersTitle")}</div>
						<div className="home-starters-row">
							{starters().map(s => (
								<button key={s.id} className="starter" onClick={() => setPrefill(s.text)}>
									<Icon name={s.icon} size={14} className="starter-icon" />
									<span className="starter-label">{s.label}</span>
								</button>
							))}
						</div>
					</div>
					{a.sessions.length > 0 && (
						<div className="home-recent">
							<div className="recent-head">
								<button className="recent-toggle" title={a.prefs.recentCollapsed ? t("shell.expand") : t("shell.collapse")} onClick={() => app.setPrefs({ recentCollapsed: !a.prefs.recentCollapsed })}>
									<Icon name={a.prefs.recentCollapsed ? "chevronRight" : "chevronDown"} size={12} />
									<span>{t("shell.recentChats")}</span>
									{recent.length > 0 && <span className="count">{recent.length}</span>}
								</button>
								{hiddenCount > 0 && (
									<button className="recent-restore" onClick={() => app.restoreRecent()}>
										{t("shell.restoreHidden", { n: hiddenCount })}
									</button>
								)}
							</div>
							{!a.prefs.recentCollapsed && (
								<div className="recent-list">
									{recent.map(s => (
										<div key={s.path} className="recent-row">
											<button className="pop-item" onClick={() => app.open(s.path)}>
												<span className="main-label">{s.title}</span>
												<span className="sub">
													{baseName(s.cwd)} · {relativeTime(s.activeAt || s.modified)}
												</span>
											</button>
											<button
												className="icon-btn recent-x"
												title={t("shell.hideRecent")}
												onClick={() => app.dismissRecent(s.path)}
											>
												<Icon name="x" size={13} />
											</button>
										</div>
									))}
									{recent.length === 0 && <div className="recent-note">{t("shell.recentAllHidden")}</div>}
								</div>
							)}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

/**
 * Model for the conversation about to start. The profile default fills the chip
 * until the user picks another model here; a pick only sets `draftModel`, which
 * `startSession` applies to that one session. It never writes OMP's default role.
 */
function HomeModelPicker() {
	const a = useApp();
	const lock = a.modelLock;
	const def = a.agentSettings?.roles.default;
	const draft = a.draftModel;
	const wanted = draft ?? (def?.provider && def?.id && !def.missing ? { provider: def.provider, id: def.id, level: def.level } : undefined);
	const known = wanted ? a.models.find(m => m.provider === wanted.provider && m.id === wanted.id) : undefined;
	const current: ModelChoice | undefined = wanted ? { provider: wanted.provider, id: wanted.id, name: known?.name } : undefined;
	const lockCached = lock ? a.models.find(m => m.provider === lock.provider && m.id === lock.model) : undefined;
	const lockedTo: ModelChoice | undefined = lock ? { provider: lock.provider, id: lock.model, name: lockCached?.name } : undefined;
	const efforts = known?.reasoning ? ["off", ...(known.efforts ?? [])] : [];

	// The chip is disabled while the list is empty, so its onOpen load can never fire.
	useEffect(() => {
		if (a.models.length === 0) void app.loadModelsWithoutSession();
	}, [a.models.length]);

	return (
		<ModelPicker
			current={current}
			level={wanted?.level}
			efforts={efforts}
			models={a.models}
			hidden={a.prefs.hiddenModels}
			openSignal={a.modelMenuSignal}
			lockedTo={lockedTo}
			onOpen={() => {
				if (a.models.length === 0) void app.loadModelsWithoutSession();
			}}
			onPick={m => app.setDraftModel({ provider: m.provider, id: m.id, level: wanted?.level })}
			onLevel={l => {
				if (wanted) app.setDraftModel({ ...wanted, level: l });
			}}
		/>
	);
}
