import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ClientMsg, ServerMsg } from "../shared/api.ts";
import { Gateway } from "../web/src/lib/ws.ts";

class FakeSocket {
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSED = 3;
	static instances: FakeSocket[] = [];
	readyState = FakeSocket.CONNECTING;
	onopen?: () => void;
	onclose?: () => void;
	onmessage?: (event: { data: string }) => void;
	sent: ClientMsg[] = [];
	constructor(readonly url: string) {
		FakeSocket.instances.push(this);
	}
	send(text: string): void {
		this.sent.push(JSON.parse(text) as ClientMsg);
	}
	open(): void {
		this.readyState = FakeSocket.OPEN;
		this.onopen?.();
	}
	close(): void {
		this.readyState = FakeSocket.CLOSED;
		this.onclose?.();
	}
	receive(msg: ServerMsg): void {
		this.onmessage?.({ data: JSON.stringify(msg) });
	}
}

const previousSocket = globalThis.WebSocket;
const previousLocation = Object.getOwnPropertyDescriptor(globalThis, "location");
const previousTimeout = globalThis.setTimeout;
const previousClear = globalThis.clearTimeout;
let timers: Map<number, { callback: () => void; delay: number }>;
let nextTimer: number;

beforeEach(() => {
	FakeSocket.instances = [];
	timers = new Map();
	nextTimer = 1;
	globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
	Object.defineProperty(globalThis, "location", { configurable: true, value: { protocol: "http:", host: "localhost:30193" } });
	globalThis.setTimeout = ((callback: () => void, delay: number) => {
		const id = nextTimer++;
		timers.set(id, { callback, delay });
		return id;
	}) as unknown as typeof setTimeout;
	globalThis.clearTimeout = ((id: number) => timers.delete(id)) as unknown as typeof clearTimeout;
});

afterEach(() => {
	globalThis.WebSocket = previousSocket;
	globalThis.setTimeout = previousTimeout;
	globalThis.clearTimeout = previousClear;
	if (previousLocation) Object.defineProperty(globalThis, "location", previousLocation);
	else Reflect.deleteProperty(globalThis, "location");
});

function retry(): FakeSocket {
	const [id, timer] = [...timers][0];
	timers.delete(id);
	timer.callback();
	return FakeSocket.instances.at(-1)!;
}

