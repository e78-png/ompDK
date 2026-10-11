/** Single WebSocket to the gateway: reconnects, re-attaches sessions, correlates RPC replies. */
import type { ClientMsg, ServerMsg } from "../../../shared/api.ts";

type Listener = (msg: ServerMsg) => void;

export class Gateway {
	#ws?: WebSocket;
	#outbox: string[] = [];
	#listeners = new Set<Listener>();
	#pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
	#attached = new Set<string>();
	#observed = new Set<string>();
	#nextRid = 1;
	#retry = 0;
	#reconnectTimer?: ReturnType<typeof setTimeout>;
	connected = false;
	#statusListeners = new Set<() => void>();

	connect(): void {
		if (this.#ws && (this.#ws.readyState === WebSocket.CONNECTING || this.#ws.readyState === WebSocket.OPEN)) return;
		clearTimeout(this.#reconnectTimer);
		this.#reconnectTimer = undefined;
		const proto = location.protocol === "https:" ? "wss" : "ws";
		const ws = new WebSocket(`${proto}://${location.host}/ws`);
		this.#ws = ws;
		ws.onopen = () => {
			if (this.#ws !== ws) return;
			this.#retry = 0;
			for (const key of this.#attached) ws.send(JSON.stringify({ t: "attach", key, ...(this.#observed.has(key) ? { observe: true } : {}) } satisfies ClientMsg));
			for (const text of this.#outbox.splice(0)) ws.send(text);
			this.#setConnected(true);
		};
		ws.onmessage = ev => {
			if (this.#ws !== ws) return;
			const msg = JSON.parse(String(ev.data)) as ServerMsg;
			if (msg.t === "rpc_res") {
				const p = this.#pending.get(msg.rid);
				if (p) {
					this.#pending.delete(msg.rid);
					if (msg.ok) p.resolve(msg.data);
					else p.reject(new Error(msg.error ?? "失败"));
				}
				return;
			}
			if (msg.t === "rekey" && this.#attached.delete(msg.from)) {
				this.#attached.add(msg.to);
				if (this.#observed.delete(msg.from)) this.#observed.add(msg.to);
			}
			for (const l of this.#listeners) l(msg);
		};
		ws.onclose = () => {
			if (this.#ws !== ws) return;
			this.#ws = undefined;
			for (const p of this.#pending.values()) p.reject(new Error("连接已断开"));
			this.#pending.clear();
			// A rejected RPC must not execute later just because it was still queued.
			this.#outbox = [];
			const delay = Math.min(5000, 300 * 2 ** this.#retry++);
			this.#reconnectTimer = setTimeout(() => this.connect(), delay);
			this.#setConnected(false);
		};
	}

	#setConnected(value: boolean): void {
		this.connected = value;
		for (const l of this.#statusListeners) l();
	}

	onStatus(listener: () => void): () => void {
		this.#statusListeners.add(listener);
		return () => this.#statusListeners.delete(listener);
	}

	#send(msg: ClientMsg): void {
		const text = JSON.stringify(msg);
		if (this.#ws?.readyState === WebSocket.OPEN) this.#ws.send(text);
		else if (msg.t !== "attach") this.#outbox.push(text); // attaches are replayed on open
	}

	on(listener: Listener): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/** `model` and `force` apply to this attach only; reconnects resume whatever the session saved. */
	attach(key: string, model?: string, force?: boolean, observe = false): void {
		this.#attached.add(key);
		if (observe) this.#observed.add(key);
		else this.#observed.delete(key);
		const msg: ClientMsg = { t: "attach", key };
		if (observe) msg.observe = true;
		if (model) msg.model = model;
		// Deliberately not remembered: a later reconnect should re-check ownership.
		if (force) msg.force = true;
		this.#send(msg);
	}

	detach(key: string): void {
		this.#attached.delete(key);
		this.#observed.delete(key);
		this.#send({ t: "detach", key });
	}

	rpc<T = unknown>(key: string, cmd: Record<string, unknown>): Promise<T> {
		const rid = `r${this.#nextRid++}`;
		const { promise, resolve, reject } = Promise.withResolvers<unknown>();
		this.#pending.set(rid, { resolve, reject });
		this.#send({ t: "rpc", key, rid, cmd });
		return promise as Promise<T>;
	}

	ui(key: string, payload: Record<string, unknown>): void {
		this.#send({ t: "ui", key, payload });
	}
}

export const gateway = new Gateway();

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
	const data = (await res.json()) as T & { error?: string };
	if (!res.ok) throw new Error(data.error ?? res.statusText);
	return data;
}
