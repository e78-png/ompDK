/**
 * 完整的相容性檢查：`bun run omp:check` 的那一整套探測，這裡是可以呼叫的版本。
 *
 * 為什麼要抽出來：同一份檢查有兩個使用者——終端機裡的 CLI（要自己印表格、自己
 * 改寫已驗證版本）與設定頁的按鈕（只看結果、不碰原始碼檔案）。探測邏輯只寫一次，
 * 兩邊才不會各跑各的、講不同的故事。
 *
 * 這裡不做的事：不會改寫 `server/omp/compat.ts` 裡的版本常數，也不會結束程序。
 * 「要不要承認某個版本」是 CLI 的決定（它改了檔案），這裡只回報結果。
 *
 * 檢查本身不起模型：所有探針都是本機的行程與檔案讀取，跑完大約幾秒。
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { CompatCheckItem, CompatCheckResult, CompatCheckSection } from "../../shared/api.ts";
import { CONFIG_KEYS } from "../../shared/omp/conventions.ts";
import { config } from "../config.ts";
import { OmpProcess } from "../omp-process.ts";
import { MIN_PROTOCOL, TESTED_OMP, parseVersion } from "./compat.ts";
import { ompBinaryName, ompConfigListArgs, ompConfigSetArgs, ompModelsArgs, ompPluginListArgs, ompSkillListArgs, ompVersionArgs, runOmp, runOmpIn, type OmpRun } from "./cli.ts";
import { readSessionHead } from "./session-file.ts";

/** 整個檢查的期限；超過就收尾，不讓一個請求無限期吊著。 */
const TOTAL_BUDGET_MS = 180_000;

type Mark = CompatCheckItem["mark"];

/** 一次檢查的累加器：結果、分組與計數都從這裡長出來。 */
class Recorder {
	items: CompatCheckItem[] = [];
	sections: CompatCheckSection[] = [];
	private readonly deadline = Date.now() + TOTAL_BUDGET_MS;

	/** 開一個分組；沒有項目的分組也要留著，CLI 才會照原樣印出標題。 */
	section(id: CompatCheckSection): void {
		this.sections.push(id);
	}

	record(section: CompatCheckSection, mark: Mark, what: string, why = ""): void {
		this.items.push({ section, mark, what, why });
	}

	/** 剩下的時間；沒有了就是逾時。 */
	remaining(): number {
		return this.deadline - Date.now();
	}
}

/** 探測行程推送的影格，讓檢查讀得到「不問也會送」的東西。 */
class FrameLog {
	readonly frames: Record<string, unknown>[] = [];

	push(frame: Record<string, unknown>): void {
		this.frames.push(frame);
	}

	find(type: string): Record<string, unknown> | undefined {
		return this.frames.find(frame => frame.type === type);
	}

	/** 等某一種影格出現；回傳 undefined 表示它沒有來。 */
	async wait(type: string, timeoutMs: number): Promise<Record<string, unknown> | undefined> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			const hit = this.find(type);
			if (hit) return hit;
			await Bun.sleep(50);
		}
		return undefined;
	}
}

function json(stdout: string): unknown | undefined {
	try {
		return JSON.parse(stdout);
	} catch {
		return undefined;
	}
}

function tail(stderr: string): string {
	return stderr.trim().split("\n").filter(Boolean).slice(-2).join(" / ").slice(0, 160);
}

/**
 * 跑一次 omp 的 CLI 子命令；失敗記成一個 fail 項，這樣檢查才會繼續往後走。
 * 一個壞掉的地方不該讓整份報告只剩一行。
 */
async function runCli(rec: Recorder, section: CompatCheckSection, what: string, args: string[], options: { cwd?: string; agentDir?: string } = {}): Promise<OmpRun | undefined> {
	try {
		const timeoutMs = Math.max(0, Math.min(30_000, rec.remaining()));
		const result = options.agentDir ? await runOmpIn(options.agentDir, args, { timeoutMs }) : await runOmp(args, options.cwd, { timeoutMs });
		if (result.code !== 0) {
			rec.record(section, "fail", what, result.timedOut ? "逾時" : tail(result.stderr) || `exit ${result.code}`);
			return undefined;
		}
		return result;
	} catch (error) {
		rec.record(section, "fail", what, (error as Error).message);
		return undefined;
	}
}

