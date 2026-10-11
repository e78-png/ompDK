import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { ServerMsg } from "../shared/api.ts";
import { SessionRegistry } from "../web/src/lib/session-registry.ts";
import type { SessionStore } from "../web/src/lib/session-store.ts";

const previousRaf = globalThis.requestAnimationFrame;
const previousCancel = globalThis.cancelAnimationFrame;

beforeAll(() => {
	globalThis.requestAnimationFrame = () => 1;
	globalThis.cancelAnimationFrame = () => {};
});

afterAll(async () => {
	await Promise.resolve();
	globalThis.requestAnimationFrame = previousRaf;
	globalThis.cancelAnimationFrame = previousCancel;
});

function setup() {
	const attached: string[] = [];
	const detached: string[] = [];
	const configured: SessionStore[] = [];
	const registry = new SessionRegistry({ attach: key => { attached.push(key); }, detach: key => { detached.push(key); } }, store => { configured.push(store); });
	return { registry, attached, detached, configured };
}

function ready(key: string): ServerMsg {
	return { t: "snapshot", key, state: { isStreaming: false, isCompacting: false, messageCount: 0, cwd: "test" }, messages: [], inflight: [], pendingUi: [], commands: [], subagents: [] };
}

describe("SessionRegistry 的会话生命周期", () => {
	test("同一会话只注册和 attach 一次，消息进入已有 store", () => {
		const { registry, attached, configured } = setup();
		const store = registry.get("s");
		expect(registry.get("s")).toBe(store);
		expect(attached).toEqual(["s"]);
		expect(configured).toEqual([store]);
		registry.handle(ready("s"));
		expect(store.status).toBe("ready");
	});

	test("待创建会话即时回显，激活后保留同一个 store 和回显", () => {
		const { registry, attached, configured } = setup();
		const store = registry.pending("第一条消息");
		const temp = store.key;
		expect(temp.startsWith("pending:")).toBe(true);
		expect(store.messages).toHaveLength(1);
		expect(store.isRunning).toBe(true);
		expect(attached).toEqual([]);
		registry.activate(store, "real");
		expect(registry.has(temp)).toBe(false);
		expect(registry.get("real")).toBe(store);
		expect(store.key).toBe("real");
		expect(store.pending).toBe(store.messages[0]);
		expect(attached).toEqual(["real"]);
		expect(configured).toEqual([store]);
	});

	test("rekey 保留会话身份，后续消息只进入新键", () => {
		const { registry, attached } = setup();
		const store = registry.get("old");
		registry.handle({ t: "rekey", from: "old", to: "new" });
		expect(registry.has("old")).toBe(false);
		expect(registry.get("new")).toBe(store);
		expect(attached).toEqual(["old"]);
		registry.handle(ready("old"));
		expect(store.status).toBe("starting");
		registry.handle(ready("new"));
		expect(store.status).toBe("ready");
	});

	test("切走时保留运行中会话，空闲后 detach 并在下次打开时重新注册", () => {
		const { registry, attached, detached } = setup();
		const store = registry.get("s");
		registry.handle(ready("s"));
		store.state!.isStreaming = true;
		registry.releaseIdle("s");
		expect(registry.has("s")).toBe(true);
		expect(detached).toEqual([]);
		store.state!.isStreaming = false;
		registry.releaseIdle("s");
		expect(registry.has("s")).toBe(false);
		expect(detached).toEqual(["s"]);
		expect(registry.get("s")).not.toBe(store);
		expect(attached).toEqual(["s", "s"]);
	});

	test("失败清理只 detach 已激活会话，未知消息不会创建 store", () => {
		const { registry, detached } = setup();
		const pending = registry.pending("失败后恢复输入");
		registry.remove(pending.key);
		expect(detached).toEqual([]);
		const active = registry.pending("已激活");
		registry.activate(active, "real");
		registry.remove("real");
		registry.remove("real");
		expect(detached).toEqual(["real"]);
		registry.handle(ready("unknown"));
		registry.handle({ t: "rekey", from: "unknown", to: "other" });
		expect(registry.has("unknown")).toBe(false);
		expect(registry.has("other")).toBe(false);
	});
});
