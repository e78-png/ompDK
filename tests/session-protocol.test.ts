/**
 * 閘道器的 WebSocket 協定：attach → snapshot → 往回取一頁 → 增量。
 *
 * 為什麼要有這個測試：前面那些測試各自覆蓋一格（session 的視窗、store 的處理、
 * 唯讀模式的增量），但**路由本身**（`server/main.ts` 收到 `history_page` 會不會
 * 真的回一頁）沒有被任何測試碰到。這裡把真的閘道器起重來，用真的 WebSocket
 * 走一遍。
 *
 * 走唯讀模式：唯讀不需要起 omp 子行程，測試快而且不會碰到使用者的設定檔。
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ServerMsg } from "../shared/api.ts";
import { removeTempDir } from "./fixtures/cleanup.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), `omp-protocol-${process.pid}-`));
const sessions = path.join(dir, "sessions");
// 會話檔要放在 sessions/<專案>/ 底下：索引是掃子目錄的，不是掃 sessions 本身。
const project = path.join(sessions, "testproject");
const file = path.join(project, "a.jsonl");
const port = 30200 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}`;

/** 一則訊息，串在前一則後面——session 檔就是一條這樣的鏈。 */
function message(text: string, ts: number, parent: string): string {
	return JSON.stringify({ type: "message", id: `m${ts}`, parentId: parent, timestamp: ts, message: { role: "user", content: [{ type: "text", text }], timestamp: ts } });
}

let child: ReturnType<typeof spawn> | undefined;

beforeAll(async () => {
	fs.mkdirSync(project, { recursive: true });
	fs.writeFileSync(file, `${JSON.stringify({ type: "session", id: "s1" })}\n${JSON.stringify({ type: "model_change", id: "r1", parentId: null, model: "x/y" })}\n${message("第一則", 1000, "r1")}\n${message("第二則", 2000, "m1000")}\n`);
	child = spawn(process.execPath, ["run", path.resolve(import.meta.dir, "../server/main.ts")], {
		cwd: path.resolve(import.meta.dir, ".."),
		windowsHide: true,
		env: {
			...process.env,
			OMP_WEB_AGENT_DIR: dir,
			OMP_WEB_DATA_DIR: path.join(dir, "data"),
			OMP_WEB_PORT: String(port),
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	child.stdout?.on("data", () => undefined);
	child.stderr?.on("data", () => undefined);
	for (let i = 0; i < 120; i++) {
		await Bun.sleep(250);
		const ok = await fetch(`${base}/api/health`).then(r => r.ok).catch(() => false);
		if (ok) return;
	}
	throw new Error("the gateway did not come up");
});

afterAll(() => {
	child?.kill();
	removeTempDir(dir);
});

/** Open a socket and collect what the gateway says. */
async function connect(): Promise<{ ws: WebSocket; frames: ServerMsg[]; waitFor: (type: string, timeoutMs?: number) => Promise<ServerMsg> }> {
	const ws = new WebSocket(`${base.replace("http", "ws")}/ws?lang=zh`);
	await new Promise<void>((resolve, reject) => {
		ws.onopen = () => resolve();
		ws.onerror = () => reject(new Error("socket failed"));
	});
	const frames: ServerMsg[] = [];
	const waiters: { type: string; resolve: (m: ServerMsg) => void }[] = [];
	ws.onmessage = ev => {
		const msg = JSON.parse(String(ev.data)) as ServerMsg;
		frames.push(msg);
		for (let i = waiters.length - 1; i >= 0; i--) {
			if (waiters[i].type === msg.t) waiters.splice(i, 1)[0].resolve(msg);
		}
	};
	const waitFor = (type: string, timeoutMs = 15000) =>
		new Promise<ServerMsg>((resolve, reject) => {
			const seen = frames.find(f => f.t === type);
			if (seen) return resolve(seen);
			const timer = setTimeout(() => reject(new Error(`no ${type} within ${timeoutMs}ms`)), timeoutMs);
			waiters.push({
				type,
				resolve: m => {
					clearTimeout(timer);
					resolve(m);
				},
			});
		});
	return { ws, frames, waitFor };
}

describe("閘道器的 WebSocket 協定", () => {
	test("掛上唯讀會話：收到 snapshot，帶著歷史視窗的起點", async () => {
		const { ws, waitFor } = await connect();
		ws.send(JSON.stringify({ t: "attach", key: file, observe: true }));
		const snap = await waitFor("snapshot");
		expect(snap.t).toBe("snapshot");
		if (snap.t !== "snapshot") throw new Error("expected a snapshot");
		expect(snap.messages.length).toBe(2);
		expect(snap.history).toEqual({ offset: 0, total: 2 });
		ws.close();
	});

	test("往回取一頁：伺服器真的回一頁，offset 往前退", async () => {
		const { ws, waitFor } = await connect();
		ws.send(JSON.stringify({ t: "attach", key: file, observe: true }));
		await waitFor("snapshot");
		ws.send(JSON.stringify({ t: "history_page", key: file, before: 2, limit: 1 }));
		const page = await waitFor("history_page");
		expect(page.t).toBe("history_page");
		if (page.t !== "history_page") throw new Error("expected a page");
		expect(page.messages.length).toBe(1);
		expect(page.offset).toBe(1);
		expect(page.total).toBe(2);
		ws.close();
	});

	test("往回取到最前面：沒有更早的了", async () => {
		const { ws, waitFor } = await connect();
		ws.send(JSON.stringify({ t: "attach", key: file, observe: true }));
		await waitFor("snapshot");
		ws.send(JSON.stringify({ t: "history_page", key: file, before: 0, limit: 10 }));
		const page = await waitFor("history_page");
		if (page.t !== "history_page") throw new Error("expected a page");
		expect(page.messages.length).toBe(0);
		expect(page.offset).toBe(0);
		ws.close();
	});
});
