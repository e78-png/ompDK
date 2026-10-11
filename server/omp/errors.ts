/**
 * omp's failures, sorted into the handful this app actually reacts to.
 *
 * omp puts a machine-readable `code` on some failed responses and nothing but prose on
 * others, so the code is consulted first and the text only where a message is all there
 * is. Each regex names the omp version and file it was read from: when the wording
 * changes, the place to look is here, and nothing else in the app should be matching
 * omp's sentences at all.
 */
export type OmpErrorKind = "model_unavailable" | "session_busy" | "session_malformed" | "unknown";

/** `code` values on a failed response frame, per omp 18.8.6 `src/modes/rpc/rpc-mode.ts`. */
const CODE_KINDS: Record<string, OmpErrorKind> = {
	session_busy: "session_busy",
	stale_cursor: "session_busy",
	unknown_since: "session_malformed",
};

/**
 * `Could not restore model <provider/id> (<reason>)` — omp 18.8.6,
 * `src/config/model-resolver.ts:2433`. `rpc-ui` refuses to resume a session whose saved
 * model is gone instead of falling back, and this line on stderr is the only sign of
 * which model it was; the gateway retries once on the default role.
 *
 * The name stops at whitespace or a backtick because the same stderr also echoes omp's
 * source line, whose template literal `` `${savedProvider}/${savedModelId}` `` matches
 * the same words, and the real message is the last of them.
 */
const MODEL_RESTORE_FAILED = /Could not restore model ([^\s`]+)/g;

export interface OmpError {
	kind: OmpErrorKind;
	/** What the error named, when it named something: for `model_unavailable`, the lost `provider/id`. */
	detail?: string;
}

/**
 * `Unknown command: <type>` — omp 18.8.6, `src/modes/rpc/rpc-mode.ts:2627`. What an
 * older build answers for a command it does not have. It carries no `code`, so this text
 * is the only sign, and it is what tells a caller to ask the same thing another way
 * rather than to report a failure.
 */
export function isUnknownCommand(error: unknown): boolean {
	return typeof error === "string" && error.startsWith("Unknown command:");
}

/** Classify a failed response, or the stderr tail of a process that died. */
export function classifyOmpError(text: string, code?: string): OmpError {
	const coded = code ? CODE_KINDS[code] : undefined;
	if (coded) return { kind: coded };
	const lost = [...text.matchAll(MODEL_RESTORE_FAILED)].at(-1)?.[1];
	if (lost) return { kind: "model_unavailable", detail: lost };
	return { kind: "unknown" };
}
