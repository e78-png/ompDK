/**
 * 插件: the skills and plugins OMP actually loads. Skills come from
 * `omp skill list` run inside one project, because project-level skills depend
 * on the working directory; plugins are global. The project is the one you
 * opened the page from, on purpose: with only user-level skills installed a
 * picker could not change what the page shows.
 */
import { type ReactNode, useMemo, useState } from "react";
import type { PluginItem, SkillItem } from "../../../shared/api.ts";
import { app, useApp } from "../lib/app-store.ts";
import { Icon } from "../lib/icons.tsx";
import { avatarClass, groupName, initial } from "../lib/skills.ts";
import { Toggle } from "./settings/controls.tsx";

const PLUGIN_GROUPS: [string, PluginItem["kind"]][] = [
	["市场插件", "marketplace"],
	["npm 插件", "npm"],
];

export function PluginsPage() {
	const a = useApp();
	const [query, setQuery] = useState("");
	const [disabledOpen, setDisabledOpen] = useState(false);
	const q = query.trim().toLowerCase();
	const tab = a.pluginsTab;
	const skills = a.skills ?? [];
	const plugins = a.plugins ?? [];

	const skillMatches = useMemo(() => skills.filter(s => !q || `${s.name} ${s.description}`.toLowerCase().includes(q)), [skills, q]);
	const pluginMatches = useMemo(() => plugins.filter(p => !q || `${p.name} ${p.id}`.toLowerCase().includes(q)), [plugins, q]);

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
			if (list.length) map.set(label, list);
		}
		return map;
	}, [pluginMatches]);

	const disabled = q ? [] : skillMatches.filter(s => !s.enabled);
	const groupCount = tab === "skills" ? skillGroups.size : pluginGroups.size;
	const noMatch = Boolean(q) && (tab === "skills" ? skillMatches : pluginMatches).length === 0;
	const loading = tab === "skills" ? a.skills === undefined : a.plugins === undefined;

	return (
		<div className="main">
			<div className="main-col">
				<div className="pl-page">
					<header className="pl-head">
						<div>
							<h1>插件</h1>
							<p className="pl-sub">让 OMP 使用的技能与插件</p>
						</div>
						<div className="pl-tools">
							<label className="pl-search">
								<Icon name="search" size={14} />
								<input placeholder="搜索插件和技能" value={query} onChange={e => setQuery(e.target.value)} />
							</label>
							<button className="icon-btn" title="重新读取" onClick={() => void app.refreshPlugins()}>
								<Icon name="refresh" size={15} />
							</button>
						</div>
					</header>
					<div className="pl-bar">
						<div className="seg">
							<button className={tab === "skills" ? "on" : ""} onClick={() => app.setPluginsTab("skills")}>
								技能 {skills.length}
							</button>
							<button className={tab === "plugins" ? "on" : ""} onClick={() => app.setPluginsTab("plugins")}>
								插件 {plugins.length}
							</button>
						</div>
					</div>
					{loading && <div className="pl-note">正在读取…</div>}
					{!loading && noMatch && <div className="pl-note">没有匹配「{query.trim()}」的{tab === "skills" ? "技能" : "插件"}</div>}
					{!loading && !q && groupCount === 0 && disabled.length === 0 && (tab === "skills" ? <EmptySkills hasProjects={a.projects.length > 0} /> : <EmptyPlugins />)}
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
					{disabled.length > 0 && (
						<section className="pl-group">
							<button className="pl-group-head" onClick={() => setDisabledOpen(v => !v)}>
								<Icon name={disabledOpen ? "chevronDown" : "chevronRight"} size={13} />
								已停用 · {disabled.length}
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
					{s.hide && <span className="pl-tag">仅手动</span>}
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

function EmptySkills({ hasProjects }: { hasProjects: boolean }) {
	return (
		<div className="pl-empty">
			{hasProjects ? (
				<>
					还没有技能。把技能放到 <code>~/.agents/skills/&lt;名称&gt;/SKILL.md</code> 或项目的 <code>.omp/skills/</code> 下，然后点刷新。
				</>
			) : (
				<>先在侧栏添加一个项目，技能是按项目列出的。</>
			)}
		</div>
	);
}

function EmptyPlugins() {
	return (
		<div className="pl-empty">
			还没有安装插件。插件市场会在下一版提供；现在可以在终端用 <code>omp plugin install &lt;包名&gt;</code> 安装。
		</div>
	);
}
