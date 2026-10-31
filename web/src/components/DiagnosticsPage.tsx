/**
 * 行程診斷：這台機器上正在跑哪些 omp 行程、各自開著哪一個 session 檔。
 *
 * 為什麼要有這一頁：使用者看到「某個 session 被另一個 OMP 行程寫著」時，手上只有
 * 「被佔著」這件事，沒有「是誰」。租約知道檔案被別人佔著，行程表卻對不到持有者——
 * 互動式的 omp 命令列上沒有檔案路徑，它寫的是自己剛開的那一個 session。把行程全部
 * 列出來，使用者就能自己對照哪一個行程才是那個持有者。
 *
 * 這一頁只回報，不動手：要結束哪一個行程由使用者自己決定。
 */
import { useEffect, useMemo, useState } from "react";
import type { OmpProcessList } from "../../../shared/diagnostics.ts";
import { app, useApp } from "../lib/app-store.ts";
import { t } from "../lib/i18n/index.ts";
import { SidebarToggle } from "./SidebarToggle.tsx";

export function DiagnosticsPage() {
	const a = useApp();
	const [list, setList] = useState<OmpProcessList | undefined>();
	const [error, setError] = useState("");

	useEffect(() => {
		let alive = true;
		const load = async () => {
			try {
				const data = await app.loadDiagnostics();
				if (alive) {
					setList(data);
					setError("");
				}
			} catch (e) {
				if (alive) setError((e as Error).message);
			}
		};
		void load();
		// The list changes while other sessions come and go; a slow poll keeps it honest.
		const timer = setInterval(load, 5000);
		return () => {
			alive = false;
			clearInterval(timer);
		};
	}, []);

	const processes = list?.processes ?? [];
	/** Orphans: their parent is gone, yet they still hold a session file. */
	const orphans = useMemo(() => processes.filter(p => !p.parentAlive && p.session), [processes]);

	return (
		<div className="main">
			<div className="main-col">
				<div className="pl-page">
					<header className="pl-head">
						<div className="pl-title-row">
							<SidebarToggle />
							<h1>{t("set.diagTitle")}</h1>
						</div>
					</header>

					<p className="pl-sub">{t("set.diagLead")}</p>

					{error ? <p className="set-warn">{error}</p> : null}

					{orphans.length > 0 && (
						<section className="cmd-ref-section">
							<h2>{t("set.diagOrphans")}</h2>
							<p className="set-section-about">{t("set.diagOrphansHint")}</p>
						</section>
					)}

					{processes.length === 0 ? (
						<p className="set-desc">{list ? t("set.diagEmpty") : t("set.diagLoading")}</p>
					) : (
						<div className="set-plain-list">
							{processes.map(p => (
								<div className="set-plain-row" key={p.pid}>
									<code>{p.pid}</code>
									<span className="set-value">{p.ownedByGateway ? t("set.diagOwned") : p.parentAlive ? t("set.diagOther") : t("set.diagOrphan")}</span>
									<p className="set-desc">
										{p.session ? t("set.diagSession", { file: p.session }) : t("set.diagNoSession")}
									</p>
									<code className="set-desc">{p.commandLine}</code>
								</div>
							))}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
