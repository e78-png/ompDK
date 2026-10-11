/**
 * The omp handshake: each optional feature costs one RPC call, so the handshake makes
 * them one at a time and records what answered.
 *
 * A step that fails, is refused or never answers is recorded as `false` and the process
 * is still reported ready. Refusing to start over `set_ask_dialog` would turn a missing
 * nicety into a session that cannot be opened at all, and every one of these has a
 * working fallback: without the event filter omp sends whole messages instead of
 * deltas, without the ask dialog a question arrives as the usual select-and-input
 * cards, and without the subagent subscription the subagent panel simply has no data.
 */
import type { OmpCapabilities } from "../../shared/api.ts";
import type { OmpFrame, OmpResponse } from "../../shared/omp/wire.ts";

/** Long enough for a loaded machine: these are local calls, not model calls. */
export const HANDSHAKE_TIMEOUT_MS = 5_000;

/** Send one command and await its response frame — `OmpProcess.request`. */
export type HandshakeRequest = (command: Record<string, unknown>, timeoutMs: number) => Promise<OmpFrame>;

/** `supportedProtocolVersions` off the `ready` frame; anything but a clean 2 stays on 1. */
function offeredProtocol(ready: OmpFrame): 1 | 2 {
	const versions = ready.supportedProtocolVersions as unknown;
	return Array.isArray(versions) && versions.includes(2) ? 2 : 1;
}

/** Only a response that does not say `success: false` proves the feature. */
async function step(request: HandshakeRequest, command: Record<string, unknown>): Promise<boolean> {
	try {
		return (await request(command, HANDSHAKE_TIMEOUT_MS) as OmpResponse).success !== false;
	} catch {
		return false;
	}
}

/**
 * Negotiate everything `ready` allows, in order. `messagesPage` starts optimistic: it
 * is proved by the first message read, not here (`markMessagesPage`).
 */
export async function negotiate(request: HandshakeRequest, ready: OmpFrame): Promise<OmpCapabilities> {
	let protocol: 1 | 2 = 1;
	// v2 is what makes `rpc_chunk` framing arrive, so it counts as negotiated only when
	// omp accepted the version, not merely when it listed one.
	if (offeredProtocol(ready) === 2 && (await step(request, { type: "negotiate_protocol", protocolVersion: 2 }))) protocol = 2;
	const deltaUpdates = await step(request, { type: "set_event_filter", events: null, messageUpdates: "delta" });
	// One rich card for every question of an `ask` call, instead of select+editor per question.
	const askDialog = await step(request, { type: "set_ask_dialog", enabled: true });
	// Lifecycle plus aggregated progress frames drive the subagent panel.
	const subagentProgress = await step(request, { type: "set_subagent_subscription", level: "progress" });
	return { protocol, deltaUpdates, askDialog, subagentProgress, messagesPage: true };
}
