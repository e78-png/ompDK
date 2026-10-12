/**
 * Settings → 手机访问. Only the machine running the gateway can read this page: the code it
 * shows is the way in, so a phone never sees it (the dialog drops the nav item entirely).
 */
import { useEffect, useMemo, useState } from "react";
import type { LanInfo } from "../../../../shared/api.ts";
import { app, useApp } from "../../lib/app-store.ts";
import { copyText } from "../../lib/clipboard.ts";
import { relativeTime } from "../../lib/format.ts";
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
			<svg viewBox={`0 0 ${size} ${size}`} width={220} height={220} role="img" aria-label={`配对链接 ${link}`}>
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
			<h2 className="set-h2">手机访问</h2>
			{lan.enabled ? <LanOn lan={lan} /> : <LanOff />}
		</>
	);
}

function LanOff() {
	const [copied, setCopied] = useState(false);
	return (
		<>
			<p className="set-lead">现在只有这台电脑能打开。手机和电脑连同一个 Wi-Fi 后，用下面的方式开启，手机浏览器会看到输入访问码的页面。</p>
			<Section title="怎么开启">
				<Row title="重新启动服务" desc={<code className="set-path">{COMMAND}</code>}>
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
						{copied ? "已复制" : "复制命令"}
					</button>
				</Row>
				<Row
					title="Windows 防火墙"
					desc="首次开启时弹窗问是否允许 bun 访问网络，勾选「专用网络」。如果手机打不开，检查电脑连的这个 Wi-Fi 是不是被设成了「专用网络」——公用网络的入站连接会被防火墙拦掉。"
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
			<p className="set-lead">手机和电脑连同一个 Wi-Fi，用手机浏览器打开下面的地址，输入访问码。输对一次后，那台手机 30 天内不用再输。</p>
			<Section title="访问码">
				<Row title="本次启动的访问码" desc="每次启动服务都会换一个。输错太多次会锁住十分钟，累计错够二十次会自动更换。">
					<button
						className="lan-code"
						title="复制访问码"
						onClick={() =>
							void copyText(lan.code).then(ok => {
								if (!ok) return;
								setCopied(true);
								setTimeout(() => setCopied(false), 1600);
							})
						}
					>
						{copied ? "已复制" : spaced(lan.code)}
					</button>
				</Row>
				<Row title="换一个访问码" desc="已经在用的手机不受影响，新手机要用新码。">
					<button className="btn" onClick={() => void app.rotateLanCode()}>
						换一个
					</button>
				</Row>
			</Section>
			<Section title="手机地址">
				<div className="set-row">
					<div className="set-text">
						<div className="set-name">用手机打开</div>
						<div className="set-desc">
							{lan.urls.length === 0 ? "没有找到可用的局域网地址。检查电脑是否连上了 Wi-Fi，或者换个网络后刷新这一页。" : "多个地址时挑一个手机能连上的，它就是下面二维码的内容。"}
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
				<Section title="扫码登录">
					<Qr link={`${url}/#pair=${lan.code}`} />
					<div className="set-desc">扫这个码直接进入并登录，不用手输访问码。</div>
				</Section>
			)}
			<Section title="已登录的手机">
				{lan.devices.length === 0 ? (
					<Row title="还没有手机登录过" desc="配对成功后这里会列出它。" />
				) : (
					lan.devices.map(device => (
						<Row key={`${device.label}-${device.lastSeen}`} title={device.label} desc={`最近使用 ${relativeTime(device.lastSeen)}`} />
					))
				)}
				{confirming ? (
					<Row title="让所有手机退出登录？" desc="它们下次操作时会回到输入访问码的页面。">
						<button className="btn ghost" onClick={() => setConfirming(false)}>
							取消
						</button>
						<button
							className="btn danger"
							onClick={() => {
								setConfirming(false);
								void app.revokeLanDevices();
							}}
						>
							全部退出（{lan.devices.length} 台）
						</button>
					</Row>
				) : (
					<Row title="让所有手机退出登录" desc="已经在用的手机需要重新输入访问码。">
						<button className="btn ghost danger-ghost" disabled={lan.devices.length === 0} onClick={() => setConfirming(true)}>
							全部退出
						</button>
					</Row>
				)}
			</Section>
			<p className="set-lead danger-text">只在家里或可信的 Wi-Fi 下开启：这里是 HTTP，同一个网络里有人抓包就能拿到登录凭据和对话内容。不用手机时，去掉 --lan 重启即可关闭。</p>
		</>
	);
}
