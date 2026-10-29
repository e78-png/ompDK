import { type ReactNode, useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ProviderConfig, ProviderModel, ProvidersView } from "../../../shared/api.ts";
import { app, type SettingsPage, useApp } from "../lib/app-store.ts";
import { relativeTime, tokens } from "../lib/format.ts";
import { LOCALE_LABELS, pick, t, type MessageKey } from "../lib/i18n/index.ts";
import { Icon, type IconName } from "../lib/icons.tsx";
import { baseName } from "../lib/turns.ts";
import { api } from "../lib/ws.ts";
import { AgentPage } from "./settings/AgentPage.tsx";
import { MobilePage } from "./settings/MobilePage.tsx";
import { Row, Section, Seg, Toggle } from "./settings/controls.tsx";

const PAGES: { id: SettingsPage; label: MessageKey; icon: IconName }[] = [
	{ id: "general", label: "set.general", icon: "sliders" },
	{ id: "agent", label: "set.navAgent", icon: "agent" },
	{ id: "providers", label: "set.navProviders", icon: "bolt" },
	{ id: "archived", label: "set.navArchived", icon: "archive" },
	{ id: "about", label: "set.navAbout", icon: "info" },
	{ id: "mobile", label: "set.navMobile", icon: "phone" },
];

/** Settings window: left navigation, grouped cards on the right (Kimi / Codex layout). */
export function SettingsDialog() {
	const a = useApp();
	const page = a.settingsPage;
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector(".pop") && app.closeSettings();
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, []);
	useEffect(() => {
		if (!page) return;
		if (a.models.length === 0) void app.loadModelsWithoutSession();
		void app.loadAgentSettings();
		// One probe decides whether this browser may see the LAN page at all.
		if (a.lanLocal === undefined) void app.loadLan();
	}, [page, a.models.length, a.lanLocal]);
	if (!page) return null;
	// The code is the way in, so the page only exists on the machine running the gateway.
	const pages = a.lanLocal === false ? PAGES.filter(p => p.id !== "mobile") : PAGES;
	return createPortal(
		<div className="scrim" onPointerDown={e => e.target === e.currentTarget && app.closeSettings()}>
			<div className="settings" role="dialog" aria-modal="true" aria-label={t("set.title")}>
				<nav className="settings-nav">
					<div className="settings-title">{t("set.title")}</div>
					{pages.map(p => (
						<button key={p.id} className={`settings-nav-item ${page === p.id ? "on" : ""}`} onClick={() => app.openSettings(p.id)}>
							<Icon name={p.icon} size={16} />
							<span>{t(p.label)}</span>
							{p.id === "archived" && a.archived.length > 0 && <span className="nav-count">{a.archived.length}</span>}
						</button>
					))}
				</nav>
				<div className="settings-body">
					<button className="icon-btn settings-close" onClick={() => app.closeSettings()} title={t("set.closeEsc")}>
						<Icon name="x" />
					</button>
					<div className="settings-scroll">
						{page === "general" && <GeneralPage />}
						{page === "agent" && <AgentPage />}
						{page === "providers" && <ProvidersPage />}
						{page === "archived" && <ArchivedPage />}
						{page === "mobile" && <MobilePage />}
						{page === "about" && <AboutPage />}
					</div>
				</div>
			</div>
		</div>,
		document.body,
	);
}

