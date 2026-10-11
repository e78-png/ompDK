/**
 * The reducer's two streaming shapes.
 *
 * `set_event_filter` either took or it did not, and the difference is visible in one
 * frame: with the filter a `message_update` carries an `assistantMessageEvent` to append,
 * without it omp resends the whole message. Both must end in the same draft, or a session
 * on an older build renders nothing until its turn finishes.
 */
import { describe, expect, test } from "bun:test";
import type { OmpCapabilities, RpcServerFrame, ServerMsg, SessionState } from "../shared/api.ts";
import { SessionStore } from "../web/src/lib/session-store.ts";

// Frame notifications are batched onto animation frames, which this runtime has no notion of.
const globals = globalThis as unknown as { requestAnimationFrame?: (cb: () => void) => number; cancelAnimationFrame?: (id: number) => void };
globals.requestAnimationFrame = cb => setTimeout(cb, 0) as unknown as number;
globals.cancelAnimationFrame = id => clearTimeout(id as unknown as ReturnType<typeof setTimeout>);

const state: SessionState = { isStreaming: false, isCompacting: false, messageCount: 0, cwd: "C:\\tmp" };

const NO_FILTER: OmpCapabilities = { protocol: 2, deltaUpdates: false, askDialog: true, subagentProgress: true, messagesPage: true };

function open(capabilities?: OmpCapabilities): SessionStore {
	const store = new SessionStore("s");
	const snapshot: ServerMsg = { t: "snapshot", key: "s", state, messages: [], inflight: [], pendingUi: [], commands: [], subagents: [], capabilities };
	store.handle(snapshot);
	return store;
}

function feed(store: SessionStore, frame: Record<string, unknown>): void {
	store.handle({ t: "frame", key: "s", frame: frame as unknown as RpcServerFrame });
}

const start = { type: "message_start", messageId: "m1", message: { role: "assistant", content: [] } };
const textOfDraft = (store: SessionStore): string => String((store.drafts.get("m1")?.content[0] as { text?: string } | undefined)?.text ?? "");

describe("message_update 的两种形态", () => {
	test("默认按增量拼接：没有能力表也当作支持 delta", () => {
		const store = open();
		expect(store.capabilities).toBeUndefined();
		feed(store, start);
		feed(store, { type: "message_update", messageId: "m1", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "你好" } });
		feed(store, { type: "message_update", messageId: "m1", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "，世界" } });
		expect(textOfDraft(store)).toBe("你好，世界");
	});

	test("协商失败时整段替换：两次更新只留最后一段", () => {
		const store = open(NO_FILTER);
		feed(store, start);
		feed(store, { type: "message_update", messageId: "m1", message: { role: "assistant", content: [{ type: "text", text: "第一段" }] } });
		expect(textOfDraft(store)).toBe("第一段");
		feed(store, { type: "message_update", messageId: "m1", message: { role: "assistant", content: [{ type: "text", text: "第一段 第二段" }] } });
		expect(store.drafts.get("m1")?.content.length).toBe(1);
		expect(textOfDraft(store)).toBe("第一段 第二段");
	});

	test("整段模式下增量帧不再拼接，也不会凭空造出草稿", () => {
		const store = open(NO_FILTER);
		feed(store, { type: "message_update", messageId: "ghost", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "忽略" } });
		expect(store.drafts.has("ghost")).toBe(false);
		feed(store, start);
		feed(store, { type: "message_update", messageId: "m1", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "忽略" } });
		expect(textOfDraft(store)).toBe("");
	});

	test("两种模式都由 message_end 收尾", () => {
		const delta = open();
		feed(delta, start);
		feed(delta, { type: "message_update", messageId: "m1", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "增量" } });
		feed(delta, { type: "message_end", messageId: "m1", message: { role: "assistant", content: [{ type: "text", text: "最终" }] } });
		expect(delta.drafts.size).toBe(0);
		expect(delta.messages.length).toBe(1);

		const full = open(NO_FILTER);
		feed(full, start);
		feed(full, { type: "message_update", messageId: "m1", message: { role: "assistant", content: [{ type: "text", text: "整段" }] } });
		feed(full, { type: "message_end", messageId: "m1", message: { role: "assistant", content: [{ type: "text", text: "最终" }] } });
		expect(full.drafts.size).toBe(0);
		expect(full.messages.length).toBe(1);
	});
});
