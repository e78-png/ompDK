/**
 * Stand-in for the `omp` binary in tests. `config list|get|set` read and write the
 * JSON file named by STUB_CONFIG_FILE; `skill list --json` serves
 * STUB_SKILLS_FILE while hiding the names listed in `disabledExtensions` (exactly
 * like omp does); `plugin list --json` serves STUB_PLUGINS_FILE; and
 * `plugin enable|disable <id>` appends to STUB_PLUGIN_LOG; STUB_LIST_DELAY_MS slows
 * `config list` down so a test can have a read straddle a write; `models --json`
 * serves STUB_MODELS, can be delayed with STUB_MODELS_DELAY_MS or failed with
 * STUB_MODELS_FAIL, and counts each call into STUB_CALLS_FILE; STUB_MODELS_FAIL_AFTER=N
 * fails only the calls after the Nth (it counts through STUB_CALLS_FILE, so both are
 * needed); STUB_MODELS_WARN_AFTER=N answers those later calls the way a real omp answers a
 * file it rejects — exit 0, one `Validate(models) error:` line taken from STUB_MODELS_WARN,
 * and an empty model list because every custom provider got disabled; and `--mode rpc-ui`
 * stands in for a session process, pushing `available_commands_update` (or staying
 * silent with STUB_COMMANDS_SILENT, or exiting at once with STUB_COMMANDS_EXIT) so
 * the gateway's command probe has something to talk to; `get_state` answers with the file
 * this stub was given on `--resume`, and STUB_STATE_FILE plus STUB_STATE_FILE_AFTER=N make
 * the session move to that file after N reads (counted inside this stub process, so each
 * session has its own count) the way omp does when the file it was handed is taken; STUB_EXIT_DELAY_MS keeps a
 * session stub alive for that long after its input closes, like a child mid-turn; STUB_READY_DELAY_MS keeps
 * it before the ready frame so shutdown tests can hold an init in flight. Only the exit-delay test writes an
 * `exit` line in STUB_CALLS_FILE (other suites count those lines as process starts). Commands named in
 * STUB_FAIL_COMMANDS are answered as an older omp answers a command it has never
 * heard of — `success: false` with `Unknown command: <type>` — which is how a test
 * drives the capability handshake and the paging fallback.
 */
import * as fs from "node:fs";

const file = process.env.STUB_CONFIG_FILE;
if (!file) {
	console.error("STUB_CONFIG_FILE is not set");
	process.exit(2);
}
const cfgFile = file;

type All = Record<string, { value: unknown; type: string; description: string }>;

function load(): All {
	try {
		return JSON.parse(fs.readFileSync(cfgFile, "utf8")) as All;
	} catch {
		return {};
	}
}

