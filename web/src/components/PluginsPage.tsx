/**
 * 插件: the skills, plugins and MCP servers OMP actually loads. Skills come from
 * `omp skill list` run inside one project, because project-level skills depend
 * on the working directory; plugins are global. The project is the one you
 * opened the page from, on purpose: with only user-level skills installed a
 * picker could not change what the page shows.
 *
 * MCP 的清單也是按專案讀的（專案自己的 `.omp/mcp.json` 只在那個目錄下才被發現），
 * 所以它跟技能走同一個 cwd。
 */
import { type ReactNode, useMemo, useState } from "react";
import type { McpServerInfo, PluginItem, SkillItem } from "../../../shared/api.ts";
import { MCP_CONVENTIONS, OMP_LAYOUT } from "../../../shared/omp/conventions.ts";
import { app, useApp } from "../lib/app-store.ts";
import { Icon } from "../lib/icons.tsx";
import { t, type MessageKey } from "../lib/i18n/index.ts";
import { avatarClass, groupName, initial } from "../lib/skills.ts";
import { SidebarToggle } from "./SidebarToggle.tsx";
import { Toggle } from "./settings/controls.tsx";

const PLUGIN_GROUPS: [MessageKey, PluginItem["kind"]][] = [
	["shell.marketplacePlugins", "marketplace"],
	["shell.npmPlugins", "npm"],
];

