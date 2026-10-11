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
 * required is missing, `·` information. Any `✗` exits 1. When every line is `✓` or `⚠`
 * and the only complaint is the version, move `TESTED_OMP` in `server/omp/compat.ts`.
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { OmpCapabilities } from "../shared/api.ts";
import type { OmpRun } from "../server/omp/cli.ts";

// Decide the profile before anything reads the environment: without this the check would
// probe the user's real `~/.omp/agent` whenever the gateway was not started with one.
const ROOT = path.resolve(import.meta.dir, "..");
if (!process.env.OMP_WEB_AGENT_DIR) process.env.OMP_WEB_AGENT_DIR = path.join(ROOT, ".data", "omp-agent");

const [{ config }, { OmpProcess }, cli, { MIN_PROTOCOL, TESTED_OMP, parseVersion }, { readSessionHead }, { CONFIG_KEYS }] = await Promise.all([
	import("../server/config.ts"),
	import("../server/omp-process.ts"),
	import("../server/omp/cli.ts"),
	import("../server/omp/compat.ts"),
	import("../server/omp/session-file.ts"),
	import("../shared/omp/conventions.ts"),
]);

type Mark = "ok" | "warn" | "fail" | "note";
const SYMBOL: Record<Mark, string> = { ok: "✓", warn: "⚠", fail: "✗", note: "·" };
const rows: { section: string; mark: Mark; what: string; why: string }[] = [];

function record(section: string, mark: Mark, what: string, why = ""): void {
	rows.push({ section, mark, what, why });
	console.log(`${SYMBOL[mark]} ${what}${why ? `  — ${why}` : ""}`);
}

/** The frames the probe process pushed, so a check can read what arrived out of band. */
const pushed: Record<string, unknown>[] = [];

function findPushed(type: string): Record<string, unknown> | undefined {
	return pushed.find(frame => frame.type === type);
}

async function waitForPush(type: string, timeoutMs: number): Promise<Record<string, unknown> | undefined> {
	const seen = findPushed(type);
	if (seen) return seen;
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		await Bun.sleep(50);
		const frame = findPushed(type);
		if (frame) return frame;
	}
	return undefined;
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
 * One CLI run, reported rather than thrown. A binary that cannot be started, or a command
 * that exits non-zero, is a `✗` in this report and nothing more: the point of the check is
 * to enumerate every difference, not to stop at the first one.
 */
async function run(section: string, what: string, args: string[], options: { cwd?: string; agentDir?: string } = {}): Promise<OmpRun | undefined> {
	try {
		const result = options.agentDir ? await cli.runOmpIn(options.agentDir, args) : await cli.runOmp(args, options.cwd);
		if (result.code !== 0) {
			record(section, "fail", what, tail(result.stderr) || `exit ${result.code}`);
			return undefined;
		}
		return result;
	} catch (error) {
		record(section, "fail", what, (error as Error).message);
		return undefined;
	}
}

// ── 1. version ───────────────────────────────────────────────────────────────────────
console.log(`\n[检查目标]`);
record("检查目标", "note", cli.ompBinaryName(), `profile：${config.agentDir ?? "omp 的默认目录"}`);
console.log(`\n[版本]`);
let version: string | null = null;
{
	try {
		const run = await cli.runOmp(cli.ompVersionArgs());
		version = parseVersion(run.stdout) ?? null;
		if (!version) record("版本", "fail", "omp --version 没有输出版本号", run.stdout.slice(0, 60) || tail(run.stderr));
		else if (version === TESTED_OMP) record("版本", "ok", `${version}`, "本应用验证过的版本");
		else record("版本", "warn", `${version}`, `本应用验证过的是 ${TESTED_OMP}；跑完这份检查其余项都过了就可以改它`);
	} catch (error) {
		record("版本", "fail", `无法执行 ${cli.ompBinaryName()}`, (error as Error).message);
	}
}

// ── 2. a process starts and handshakes ───────────────────────────────────────────────
console.log(`\n[进程与握手]`);
let proc: InstanceType<typeof OmpProcess> | undefined;
try {
	proc = new OmpProcess({
		cwd: ROOT,
		ephemeral: true,
		onFrame: frame => pushed.push(frame as unknown as Record<string, unknown>),
		onExit: () => undefined,
	});
	await Promise.race([
		proc.ready,
		Bun.sleep(20_000).then(() => {
			throw new Error("20s 内没有就绪");
		}),
	]);
	record("进程与握手", "ok", "临时进程就绪", "--no-session：不写会话文件");
} catch (error) {
	record("进程与握手", "fail", "临时进程未能就绪", (error as Error).message);
	proc = undefined;
}

