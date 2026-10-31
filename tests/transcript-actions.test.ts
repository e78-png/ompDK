/**
 * `/copy` 與 `/open` 要從對話裡挑出東西：程式碼、連結。
 *
 * 為什麼要有這個測試：上游那兩條指令是終端 TUI 自己的動作，Web 端收不到，這個
 * App 自己做。挑錯了——複製到空的、挑到使用者自己的訊息而不是助理的、開了一個
 * 對話裡隨便出現的字串——使用者按下去只會覺得「這功能壞了」。
 */
import { describe, expect, test } from "bun:test";
import type { AgentMessage } from "../shared/api.ts";
import { copyableText, lastCodeBlock, lastLink } from "../web/src/lib/transcript-actions.ts";

function assistant(text: string): AgentMessage {
	return { role: "assistant", content: [{ type: "text", text }], timestamp: 1 } as AgentMessage;
}

function user(text: string): AgentMessage {
	return { role: "user", content: [{ type: "text", text }], timestamp: 1 } as AgentMessage;
}

describe("複製對話裡的內容", () => {
	test("最後一段程式碼", () => {
		const messages = [assistant("先看看這個\n```ts\nconst a = 1;\n```"), assistant("再改一下\n```ts\nconst b = 2;\n```")];
		expect(lastCodeBlock(messages)).toBe("const b = 2;");
	});

	test("沒有程式碼就複製最後一段回覆", () => {
		const messages = [assistant("沒有程式碼，就是一句話。")];
		expect(lastCodeBlock(messages)).toBeUndefined();
		expect(copyableText(messages)).toBe("沒有程式碼，就是一句話。");
	});

	test("使用者自己的訊息不算", () => {
		const messages = [assistant("助理的回覆"), user("我剛剛貼的一段 ```code```")];
		expect(copyableText(messages)).toBe("助理的回覆");
	});

	test("對話是空的時候沒有東西可複製", () => {
		expect(copyableText([])).toBeUndefined();
		expect(copyableText([user("只有我說話")])).toBeUndefined();
	});

	test("空白的程式碼不算", () => {
		expect(lastCodeBlock([assistant("```\n\n```")])).toBeUndefined();
	});
});

describe("開啟對話裡的連結", () => {
	test("最後一個連結", () => {
		const messages = [assistant("看這裡 https://example.com/a"), assistant("還有這個 https://example.com/b")];
		expect(lastLink(messages)).toBe("https://example.com/b");
	});

	test("句尾的標點不算進連結", () => {
		expect(lastLink([assistant("請看 https://example.com/a。")])).toBe("https://example.com/a");
	});

	test("不是 http 的不開", () => {
		expect(lastLink([assistant("檔案在 C:\\Users\\e7896\\notes.txt")])).toBeUndefined();
	});

	test("沒有連結就是沒有", () => {
		expect(lastLink([assistant("沒有連結")])).toBeUndefined();
	});
});
