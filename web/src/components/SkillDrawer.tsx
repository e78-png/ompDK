/**
 * Skill detail drawer: where the skill came from, its SKILL.md, and a way to
 * start a conversation with it. Read-only apart from the enable switch.
 */
import { useEffect, useState } from "react";
import { SKILL_COMMAND_PREFIX } from "../../../shared/omp/conventions.ts";
import { app, useApp } from "../lib/app-store.ts";
import { Icon } from "../lib/icons.tsx";
import { avatarClass, groupName, initial, stripFrontmatter } from "../lib/skills.ts";
import { Markdown } from "../lib/markdown.tsx";
import { api } from "../lib/ws.ts";
import { Toggle } from "./settings/controls.tsx";

/** Takes the name, not the record: enabling a skill reloads the list underneath. */
export function SkillDrawer({ name, cwd, onClose }: { name: string; cwd: string; onClose: () => void }) {
	const a = useApp();
	// Only the plugins page loads the list; a conversation opens this by name alone.
	const skill = a.skills?.find(s => s.name === name);
	const [body, setBody] = useState<string | undefined>();
	const [error, setError] = useState("");
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		let alive = true;
		setBody(undefined);
		setError("");
		api<{ text: string }>(`/api/skills/file?name=${encodeURIComponent(name)}&cwd=${encodeURIComponent(cwd)}`)
			.then(r => {
				if (alive) setBody(r.text);
			})
			.catch(e => {
				if (alive) setError((e as Error).message);
			});
		return () => {
			alive = false;
		};
	}, [name, cwd]);

	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.stopPropagation();
			onClose();
		};
		document.addEventListener("keydown", onKey, true);
		return () => document.removeEventListener("keydown", onKey, true);
	}, [onClose]);

	const file = skill?.filePath;

	const copy = () => {
		if (!file) return;
		void navigator.clipboard
			.writeText(file)
			.then(() => {
				setCopied(true);
				setTimeout(() => setCopied(false), 1600);
			})
			.catch(e => app.notify("error", `复制失败：${(e as Error).message}`));
	};

	const reveal = () =>
		void api("/api/reveal", { method: "POST", body: JSON.stringify({ target: "skill", name, cwd }) }).catch(e => app.notify("error", (e as Error).message));

	return (
		<div className="sk-scrim" onPointerDown={e => e.target === e.currentTarget && onClose()}>
			<aside className="sk-drawer">
				<header className="sk-head">
					<span className={avatarClass(name)}>{initial(name)}</span>
					<div className="sk-title">
						<div className="sk-name">
							{name}
							{skill?.hide && <span className="pl-tag">仅手动</span>}
						</div>
						{skill && (
							<div className="sk-sub" title={skill.source}>
								{groupName(skill.source)} · {skill.source}
							</div>
						)}
					</div>
					{skill && <Toggle on={skill.enabled} onChange={v => void app.setSkillEnabled(skill.name, v)} />}
					<button className="icon-btn" title="关闭" onClick={onClose}>
						<Icon name="x" size={15} />
					</button>
				</header>
				{file && (
					<div className="sk-path">
						<code title={file}>{file}</code>
						<button className="icon-btn" title="复制路径" onClick={copy}>
							<Icon name={copied ? "check" : "copy"} size={14} />
						</button>
						<button className="icon-btn" title="在资源管理器中显示" onClick={reveal}>
							<Icon name="folder" size={14} />
						</button>
					</div>
				)}
				<div className="sk-body">
					{error && <div className="err-text">{error}</div>}
					{!error && body === undefined && <div className="pl-note">正在读取 SKILL.md…</div>}
					{body !== undefined && <Markdown text={stripFrontmatter(body)} />}
				</div>
				<footer className="sk-foot">
					<button className="btn primary" onClick={() => app.prefillHome(`${SKILL_COMMAND_PREFIX}${name} `)}>
						在新会话中使用
					</button>
				</footer>
			</aside>
		</div>
	);
}
