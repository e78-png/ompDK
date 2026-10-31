/**
 * OMP 設定：讓人看得懂、也改得動 OMP 自己的設定。
 *
 * 為什麼要有這一頁：到今天為止這個 App 只碰了 OMP 的四個設定（模型角色、子代理覆寫、
 * 計畫預設、停用的外掛）。OMP 自己的 schema 有五百多個鍵，其中真正值得人改的有
 * 幾十項——這一頁把那幾十項挑出來，寫上中文的「這是什麼、什麼時候該改」，並且
 * 真的改得動。改的是 OMP 的設定檔，所以終端機裡的 omp 看到的是同一份值。
 *
 * 精選表之外的鍵仍然搜得到、看得見（用 OMP 自己的說明），只是不能從這裡改——
 * 那是刻意的：五百多個鍵全開放可寫，只會讓人改壞自己不理解的設定。
 */
import { useEffect, useMemo, useState } from "react";
import type { OmpConfigEntry } from "../../../../shared/api.ts";
import { CURATED_SETTINGS, type RecordSettingSpec, RECORD_SETTINGS, type SettingGroup, type SettingSpec, aboutOf, groupAboutOf, groupLabelOf, labelOf, noteOf } from "../../../../shared/omp/settings.ts";
import { MODEL_ROLES } from "../../../../shared/omp/conventions.ts";
import { app, useApp } from "../../lib/app-store.ts";
import { t } from "../../lib/i18n/index.ts";
import { Row, Section, Toggle } from "./controls.tsx";

/** How a value reads in the list: short enough to sit in a row. */
function show(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (typeof value === "boolean") return value ? t("set.on") : t("set.off");
	if (typeof value === "string") return value;
	if (typeof value === "number") return String(value);
	if (Array.isArray(value)) return value.length ? value.map(v => String(v)).join(", ") : t("set.empty");
	return JSON.stringify(value);
}

/** The value as the editor needs it: a boolean, or the text of a scalar. */
function editableText(value: unknown): string {
	if (typeof value === "boolean") return value ? "true" : "false";
	if (value === undefined || value === null) return "";
	if (typeof value === "object") return "";
	return String(value);
}

/**
 * One record-shaped setting, edited field by field.
 *
 * 為什麼要逐欄位：模型角色與逐工具批准都是 `{ 欄位: 值 }` 的物件，整鍵寫回去
 * 會把沒動到的欄位一起蓋掉。每一欄自己讀自己寫，其他欄位不動。
 */
function RecordSection({
	spec,
	entry,
	busy,
	onWrite,
}: {
	spec: RecordSettingSpec;
	entry: OmpConfigEntry | undefined;
	busy: string | undefined;
	onWrite: (field: string, value: string) => void;
}) {
	const [draft, setDraft] = useState("");
	const current = (entry?.value ?? {}) as Record<string, unknown>;
	const fields = useMemo(() => {
		if (spec.fields === "roles") {
			// 已設定的角色，加上 OMP 內建的那些角色。
			const names = new Set<string>([...MODEL_ROLES, ...Object.keys(current)]);
			return [...names];
		}
		return Object.keys(current);
	}, [spec.fields, current]);

	return (
		<Section title={spec.label}>
			<p className="set-section-about">{spec.about}</p>
			{fields.map(field => {
				const value = typeof current[field] === "string" ? (current[field] as string) : "";
				const isBusy = busy === `${spec.key}.${field}`;
				return (
					<Row key={field} title={field} desc={spec.pattern === "role" ? t("set.ompRoleHint") : undefined}>
						{spec.values ? (
							<select className="set-select" value={value} disabled={isBusy} onChange={e => onWrite(field, e.target.value)}>
								<option value="">{t("set.unset")}</option>
								{spec.values.map(v => (
									<option key={v} value={v}>{v}</option>
								))}
							</select>
						) : (
							<input
								className="set-input"
								defaultValue={value}
								disabled={isBusy}
								placeholder={spec.placeholder}
								onBlur={e => {
									if (e.target.value !== value) onWrite(field, e.target.value);
								}}
							/>
						)}
					</Row>
				);
			})}
			{spec.fields === "existing" && (
				<Row title={t("set.ompAddField")} desc={t("set.ompAddFieldHint")}>
					<input
						className="set-input"
						value={draft}
						placeholder={spec.placeholder}
						onChange={e => setDraft(e.target.value)}
						onKeyDown={e => {
							if (e.key !== "Enter" || !draft.trim()) return;
							onWrite(draft.trim(), spec.values?.[0] ?? "");
							setDraft("");
						}}
					/>
				</Row>
			)}
		</Section>
	);
}

