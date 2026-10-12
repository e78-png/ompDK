import { locale, t, type MessageKey } from "./i18n/index.ts";

export function duration(ms: number): string {
	if (!Number.isFinite(ms) || ms < 0) return "";
	const s = Math.round(ms / 1000);
	if (s < 60) return t("panel.dur.sec", { n: Math.max(1, s) });
	const m = Math.floor(s / 60);
	if (m < 60) return t("panel.dur.minSec", { m, s: s % 60 });
	return t("panel.dur.hourMin", { h: Math.floor(m / 60), m: m % 60 });
}

/**
 * One tool call's own duration. Reads and greps usually finish in a few hundred ms,
 * and showing nothing there made them indistinguishable from a call still running.
 */
export function stepDuration(ms: number): string {
	if (!Number.isFinite(ms) || ms < 100) return "";
	if (ms < 1000) return t("panel.dur.sec", { n: (ms / 1000).toFixed(1) });
	return duration(ms);
}

export function relativeTime(epochMs: number): string {
	const diff = Date.now() - epochMs;
	const min = Math.floor(diff / 60_000);
	if (min < 1) return t("panel.time.justNow");
	if (min < 60) return t("panel.time.minAgo", { n: min });
	const h = Math.floor(min / 60);
	if (h < 24) return t("panel.time.hourAgo", { n: h });
	const d = Math.floor(h / 24);
	if (d < 30) return t("panel.time.dayAgo", { n: d });
	return new Date(epochMs).toLocaleDateString(locale() === "zh" ? "zh-CN" : "en-US");
}

export function tokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
	return String(n);
}

const EFFORT_NAMES: Record<string, MessageKey> = {
	off: "panel.effort.off",
	minimal: "panel.effort.minimal",
	low: "panel.effort.low",
	medium: "panel.effort.medium",
	high: "panel.effort.high",
	xhigh: "panel.effort.xhigh",
	max: "panel.effort.max",
	auto: "panel.effort.auto",
	inherit: "panel.effort.inherit",
};

export function effortName(level: string | undefined): string {
	if (!level) return "";
	const key = EFFORT_NAMES[level];
	return key ? t(key) : level;
}