const abilities: OmpCapabilities | undefined = proc?.capabilities;
if (abilities) {
	record("进程与握手", abilities.protocol >= MIN_PROTOCOL ? (abilities.protocol === 2 ? "ok" : "warn") : "fail", `协议版本 ${abilities.protocol}`, abilities.protocol === 2 ? "v2 分帧可用" : "没有协商到 v2，大消息按整帧处理");
	for (const [flag, what, fallback] of [
		["deltaUpdates", "增量更新", "整段消息替换，仍能显示"],
		["askDialog", "ask 对话卡片", "退成逐题的选择＋输入"],
		["subagentProgress", "子代理订阅", "隐藏子代理页签与线程里的徽标"],
	] as const) {
		const on = abilities[flag];
		record("进程与握手", on ? "ok" : "warn", what, on ? "已协商" : `不支持：${fallback}`);
	}
}

// ── 3. the state fields the UI reads ─────────────────────────────────────────────────
console.log(`\n[get_state]`);
const REQUIRED_STATE = ["model", "thinkingLevel", "isStreaming", "isCompacting", "messageCount", "contextUsage", "queuedMessages", "todoPhases"];
const OPTIONAL_STATE = ["sessionFile", "sessionName"];
if (proc) {
	const res = await proc.request({ type: "get_state" }, 15_000);
	const data = (res.success ? res.data : undefined) as Record<string, unknown> | undefined;
	if (!data) record("get_state", "fail", "没有返回状态", String(res.error ?? ""));
	else {
		const missing = REQUIRED_STATE.filter(key => data[key] === undefined);
		record("get_state", missing.length ? "fail" : "ok", `${REQUIRED_STATE.length} 个必需字段`, missing.length ? `缺少 ${missing.join("、")}` : "全部读到");
		const model = data.model as { provider?: string; id?: string } | undefined;
		record("get_state", model?.provider && model?.id ? "ok" : "fail", "model.provider / model.id", model?.provider && model?.id ? `${model.provider}/${model.id}` : "读不出供应商或模型 id");
		const usage = data.contextUsage as { tokens?: number; contextWindow?: number; percent?: number } | undefined;
		record("get_state", usage && usage.contextWindow ? "ok" : "warn", "contextUsage 的形状", usage ? `tokens ${usage.tokens} / ${usage.contextWindow}（${usage.percent}%）` : "没有上下文用量，信息页会显示「暂无数据」");
		const absent = OPTIONAL_STATE.filter(key => data[key] === undefined);
		if (absent.length) record("get_state", "note", `${absent.join("、")} 未出现`, "临时进程按定义还没有会话文件与名字，不是问题");
	}
} else record("get_state", "fail", "跳过", "没有可用的进程");

// ── 4. the slash-command catalog ─────────────────────────────────────────────────────
console.log(`\n[命令列表]`);
if (proc) {
	const res = await proc.request({ type: "get_available_commands" }, 15_000);
	const data = res.data as unknown;
	// omp answers this one with the array itself, and also pushes the update frame.
	const list = (Array.isArray(data) ? data : (data as { commands?: unknown[] } | undefined)?.commands) as { name?: string; source?: string; input?: unknown; subcommands?: unknown[] }[] | undefined;
	if (!list?.length) record("命令列表", "fail", "没有解析出命令", String(res.error ?? "空列表"));
	else {
		const named = list.filter(c => typeof c?.name === "string" && c.name);
		record("命令列表", named.length === list.length ? "ok" : "fail", `${list.length} 条命令`, named.length === list.length ? "每条都有 name" : `有 ${list.length - named.length} 条缺 name，菜单会丢行`);
		const withSource = list.filter(c => typeof c?.source === "string" && c.source).length;
		record("命令列表", withSource ? "ok" : "warn", "source 字段", `${withSource}/${list.length} 条标注了来源，分组与图标依赖它`);
		const withInput = list.filter(c => c?.input && typeof c.input === "object").length;
		const withSubs = list.filter(c => Array.isArray(c?.subcommands) && c.subcommands!.length > 0).length;
		record("命令列表", withInput || withSubs ? "ok" : "warn", "input / subcommands", `${withInput} 条带参数提示、${withSubs} 条带子命令`);
	}
	const frame = findPushed("available_commands_update");
	if (frame) record("命令列表", "ok", "available_commands_update 推送", "会话开启时主动推送，主界面才能补全 `/`");
	else record("命令列表", "warn", "没有收到 available_commands_update 推送", "主界面只能等 get_available_commands");
} else record("命令列表", "fail", "跳过", "没有可用的进程");

