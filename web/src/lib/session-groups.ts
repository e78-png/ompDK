/**
 * Flat session list grouped by when it was last really used — the shape ChatGPT and
 * Claude Desktop show: a plain list of chats under 今天／昨天／近 7 天／更早.
 *
 * The grouping is a pure function of (sessions, now) so it can be tested against a
 * controlled clock instead of the wall clock.
 */
import type { SessionSummary } from "../../../shared/api.ts";

export type TimeGroupKey = "today" | "yesterday" | "week" | "older";

/** Fixed order of the groups; the sidebar renders them exactly like this. */
export const TIME_GROUP_ORDER: readonly TimeGroupKey[] = ["today", "yesterday", "week", "older"];

export interface TimeGroup {
	key: TimeGroupKey;
	sessions: SessionSummary[];
}

/** The moment we last really chatted in this session; a file mtime is only bookkeeping. */
export function sessionTime(s: SessionSummary): number {
	return s.activeAt || s.modified;
}

/** Local midnight of the day `ts` falls in — the sidebar groups by the user's calendar, not UTC. */
function startOfDay(ts: number): number {
	const d = new Date(ts);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

/**
 * Local midnight `days` before the day `ts` falls in. Walking the calendar instead of
 * subtracting 24h keeps the boundaries right across a daylight-saving change.
 */
function daysBefore(dayStart: number, days: number): number {
	const d = new Date(dayStart);
	d.setDate(d.getDate() - days);
	return d.getTime();
}

/**
 * Split sessions into the four time groups, newest first inside each group.
 * Empty groups are dropped: a heading with nothing under it only adds noise.
 */
export function groupByTime(sessions: SessionSummary[], now: number): TimeGroup[] {
	if (sessions.length === 0) return [];
	const todayStart = startOfDay(now);
	const yesterdayStart = daysBefore(todayStart, 1);
	const weekStart = daysBefore(todayStart, 7);

	const buckets = new Map<TimeGroupKey, SessionSummary[]>();
	for (const s of sessions) {
		const at = sessionTime(s);
		const key: TimeGroupKey = at >= todayStart ? "today" : at >= yesterdayStart ? "yesterday" : at >= weekStart ? "week" : "older";
		const list = buckets.get(key);
		if (list) list.push(s);
		else buckets.set(key, [s]);
	}

	const groups: TimeGroup[] = [];
	for (const key of TIME_GROUP_ORDER) {
		const list = buckets.get(key);
		if (!list || list.length === 0) continue;
		list.sort((a, b) => sessionTime(b) - sessionTime(a));
		groups.push({ key, sessions: list });
	}
	return groups;
}