function GeneralPage() {
	const { prefs } = useApp();
	const [permission, setPermission] = useState(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
	/**
	 * Notifications need a secure context. A phone on the LAN reaches this page over plain HTTP,
	 * where Chrome keeps the API but answers `denied` to everything — so the toggle has to be off
	 * there with the reason, not a "please allow it in site settings" hint that cannot work.
	 */
	const notificationsAvailable = typeof Notification !== "undefined" && window.isSecureContext;

	const setNotify = async (on: boolean) => {
		if (!on) return app.setPrefs({ notify: false });
		if (!notificationsAvailable) return;
		const result = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
		setPermission(result);
		app.setPrefs({ notify: result === "granted" });
	};

	return (
		<>
			<h2 className="set-h2">{t("set.general")}</h2>
			<Section title={t("set.appearance")}>
				<Row title={t("set.language")} desc={t("set.languageDesc")}>
					<Seg
						value={prefs.locale}
						options={[
							["system", pick(LOCALE_LABELS.system)],
							["zh", pick(LOCALE_LABELS.zh)],
							["zh-Hant", pick(LOCALE_LABELS["zh-Hant"])],
							["en", pick(LOCALE_LABELS.en)],
						]}
						onChange={locale => app.setPrefs({ locale })}
					/>
				</Row>
				<Row title={t("set.theme")} desc={t("set.themeDesc")}>
					<Seg
						value={prefs.theme}
						options={[
							["light", <><Icon name="sun" size={14} />{t("set.light")}</>],
							["dark", <><Icon name="moon" size={14} />{t("set.dark")}</>],
							["system", t("set.followSystem")],
						]}
						onChange={theme => app.setPrefs({ theme })}
					/>
				</Row>
				<Row title={t("set.fontSize")} desc={t("set.fontSizeDesc")}>
					<Seg value={prefs.fontSize} options={[["s", "S"], ["m", "M"], ["l", "L"], ["xl", "XL"]]} onChange={fontSize => app.setPrefs({ fontSize })} />
				</Row>
				<Row title={t("set.uiFont")} desc={t("set.uiFontDesc")}>
					<Seg value={prefs.uiFont} options={[["system", t("set.fontSystem")], ["yahei", t("set.fontYahei")], ["harmony", t("set.fontHarmony")]]} onChange={uiFont => app.setPrefs({ uiFont })} />
				</Row>
				<Row title={t("set.codeFont")} desc={t("set.codeFontDesc")}>
					<Seg value={prefs.codeFont} options={[["jetbrains", "JetBrains"], ["cascadia", "Cascadia"], ["consolas", "Consolas"]]} onChange={codeFont => app.setPrefs({ codeFont })} />
				</Row>
				<Row title={t("set.colWidth")} desc={t("set.colWidthDesc")}>
					<Seg value={prefs.colWidth} options={[["narrow", t("set.widthNarrow")], ["normal", t("set.widthNormal")], ["wide", t("set.widthWide")]]} onChange={colWidth => app.setPrefs({ colWidth })} />
				</Row>
			</Section>
			<Section title={t("set.notifications")}>
				<Row
					title={t("set.sysNotify")}
					desc={
						!notificationsAvailable
							? t("set.notifyInsecure")
							: permission === "denied"
								? t("set.notifyDenied")
								: t("set.notifyHint")
					}
				>
					<Toggle on={prefs.notify && permission === "granted"} disabled={!notificationsAvailable || permission === "denied"} onChange={v => void setNotify(v)} />
				</Row>
			</Section>
			<Section title={t("set.chatSection")}>
				<Row title={t("set.enterRunning")} desc={t("set.enterRunningDesc")}>
					<Seg value={prefs.enterWhileRunning} options={[["steer", t("set.enterSteer")], ["followUp", t("set.enterFollowUp")]]} onChange={enterWhileRunning => app.setPrefs({ enterWhileRunning })} />
				</Row>
				<Row title={t("set.autoOpenAgents")} desc={t("set.autoOpenAgentsDesc")}>
					<Toggle on={prefs.autoOpenAgents} onChange={autoOpenAgents => app.setPrefs({ autoOpenAgents })} />
				</Row>
			</Section>
		</>
	);
}

interface About {
	ompVersion: string;
	agentDir: string;
	sessionsRoot: string;
	modelsFile: string;
	dataDir: string;
	testProfile: boolean;
	modelLock: { provider: string; model: string } | null;
}

function useAbout(): About | undefined {
	const [info, setInfo] = useState<About>();
	useEffect(() => {
		void api<About>("/api/about").then(setInfo, () => {});
	}, []);
	return info;
}

async function reveal(target: "models" | "agent" | "data") {
	try {
		await api("/api/reveal", { method: "POST", body: JSON.stringify({ target }) });
	} catch (e) {
		app.notify("error", (e as Error).message);
	}
}

/** One row of the provider form, kept as text so empty means "leave it out". */
interface ModelDraft {
	id: string;
	name: string;
	reasoning: boolean;
	contextWindow: string;
	maxTokens: string;
}

interface ProviderDraft {
	id: string;
	baseUrl: string;
	api: string;
	apiKey: string;
	authHeader: "" | "on" | "off";
	models: ModelDraft[];
}

const API_SUGGESTIONS = ["openai-completions", "openai-responses", "openai-chat-completions", "anthropic-messages", "google-generative-ai"];

/** Provider details for the row's hover tooltip; the list itself stays one line per provider. */
function providerSummary(provider: ProviderConfig): string {
	return [
		provider.baseUrl,
		provider.api,
		provider.apiKey ? t("set.providerKey", { key: provider.apiKey }) : "",
		provider.authHeader ? "authHeader" : "",
		provider.models?.length ? t("set.providerModels", { n: provider.models.length }) : "",
	]
		.filter(Boolean)
		.join(" · ");
}

function toDraft(provider?: ProviderConfig): ProviderDraft {
	return {
		id: provider?.id ?? "",
		baseUrl: provider?.baseUrl ?? "",
		api: provider?.api ?? "openai-completions",
		apiKey: provider?.apiKey ?? "",
		authHeader: provider?.authHeader === undefined ? "" : provider.authHeader ? "on" : "off",
		models: (provider?.models ?? []).map(m => ({
			id: m.id,
			name: m.name ?? "",
			reasoning: Boolean(m.reasoning),
			contextWindow: m.contextWindow ? String(m.contextWindow) : "",
			maxTokens: m.maxTokens ? String(m.maxTokens) : "",
		})),
	};
}

/** Only the form's fields are sent; the gateway keeps every other field the file had. */
function toPayload(draft: ProviderDraft): ProviderConfig {
	const models: ProviderModel[] = [];
	for (const row of draft.models) {
		const id = row.id.trim();
		if (!id) continue;
		const model: ProviderModel = { id };
		const name = row.name.trim();
		if (name) model.name = name;
		if (row.reasoning) model.reasoning = true;
		const context = Number(row.contextWindow);
		if (Number.isFinite(context) && context > 0) model.contextWindow = context;
		const max = Number(row.maxTokens);
		if (Number.isFinite(max) && max > 0) model.maxTokens = max;
		models.push(model);
	}
	return {
		id: draft.id.trim(),
		baseUrl: draft.baseUrl.trim(),
		api: draft.api.trim(),
		apiKey: draft.apiKey.trim(),
		authHeader: draft.authHeader === "" ? undefined : draft.authHeader === "on",
		models,
	};
}

function ProvidersPage() {
	const a = useApp();
	const info = useAbout();
	const [view, setView] = useState<ProvidersView>();
	const [error, setError] = useState<string>();
	const [draft, setDraft] = useState<ProviderDraft>();
	const [editingNew, setEditingNew] = useState(false);
	const [confirm, setConfirm] = useState<string>();
	const [busy, setBusy] = useState(false);

	const load = useCallback(async () => {
		try {
			setView(await api<ProvidersView>("/api/providers"));
			setError(undefined);
		} catch (e) {
			setError((e as Error).message);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	useEffect(() => {
		if (a.models.length > 0 || !a.route) return;
		void app.loadModels(a.route);
	}, [a.route, a.models.length]);

	const save = async () => {
		if (!draft) return;
		setBusy(true);
		try {
			const next = await api<ProvidersView>("/api/providers", { method: "POST", body: JSON.stringify(toPayload(draft)) });
			setView(next);
			setDraft(undefined);
			setEditingNew(false);
			app.notify("info", t("set.savedModels"));
		} catch (e) {
			app.notify("error", t("set.saveFailed", { error: (e as Error).message }));
		} finally {
			setBusy(false);
		}
	};

	const remove = async (id: string) => {
		setBusy(true);
		try {
			const next = await api<ProvidersView>(`/api/providers?id=${encodeURIComponent(id)}`, { method: "DELETE" });
			setView(next);
			setConfirm(undefined);
			if (draft?.id === id) setDraft(undefined);
			app.notify("info", t("set.removedFromModels", { id }));
		} catch (e) {
			app.notify("error", t("set.removeFailed", { error: (e as Error).message }));
		} finally {
			setBusy(false);
		}
	};

	const groups = new Map<string, typeof a.models>();
	for (const m of a.models) {
		let g = groups.get(m.provider);
		if (!g) groups.set(m.provider, (g = []));
		g.push(m);
	}
	const hidden = a.prefs.hiddenModels;

	return (
		<>
			<h2 className="set-h2">{t("set.navProviders")}</h2>
			<Section title={t("set.config")}>
				<Row title="models.yml" desc={info ? <code className="set-path">{info.modelsFile}</code> : t("set.loading")}>
					<button className="btn" onClick={() => void reveal("models")}>
						{t("set.revealFile")}
					</button>
				</Row>
				<Row
					title={t("set.howToEdit")}
					desc={t("set.howToEditDesc")}
				/>
				{info?.modelLock && <Row title={t("set.testConfig")} desc={t("set.testConfigDesc", { provider: info.modelLock.provider, model: info.modelLock.model })} />}
			</Section>

			{error && (
				<div className="set-note danger-text">
					{a.serverStale ? t("set.serverStale") : error}
				</div>
			)}

			{draft ? (
				<Section title={editingNew ? t("set.addProvider") : t("set.editProvider", { id: draft.id })}>
					<div className="set-form">
						<Row title={t("set.providerId")} desc={t("set.providerIdDesc")}>
							<input
								className="text-input"
								value={draft.id}
								disabled={!editingNew}
								placeholder="my-provider"
								onChange={e => setDraft({ ...draft, id: e.target.value })}
							/>
						</Row>
						<Row title="Base URL" desc={t("set.baseUrlDesc")}>
							<input className="text-input" value={draft.baseUrl} placeholder="https://api.example.com/v1" onChange={e => setDraft({ ...draft, baseUrl: e.target.value })} />
						</Row>
						<Row title="API" desc={t("set.apiDesc")}>
							<>
								<input className="text-input" list="provider-apis" value={draft.api} onChange={e => setDraft({ ...draft, api: e.target.value })} />
								<datalist id="provider-apis">
									{API_SUGGESTIONS.map(v => (
										<option key={v} value={v} />
									))}
								</datalist>
							</>
						</Row>
						<Row title={t("set.apiKeyLabel")} desc={t("set.apiKeyDesc")}>
							<input className="text-input" value={draft.apiKey} placeholder="MY_PROVIDER_KEY" onChange={e => setDraft({ ...draft, apiKey: e.target.value })} />
						</Row>
						<Row title={t("set.authHeader")} desc={t("set.authHeaderDesc")}>
							<Seg value={draft.authHeader} options={[["", t("set.default")], ["on", t("set.send")], ["off", t("set.dontSend")]]} onChange={authHeader => setDraft({ ...draft, authHeader })} />
						</Row>
					</div>
					<div className="set-model-editor">
						<div className="set-model-head">
							<span>{t("set.colModelId")}</span>
							<span>{t("set.colDisplayName")}</span>
							<span>{t("set.colContext")}</span>
							<span>{t("set.colMaxOutput")}</span>
							<span>{t("set.reasoning")}</span>
							<span />
						</div>
						{draft.models.map((m, i) => (
							<div className="set-model-row" key={i}>
								<input value={m.id} placeholder="gpt-4o" onChange={e => setDraft({ ...draft, models: draft.models.map((x, j) => (j === i ? { ...x, id: e.target.value } : x)) })} />
								<input value={m.name} placeholder={t("set.optional")} onChange={e => setDraft({ ...draft, models: draft.models.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
								<input value={m.contextWindow} placeholder="128000" inputMode="numeric" onChange={e => setDraft({ ...draft, models: draft.models.map((x, j) => (j === i ? { ...x, contextWindow: e.target.value } : x)) })} />
								<input value={m.maxTokens} placeholder="8192" inputMode="numeric" onChange={e => setDraft({ ...draft, models: draft.models.map((x, j) => (j === i ? { ...x, maxTokens: e.target.value } : x)) })} />
								<Toggle on={m.reasoning} onChange={reasoning => setDraft({ ...draft, models: draft.models.map((x, j) => (j === i ? { ...x, reasoning } : x)) })} />
								<button className="icon-btn" title={t("set.removeModel")} onClick={() => setDraft({ ...draft, models: draft.models.filter((_, j) => j !== i) })}>
									<Icon name="x" size={13} />
								</button>
							</div>
						))}
						<button className="btn ghost" onClick={() => setDraft({ ...draft, models: [...draft.models, { id: "", name: "", reasoning: false, contextWindow: "", maxTokens: "" }] })}>
							<Icon name="plus" size={14} />
							{t("set.addModel")}
						</button>
						<div className="set-desc">{t("set.modelNote")}</div>
					</div>
					<div className="set-actions">
						<button className="btn primary" disabled={busy || !draft.id.trim() || !draft.baseUrl.trim()} onClick={() => void save()}>
							{t("set.saveToModels")}
						</button>
						<button
							className="btn ghost"
							onClick={() => {
								setDraft(undefined);
								setEditingNew(false);
							}}
						>
							{t("set.cancel")}
						</button>
					</div>
				</Section>
			) : (
				<Section title={t("set.customProviders")}>
					{(view?.providers.length ?? 0) === 0 && <Row title={view ? t("set.noProviders") : t("set.loading")} desc={view ? t("set.noProvidersDesc") : undefined} />}
					{/* The list stays one line per provider; details live behind Edit (and the tooltip). */}
					<div className="set-group">
						{view?.providers.map(p => (
							<div key={p.id} className="set-row" title={providerSummary(p)}>
								<div className="set-text">
									<div className="set-name">{p.id}</div>
								</div>
								<div className="set-control">
									{confirm === p.id ? (
										<>
											<span className="danger-text">{t("set.confirmRemove")}</span>
											<button className="btn ghost" onClick={() => setConfirm(undefined)}>
												{t("set.cancel")}
											</button>
											<button className="btn danger" disabled={busy} onClick={() => void remove(p.id)}>
												{t("set.remove")}
											</button>
										</>
									) : (
										<>
											<button
												className="btn"
												onClick={() => {
													setDraft(toDraft(p));
													setEditingNew(false);
												}}
											>
												{t("set.edit")}
											</button>
											<button className="btn ghost danger-ghost" onClick={() => setConfirm(p.id)}>
												{t("set.remove")}
											</button>
										</>
									)}
								</div>
							</div>
						))}
					</div>
					<div className="set-actions">
						<button
							className="btn"
							onClick={() => {
								setDraft(toDraft());
								setEditingNew(true);
							}}
						>
							<Icon name="plus" size={14} />
							{t("set.addProvider")}
						</button>
					</div>
				</Section>
			)}

			<Section title={t("set.hiddenModels")}>
				{groups.size === 0 ? (
					<Row title={t("set.noModels")} desc={t("set.noModelsDesc")} />
				) : (
					<>
						{[...groups].map(([provider, list]) => (
							<div key={provider} className="set-group">
								<div className="set-group-name">{provider}</div>
								{list.map(m => {
									const key = `${m.provider}/${m.id}`;
									const visible = !hidden.includes(key);
									return (
										<Row
											key={key}
											title={m.name ?? m.id}
											desc={
												<>
													<code className="set-path">{m.id}</code>
													{m.contextWindow ? ` · ${t("set.modelContext", { n: tokens(m.contextWindow) })}` : ""}
													{m.reasoning ? ` · ${t("set.reasoning")}` : ""}
												</>
											}
										>
											<Toggle on={visible} onChange={on => app.setModelVisible(key, on)} />
										</Row>
									);
								})}
							</div>
						))}
						<div className="set-actions">
							<span className="set-desc">
								{hidden.length > 0 ? t("set.hiddenCount", { n: hidden.length }) : t("set.allVisible")}
							</span>
							{hidden.length > 0 && (
								<button className="btn ghost" onClick={() => app.setPrefs({ hiddenModels: [] })}>
									{t("set.showAll")}
								</button>
							)}
						</div>
					</>
				)}
			</Section>
		</>
	);
}

function ArchivedPage() {
	const a = useApp();
	const [query, setQuery] = useState("");
	const [confirm, setConfirm] = useState<string>();
	const [busy, setBusy] = useState<string>();
	const q = query.trim().toLowerCase();
	const list = a.archived.filter(s => !q || s.title.toLowerCase().includes(q) || s.cwd.toLowerCase().includes(q));

	const run = async (path: string, action: () => Promise<void>, label: string) => {
		setBusy(path);
		try {
			await action();
			setConfirm(undefined);
		} catch (e) {
			app.notify("error", t("set.actionFailed", { action: label, error: (e as Error).message }));
		} finally {
			setBusy(undefined);
		}
	};

	return (
		<>
			<h2 className="set-h2">{t("set.navArchived")}</h2>
			<p className="set-lead">{t("set.archivedLead")}</p>
			{a.archived.length > 0 && (
				<label className="set-search">
					<Icon name="search" size={14} />
					<input placeholder={t("set.searchArchived")} value={query} onChange={e => setQuery(e.target.value)} />
				</label>
			)}
			{a.archived.length === 0 ? (
				<div className="set-empty">
					<Icon name="archive" size={22} />
					<div>{t("set.noArchived")}</div>
					<div className="muted">{t("set.noArchivedHint")}</div>
				</div>
			) : (
				<div className="set-card">
					{list.map(s => (
						<div key={s.path} className="set-row archived-row">
							<div className="set-text">
								<div className="set-name">{s.title}</div>
								<div className="set-desc">
									{baseName(s.cwd)} · {relativeTime(s.modified)}
								</div>
							</div>
							<div className="set-control">
								{confirm === s.path ? (
									<>
										<span className="danger-text">{t("set.confirmDelete")}</span>
										<button className="btn ghost" onClick={() => setConfirm(undefined)}>
											{t("set.cancel")}
										</button>
										<button className="btn danger" disabled={busy === s.path} onClick={() => void run(s.path, () => app.deleteArchived(s.path), t("set.delete"))}>
											{t("set.delete")}
										</button>
									</>
								) : (
									<>
										<button className="btn" disabled={busy === s.path} onClick={() => void run(s.path, () => app.setArchived(s.path, false), t("set.restore"))}>
											{t("set.restore")}
										</button>
										<button className="btn ghost danger-ghost" onClick={() => setConfirm(s.path)}>
											{t("set.deleteForever")}
										</button>
									</>
								)}
							</div>
						</div>
					))}
					{list.length === 0 && <div className="set-note">{t("set.noMatches")}</div>}
				</div>
			)}
		</>
	);
}

function AboutPage() {
	const info = useAbout();
	const a = useApp();
	// 更新狀態只在這個頁面打開時問一次：上游的檢查要連網，不是每次重繪都打一次 API。
	useEffect(() => {
		void app.loadOmpUpdate();
	}, []);
	const update = a.ompUpdate;
	return (
		<>
			<h2 className="set-h2">{t("set.navAbout")}</h2>
			<Section title={t("set.version")}>
				<Row title="ompDK Web" desc={t("set.webDesc")} />
				<Row title="OMP" desc={info?.ompVersion || t("set.loading")} />
				{a.omp?.compat === "untested" && <div className="set-note">{t("set.ompUntested", { version: a.omp.version ?? "?" })} <code>bun run omp:check</code> {t("set.ompUntestedTail")}</div>}
				{a.omp?.compat === "broken" && <div className="set-note danger-text">{t("set.ompBroken", { version: a.omp.version ?? "?", problems: a.omp.problems.join(pick(["；", "; "])) || t("set.startupCheckFailed") })} <code>bun run omp:check</code> {t("set.ompBrokenTail")}</div>}
			</Section>
			<Section title={t("set.ompUpdateSection")}>
				<Row title={t("set.ompCurrentVersion")} desc={update?.current || info?.ompVersion || t("set.loading")} />
				{update && update.latest && update.latest !== update.current && (
					<Row title={t("set.ompNewVersion", { version: update.latest })} desc={t("set.ompNewVersionDesc")}>
						<button className="btn" disabled={a.ompUpdating} onClick={() => void app.installOmpUpdate()}>
							{a.ompUpdating ? t("set.ompUpdating") : t("set.ompUpdateNow")}
						</button>
					</Row>
				)}
				{update && !update.latest && update.upToDate && <Row title={t("set.ompUpToDate")} desc={t("set.ompUpToDateDesc")} />}
				{update?.note === "check-failed" && <div className="set-note">{t("set.ompUpdateUnreachable")}</div>}
				{update?.note === "unparsed" && <div className="set-note">{t("set.ompUpdateUnparsed")}</div>}
			</Section>
			<Section title={t("set.ompCompatSection")}>
				<Row
					title={t("set.ompCompatStatus")}
					desc={a.omp?.compat === "tested" ? t("set.ompCompatTested") : a.omp?.compat === "broken" ? t("set.ompCompatBroken") : a.omp?.compat === "untested" ? t("set.ompCompatUntested") : t("set.loading")}
				/>
				{a.omp?.compat === "untested" && (
					<Row title={t("set.ompCompatCheckTitle")} desc={t("set.ompCompatCheckDesc")}>
						<button className="btn" disabled={a.ompChecking} onClick={() => void app.runOmpCheck()}>
							{a.ompChecking ? t("set.ompChecking") : t("set.ompRunCheck")}
						</button>
					</Row>
				)}
				{a.ompCheck && (
					<Row
						title={t("set.ompCheckResult", { passed: a.ompCheck.passed, warned: a.ompCheck.warned, failed: a.ompCheck.failed })}
						desc={
							a.ompCheck.failed
								? t("set.ompCheckFailedDesc")
								: a.ompCheck.capabilityWarnings.length
									? t("set.ompCheckWarnDesc")
									: t("set.ompCheckOkDesc")
						}
					/>
				)}
				{a.ompCheck?.failed ? (
					<div className="set-note danger-text">
						{t("set.ompCheckWhere")}
						<ul className="set-list">
							{a.ompCheck.items.filter(item => item.mark === "fail").map(item => (
								<li key={`${item.section}-${item.what}`}>
									<code>{item.section}</code> {item.what}
									{item.why ? ` — ${item.why}` : ""}
								</li>
							))}
						</ul>
					</div>
				) : null}
				{a.ompCheck?.suggestedVersion && <div className="set-note">{t("set.ompCheckSuggested", { version: a.ompCheck.suggestedVersion })}</div>}
			</Section>
			<Section title={t("set.dataLocation")}>
				<Row title={t("set.ompConfigDir")} desc={<code className="set-path">{info?.agentDir ?? "…"}</code>}>
					<button className="btn" onClick={() => void reveal("agent")}>
						{t("set.open")}
					</button>
				</Row>
				<Row title={t("set.webDataDir")} desc={<code className="set-path">{info?.dataDir ?? "…"}</code>}>
					<button className="btn" onClick={() => void reveal("data")}>
						{t("set.open")}
					</button>
				</Row>
			</Section>
		</>
	);
}