export function PluginsPage() {
	const a = useApp();
	const [query, setQuery] = useState("");
	const [disabledOpen, setDisabledOpen] = useState(false);
	const q = query.trim().toLowerCase();
	const tab = a.pluginsTab;
	const skills = a.skills ?? [];
	const plugins = a.plugins ?? [];
	const mcpServers = a.mcp?.servers ?? [];

	const skillMatches = useMemo(() => skills.filter(s => !q || `${s.name} ${s.description}`.toLowerCase().includes(q)), [skills, q]);
	const pluginMatches = useMemo(() => plugins.filter(p => !q || `${p.name} ${p.id}`.toLowerCase().includes(q)), [plugins, q]);
	const mcpMatches = useMemo(() => mcpServers.filter(s => !q || `${s.name} ${s.endpoint}`.toLowerCase().includes(q)), [mcpServers, q]);

	// A search flattens on purpose: the match matters more than the origin then.
	const skillGroups = useMemo(() => {
		if (q) return skillMatches.length ? new Map([["", skillMatches]]) : new Map<string, SkillItem[]>();
		const map = new Map<string, SkillItem[]>();
		for (const s of skillMatches) {
			if (!s.enabled) continue;
			const label = groupName(s.source);
			const list = map.get(label);
			if (list) list.push(s);
			else map.set(label, [s]);
		}
		return map;
	}, [skillMatches, q]);

	const pluginGroups = useMemo(() => {
		const map = new Map<string, PluginItem[]>();
		for (const [label, kind] of PLUGIN_GROUPS) {
			const list = pluginMatches.filter(p => p.kind === kind);
			if (list.length) map.set(t(label), list);
		}
		return map;
	}, [pluginMatches]);

	const disabled = q ? [] : skillMatches.filter(s => !s.enabled);
	const mcpDisabled = q ? [] : mcpMatches.filter(s => !s.enabled);
	const mcpEnabled = mcpMatches.filter(s => s.enabled);
	/** Rows the gateway could not parse; the user should see them, not an empty list. */
	const unparsed = q ? [] : (a.mcp?.unparsed ?? []);
	const groupCount = tab === "skills" ? skillGroups.size : tab === "plugins" ? pluginGroups.size : mcpEnabled.length;
	const noMatch = Boolean(q) && (tab === "skills" ? skillMatches : tab === "plugins" ? pluginMatches : mcpMatches).length === 0;
	const loading = tab === "skills" ? a.skills === undefined : tab === "plugins" ? a.plugins === undefined : a.mcp === undefined;

	return (
		<div className="main">
			<div className="main-col">
				<div className="pl-page">
					<header className="pl-head">
						<div className="pl-title-row">
							<SidebarToggle />
							<div>
								<h1>{t("shell.plugins")}</h1>
								<p className="pl-sub">{t("shell.pluginsSub")}</p>
							</div>
						</div>
						<div className="pl-tools">
							<label className="pl-search">
								<Icon name="search" size={14} />
								<input placeholder={t("shell.searchPlugins")} value={query} onChange={e => setQuery(e.target.value)} />
							</label>
							<button className="icon-btn" title={t("shell.reload")} onClick={() => void (tab === "mcp" ? app.refreshMcp() : app.refreshPlugins())}>
								<Icon name="refresh" size={15} />
							</button>
						</div>
					</header>
					<div className="pl-bar">
						<div className="seg">
							<button className={tab === "skills" ? "on" : ""} onClick={() => app.setPluginsTab("skills")}>
								{t("shell.tabSkills", { n: skills.length })}
							</button>
							<button className={tab === "plugins" ? "on" : ""} onClick={() => app.setPluginsTab("plugins")}>
								{t("shell.tabPlugins", { n: plugins.length })}
							</button>
							<button className={tab === "mcp" ? "on" : ""} onClick={() => app.setPluginsTab("mcp")}>
								{/* 還沒讀到就不顯示數字：顯示「0」會讓人以為真的沒有 MCP server。 */}
								{a.mcp === undefined ? t("shell.tabMcpPlain") : t("shell.tabMcp", { n: mcpServers.length })}
							</button>
						</div>
					</div>
					{loading && <div className="pl-note">{t("shell.loading")}</div>}
					{!loading && noMatch && (
						<div className="pl-note">
							{t(tab === "skills" ? "shell.noSkillMatch" : tab === "plugins" ? "shell.noPluginMatch" : "shell.noMcpMatch", { query: query.trim() })}
						</div>
					)}
					{!loading && !q && groupCount === 0 && (tab === "skills" ? <EmptySkills hasProjects={a.projects.length > 0} /> : tab === "plugins" ? <EmptyPlugins /> : <EmptyMcp />)}
					{tab === "skills" &&
						[...skillGroups].map(([label, list]) => (
							<Group key={label || "flat"}>
								{list.map(s => (
									<SkillCard key={s.name} s={s} onOpen={() => app.openSkillDetail(s.name, a.skillsCwd ?? "")} />
								))}
							</Group>
						))}
					{tab === "plugins" &&
						[...pluginGroups].map(([label, list]) => (
							<Group key={label}>
								{list.map(p => (
									<PluginCard key={p.id} p={p} />
								))}
							</Group>
						))}
					{tab === "mcp" && (
						<>
							<Group>
								{mcpEnabled.map(s => (
									<McpCard key={s.name} s={s} />
								))}
							</Group>
							{unparsed.length > 0 && (
								<section className="pl-group">
									<div className="pl-note">
										{t("shell.mcpUnparsedTitle")}
										<div className="pl-card-desc" style={{ whiteSpace: "pre-wrap" }}>
											{unparsed.join("\n")}
										</div>
									</div>
								</section>
							)}
							{mcpDisabled.length > 0 && (
								<section className="pl-group">
									<button className="pl-group-head" onClick={() => setDisabledOpen(v => !v)}>
										<Icon name={disabledOpen ? "chevronDown" : "chevronRight"} size={13} />
										{t("shell.disabled", { n: mcpDisabled.length })}
									</button>
									{disabledOpen && (
										<div className="pl-grid">
											{mcpDisabled.map(s => (
												<McpCard key={s.name} s={s} />
											))}
										</div>
									)}
								</section>
							)}
						</>
					)}
					{tab === "skills" && disabled.length > 0 && (
						<section className="pl-group">
							<button className="pl-group-head" onClick={() => setDisabledOpen(v => !v)}>
								<Icon name={disabledOpen ? "chevronDown" : "chevronRight"} size={13} />
								{t("shell.disabled", { n: disabled.length })}
							</button>
							{disabledOpen && (
								<div className="pl-grid">
									{disabled.map(s => (
										<SkillCard key={s.name} s={s} onOpen={() => app.openSkillDetail(s.name, a.skillsCwd ?? "")} />
									))}
								</div>
							)}
						</section>
					)}
				</div>
			</div>
		</div>
	);
}

