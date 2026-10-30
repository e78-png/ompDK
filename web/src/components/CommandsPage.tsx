/**
 * 指令參考頁：所有內建指令的中文教學，加上這台機器上實際存在的其他指令。
 *
 * 為什麼要有這一頁：`/` 選單只能一行一列地看，看不到一條指令到底做什麼、什麼時候用。
 * 教學表裡的內容要有一個地方完整地摊開來，讓人一次看完、再回去查細節。
 *
 * 兩段內容：
 *  - 教學：內建指令的用途、用法、範例、注意。這是中文的，來源是教學表。
 *  - 本機指令：skill、extension、custom 指令。說明是他們自己的文字，翻譯會走樣。
 */
import { useMemo, useState } from "react";
import { COMMAND_HELP } from "../../../shared/command-help.ts";
import { type CommandGroup, GROUP_ORDER, builtinGroup, groupLabel, helpOfName, titleOf } from "../../../shared/commands.ts";
import { COMMAND_SOURCES } from "../../../shared/omp/conventions.ts";
import { app, useApp } from "../lib/app-store.ts";
import { Icon } from "../lib/icons.tsx";
import { t } from "../lib/i18n/index.ts";
import { SidebarToggle } from "./SidebarToggle.tsx";

/** One row of the reference: a builtin's teaching, or a command this machine has. */
interface Entry {
	name: string;
	group: CommandGroup;
	/** Chinese title, when the app has one. */
	title: string;
	/** What it is for. */
	purpose: string;
	usage?: string;
	examples?: string[];
	note?: string;
	via?: string;
	/** Where the command came from; only set for the machine's own commands. */
	source?: string;
}

export function CommandsPage() {
	const a = useApp();
	const [query, setQuery] = useState("");
	const q = query.trim().toLowerCase();

	/** The teaching table, which is the same on every machine. */
	const taught = useMemo<Entry[]>(
		() =>
			Object.keys(COMMAND_HELP).flatMap(name => {
				// The accessor converts to the interface language; reading the table
				// directly would show simplified text in a traditional interface.
				const doc = helpOfName(name);
				if (!doc) return [];
				return [{
					name,
					group: builtinGroup(name),
					title: "",
					purpose: doc.purpose,
					usage: doc.usage,
					examples: doc.examples,
					note: doc.note,
					via: doc.via,
				}];
			}),
		[],
	);

	/** The commands this machine has that the teaching table does not cover. */
	const own = useMemo<Entry[]>(() => {
		const out: Entry[] = [];
		for (const c of a.homeCommands ?? []) {
			if (c.source === COMMAND_SOURCES.builtin) continue;
			out.push({
				name: c.name,
				group: c.source === COMMAND_SOURCES.skill ? "skill" : "custom",
				title: titleOf(c),
				purpose: (c.description ?? "").replace(/\s+/g, " "),
				source: c.source,
			});
		}
		return out;
	}, [a.homeCommands]);

	const matches = useMemo(() => {
		if (!q) return null;
		const hit = (e: Entry) => `${e.name} ${e.title} ${e.purpose} ${e.usage ?? ""}`.toLowerCase().includes(q);
		return { taught: taught.filter(hit), own: own.filter(hit) };
	}, [q, taught, own]);

	const taughtGroups = useMemo(() => {
		const list = matches ? matches.taught : taught;
		const map = new Map<CommandGroup, Entry[]>();
		for (const e of list) {
			const bucket = map.get(e.group);
			if (bucket) bucket.push(e);
			else map.set(e.group, [e]);
		}
		return map;
	}, [taught, matches]);

	const ownEntries = matches ? matches.own : own;
	const total = (matches ? matches.taught.length : taught.length) + ownEntries.length;

	return (
		<div className="main">
			<div className="main-col">
				<div className="pl-page">
					<header className="pl-head">
						<div className="pl-title-row">
							<SidebarToggle />
							<h1>{t("shell.commandReference")}</h1>
						</div>
						<div className="pl-tools">
							<label className="pl-search">
								<input value={query} placeholder={t("shell.commandReferenceSearch")} onChange={e => setQuery(e.target.value)} />
							</label>
						</div>
					</header>

					{total === 0 ? (
						<div className="center-state">{t("shell.commandReferenceEmpty")}</div>
					) : (
						<>
							{matches ? null : <p className="pl-sub">{t("shell.commandReferenceLead")}</p>}

							{ownEntries.length > 0 && (
								<section className="cmd-ref-section">
									<h2>{t("shell.commandReferenceLocal")}</h2>
									<p className="pl-sub">{t("shell.commandReferenceLocalHint")}</p>
									<div className="cmd-ref-list">
										{ownEntries.map(e => (
											<article className="cmd-ref-item" key={`own-${e.name}`}>
												<header>
													<code>/{e.name}</code>
													{e.title ? <span className="cmd-ref-title">{e.title}</span> : null}
													{e.source ? <span className="cmd-ref-source">{e.source}</span> : null}
												</header>
												{e.purpose ? <p>{e.purpose}</p> : null}
											</article>
										))}
									</div>
								</section>
							)}

							{GROUP_ORDER.filter(g => g === "context" || g === "mode" || g === "session" || g === "workspace" || g === "system").map(group => {
								const entries = taughtGroups.get(group);
								if (!entries?.length) return null;
								return (
									<section className="cmd-ref-section" key={group}>
										<h2>{groupLabel(group)}</h2>
										<div className="cmd-ref-list">
											{entries.map(e => (
												<article className="cmd-ref-item" key={e.name}>
													<header>
														<code>/{e.name}</code>
														{e.via ? <span className="cmd-ref-via">{t("shell.commandReferenceVia", { where: e.via })}</span> : null}
													</header>
													<p className="cmd-ref-purpose">{e.purpose}</p>
													{e.usage ? <p className="cmd-ref-usage"><code>{e.usage}</code></p> : null}
													{e.examples?.length ? (
														<ul className="cmd-ref-examples">
															{e.examples.map((x, i) => (
																<li key={i}><code>{x}</code></li>
															))}
														</ul>
													) : null}
													{e.note ? <p className="cmd-ref-note">{e.note}</p> : null}
												</article>
											))}
										</div>
									</section>
								);
							})}
						</>
					)}
				</div>
			</div>
		</div>
	);
}