const [cmd, sub, key, raw] = process.argv.slice(2);
if (cmd === "config") {
	if (sub === "list") {
		// Stand-in for a read still running when a write lands: the snapshot is taken
		// before the delay, so it holds the pre-write config, like a real read would.
		const snapshot = JSON.stringify(load());
		const delay = Number(process.env.STUB_LIST_DELAY_MS ?? 0);
		if (delay > 0) await Bun.sleep(delay);
		console.log(snapshot);
	} else if (sub === "get") {
		console.log(JSON.stringify(load()[key] ?? { value: null }));
	} else if (sub === "set") {
		if (raw.includes("REJECT")) {
			console.error("set: rejected by policy\nsee the config docs");
			process.exit(3);
		}
		const all = load();
		all[key] = { value: JSON.parse(raw), type: "stub", description: "" };
		fs.writeFileSync(cfgFile, JSON.stringify(all, null, 2));
	} else {
		console.error(`unsupported subcommand: ${sub}`);
		process.exit(2);
	}
} else if (cmd === "skill" && sub === "list") {
	type Skill = { name: string };
	const all = JSON.parse(fs.readFileSync(process.env.STUB_SKILLS_FILE ?? "", "utf8")) as Skill[];
	const disabled = new Set(((load().disabledExtensions?.value ?? []) as string[]).map(String));
	console.log(JSON.stringify({ skills: all.filter(s => !disabled.has(`skill:${s.name}`)) }));
} else if (cmd === "plugin" && sub === "list") {
	try {
		process.stdout.write(fs.readFileSync(process.env.STUB_PLUGINS_FILE ?? "", "utf8"));
	} catch {
		console.log(JSON.stringify({ npm: [], marketplace: [] }));
	}
} else if (cmd === "plugin" && (sub === "enable" || sub === "disable")) {
	if (key === "boom") {
		console.error("plugin: unknown id");
		process.exit(4);
	}
	fs.appendFileSync(process.env.STUB_PLUGIN_LOG ?? "", `${sub} ${key}\n`);
} else if (cmd === "--mode" && sub === "rpc-ui") {
	const send = (o: unknown) => process.stdout.write(`${JSON.stringify(o)}\n`);
	const commands = process.env.STUB_COMMANDS ? JSON.parse(process.env.STUB_COMMANDS) : [{ name: "context", source: "builtin", description: "Show context usage" }];
	if (process.env.STUB_CALLS_FILE) fs.appendFileSync(process.env.STUB_CALLS_FILE, "rpc-ui\n");
	const readyDelay = Number(process.env.STUB_READY_DELAY_MS ?? 0);
	if (readyDelay > 0) await Bun.sleep(readyDelay);
	send({ type: "ready", supportedProtocolVersions: [1, 2] });
	if (process.env.STUB_COMMANDS_EXIT) process.exit(7);
	const serving = (async () => {
		const text = new TextDecoder();
		let buf = "";
		// `STUB_STATE_FILE_AFTER` counts inside this process, so every session gets its own.
		const moved = process.env.STUB_STATE_FILE;
		const moveAfter = Number(process.env.STUB_STATE_FILE_AFTER ?? 0);
		const argv = process.argv.slice(2);
		const resumed = argv[argv.indexOf("--resume") + 1];
		let states = 0;
		for await (const chunk of process.stdin) {
			buf += text.decode(chunk as Uint8Array, { stream: true });
			let nl = buf.indexOf("\n");
			while (nl >= 0) {
				const line = buf.slice(0, nl).trim();
				buf = buf.slice(nl + 1);
				nl = buf.indexOf("\n");
				if (!line) continue;
				const frame = JSON.parse(line) as { id?: string; type?: string };
				if (!frame.id) continue;
				const refused = (process.env.STUB_FAIL_COMMANDS ?? "").split(",").some(type => type.trim() === frame.type);
				if (refused) send({ type: "response", id: frame.id, success: false, error: `Unknown command: ${frame.type}` });
				else if (frame.type === "get_state" && moved) send({ type: "response", id: frame.id, success: true, data: { sessionFile: ++states > moveAfter ? moved : resumed } });
				else send({ type: "response", id: frame.id, success: true, data: frame.type === "get_available_commands" ? { commands } : {} });
			}
		}
	})();
	if (!process.env.STUB_COMMANDS_SILENT) {
		const delay = Number(process.env.STUB_COMMANDS_DELAY_MS ?? 0);
		if (delay > 0) await Bun.sleep(delay);
		send({ type: "available_commands_update", commands });
	}
	// Like omp: end once the host closes its input, so stopping a probe really stops it.
	await serving;
	// A child that is mid-turn does not vanish the instant its input closes; D3's test needs
	// that window. Its `exit` line is only written for that test, because other suites count
	// the lines in STUB_CALLS_FILE as process starts.
	const exitDelay = Number(process.env.STUB_EXIT_DELAY_MS ?? 0);
	if (exitDelay > 0) {
		await Bun.sleep(exitDelay);
		if (process.env.STUB_CALLS_FILE) fs.appendFileSync(process.env.STUB_CALLS_FILE, "exit\n");
	}
	process.exit(0);
} else if (cmd === "models") {
	// Which models call this is, so a test can make omp answer once and then not:
	// STUB_MODELS_FAIL_AFTER=1 = "readable before the write, unreadable after it".
	let calls = 0;
	if (process.env.STUB_CALLS_FILE) {
		fs.appendFileSync(process.env.STUB_CALLS_FILE, `models\n`);
		calls = fs
			.readFileSync(process.env.STUB_CALLS_FILE, "utf8")
			.split("\n")
			.filter(line => line.trim() === "models").length;
	}
	const failAfter = Number(process.env.STUB_MODELS_FAIL_AFTER ?? 0);
	if (process.env.STUB_MODELS_FAIL || (failAfter > 0 && calls > failAfter)) {
		console.error("models: provider unreachable");
		process.exit(5);
	}
	// What a real omp does when one provider fails its schema: it exits 0, prints the
	// complaint, and returns nothing because every custom provider got disabled.
	const warnAfter = Number(process.env.STUB_MODELS_WARN_AFTER ?? 0);
	if (warnAfter > 0 && calls > warnAfter) {
		console.log("Warning: models.yml validation failed — custom providers disabled");
		console.log(`Failed to load config file models, Validate(models) error: ${process.env.STUB_MODELS_WARN ?? "a provider is invalid"}`);
		console.log(JSON.stringify({ models: [] }));
		process.exit(0);
	}
	const delay = Number(process.env.STUB_MODELS_DELAY_MS ?? 0);
	if (delay > 0) await Bun.sleep(delay);
	const models = process.env.STUB_MODELS ? JSON.parse(process.env.STUB_MODELS) : [{ provider: "p1", id: "m1", name: "M1", kind: "chat" }];
	console.log(JSON.stringify({ models }));
} else {
	console.error(`unsupported command: ${[cmd, sub].join(" ")}`);
	process.exit(2);
}
