/**
 * 唯讀模式的增量傳送。
 *
 * 為什麼要有這個測試：唯讀模式每 1.5 秒看一次 session 檔。CLI 每寫一行，檔案就
 * 變了——以前會把整份視窗（300 則、775 KB）重送一次，前端每次都重畫一次。使用者
 * 看到的就是「顯示一直卡、畫面一直在動」。現在只送新增加的那幾則。
 *
 * 這個測試真的會等那 1.5 秒：輪詢是這個模式的行為本身，沒有事件可以替代它。
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ServerMsg } from "../shared/api.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), `omp-observed-${process.pid}-`));
const file = path.join(dir, "s.jsonl");

/** 一則訊息，串在前一則的後面——session 檔就是一條這樣的鏈。 */
function message(text: string, ts: number, parent: string): string {
	return JSON.stringify({ type: "message", id: `m${ts}`, parentId: parent, timestamp: ts, message: { role: "user", content: [{ type: "text", text }], timestamp: ts } });
}

let ObservedSessionClass: typeof import("../server/observed-session.ts")["ObservedSession"];

beforeAll(async () => {
	fs.writeFileSync(file, `${JSON.stringify({ type: "session", id: "s1" })}\n${JSON.stringify({ type: "model_change", id: "r1", parentId: null, model: "x/y" })}\n${message("第一則", 1000, "r1")}\n`);
	({ ObservedSession: ObservedSessionClass } = await import("../server/observed-session.ts"));
});

afterAll(() => {
	fs.rmSync(dir, { recursive: true, force: true });
});

describe("唯讀模式的增量", () => {
	test("檔案長大時只送新增加的那幾則", async () => {
		const sent: { msg: ServerMsg; bytes: number }[] = [];
		const socket = {
			send: (text: string) => {
				sent.push({ msg: JSON.parse(text) as ServerMsg, bytes: text.length });
				return text.length;
			},
		} as never;
		const session = new ObservedSessionClass(file, dir, undefined, () => undefined);
		await session.attach(socket);
		expect(sent.at(-1)?.msg.t).toBe("snapshot");

		fs.appendFileSync(file, `${message("第二則", 2000, "m1000")}\n`);
		// The poll runs every 1.5 s; the delta lands on the next one.
		await new Promise(resolve => setTimeout(resolve, 2200));

		const last = sent.at(-1);
		expect(last?.msg.t).toBe("history_append");
		if (last?.msg.t !== "history_append") throw new Error("expected an append");
		expect(last.msg.messages.length).toBe(1);
		expect((last.msg.messages[0] as { content?: { text?: string }[] }).content?.[0]?.text).toBe("第二則");
		// The delta is one message, not the whole window again.
		expect(last.bytes).toBeLessThan(sent[0].bytes * 2);
		session.close();
	});

	test("沒有變動時什麼都不送", async () => {
		const sent: ServerMsg[] = [];
		const socket = { send: (text: string) => { sent.push(JSON.parse(text) as ServerMsg); return text.length; } } as never;
		const session = new ObservedSessionClass(file, dir, undefined, () => undefined);
		await session.attach(socket);
		const after = sent.length;
		await new Promise(resolve => setTimeout(resolve, 2200));
		expect(sent.length).toBe(after);
		session.close();
	});
});
