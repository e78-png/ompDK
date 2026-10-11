/**
 * Fails when production code outside `server/omp/` and `shared/omp/` spells out something
 * that belongs to omp: a flag, its profile variable, a config key, a message role, a
 * `customType`, or a piece of its prose.
 *
 * The point is not tidiness. Each of these strings is a feature that stops working
 * quietly when omp renames it — no compile error, no failing test, just a screen that
 * shows less than it used to. Centralised, there is one place to fix and one place to
 * look.
 *
 * Written as a script rather than the `rg` the plan suggested, because the patterns are
 * shell-hostile (`--mode`, `-p` get rewritten by Git Bash on Windows) and because it has
 * to behave the same here and in CI.
 *
 * `tests/` is deliberately not scanned. A fixture that stands in for omp has to name its
 * flags and keys exactly as omp spells them — that is the whole value of the fixture —
 * and tests assert against real strings for the same reason. What omp's *binary* actually
 * accepts is `bun run omp:check`'s business, not this file's.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";

/** Directories that are allowed to know these things. */
const ALLOWED_PREFIXES = ["server/omp/", "shared/omp/"];
/** This script holds the patterns as data, so it is the one file that must not be scanned. */
const EXEMPT = ["scripts/lint-omp.ts"];
const ROOTS = ["server", "shared", "web/src", "scripts"];

/** Literal to look for → what to do instead. Flags and keys are matched in their quoted form. */
const PATTERNS: [string, string][] = [
	["PI_CODING_AGENT_DIR", "use ompEnv() from server/omp/cli.ts"],
	["config.ompBin", "only server/omp/cli.ts assembles a command line"],
	['"--mode"', "add a builder to server/omp/cli.ts"],
	['"--resume"', "add a builder to server/omp/cli.ts"],
	['"--no-session"', "add a builder to server/omp/cli.ts"],
	['"--no-extensions"', "add a builder to server/omp/cli.ts"],
	['"--max-time"', "add a builder to server/omp/cli.ts"],
	['"--provider"', "add a builder to server/omp/cli.ts"],
	['"--model"', "add a builder to server/omp/cli.ts"],
	['"-p"', "add a builder to server/omp/cli.ts"],
	['"modelRoles"', "use CONFIG_KEYS from shared/omp/conventions.ts"],
	['"task.agentModelOverrides"', "use CONFIG_KEYS from shared/omp/conventions.ts"],
	['"plan.defaultOnStartup"', "use CONFIG_KEYS from shared/omp/conventions.ts"],
	['"disabledExtensions"', "use CONFIG_KEYS from shared/omp/conventions.ts"],
	['"skill-prompt"', "use CUSTOM_TYPES from shared/omp/conventions.ts"],
	['"command-output"', "use CUSTOM_TYPES from shared/omp/conventions.ts"],
	['"command-echo"', "use CUSTOM_TYPES from shared/omp/conventions.ts"],
	['"compactionSummary"', "use SUMMARY_ROLES from shared/omp/conventions.ts"],
	['"branchSummary"', "use SUMMARY_ROLES from shared/omp/conventions.ts"],
	['"toolResult"', "use MESSAGE_ROLES from shared/omp/conventions.ts"],
	['"bashExecution"', "use MESSAGE_ROLES from shared/omp/conventions.ts"],
	['"/skill:"', "use SKILL_COMMAND_PREFIX from shared/omp/conventions.ts"],
	['"skill:"', "use SKILL_EXTENSION_PREFIX from shared/omp/conventions.ts"],
	["Could not restore", "use classifyOmpError from server/omp/errors.ts"],
	["User invoked the", "use skillNameOf from shared/omp/conventions.ts"],
	['"session_busy"', "use classifyOmpError from server/omp/errors.ts"],
	['"stale_cursor"', "use classifyOmpError from server/omp/errors.ts"],
	['"unknown_since"', "use classifyOmpError from server/omp/errors.ts"],
];

const allowed = (file: string) => [...ALLOWED_PREFIXES, ...EXEMPT].some(prefix => file.startsWith(prefix));

const hits: string[] = [];

async function walk(dir: string, out: string[]): Promise<void> {
	for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
		if (entry.name.startsWith(".")) continue;
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) await walk(full, out);
		else if (/\.tsx?$/.test(entry.name)) out.push(full.replace(/\\/g, "/"));
	}
}

const files: string[] = [];
for (const root of ROOTS) {
	try {
		await walk(root, files);
	} catch {
		console.error(`nothing to scan under ${root}`);
	}
}

for (const file of files.sort()) {
	if (allowed(file)) continue;
	const text = await Bun.file(file).text();
	text.split("\n").forEach((line, index) => {
		for (const [pattern, fix] of PATTERNS) {
			if (line.includes(pattern)) hits.push(`${file}:${index + 1}  ${pattern}  → ${fix}`);
		}
	});
}

if (hits.length) {
	console.error(`omp knowledge outside server/omp and shared/omp:\n`);
	for (const hit of hits) console.error(`  ${hit}`);
	console.error(`\n${hits.length} hit(s). Move it into server/omp/ or shared/omp/conventions.ts, or add it to a builder.`);
	process.exit(1);
}
console.log(`omp knowledge is confined to server/omp and shared/omp (${files.length} files scanned, ${PATTERNS.length} patterns).`);
