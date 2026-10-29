/**
 * Subagent bookkeeping shared by the gateway and the browser store: both fold
 * the same `subagent_lifecycle` / `subagent_progress` frames into one map.
 */
import { numberOr } from "./omp/wire.ts";
import type { SubagentLifecyclePayload, SubagentProgressPayload, SubagentSnapshot } from "./omp/wire.ts";

/** Progress frames carry only the index, so an entry may start life without an id. */
export function progressKey(index: number): string {
	return `index:${index}`;
}

const SETTLED: SubagentSnapshot["status"][] = ["completed", "failed", "aborted"];

/**
 * omp's lifecycle words, narrowed. `started` is the one that differs from the panel's own
 * vocabulary; anything it does not recognise reads as still running, which is what an
 * unrecognised state has always looked like here.
 */
function lifecycleStatus(status: string | undefined): SubagentSnapshot["status"] {
	if (status === "started") return "running";
	return status === "pending" || SETTLED.includes(status as SubagentSnapshot["status"]) ? (status as SubagentSnapshot["status"]) : "running";
}

export function applySubagentLifecycle(all: Map<string, SubagentSnapshot>, payload: SubagentLifecyclePayload): void {
	// payload 可能是 undefined（上游改了 frame 形狀時），或沒有 id。
	// 沒有 id 就沒有東西可以建立或更新——omp 正常時一定會送。
	if (!payload?.id) return;
	const previous = all.get(payload.id);
	// A progress frame may have created an index-keyed placeholder before its lifecycle arrived.
	all.delete(progressKey(numberOr(payload.index, previous?.index ?? 0)));
	all.set(payload.id, {
		id: payload.id,
		index: numberOr(payload.index, previous?.index ?? 0),
		agent: payload.agent ?? previous?.agent,
		agentSource: payload.agentSource ?? previous?.agentSource,
		status: lifecycleStatus(payload.status),
		lastUpdate: Date.now(),
		description: payload.description ?? previous?.description,
		task: previous?.task,
		assignment: previous?.assignment,
		sessionFile: payload.sessionFile ?? previous?.sessionFile,
		progress: previous?.progress,
		parentToolCallId: payload.parentToolCallId ?? previous?.parentToolCallId,
	});
}

export function applySubagentProgress(all: Map<string, SubagentSnapshot>, payload: SubagentProgressPayload): void {
	// payload 可能是 undefined（上游改了 frame 形狀時）。
	if (!payload) return;
	// The raw AgentProgress record carries the subagent id; fall back to the index only when it does not
	// (indices restart per batch, so then bind to the most recently touched entry with that index).
	const progressId = typeof payload.progress?.id === "string" ? payload.progress.id : undefined;
	const byIndex = typeof payload.index === "number" ? payload.index : undefined;
	if (!progressId && byIndex === undefined) return;
	const existing = progressId
		? (all.get(progressId) ?? (byIndex === undefined ? undefined : all.get(progressKey(byIndex))))
		: [...all.values()].filter(s => s.index === byIndex).sort((a, b) => b.lastUpdate - a.lastUpdate)[0];
	const id = progressId ?? existing?.id ?? progressKey(byIndex ?? 0);
	if (existing && existing.id !== id) all.delete(existing.id);
	const progressStatus = payload.progress?.status as SubagentSnapshot["status"] | undefined;
	all.set(id, {
		id,
		index: byIndex ?? existing?.index ?? 0,
		agent: payload.agent ?? existing?.agent,
		agentSource: payload.agentSource ?? existing?.agentSource,
		// Lifecycle frames own terminal states; progress may only report a live one.
		status: existing && existing.status !== "running" && existing.status !== "pending" ? existing.status : (progressStatus ?? existing?.status ?? "running"),
		lastUpdate: Date.now(),
		description: existing?.description,
		task: payload.task ?? existing?.task,
		assignment: payload.assignment ?? existing?.assignment,
		sessionFile: payload.sessionFile ?? existing?.sessionFile,
		progress: payload.progress ?? existing?.progress,
		parentToolCallId: payload.parentToolCallId ?? existing?.parentToolCallId,
	});
}