// ── 5. a local slash command still answers ───────────────────────────────────────────
console.log(`\n[命令输出]`);
if (proc) {
	// `/fast status` is answered by omp itself without a model call, which is what makes
	// it usable here: it exercises the whole command path for free.
	const res = await proc.request({ type: "prompt", message: "/fast status" }, 30_000);
	const data = res.data as { agentInvoked?: boolean } | undefined;
	if (!res.success) record("命令输出", "fail", "prompt /fast status 失败", String(res.error ?? ""));
	else record("命令输出", data && data.agentInvoked === false ? "ok" : "warn", "应答里的 agentInvoked", data ? `agentInvoked=${data.agentInvoked}` : "应答没有 data，本地命令应当返回 {agentInvoked:false}");
	const out = await waitForPush("command_output", 5_000);
	const text = (out as { text?: unknown } | undefined)?.text;
	if (typeof text === "string" && text.trim()) record("命令输出", "ok", "command_output 帧", text.trim().split("\n")[0].slice(0, 70));
	else record("命令输出", "fail", "没有收到 command_output 帧", "命令的答案进不了会话镜像，线程里会只剩一条空记录");
} else record("命令输出", "fail", "跳过", "没有可用的进程");

// ── 6. the session file format ───────────────────────────────────────────────────────
console.log(`\n[会话文件]`);
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
		record("会话文件", "warn", "跳过", `${config.sessionsRoot} 读不到，里面大概还没有会话`);
	}
	if (newest) {
		const head = await readSessionHead(newest.file);
		if (!head) record("会话文件", "fail", "头部解析失败", path.basename(newest.file));
		else {
			record("会话文件", "ok", "session 头", `id ${head.header.id.slice(0, 8)}…，cwd ${head.header.cwd ?? "（无）"}`);
			record("会话文件", head.title.trim() || head.firstUser ? "ok" : "warn", "标题槽或首个用户消息", head.title.trim() ? `「${head.title.trim()}」` : "只有首个用户消息可当标题");
			record("会话文件", "note", "目录名由 cwd 编码而来", path.basename(path.dirname(newest.file)));
		}
	}
}

// ── 7. the CLI subcommands ───────────────────────────────────────────────────────────
console.log(`\n[命令行子命令]`);
{
	const list = await run("命令行子命令", "config list --json", cli.ompConfigListArgs());
	if (list) {
		const all = json(list.stdout) as Record<string, { type?: string; value?: unknown }> | undefined;
		if (!all) record("命令行子命令", "fail", "config list --json 的输出不是 JSON", list.stdout.slice(0, 60));
		else {
			record("命令行子命令", Object.keys(all).length ? "ok" : "fail", `config list：${Object.keys(all).length} 个键`, "界面只读下面四个");
			for (const key of [CONFIG_KEYS.modelRoles, CONFIG_KEYS.agentModelOverrides, CONFIG_KEYS.planDefaultOnStartup, CONFIG_KEYS.disabledExtensions]) {
				const entry = all[key];
				// `value` is absent on keys omp has no default for, which is not a failure.
				record("命令行子命令", entry ? "ok" : "fail", `配置键 ${key}`, entry ? `type=${entry.type}${entry.value === undefined ? "（无默认值）" : ""}` : "omp 不再报告这个键，设置页会读不到");
			}
		}
	}

	const models = await run("命令行子命令", "models --json", cli.ompModelsArgs());
	if (models) {
		const modelList = json(models.stdout) as { models?: { provider?: string; id?: string }[] } | undefined;
		if (!modelList?.models?.length) record("命令行子命令", "fail", "models --json 没有返回模型", models.stdout.slice(0, 60));
		else {
			const bad = modelList.models.filter(m => !m.provider || !m.id);
			record("命令行子命令", bad.length ? "warn" : "ok", `models --json：${modelList.models.length} 个模型`, bad.length ? `${bad.length} 个缺 provider/id` : "每个都有 provider/id");
		}
	}

	const skills = await run("命令行子命令", "skill list --json", cli.ompSkillListArgs(), { cwd: ROOT });
	if (skills) {
		const skillList = json(skills.stdout) as { skills?: { name?: string }[] } | undefined;
		if (!skillList) record("命令行子命令", "fail", "skill list --json 的输出不是 JSON", skills.stdout.slice(0, 60));
		else
			record(
				"命令行子命令",
				skillList.skills?.length ? "ok" : "warn",
				`skill list --json：${skillList.skills?.length ?? 0} 个技能`,
				skillList.skills?.every(s => s.name) ? "每条都有 name" : "有技能缺 name，列表会串行",
			);
	}

	const plugins = await run("命令行子命令", "plugin list --json", cli.ompPluginListArgs());
	if (plugins) {
		const pluginList = json(plugins.stdout) as Record<string, unknown> | undefined;
		if (!pluginList) record("命令行子命令", "fail", "plugin list --json 的输出不是 JSON", plugins.stdout.slice(0, 60));
		else {
			const shape = ["npm", "marketplace"].every(key => Array.isArray(pluginList[key]));
			record("命令行子命令", shape ? "ok" : "fail", "plugin list --json 的 npm/marketplace", shape ? "两个都是数组" : Object.keys(pluginList).join("、"));
		}
	}
}