function Group({ children }: { children: ReactNode }) {
	return (
		<section className="pl-group">
			<div className="pl-grid">{children}</div>
		</section>
	);
}

function SkillCard({ s, onOpen }: { s: SkillItem; onOpen: () => void }) {
	return (
		<div className="pl-card clickable" onClick={onOpen}>
			<span className={avatarClass(s.name)}>{initial(s.name)}</span>
			<div className="pl-card-text">
				<div className="pl-card-name">
					{s.name}
					{s.hide && <span className="pl-tag">{t("shell.manualOnly")}</span>}
				</div>
				<div className="pl-card-desc" title={s.description}>
					{s.description}
				</div>
			</div>
			<span onClick={e => e.stopPropagation()}>
				<Toggle on={s.enabled} onChange={v => void app.setSkillEnabled(s.name, v)} />
			</span>
		</div>
	);
}

/** First phase lists what is installed; installing and switching plugins come with the marketplace. */
function PluginCard({ p }: { p: PluginItem }) {
	return (
		<div className="pl-card">
			<span className={avatarClass(p.name || p.id)}>{initial(p.name || p.id)}</span>
			<div className="pl-card-text">
				<div className="pl-card-name">{p.name || p.id}</div>
				<div className="pl-card-desc" title={p.id}>
					{p.id}
				</div>
			</div>
		</div>
	);
}

/**
 * One MCP server, as omp reported it.
 *
 * The endpoint is the longest thing here, so it gets the whole width in a monospace
 * line and the full text in the tooltip; a disabled server is dimmed so the two
 * states do not look alike.
 */
function McpCard({ s }: { s: McpServerInfo }) {
	return (
		<div className="pl-card" style={s.enabled ? undefined : { opacity: 0.55 }}>
			<span className={avatarClass(s.name)}>{initial(s.name)}</span>
			<div className="pl-card-text">
				<div className="pl-card-name">
					{s.name}
					<span className="pl-tag">{s.transport}</span>
					<span className="pl-tag">{s.enabled ? t("shell.mcpEnabled") : t("shell.mcpDisabled")}</span>
					{s.source && <span className="pl-tag">{`${t("shell.mcpSource")}: ${s.source}`}</span>}
				</div>
				<div className="pl-card-desc" title={s.endpoint} style={{ fontFamily: "var(--mono)" }}>
					{s.endpoint}
				</div>
			</div>
		</div>
	);
}

function EmptySkills({ hasProjects }: { hasProjects: boolean }) {
	return (
		<div className="pl-empty">
			{hasProjects ? (
				<>
					{t("shell.emptySkillsLead")}
					<code>{t("shell.skillPath")}</code>
					{t("shell.emptySkillsMid")}
					<code>.omp/skills/</code>
					{t("shell.emptySkillsTail")}
				</>
			) : (
				<>{t("shell.emptySkillsNoProjects")}</>
			)}
		</div>
	);
}

function EmptyPlugins() {
	return (
		<div className="pl-empty">
			{t("shell.emptyPluginsLead")}
			<code>{t("shell.pluginInstallCmd")}</code>
			{t("shell.emptyPluginsTail")}
		</div>
	);
}

/**
 * The empty MCP list: where to add a server, and how to see what omp loaded.
 *
 * The file names and the slash commands come from `shared/omp/conventions.ts`, so
 * this file never spells out where omp keeps its configuration.
 */
function EmptyMcp() {
	return (
		<div className="pl-empty">
			{t("shell.mcpEmptyLead")}
			<code>{`~/${OMP_LAYOUT.defaultAgentDir.join("/")}/${MCP_CONVENTIONS.userConfigFile}`}</code>
			{t("shell.mcpEmptyMid")}
			<code>{MCP_CONVENTIONS.projectConfigFile}</code>
			{t("shell.mcpEmptyTail")}
			<code>{MCP_CONVENTIONS.listCommand}</code>
			{t("shell.mcpEmptyMid2")}
			<code>{MCP_CONVENTIONS.addCommand}</code>
			{t("shell.mcpEmptyTail2")}
		</div>
	);
}
