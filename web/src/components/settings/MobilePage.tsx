/**
 * Settings → 手机访问. Only the machine running the gateway can read this page: the code it
 * shows is the way in, so a phone never sees it (the dialog drops the nav item entirely).
 */
import { useEffect, useMemo, useState } from "react";
import type { LanInfo } from "../../../../shared/api.ts";
import { app, useApp } from "../../lib/app-store.ts";
import { copyText } from "../../lib/clipboard.ts";
import { relativeTime } from "../../lib/format.ts";
import { t } from "../../lib/i18n/index.ts";
import { qrMatrix } from "../../lib/qr.ts";
import { Row, Section } from "./controls.tsx";

const COMMAND = "ompweb --lan --restart";

/** 3+3, so six digits can be read out loud and typed without losing the place. */
function spaced(code: string): string {
	return `${code.slice(0, 3)} ${code.slice(3)}`;
}

/**
 * The pairing link as an SVG. Black on white is deliberate, and the one place in this app
 * that writes literal colours: a QR has to keep its contrast to scan, and no theme variable
 * promises that in both themes.
 */
function Qr({ link }: { link: string }) {
	const modules = useMemo(() => qrMatrix(link), [link]);
	const scale = 5;
	const size = modules.length * scale;
	return (
		<div className="lan-qr">
			<svg viewBox={`0 0 ${size} ${size}`} width={220} height={220} role="img" aria-label={t("set.pairLink", { link })}>
				<rect width={size} height={size} fill="#fff" />
				{modules.map((row, y) => row.map((dark, x) => (dark ? <rect key={`${x},${y}`} x={x * scale} y={y * scale} width={scale} height={scale} fill="#000" /> : null)))}
			</svg>
		</div>
	);
}

export function MobilePage() {
	const a = useApp();
	useEffect(() => {
		void app.loadLan();
		// The code can change under this page (a wrong-code flood rotates it), so keep it live.
		const timer = setInterval(() => void app.loadLan(), 5000);
		return () => clearInterval(timer);
	}, []);
	const lan = a.lan;
	// Unreadable means this browser is not on the machine running the gateway; the dialog
	// hides the page in that case, so there is nothing to show here either.
	if (!lan) return null;
	return (
		<>
			<h2 className="set-h2">{t("set.navMobile")}</h2>
			{lan.enabled ? <LanOn lan={lan} /> : <LanOff />}
		</>
	);
}

function LanOff() {
	const [copied, setCopied] = useState(false);
	return (
		<>
			<p className="set-lead">{t("set.mobileOffLead")}</p>
			<Section title={t("set.howToEnable")}>
				<Row title={t("set.restartService")} desc={<code className="set-path">{COMMAND}</code>}>
					<button
						className="btn"
						onClick={() =>
							void copyText(COMMAND).then(ok => {
								if (!ok) return;
								setCopied(true);
								setTimeout(() => setCopied(false), 1600);
							})
						}
					>
						{copied ? t("set.copied") : t("set.copyCommand")}
					</button>
				</Row>
				<Row
					title={t("set.firewall")}
					desc={t("set.firewallDesc")}
				/>
			</Section>
		</>
	);
}

function LanOn({ lan }: { lan: LanInfo }) {
	const [index, setIndex] = useState(0);
	const [copied, setCopied] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const url = lan.urls[index] ?? lan.urls[0];

	return (
		<>
			<p className="set-lead">{t("set.mobileOnLead")}</p>
			<Section title={t("set.accessCode")}>
				<Row title={t("set.currentCode")} desc={t("set.currentCodeDesc")}>
					<button
						className="lan-code"
						title={t("set.copyCode")}
						onClick={() =>
							void copyText(lan.code).then(ok => {
								if (!ok) return;
								setCopied(true);
								setTimeout(() => setCopied(false), 1600);
							})
						}
					>
						{copied ? t("set.copied") : spaced(lan.code)}
					</button>
				</Row>
				<Row title={t("set.rotateCode")} desc={t("set.rotateCodeDesc")}>
					<button className="btn" onClick={() => void app.rotateLanCode()}>
						{t("set.rotate")}
					</button>
				</Row>
			</Section>
			<Section title={t("set.phoneAddress")}>
				<div className="set-row">
					<div className="set-text">
						<div className="set-name">{t("set.openOnPhone")}</div>
						<div className="set-desc">
							{lan.urls.length === 0 ? t("set.noLanAddress") : t("set.multipleAddresses")}
						</div>
					</div>
				</div>
				{lan.urls.length > 0 && (
					<div className="lan-urls">
						{lan.urls.map((value, i) => (
							<button key={value} className={`btn ${i === index ? "primary" : "ghost"}`} onClick={() => setIndex(i)}>
								{value}
							</button>
						))}
					</div>
				)}
			</Section>
			{url && (
				<Section title={t("set.qrLogin")}>
					<Qr link={`${url}/#pair=${lan.code}`} />
					<div className="set-desc">{t("set.qrHint")}</div>
				</Section>
			)}
			<Section title={t("set.loggedInPhones")}>
				{lan.devices.length === 0 ? (
					<Row title={t("set.noDevices")} desc={t("set.noDevicesDesc")} />
				) : (
					lan.devices.map(device => (
						<Row key={`${device.label}-${device.lastSeen}`} title={device.label} desc={t("set.lastUsed", { time: relativeTime(device.lastSeen) })} />
					))
				)}
				{confirming ? (
					<Row title={t("set.confirmLogout")} desc={t("set.confirmLogoutDesc")}>
						<button className="btn ghost" onClick={() => setConfirming(false)}>
							{t("set.cancel")}
						</button>
						<button
							className="btn danger"
							onClick={() => {
								setConfirming(false);
								void app.revokeLanDevices();
							}}
						>
							{t("set.logoutAllCount", { n: lan.devices.length })}
						</button>
					</Row>
				) : (
					<Row title={t("set.logoutAll")} desc={t("set.logoutAllDesc")}>
						<button className="btn ghost danger-ghost" disabled={lan.devices.length === 0} onClick={() => setConfirming(true)}>
							{t("set.logoutAllBtn")}
						</button>
					</Row>
				)}
			</Section>
			<p className="set-lead danger-text">{t("set.securityNote")}</p>
		</>
	);
}
