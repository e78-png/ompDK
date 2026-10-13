/** Single WebSocket to the gateway: reconnects, re-attaches sessions, correlates RPC replies. */
import type { ClientMsg, ServerMsg } from "../../../shared/api.ts";
import { locale, t } from "./i18n/index.ts";

type Listener = (msg: ServerMsg) => void;

/**
 * How long the page waits for the gateway before declaring the socket dead. The gateway sends
 * `ping` every 30 s, so three of them missing means nothing is arriving any more — which is what
 * a laptop suspended mid-run, a phone that lost signal, or a NAT entry that expired all look
 * like. `readyState` stays `OPEN` through all three, so only silence can tell the story.
 */
const LIVENESS_MS = 75_000;
/** Queued sends beyond this are worthless by the time a reconnect lands; the oldest go first. */
const OUTBOX_LIMIT = 200;

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
	#livenessTimer?: ReturnType<typeof setTimeout>;
	/** Set once the gateway has actually pinged us: a gateway too old to ping is left alone. */
	#beat = false;
	connected = false;
	#statusListeners = new Set<() => void>();

	connect(): void {
		if (this.#ws && (this.#ws.readyState === WebSocket.CONNECTING || this.#ws.readyState === WebSocket.OPEN)) return;
		clearTimeout(this.#reconnectTimer);
		this.#reconnectTimer = undefined;
		const proto = location.protocol === "https:" ? "wss" : "ws";
		const ws = new WebSocket(`${proto}://${location.host}/ws?lang=${locale()}`);
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
			if (msg.t === "ping") {
				this.#beat = true;
				this.#armLiveness();
				this.#send({ t: "pong" });
				return;
			}
			if (msg.t === "rpc_res") {
				const p = this.#pending.get(msg.rid);
				if (p) {
					this.#pending.delete(msg.rid);
					if (msg.ok) p.resolve(msg.data);
					else p.reject(new Error(msg.error ?? t("chrome.failed")));
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
			clearTimeout(this.#livenessTimer);
			this.#livenessTimer = undefined;
			for (const p of this.#pending.values()) p.reject(new Error(t("chrome.connectionLost")));
			this.#pending.clear();
			// A rejected RPC must not execute later just because it was still queued.
			this.#outbox = [];
			const delay = Math.min(5000, 300 * 2 ** this.#retry++);
			// The gateway refuses an unpaired socket with a 401, which looks like an ordinary
			// failure here; after a few of them, ask whether this device is still paired.
			if (this.#retry >= 3) notifyPairRequired();
			this.#reconnectTimer = setTimeout(() => this.connect(), delay);
			this.#setConnected(false);
		};
	}

	/**
	 * Restart the silence timer. Called from every keep-alive, because the beat is the only thing
	 * that arrives on an idle page: a visible one is still re-rendering from tokens, a backgrounded
	 * one is not, and both have to notice a socket that died underneath them.
	 */
	#armLiveness(): void {
		clearTimeout(this.#livenessTimer);
		this.#livenessTimer = setTimeout(() => {
			// `close()` and not `terminate()`-by-hand: `onclose` owns the reconnect.
			this.#ws?.close();
		}, LIVENESS_MS);
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
		else if (msg.t !== "attach") {
			// attaches are replayed on open
			this.#outbox.push(text);
			// A gateway that never comes back must not turn the queue into a leak; the newest
			// messages are the ones still worth sending.
			if (this.#outbox.length > OUTBOX_LIMIT) this.#outbox.shift();
		}
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

/** An HTTP failure that keeps its status: the settings page hides itself on a 403. */
export class ApiError extends Error {
	constructor(message: string, readonly status: number, readonly body?: unknown) {
		super(message);
	}
}

const pairListeners = new Set<() => void>();

/** Called when something answered "pair first": a parked API call, or a socket that keeps failing. */
export function onPairRequired(listener: () => void): () => void {
	pairListeners.add(listener);
	return () => pairListeners.delete(listener);
}

function notifyPairRequired(): void {
	for (const listener of pairListeners) listener();
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(path, { ...init, headers: { "content-type": "application/json", "x-omp-web-lang": locale(), ...init?.headers } });
	const text = await res.text();
	let data: (T & { error?: string }) | undefined;
	try {
		data = text ? (JSON.parse(text) as T & { error?: string }) : undefined;
	} catch {
		// The request guard refuses in plain text; the status is all there is to report.
	}
	if (!res.ok) {
		const error = data?.error ?? (text.trim() || res.statusText);
		if (res.status === 401 && error === "pair_required") notifyPairRequired();
		throw new ApiError(error, res.status, data);
	}
	return data as T;
}
