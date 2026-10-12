/** Session identity and attach/detach lifetime, independent of routing and app settings. */
import type { ImageContent, ServerMsg } from "../../../shared/api.ts";
import { SessionStore } from "./session-store.ts";
import type { Gateway } from "./ws.ts";

export const PENDING_PREFIX = "pending:";

export class SessionRegistry {
	#stores = new Map<string, SessionStore>();

	constructor(
		private readonly connection: Pick<Gateway, "attach" | "detach">,
		private readonly configure: (store: SessionStore) => void,
	) {}

	has(key: string): boolean {
		return this.#stores.has(key);
	}

	get(key: string, observe = false): SessionStore {
		let store = this.#stores.get(key);
		if (!store) {
			store = this.#register(new SessionStore(key));
			this.connection.attach(key, undefined, undefined, observe);
		} else if (observe) {
			store.markReconnecting();
			this.connection.attach(key, undefined, undefined, true);
		}
		return store;
	}

	pending(text: string, images?: ImageContent[]): SessionStore {
		// getRandomValues also works on LAN HTTP pages, where randomUUID is unavailable.
		const id = Array.from(crypto.getRandomValues(new Uint32Array(4)), part => part.toString(16).padStart(8, "0")).join("");
		const store = new SessionStore(`${PENDING_PREFIX}${id}`);
		store.beginPending(text, images);
		return this.#register(store);
	}

	activate(store: SessionStore, key: string): void {
		this.#rekey(store.key, key);
		this.connection.attach(key);
	}

	handle(msg: ServerMsg): void {
		if (msg.t === "rekey") this.#rekey(msg.from, msg.to);
		else if ("key" in msg) this.#stores.get(msg.key)?.handle(msg);
	}

	/** Running sessions keep receiving frames after the user leaves their page. */
	releaseIdle(key: string): void {
		const store = this.#stores.get(key);
		if (store && !store.isRunning) this.remove(key);
	}

	remove(key: string): void {
		if (!this.#stores.delete(key)) return;
		if (!key.startsWith(PENDING_PREFIX)) this.connection.detach(key);
	}

	#register(store: SessionStore): SessionStore {
		this.configure(store);
		this.#stores.set(store.key, store);
		return store;
	}

	#rekey(from: string, to: string): void {
		const store = this.#stores.get(from);
		if (!store) return;
		this.#stores.delete(from);
		store.key = to;
		this.#stores.set(to, store);
	}
}