/**
 * 跑完整套檢查，回傳結果。
 *
 * 每一項都是「看見了什麼」與「為什麼是這個結果」；分組順序與 CLI 的輸出一致。
 */
export async function runCompatCheck(): Promise<CompatCheckResult> {
	const rec = new Recorder();
	const log = new FrameLog();

	// ── 1. 這次檢查的目標 ──────────────────────────────────────────────
	rec.section("target");
	rec.record("target", "note", ompBinaryName(), `profile：${config.agentDir ?? "omp 的默认目录"}`);

	// ── 2. 版本 ──────────────────────────────────────────────────────────
	rec.section("version");
	let version: string | null = null;
	{
		try {
			const run = await runOmp(ompVersionArgs(), undefined, { timeoutMs: Math.max(0, Math.min(15_000, rec.remaining())) });
			version = parseVersion(run.stdout) ?? null;
			if (!version) rec.record("version", "fail", "omp --version 没有输出版本号", run.stdout.slice(0, 60) || tail(run.stderr));
			else if (version === TESTED_OMP) rec.record("version", "ok", `${version}`, "本应用验证过的版本");
			else rec.record("version", "warn", `${version}`, `本应用验证过的是 ${TESTED_OMP}；跑完这份检查其余项都过了就可以改它`);
		} catch (error) {
			rec.record("version", "fail", `无法执行 ${ompBinaryName()}`, (error as Error).message);
		}
	}

	// ── 3. 程序與握手 ────────────────────────────────────────────────────
	rec.section("handshake");
	let proc: InstanceType<typeof OmpProcess> | undefined;
	try {
		proc = new OmpProcess({
			cwd: config.root,
			ephemeral: true,
			onFrame: frame => log.push(frame as unknown as Record<string, unknown>),
			onExit: () => undefined,
		});
		await Promise.race([
			proc.ready,
			Bun.sleep(Math.min(20_000, rec.remaining())).then(() => {
				throw new Error("20s 内没有就绪");
			}),
		]);
		rec.record("handshake", "ok", "临时进程就绪", "--no-session：不写会话文件");
	} catch (error) {
		rec.record("handshake", "fail", "临时进程未能就绪", (error as Error).message);
		proc = undefined;
	}

	const abilities = proc?.capabilities;
	if (abilities) {
		rec.record("handshake", abilities.protocol >= MIN_PROTOCOL ? (abilities.protocol === 2 ? "ok" : "warn") : "fail", `协议版本 ${abilities.protocol}`, abilities.protocol === 2 ? "v2 分帧可用" : "没有协商到 v2，大消息按整帧处理");
		for (const [flag, what, fallback] of [
			["deltaUpdates", "增量更新", "整段消息替换，仍能显示"],
			["askDialog", "ask 对话卡片", "退成逐题的选择＋输入"],
			["subagentProgress", "子代理订阅", "隐藏子代理页签与线程里的徽标"],
		] as const) {
			const on = abilities[flag];
			rec.record("handshake", on ? "ok" : "warn", what, on ? "已协商" : `不支持：${fallback}`);
		}
	}

	// ── 4. 介面要讀的狀態欄位 ────────────────────────────────────────────
	rec.section("state");
	const REQUIRED_STATE = ["model", "thinkingLevel", "isStreaming", "isCompacting", "messageCount", "contextUsage", "queuedMessages", "todoPhases"];
	const OPTIONAL_STATE = ["sessionFile", "sessionName"];
	if (proc) {
		const res = await proc.request({ type: "get_state" }, Math.min(15_000, rec.remaining()));
		const data = (res.success ? res.data : undefined) as Record<string, unknown> | undefined;
		if (!data) rec.record("state", "fail", "没有返回状态", String(res.error ?? ""));
		else {
			const missing = REQUIRED_STATE.filter(key => data[key] === undefined);
			rec.record("state", missing.length ? "fail" : "ok", `${REQUIRED_STATE.length} 个必需字段`, missing.length ? `缺少 ${missing.join("、")}` : "全部读到");
			const model = data.model as { provider?: string; id?: string } | undefined;
			rec.record("state", model?.provider && model?.id ? "ok" : "fail", "model.provider / model.id", model?.provider && model?.id ? `${model.provider}/${model.id}` : "读不出供应商或模型 id");
			const usage = data.contextUsage as { tokens?: number; contextWindow?: number; percent?: number } | undefined;
			rec.record("state", usage && usage.contextWindow ? "ok" : "warn", "contextUsage 的形状", usage ? `tokens ${usage.tokens} / ${usage.contextWindow}（${usage.percent}%）` : "没有上下文用量，信息页会显示「暂无数据」");
			const absent = OPTIONAL_STATE.filter(key => data[key] === undefined);
			if (absent.length) rec.record("state", "note", `${absent.join("、")} 未出现`, "临时进程按定义还没有会话文件与名字，不是问题");
		}
	} else rec.record("state", "fail", "跳过", "没有可用的进程");

	// ── 5. 斜線命令目錄 ──────────────────────────────────────────────────
	rec.section("commands");
	if (proc) {
		const res = await proc.request({ type: "get_available_commands" }, Math.min(15_000, rec.remaining()));
		const data = res.data as unknown;
		// omp answers this one with the array itself, and also pushes the update frame.
		const list = (Array.isArray(data) ? data : (data as { commands?: unknown[] } | undefined)?.commands) as { name?: string; source?: string; input?: unknown; subcommands?: unknown[] }[] | undefined;
		if (!list?.length) rec.record("commands", "fail", "没有解析出命令", String(res.error ?? "空列表"));
		else {
			const named = list.filter(c => typeof c?.name === "string" && c.name);
			rec.record("commands", named.length === list.length ? "ok" : "fail", `${list.length} 条命令`, named.length === list.length ? "每条都有 name" : `有 ${list.length - named.length} 条缺 name，菜单会丢行`);
			const withSource = list.filter(c => typeof c?.source === "string" && c.source).length;
			rec.record("commands", withSource ? "ok" : "warn", "source 字段", `${withSource}/${list.length} 条标注了来源，分组与图标依赖它`);
			const withInput = list.filter(c => c?.input && typeof c.input === "object").length;
			const withSubs = list.filter(c => Array.isArray(c.subcommands) && c.subcommands!.length > 0).length;
			rec.record("commands", withInput || withSubs ? "ok" : "warn", "input / subcommands", `${withInput} 条带参数提示、${withSubs} 条带子命令`);
		}
		if (log.find("available_commands_update")) rec.record("commands", "ok", "available_commands_update 推送", "会话开启时主动推送，主界面才能补全 `/`");
		else rec.record("commands", "warn", "没有收到 available_commands_update 推送", "主界面只能等 get_available_commands");
	} else rec.record("commands", "fail", "跳过", "没有可用的进程");

	// ── 6. 本機命令還會不會回答 ───────────────────────────────────────────
	rec.section("commandOutput");
	if (proc) {
		// `/fast status` is answered by omp itself without a model call, which is what makes
		// it usable here: it exercises the whole command path for free.
		const res = await proc.request({ type: "prompt", message: "/fast status" }, Math.min(30_000, rec.remaining()));
		const data = res.data as { agentInvoked?: boolean } | undefined;
		if (!res.success) rec.record("commandOutput", "fail", "prompt /fast status 失败", String(res.error ?? ""));
		else rec.record("commandOutput", data && data.agentInvoked === false ? "ok" : "warn", "应答里的 agentInvoked", data ? `agentInvoked=${data.agentInvoked}` : "应答没有 data，本地命令应当返回 {agentInvoked:false}");
		const out = await log.wait("command_output", Math.min(5_000, rec.remaining()));
		const text = (out as { text?: unknown } | undefined)?.text;
		if (typeof text === "string" && text.trim()) rec.record("commandOutput", "ok", "command_output 帧", text.trim().split("\n")[0].slice(0, 70));
		else rec.record("commandOutput", "fail", "没有收到 command_output 帧", "命令的答案进不了会话镜像，线程里会只剩一条空记录");
	} else rec.record("commandOutput", "fail", "跳过", "没有可用的进程");

	// ── 7. 會話檔案格式 ──────────────────────────────────────────────────
	rec.section("session");
	{
		let newest: { file: string; mtimeMs: number } | undefined;
		try {
			for (const dirName of await fs.readdir(config.sessionsRoot)) {
				const dir = path.join(config.sessionsRoot, dirName);
				for (const name of await fs.readdir(dir)) {
					if (!name.endsWith(".jsonl")) continue;
					const file = path.join(dir, name);
					const stat = await fs.stat(file);
					if (!newest || stat.mtimeMs > newest.mtimeMs) newest = { file, mtimeMs: stat.mtimeMs };
				}
			}
		} catch {
			rec.record("session", "warn", "跳过", `${config.sessionsRoot} 读不到，里面大概还没有会话`);
		}
		if (newest) {
			const head = await readSessionHead(newest.file);
			if (!head) rec.record("session", "fail", "头部解析失败", path.basename(newest.file));
			else {
				rec.record("session", "ok", "session 头", `id ${head.header.id.slice(0, 8)}…，cwd ${head.header.cwd ?? "（无）"}`);
				rec.record("session", head.title.trim() || head.firstUser ? "ok" : "warn", "标题槽或首个用户消息", head.title.trim() ? `「${head.title.trim()}」` : "只有首个用户消息可当标题");
				rec.record("session", "note", "目录名由 cwd 编码而来", path.basename(path.dirname(newest.file)));
			}
		}
	}

	// ── 8. CLI 子命令 ────────────────────────────────────────────────────
	rec.section("cli");
	{
		const list = await runCli(rec, "cli", "config list --json", ompConfigListArgs());
		if (list) {
			const all = json(list.stdout) as Record<string, { type?: string; value?: unknown }> | undefined;
			if (!all) rec.record("cli", "fail", "config list --json 的输出不是 JSON", list.stdout.slice(0, 60));
			else {
				rec.record("cli", Object.keys(all).length ? "ok" : "fail", `config list：${Object.keys(all).length} 个键`, "界面只读下面四个");
				for (const key of [CONFIG_KEYS.modelRoles, CONFIG_KEYS.agentModelOverrides, CONFIG_KEYS.planDefaultOnStartup, CONFIG_KEYS.disabledExtensions]) {
					const entry = all[key];
					// `value` is absent on keys omp has no default for, which is not a failure.
					rec.record("cli", entry ? "ok" : "fail", `配置键 ${key}`, entry ? `type=${entry.type}${entry.value === undefined ? "（无默认值）" : ""}` : "omp 不再报告这个键，设置页会读不到");
				}
			}
		}

		const models = await runCli(rec, "cli", "models --json", ompModelsArgs());
		if (models) {
			const modelList = json(models.stdout) as { models?: { provider?: string; id?: string }[] } | undefined;
			if (!modelList?.models?.length) rec.record("cli", "fail", "models --json 没有返回模型", models.stdout.slice(0, 60));
			else {
				const bad = modelList.models.filter(m => !m.provider || !m.id);
				rec.record("cli", bad.length ? "warn" : "ok", `models --json：${modelList.models.length} 个模型`, bad.length ? `${bad.length} 个缺 provider/id` : "每个都有 provider/id");
			}
		}

		const skills = await runCli(rec, "cli", "skill list --json", ompSkillListArgs(), { cwd: config.root });
		if (skills) {
			const skillList = json(skills.stdout) as { skills?: { name?: string }[] } | undefined;
			if (!skillList) rec.record("cli", "fail", "skill list --json 的输出不是 JSON", skills.stdout.slice(0, 60));
			else
				rec.record(
					"cli",
					skillList.skills?.length ? "ok" : "warn",
					`skill list --json：${skillList.skills?.length ?? 0} 个技能`,
					skillList.skills?.every(s => s.name) ? "每条都有 name" : "有技能缺 name，列表会串行",
				);
		}

		const plugins = await runCli(rec, "cli", "plugin list --json", ompPluginListArgs());
		if (plugins) {
			const pluginList = json(plugins.stdout) as Record<string, unknown> | undefined;
			if (!pluginList) rec.record("cli", "fail", "plugin list --json 的输出不是 JSON", plugins.stdout.slice(0, 60));
			else {
				const shape = ["npm", "marketplace"].every(key => Array.isArray(pluginList[key]));
				rec.record("cli", shape ? "ok" : "fail", "plugin list --json 的 npm/marketplace", shape ? "两个都是数组" : Object.keys(pluginList).join("、"));
			}
		}
	}

	// ── 9. profile 變數真的換到目錄 ──────────────────────────────────────
	rec.section("isolation");
	{
		// Two throwaway directories, never the user's profile. omp bootstraps what it is
		// pointed at, so writing the marker in A must leave B on its default.
		const base = await fs.mkdtemp(path.join(os.tmpdir(), "omp-check-profile-"));
		const A = path.join(base, "a");
		const B = path.join(base, "b");
		try {
			await fs.mkdir(A, { recursive: true });
			await fs.mkdir(B, { recursive: true });
			const written = await runCli(rec, "isolation", `在临时 profile 写入标记`, ompConfigSetArgs(CONFIG_KEYS.planDefaultOnStartup, "true"), { agentDir: A });
			const readA = written ? await runCli(rec, "isolation", "读回临时 profile A", ompConfigListArgs(), { agentDir: A }) : undefined;
			const readB = readA ? await runCli(rec, "isolation", "读取空的临时 profile B", ompConfigListArgs(), { agentDir: B }) : undefined;
			if (readA && readB) {
				const inA = (json(readA.stdout) as Record<string, { value?: unknown }> | undefined)?.[CONFIG_KEYS.planDefaultOnStartup]?.value;
				const inB = (json(readB.stdout) as Record<string, { value?: unknown }> | undefined)?.[CONFIG_KEYS.planDefaultOnStartup]?.value;
				if (inA === true && inB !== true) rec.record("isolation", "ok", "profile 变量选定目录", `临时 A 读到 ${inA}，临时 B 读到 ${inB}`);
				else rec.record("isolation", "fail", "profile 变量选定目录", `A=${inA} B=${inB}：变量若改名，隔离测试会写进真实 profile`);
			}
		} catch (error) {
			rec.record("isolation", "fail", "检查本身出错", (error as Error).message);
		} finally {
			await proc?.stop(800);
			await fs.rm(base, { recursive: true, force: true }).catch(() => undefined);
		}
	}

	// ── 結果 ────────────────────────────────────────────────────────────
	return summarizeCheck(rec.items, rec.sections, version, TESTED_OMP);
}

