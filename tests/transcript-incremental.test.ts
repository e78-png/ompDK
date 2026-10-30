/**
 * 讀取 session 檔的增量路徑。
 *
 * 為什麼要有這個測試：CLI 每寫一行，檔案就變大。整份重新解析是 50 ms 的
 * JSON.parse（20 MB 的檔案有 9,677 筆），而唯讀模式每 1.5 秒就要讀一次。
 * 改成只解析新增的那一段之後，增量路徑就變成「前面那段必須一模一樣」——
 * 這個測試盯的就是那件事：前面被改掉時不能把舊的留著。
 */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TranscriptReader } from "../server/omp/transcript.ts";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), `omp-transcript-${process.pid}-`));
const file = path.join(dir, "s.jsonl");

/** 一則訊息，串在前一則後面——session 檔就是一條這樣的鏈。 */
function message(text: string, ts: number, parent: string): string {
	return JSON.stringify({ type: "message", id: `m${ts}`, parentId: parent, timestamp: ts, message: { role: "user", content: [{ type: "text", text }], timestamp: ts } });
}

function head(): string {
	return JSON.stringify({ type: "model_change", id: "r1", parentId: null, model: "x/y" });
}

beforeEach(() => {
	fs.writeFileSync(file, `${head()}\n${message("第一則", 1000, "r1")}\n`);
});

afterEach(() => {
	fs.rmSync(file, { force: true });
});

afterAll(() => {
	fs.rmSync(dir, { recursive: true, force: true });
});

describe("session 檔的增量讀取", () => {
	test("檔案長大時新的一則進來了，舊的一則還在", async () => {
		const reader = new TranscriptReader();
		const first = await reader.read(file);
		expect(first.messages.length).toBe(1);

		fs.appendFileSync(file, `${message("第二則", 2000, "m1000")}\n`);
		const second = await reader.read(file);
		expect(second.messages.length).toBe(2);
		const texts = second.messages.map(m => (m.content as { text?: string }[])[0]?.text);
		expect(texts).toEqual(["第一則", "第二則"]);
	});

	test("檔案被整份改寫時不能留著舊的內容", async () => {
		const reader = new TranscriptReader();
		await reader.read(file);
		// 換成另一條鏈：前面的記錄不同了。
		fs.writeFileSync(file, `${JSON.stringify({ type: "model_change", id: "r9", parentId: null, model: "x/y" })}\n${message("別的會話", 9000, "r9")}\n`);
		const second = await reader.read(file);
		expect(second.messages.length).toBe(1);
		expect((second.messages[0].content as { text?: string }[])[0]?.text).toBe("別的會話");
	});

	test("檔案縮短時要重新讀", async () => {
		const reader = new TranscriptReader();
		await reader.read(file);
		fs.appendFileSync(file, `${message("第二則", 2000, "m1000")}\n`);
		await reader.read(file);
		fs.writeFileSync(file, `${head()}\n`);
		const third = await reader.read(file);
		expect(third.messages.length).toBe(0);
	});
});
