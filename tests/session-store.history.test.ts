/**
 * The client's view of a transcript that arrives one page at a time.
 *
 * Why this needs a test of its own: the gateway sends only the tail of a long session and
 * the client asks for the rest with `history_page`. The seam between the two — older
 * messages going in FRONT of what the client already holds — is easy to get backwards, and
 * a client that gets it wrong shows the conversation in the wrong order with no error
 * anywhere: the messages are all there, just not in the order they were said.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { AgentMessage, ServerMsg, SessionState } from "../shared/api.ts";
import { SessionStore } from "../web/src/lib/session-store.ts";

// The store schedules its notifications on an animation frame; there is no browser here.
// The stand-in runs the callback on the microtask queue, so no test waits on wall-clock time.
const previousRaf = globalThis.requestAnimationFrame;
const previousCancel = globalThis.cancelAnimationFrame;
beforeAll(() => {
	globalThis.requestAnimationFrame = callback => {
		queueMicrotask(() => callback(performance.now()));
		return 0;
	};
	globalThis.cancelAnimationFrame = () => undefined;
});
afterAll(() => {
	globalThis.requestAnimationFrame = previousRaf;
	globalThis.cancelAnimationFrame = previousCancel;
});

function message(text: string): AgentMessage {
	return { role: "user", content: [{ type: "text", text }], timestamp: 1 } as AgentMessage;
}

function texts(messages: readonly AgentMessage[]): string[] {
	return messages.map(m => (m.content as { text?: string }[] | undefined)?.[0]?.text ?? "");
}

const state = {
	cwd: "C:\\work",
	isStreaming: false,
	isCompacting: false,
	messageCount: 0,
	queuedMessages: { steering: [], followUp: [] },
} as unknown as SessionState;

function snapshot(messages: AgentMessage[], history?: { offset: number; total: number }): ServerMsg {
	return {
		t: "snapshot",
		key: "k",
		state,
		messages,
		inflight: [],
		pendingUi: [],
		commands: [],
		subagents: [],
		history,
	} as unknown as ServerMsg;
}

describe("歷史視窗", () => {
	test("snapshot 帶來視窗的起點與總數", () => {
		const store = new SessionStore("k");
		store.handle(snapshot([message("c"), message("d")], { offset: 200, total: 202 }));
		expect(store.history).toEqual({ offset: 200, total: 202 });
		expect(texts(store.messages)).toEqual(["c", "d"]);
	});

	test("往回取的一頁放在前面，不是後面", () => {
		const store = new SessionStore("k");
		store.handle(snapshot([message("c"), message("d")], { offset: 200, total: 202 }));
		store.handle({ t: "history_page", key: "k", messages: [message("a"), message("b")], offset: 198, total: 202 });
		expect(texts(store.messages)).toEqual(["a", "b", "c", "d"]);
		expect(store.history).toEqual({ offset: 198, total: 202 });
	});

	test("沒有訊息的一頁也不會動到順序", () => {
		const store = new SessionStore("k");
		store.handle(snapshot([message("c")], { offset: 200, total: 202 }));
		store.handle({ t: "history_page", key: "k", messages: [], offset: 200, total: 202 });
		expect(texts(store.messages)).toEqual(["c"]);
		expect(store.history).toEqual({ offset: 200, total: 202 });
	});

	test("沒有歷史資訊的舊閘道器：視窗為空，不顯示載入按鈕", () => {
		const store = new SessionStore("k");
		store.handle(snapshot([message("a")]));
		expect(store.history).toBeUndefined();
	});
});

describe("唯讀模式的增量", () => {
	test("新增加的訊息接在後面，舊的從前面掉出去", () => {
		const store = new SessionStore("k");
		store.handle(snapshot([message("a"), message("b")]));
		store.handle({ t: "history_append", key: "k", messages: [message("c")], keep: 2 });
		// keep=2：最舊的掉出去，留下最近兩則。
		expect(texts(store.messages)).toEqual(["b", "c"]);
	});

	test("沒有新訊息時順序不變", () => {
		const store = new SessionStore("k");
		store.handle(snapshot([message("a"), message("b")]));
		store.handle({ t: "history_append", key: "k", messages: [], keep: 2 });
		expect(texts(store.messages)).toEqual(["a", "b"]);
	});
});

describe("被別的 OMP 佔著", () => {
	test("閘道器說被佔著：記下來並提示一次", () => {
		const store = new SessionStore("k");
		store.handle({ t: "proc", key: "k", status: "ready", code: "session_owned_elsewhere", ownedBy: 4242 });
		expect(store.heldElsewhere).toBe(true);
		expect(store.ownedBy).toBe(4242);
		expect(store.notices.length).toBe(1);
		expect(store.notices[0].text).toContain("4242");
	});

	test("沒有 pid 時也要說清楚是誰佔著", () => {
		const store = new SessionStore("k");
		store.handle({ t: "proc", key: "k", status: "ready", code: "session_owned_elsewhere" });
		expect(store.heldElsewhere).toBe(true);
		expect(store.ownedBy).toBeUndefined();
		expect(store.notices.length).toBe(1);
	});
});