/**
 * 把檢查項目整理成一份結果。
 *
 * 為什麼獨立成一個純函式：計數與「哪一種警告」的判斷是這份報告的骨架，
 * 抽出來才能在不真的起行程的情況下驗證它；`runCompatCheck()` 只負責探測。
 */
export function summarizeCheck(items: CompatCheckItem[], sections: CompatCheckSection[], version: string | null, testedVersion: string): CompatCheckResult {
	const counts = { ok: 0, warn: 0, fail: 0, note: 0 };
	for (const item of items) counts[item.mark]++;
	const warned = items.filter(item => item.mark === "warn");
	// 版本那一條警告是「這個版本沒被驗過」，不是能力缺失；兩者要分開，介面才知道
	// 該提示「換版本」還是「功能會降級」。
	const versionWarning = warned.find(item => item.section === "version") ?? null;
	const capabilityWarnings = warned.filter(item => item.section !== "version");
	// 只有版本號是唯一差異時，才建議換掉已驗證版本；有能力警告就代表還有別的事要處理。
	const suggestedVersion = !counts.fail && !capabilityWarnings.length && version && version !== testedVersion ? version : null;
	return {
		items,
		sections,
		counts,
		passed: counts.ok + counts.note,
		failed: counts.fail,
		warned: warned.length,
		capabilityWarnings,
		versionWarning,
		suggestedVersion,
		version,
		testedVersion,
	};
}
