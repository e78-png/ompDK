/**
 * 從對話紀錄裡找出「最後一段程式碼」與「最後一個連結」。
 *
 * 為什麼要有這一支：上游有 `/copy`（挑一段文字或程式碼複製）與 `/open`（開啟對話裡
 * 最後一個連結），但那兩條是終端 TUI 自己處理的，沒有走 RPC——Web 端收不到。
 * 這個 App 已經把整份對話渲染在手上了，要自己做這兩件事並不難。
 *
 * 純函式：沒有 DOM 依賴，可以直接測。
 */
import type { AgentMessage } from "../../../shared/api.ts";

/** The text of a message, with every text block joined. */
function textOf(message: AgentMessage): string {
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map(block => (typeof block === "string" ? block : ((block as { text?: string })?.text ?? "")))
		.join("");
}

/** The assistant's messages, newest last. */
function assistantTexts(messages: readonly AgentMessage[]): string[] {
	const out: string[] = [];
	for (const message of messages) {
		if ((message as { role?: string }).role !== "assistant") continue;
		const text = textOf(message);
		if (text.trim()) out.push(text);
	}
	return out;
}

/**
 * The last fenced code block in the conversation.
 *
 * 回傳 `undefined` 表示整段對話裡沒有程式碼——那時複製的應該是文字本身。
 */
export function lastCodeBlock(messages: readonly AgentMessage[]): string | undefined {
	for (const text of assistantTexts(messages).reverse()) {
		const fences = [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)];
		const last = fences.at(-1);
		if (last) {
			const body = last[1].replace(/\n$/, "");
			if (body.trim()) return body;
		}
	}
	return undefined;
}

/**
 * The last link in the conversation.
 *
 * 只認 http 與 https：對話裡的其它網址形式（檔案路徑、相對連結）交給瀏覽器
 * 開會是壞事。
 */
export function lastLink(messages: readonly AgentMessage[]): string | undefined {
	for (const text of assistantTexts(messages).reverse()) {
		const links = [...text.matchAll(/\bhttps?:\/\/[^\s<>()"'`]+/g)];
		const last = links.at(-1);
		// 句尾的標點不屬於連結：英文的 `,.;:)` 與中文的 `。，；：！？`
		if (last) return last[0].replace(/[.,;:)\]}]+$/, "").replace(/[。，；：！？、）】」』]+$/, "");
	}
	return undefined;
}

/**
 * What `/copy` should put on the clipboard: the last code block if there is one,
 * otherwise the assistant's last message.
 */
export function copyableText(messages: readonly AgentMessage[]): string | undefined {
	const code = lastCodeBlock(messages);
	if (code) return code;
	const texts = assistantTexts(messages);
	return texts.at(-1)?.trim() || undefined;
}
