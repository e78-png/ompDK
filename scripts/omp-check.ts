/**
 * `bun run omp:check` — the self-check that tells you whether the omp installed on this
 * machine still matches what this app knows about it.
 *
 * Run it after upgrading omp and before reporting a bug. It uses the installed binary
 * only: no model is called, nothing is billed, and by default it works on the isolated
 * profile in `.data/omp-agent` rather than the user's real one, because a compatibility
 * probe has no business writing to someone's conversations.
 *
 * `✓` verified, `⚠` noticed but not fatal (the app degrades on its own), `✗` something
 * required is missing, `·` information. Any `✗` exits 1.
 *
 * When the only complaint left is the version, the run ends by moving `TESTED_OMP` in
 * `server/omp/compat.ts` to the installed version and reading the file back to prove it —
 * the constant is written by the check that earned it, never by hand. `--no-bump` keeps the
 * answer and leaves the file alone; capability warnings other than the version do too,
 * because a build the UI silently degrades on is worth looking at before it is called tested.
 *
 * 探測本身在 `server/omp/check.ts`：設定頁的「執行相容性檢查」按鈕跑的是同一份，
 * 只是那邊只回報結果、不碰這個檔案。分開的是「要不要承認某個版本」，不是「怎麼檢查」。
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { CompatCheckSection } from "../shared/api.ts";

// Decide the profile before anything reads the environment: without this the check would
// probe the user's real `~/.omp/agent` whenever the gateway was not started with one.
const ROOT = path.resolve(import.meta.dir, "..");
if (!process.env.OMP_WEB_AGENT_DIR) process.env.OMP_WEB_AGENT_DIR = path.join(ROOT, ".data", "omp-agent");

const [{ runCompatCheck }, { TESTED_OMP }] = await Promise.all([
	import("../server/omp/check.ts"),
	import("../server/omp/compat.ts"),
]);

type Mark = "ok" | "warn" | "fail" | "note";
const SYMBOL: Record<Mark, string> = { ok: "✓", warn: "⚠", fail: "✗", note: "·" };

/** 每個分組的標題；CLI 的樣子由這裡決定。 */
const HEADERS: Record<CompatCheckSection, string> = {
	target: "檢查目標",
	version: "版本",
	handshake: "程序與握手",
	state: "get_state",
	commands: "命令列表",
	commandOutput: "命令輸出",
	session: "會話檔案",
	cli: "命令列子命令",
	isolation: "環境變數隔離",
};

const result = await runCompatCheck();
for (const section of result.sections) {
	console.log(`\n[${HEADERS[section]}]`);
	for (const row of result.items.filter(row => row.section === section)) {
		console.log(`${SYMBOL[row.mark]} ${row.what}${row.why ? `  — ${row.why}` : ""}`);
	}
}

/**
 * Move the pinned version. Only a run whose sole complaint is the version reaches this, so
 * the constant keeps its meaning: the build named in it is one whose probes all passed.
 */
async function pinTested(to: string): Promise<void> {
	const file = path.join(ROOT, "server", "omp", "compat.ts");
	const pattern = /export const TESTED_OMP = "[^"]*"/;
	const text = await fs.readFile(file, "utf8");
	if (!pattern.test(text)) throw new Error(`server/omp/compat.ts 里找不到 TESTED_OMP 的声明行`);
	await fs.writeFile(file, text.replace(pattern, `export const TESTED_OMP = "${to}"`));
	const back = await fs.readFile(file, "utf8");
	if (!back.includes(`export const TESTED_OMP = "${to}"`)) throw new Error(`写入后读回的不是 ${to}`);
}

// ── summary ──────────────────────────────────────────────────────────────────────────
const failed = result.items.filter(row => row.mark === "fail");
const warned = result.items.filter(row => row.mark === "warn");
console.log(`\n${result.passed}/${result.items.length} 项通过，${warned.length} 项警告，${failed.length} 项失败。`);
let code = failed.length ? 1 : 0;
if (failed.length) {
	console.log(`失败项（只需改 server/omp/ 与 shared/omp/）：`);
	for (const row of failed) console.log(`  ✗ ${row.what}：${row.why}`);
} else if (result.capabilityWarnings.length) {
	console.log(`没有失败项；${result.capabilityWarnings.length} 项能力警告由前端按能力自行降级，TESTED_OMP 保持 ${TESTED_OMP}——值得先把它们看清楚再认这个版本。`);
} else if (result.suggestedVersion) {
	if (process.argv.includes("--no-bump")) console.log(`全部通过：--no-bump，TESTED_OMP 仍是 ${TESTED_OMP}，要认 ${result.suggestedVersion} 就自己改那一行。`);
	else {
		try {
			await pinTested(result.suggestedVersion);
			console.log(`全部通过：已把 server/omp/compat.ts 的 TESTED_OMP 从 ${TESTED_OMP} 改成 ${result.suggestedVersion}，读回核对过，提交那一行即可。`);
		} catch (error) {
			code = 1;
			console.log(`TESTED_OMP 没能自动改成 ${result.suggestedVersion}：${(error as Error).message}`);
		}
	}
} else if (result.version === TESTED_OMP) console.log(`全部通过，版本正是 TESTED_OMP，无需改动。`);
else console.log(`全部通过。`);
process.exit(code);