export function OmpPage() {
	const a = useApp();
	const [query, setQuery] = useState("");
	const [busy, setBusy] = useState<string | undefined>();

	useEffect(() => {
		void app.loadOmpConfig();
	}, []);

	const entries = a.ompConfig;
	const q = query.trim().toLowerCase();
	const groups = useMemo(() => {
		const map = new Map<SettingGroup, SettingSpec[]>();
		for (const spec of CURATED_SETTINGS) {
			const bucket = map.get(spec.group);
			if (bucket) bucket.push(spec);
			else map.set(spec.group, [spec]);
		}
		return [...map.entries()];
	}, []);

	/** Everything OMP reports that the curated list does not cover, filtered by the search. */
	const others = useMemo(() => {
		if (!entries) return [];
		const curated = new Set(CURATED_SETTINGS.map(s => s.key));
		const out: { key: string; entry: OmpConfigEntry }[] = [];
		for (const [key, entry] of Object.entries(entries)) {
			if (curated.has(key)) continue;
			if (q && !`${key} ${entry.description ?? ""}`.toLowerCase().includes(q)) continue;
			out.push({ key, entry });
		}
		return out;
	}, [entries, q]);

	const write = async (spec: SettingSpec, value: string) => {
		setBusy(spec.key);
		await app.setOmpSetting(spec.key, value);
		setBusy(undefined);
	};

	const writeRecord = async (spec: RecordSettingSpec, field: string, value: string) => {
		setBusy(`${spec.key}.${field}`);
		await app.setOmpSetting(spec.key, value, field);
		setBusy(undefined);
	};

	return (
		<>
			<div className="set-search">
				<input value={query} placeholder={t("set.ompSearch")} onChange={e => setQuery(e.target.value)} />
			</div>

			{!entries ? (
				<p className="set-desc">{t("set.ompLoading")}</p>
			) : (
				<>
					{groups.map(([group, specs]) => (
						<Section key={group} title={groupLabelOf(group)}>
							<p className="set-section-about">{groupAboutOf(group)}</p>
							{specs.map(spec => {
								const entry = entries[spec.key];
								const current = entry?.value;
								const value = editableText(current);
								const note = noteOf(spec);
								return (
									<Row
										key={spec.key}
										title={labelOf(spec)}
										desc={
											<>
												<span>{aboutOf(spec, entry?.description)}</span>
												{note ? <span className="set-note">{note}</span> : null}
											</>
										}
									>
										{spec.kind === "boolean" ? (
											<Toggle on={current === true} disabled={busy === spec.key} onChange={v => void write(spec, v ? "true" : "false")} />
										) : spec.kind === "enum" ? (
											<select className="set-select" value={value} disabled={busy === spec.key} onChange={e => void write(spec, e.target.value)}>
												{!spec.values?.includes(value) ? <option value={value}>{value || t("set.unset")}</option> : null}
												{spec.values?.map(v => (
													<option key={v} value={v}>{v}</option>
												))}
											</select>
										) : spec.kind === "number" ? (
											<input className="set-input" defaultValue={value} disabled={busy === spec.key} onBlur={e => { if (e.target.value !== value) void write(spec, e.target.value); }} />
										) : spec.kind === "text" ? (
											<input className="set-input" defaultValue={value} disabled={busy === spec.key} onBlur={e => { if (e.target.value !== value) void write(spec, e.target.value); }} />
										) : (
											<span className="set-value">{show(current)}</span>
										)}
									</Row>
								);
							})}
						</Section>
					))}

					<Section title={t("set.ompOthers")}>
						<p className="set-section-about">{t("set.ompOthersHint")}</p>
						{others.length === 0 ? (
							<p className="set-desc">{q ? t("set.ompNoMatch") : t("set.ompOthersEmpty")}</p>
						) : (
							<div className="set-plain-list">
								{others.slice(0, 300).map(({ key, entry }) => (
									<div className="set-plain-row" key={key}>
										<code>{key}</code>
										<span className="set-value">{show(entry.value)}</span>
										{entry.description ? <span className="set-desc">{entry.description}</span> : null}
									</div>
								))}
								{others.length > 300 ? <p className="set-desc">{t("set.ompMore", { count: others.length - 300 })}</p> : null}
							</div>
						)}
					</Section>

					{RECORD_SETTINGS.map(spec => (
						<RecordSection key={spec.key} spec={spec} entry={entries[spec.key]} busy={busy} onWrite={(field, value) => void writeRecord(spec, field, value)} />
					))}
				</>
			)}
		</>
	);
}
