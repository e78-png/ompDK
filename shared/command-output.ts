/**
 * What an omp slash-command answer looks like, shared by the gateway that mirrors it
 * into its message list and the browser store that renders it.
 */
import { CUSTOM_TYPES } from "./omp/conventions.ts";
import type { AgentMessage } from "./omp/wire.ts";

/** omp writes command output for a terminal; only the thread knows how to show its escapes. */
export function stripAnsi(text: string): string {
	return text.replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\u001B\][\s\S]*?(\u0007|\u001B\\)/g, "");
}

/**
 * The message `turns.ts` turns into a command entry. `command` is the text the user
 * submitted: omp's `command_output` frame does not name the command that produced it.
 * The text keeps its escape codes — `/context` draws its usage bar in eight greys of
 * the same block character — and `web/src/lib/ansi.tsx` is what renders them.
 */
export function commandOutputMessage(text: string, command: string | undefined, timestamp: number): AgentMessage {
	return {
		role: "custom",
		customType: CUSTOM_TYPES.commandOutput,
		content: [{ type: "text", text }],
		display: true,
		timestamp,
		...(command ? { details: { command } } : {}),
	} as unknown as AgentMessage;
}

/**
 * A command that answered with no output at all — the gateway's own record of it, so
 * the thread keeps a line for something the terminal would have shown. Same shape as
 * above with a different `customType`: both become command entries in `turns.ts`.
 */
export function commandEchoMessage(text: string, command: string | undefined, timestamp: number): AgentMessage {
	return {
		role: "custom",
		customType: CUSTOM_TYPES.commandEcho,
		content: [{ type: "text", text }],
		display: true,
		timestamp,
		...(command ? { details: { command } } : {}),
	} as unknown as AgentMessage;
}