describe("Gateway 连接生命周期", () => {
	test("连接前的请求排队，attach 先发送，回复按 rid 关联", async () => {
		const gateway = new Gateway();
		gateway.connect();
		gateway.attach("s");
		const first = gateway.rpc("s", { type: "first" });
		const second = gateway.rpc("s", { type: "second" });
		const socket = FakeSocket.instances[0];
		expect(socket.sent).toEqual([]);
		socket.open();
		expect(socket.sent.map(msg => msg.t)).toEqual(["attach", "rpc", "rpc"]);
		const requests = socket.sent.filter(msg => msg.t === "rpc");
		socket.receive({ t: "rpc_res", rid: requests[1].rid, ok: true, data: "second" });
		socket.receive({ t: "rpc_res", rid: requests[0].rid, ok: true, data: "first" });
		expect(await first).toBe("first");
		expect(await second).toBe("second");
	});

	test("断线拒绝已发出的 RPC，重连后重新 attach 并接受新请求", async () => {
		const gateway = new Gateway();
		gateway.connect();
		const socket = FakeSocket.instances[0];
		socket.open();
		gateway.attach("s");
		const failed = gateway.rpc("s", { type: "prompt" });
		socket.close();
		await expect(failed).rejects.toThrow("连接已断开");
		expect(gateway.connected).toBe(false);
		expect([...timers.values()][0].delay).toBe(300);
		const fresh = gateway.rpc("s", { type: "get_state" });
		const reopened = retry();
		reopened.open();
		expect(reopened.sent.map(msg => msg.t)).toEqual(["attach", "rpc"]);
		const request = reopened.sent[1];
		if (request.t !== "rpc") throw new Error("missing RPC");
		reopened.receive({ t: "rpc_res", rid: request.rid, ok: true, data: { ready: true } });
		expect(await fresh).toEqual({ ready: true });
		expect(gateway.connected).toBe(true);
	});

	test("连接建立前断线：失败的排队请求不会在重连后执行", async () => {
		const gateway = new Gateway();
		gateway.connect();
		gateway.attach("s");
		const failed = gateway.rpc("s", { type: "prompt", message: "只发送一次" });
		FakeSocket.instances[0].close();
		await expect(failed).rejects.toThrow("连接已断开");
		const reopened = retry();
		reopened.open();
		expect(reopened.sent).toEqual([{ t: "attach", key: "s" }]);
	});

	test("rekey 和 detach 更新重连集合，model/force 只用于本次 attach", () => {
		const gateway = new Gateway();
		gateway.connect();
		const socket = FakeSocket.instances[0];
		socket.open();
		gateway.attach("old", "p/m", true);
		gateway.attach("removed");
		expect(socket.sent[0]).toEqual({ t: "attach", key: "old", model: "p/m", force: true });
		socket.receive({ t: "rekey", from: "old", to: "new" });
		gateway.detach("removed");
		socket.close();
		const reopened = retry();
		reopened.open();
		expect(reopened.sent).toEqual([{ t: "attach", key: "new" }]);
	});

	test("重复连接与旧 socket 事件不会制造第二条重连链", () => {
		const gateway = new Gateway();
		gateway.connect();
		gateway.connect();
		expect(FakeSocket.instances).toHaveLength(1);
		const old = FakeSocket.instances[0];
		old.close();
		const reopened = retry();
		reopened.open();
		old.close();
		expect(gateway.connected).toBe(true);
		expect(timers.size).toBe(0);
	});

	test("手动连接取消待执行的重连，状态监听可取消", () => {
		const gateway = new Gateway();
		const statuses: boolean[] = [];
		const off = gateway.onStatus(() => statuses.push(gateway.connected));
		gateway.connect();
		FakeSocket.instances[0].open();
		FakeSocket.instances[0].close();
		gateway.connect();
		expect(timers.size).toBe(0);
		off();
		FakeSocket.instances[1].open();
		expect(statuses).toEqual([true, false]);
	});
});

describe("Gateway 心跳与背压", () => {
	test("收到 ping 立即回 pong，并启动看门狗", () => {
		const gateway = new Gateway();
		gateway.connect();
		const socket = FakeSocket.instances[0];
		socket.open();
		socket.receive({ t: "ping" });
		expect(socket.sent).toEqual([{ t: "pong" }]);
		expect([...timers.values()].map(timer => timer.delay)).toContain(75_000);
	});

	test("心跳停止后主动断开，交给重连路径", () => {
		const gateway = new Gateway();
		gateway.connect();
		const socket = FakeSocket.instances[0];
		socket.open();
		socket.receive({ t: "ping" });
		const beat = [...timers.entries()].find(([, timer]) => timer.delay === 75_000);
		if (!beat) throw new Error("没有看门狗定时器");
		timers.delete(beat[0]);
		beat[1].callback();
		expect(gateway.connected).toBe(false);
		expect([...timers.values()].map(timer => timer.delay)).toEqual([300]);
	});

	test("从不心跳的网关不会被看门狗误断", () => {
		const gateway = new Gateway();
		gateway.connect();
		const socket = FakeSocket.instances[0];
		socket.open();
		socket.receive({ t: "index" });
		expect([...timers.values()].filter(timer => timer.delay === 75_000)).toHaveLength(0);
	});

	test("断线期间排队的请求有上限，丢弃的是最旧的", () => {
		const gateway = new Gateway();
		gateway.connect();
		FakeSocket.instances[0].open();
		FakeSocket.instances[0].close();
		for (let i = 0; i < 205; i++) void gateway.rpc("s", { type: "probe", i });
		const reopened = retry();
		reopened.open();
		const requests = reopened.sent.flatMap(msg => (msg.t === "rpc" ? [msg] : []));
		expect(requests).toHaveLength(200);
		expect(requests[0].cmd.i).toBe(5);
		expect(requests.at(-1)?.cmd.i).toBe(204);
	});
});