// ── 8. the profile variable really selects the profile ───────────────────────────────
console.log(`\n[环境变量隔离]`);
{
	// Two throwaway directories, never the user's profile. omp bootstraps what it is
	// pointed at, so writing the marker in A must leave B on its default.
	const base = await fs.mkdtemp(path.join(os.tmpdir(), "omp-check-profile-"));
	const A = path.join(base, "a");
	const B = path.join(base, "b");
	try {
		await fs.mkdir(A, { recursive: true });
		await fs.mkdir(B, { recursive: true });
		const written = await run("环境变量隔离", `在临时 profile 写入标记`, cli.ompConfigSetArgs(CONFIG_KEYS.planDefaultOnStartup, "true"), { agentDir: A });
		const readA = written ? await run("环境变量隔离", "读回临时 profile A", cli.ompConfigListArgs(), { agentDir: A }) : undefined;
		const readB = readA ? await run("环境变量隔离", "读取空的临时 profile B", cli.ompConfigListArgs(), { agentDir: B }) : undefined;
		if (readA && readB) {
			const inA = (json(readA.stdout) as Record<string, { value?: unknown }> | undefined)?.[CONFIG_KEYS.planDefaultOnStartup]?.value;
			const inB = (json(readB.stdout) as Record<string, { value?: unknown }> | undefined)?.[CONFIG_KEYS.planDefaultOnStartup]?.value;
			if (inA === true && inB !== true) record("环境变量隔离", "ok", "profile 变量选定目录", `临时 A 读到 ${inA}，临时 B 读到 ${inB}`);
			else record("环境变量隔离", "fail", "profile 变量选定目录", `A=${inA} B=${inB}：变量若改名，隔离测试会写进真实 profile`);
		}
	} catch (error) {
		record("环境变量隔离", "fail", "检查本身出错", (error as Error).message);
	} finally {
		await proc?.stop(800);
		await fs.rm(base, { recursive: true, force: true }).catch(() => undefined);
	}
}

// ── summary ──────────────────────────────────────────────────────────────────────────
const failed = rows.filter(row => row.mark === "fail");
const warned = rows.filter(row => row.mark === "warn");
console.log(`\n${rows.length - failed.length - warned.length}/${rows.length} 项通过，${warned.length} 项警告，${failed.length} 项失败。`);
if (failed.length) {
	console.log(`失败项（只需改 server/omp/ 与 shared/omp/）：`);
	for (const row of failed) console.log(`  ✗ ${row.what}：${row.why}`);
} else if (warned.length) console.log(`没有失败项；${warned.length} 项警告由前端按能力自行降级。`);
else if (version === TESTED_OMP) console.log(`全部通过，版本正是 TESTED_OMP，无需改动。`);
else console.log(`全部通过：可以把 server/omp/compat.ts 里的 TESTED_OMP 改成 ${version} 并提交。`);
process.exit(failed.length ? 1 : 0);
