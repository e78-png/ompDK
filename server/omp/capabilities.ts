/**
 * The capability table for the omp binary on this machine.
 *
 * Every session of one omp build negotiates the same features, so the gateway keeps a
 * single table — the newest handshake wins — and `/api/health` publishes it.
 *
 * It is `undefined` until the first process has finished negotiating. That matters:
 * "not known yet" must not read as "not supported", or a page that loads before any
 * session is open would hide features omp actually has.
 */
import type { OmpCapabilities } from "../../shared/api.ts";

let table: OmpCapabilities | undefined;

export function capabilities(): OmpCapabilities | undefined {
	return table;
}

/**
 * Record a finished handshake. `messagesPage` is not proved here — it is only known
 * once a session has tried to read a page of messages — so a previous "false" survives
 * a new process coming up.
 */
export function recordCapabilities(negotiated: OmpCapabilities): void {
	table = { ...negotiated, messagesPage: table?.messagesPage ?? true };
}

/** Narrow the table when a command turns out not to exist after all. */
export function markMessagesPage(ok: boolean): void {
	if (table) table = { ...table, messagesPage: ok };
}
