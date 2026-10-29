/**
 * `bun run omp:record` — record short real sessions as frames, for the replay test.
 *
 * This is the only step of the decoupling plan that calls a model, and it is deliberately
 * small: two example-model turns, a one-file tool call plus a short answer and a local
 * `/fast status`, then a third long answer interrupted mid-stream. The recordings are what
 * turn the reducer from "compiles against shapes I believe" into "passes against shapes omp
 * actually sent", so they are worth the calls per omp upgrade. Each scenario lands beside
 * the others: `<version>/basic.jsonl` and `<version>/interrupt.jsonl`.
 *
 * It writes no session file (`--no-session`), works in the isolated profile, runs the tool
 * call in a throwaway directory, redacts what that directory and the profile's skill
 * list say about this machine, and refuses to write the fixture if the frames contain
 * anything that looks like a key.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SKILL_EXTENSION_PREFIX } from "../shared/omp/conventions.ts";

const ROOT = path.resolve(import.meta.dir, "..");
// Before anything reads the environment: one call on the isolated profile, never the
// user's default model roles or their real conversations.
process.env.OMP_WEB_AGENT_DIR ??= path.join(ROOT, ".data", "omp-agent");
process.env.OMP_WEB_MODEL_LOCK ??= "example/example-small";

const [{ config }, { OmpProcess }, { ompVersionArgs, runOmp }, { parseVersion }] = await Promise.all([
	import("../server/config.ts"),
	import("../server/omp-process.ts"),
	import("../server/omp/cli.ts"),
	import("../server/omp/compat.ts"),
]);

const TURN_TIMEOUT_MS = 180_000;

/** A neutral working directory in the fixture, spelled like the one the replay test uses. */
const NEUTRAL_CWD = "C:\\replay";

/**
 * Strip what this machine is: the throwaway directory is a real path on a real drive, and omp's
 * command catalog lists every skill installed in the profile. Providers come from the seeded
 * `models.yml`, so they are already the example ones in this copy.
 */
function redact(value: unknown): unknown {
	if (typeof value === "string") return value.split(cwd).join(NEUTRAL_CWD).split(cwd.replace(/\\/g, "/")).join(NEUTRAL_CWD);
	if (Array.isArray(value)) return value.map(redact);
	if (value === null || typeof value !== "object") return value;
	const out: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
		// A published fixture must not publish someone's skill library.
		if (key === "commands" && Array.isArray(item)) {
			out[key] = item.filter(command => !String((command as { name?: unknown })?.name ?? "").startsWith(SKILL_EXTENSION_PREFIX)).map(redact);
			continue;
		}
		out[key] = redact(item);
	}
	return out;
}

const version = parseVersion((await runOmp(ompVersionArgs())).stdout);
if (!version) throw new Error("读不出 omp 版本，录制中止");

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "omp-record-"));
const frames: Record<string, unknown>[] = [];
let exited: string | undefined;

const proc = new OmpProcess({
	cwd,
	ephemeral: true,
	onFrame: frame => frames.push(frame as unknown as Record<string, unknown>),
	onExit: (code, stderr) => {
		exited = `omp 提前退出（${code}）：${stderr.slice(-200)}`;
	},
});

/** Wait for a frame of a given type, so a slow model does not turn into a silent gap. */
async function waitFor(type: string, timeoutMs: number, after = 0): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (exited) throw new Error(exited);
		if (frames.slice(after).some(frame => frame.type === type)) return;
		await Bun.sleep(80);
	}
	throw new Error(`等 ${type} 超时（${timeoutMs / 1000}s）`);
}

/** Ask omp something and return the number of frames pushed by that point. */
async function ask(message: string): Promise<number> {
	const from = frames.length;
	await proc.request({ type: "prompt", message }, TURN_TIMEOUT_MS);
	return from;
}

await proc.ready;
console.log(`omp ${version}，profile ${config.agentDir}`);
console.log("錄製：一次工具呼叫 + 簡短回答…");
let mark = await ask(`在 ${cwd} 里创建文件 notes.txt，内容只写 hello 一行。做完只回复两个字：完成`);
await waitFor("agent_end", TURN_TIMEOUT_MS, mark);

console.log("錄製：/fast status…");
mark = await ask("/fast status");
await waitFor("command_output", 30_000, mark);
// The first scenario is the tool call, its answer and the local command; the interrupt
// recording starts from here.
const finishBasic = frames.length;

console.log("錄製：打斷一個正在進行的回答…");
mark = await ask("把「今天天气不错」扩写成 800 字，慢慢写，写完再停。");
await waitFor("turn_start", 60_000, mark);
// Long enough that the model is mid-answer and the abort lands on a stream in progress.
await Bun.sleep(2500);
await proc.request({ type: "abort" });
await waitFor("agent_end", TURN_TIMEOUT_MS, mark);

await proc.stop(1500);
if (exited) console.log(`（${exited}）`);

// The browser's mirror: only the frames the hub forwards, redacted, keyed by scenario.
const recordings: { name: string; frames: Record<string, unknown>[] }[] = [
	{ name: "basic", frames: frames.slice(0, finishBasic) },
	{ name: "interrupt", frames: frames.slice(finishBasic) },
];

for (const recording of recordings) {
	const payload = recording.frames.filter(frame => frame.type !== "ready").map(frame => redact(frame) as Record<string, unknown>);
	const meta = { record: recording.name, omp: version, capabilities: proc.capabilities, frames: payload.length, recordedAt: new Date().toISOString().slice(0, 10) };
	const text = [meta, ...payload].map(value => JSON.stringify(value)).join("\n") + "\n";
	const leak = /(EXAMPLE_API_KEY|sk-[A-Za-z0-9]{8,}|apiKey["']?\s*[:=]\s*["'][^"']{6,})/.exec(text);
	if (leak) {
		fs.rmSync(cwd, { recursive: true, force: true });
		throw new Error(`帧里出现了疑似密钥片段「${leak[0].slice(0, 12)}…」，不写入文件`);
	}
	const dir = path.join(ROOT, "tests", "fixtures", "omp-frames", version);
	fs.mkdirSync(dir, { recursive: true });
	const file = path.join(dir, `${recording.name}.jsonl`);
	fs.writeFileSync(file, text);

	const kinds: Record<string, number> = {};
	for (const frame of payload) kinds[String(frame.type)] = (kinds[String(frame.type)] ?? 0) + 1;
	console.log(`寫入 ${path.relative(ROOT, file)}：${payload.length} 幀`);
	console.log(Object.entries(kinds)
		.sort((a, b) => b[1] - a[1])
		.map(([kind, count]) => `  ${kind} ×${count}`)
		.join("\n"));
}
fs.rmSync(cwd, { recursive: true, force: true });
