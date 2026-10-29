/**
 * Stand-in for the `omp` binary in the update tests.
 *
 * Why a stub and not the real omp: `omp update` downloads and replaces a program, and
 * `omp update --check` reaches the release server. A test must do neither, so this
 * answers the same shapes from environment variables instead:
 *
 * - `STUB_UPDATE_OUTPUT`: what `omp update --check` prints.
 * - `STUB_UPDATE_CODE`: what `omp update` exits with.
 * - `STUB_UPDATE_ERROR`: the line `omp update` writes to stderr when it fails.
 * - `STUB_OMP_VERSION`: the version `omp --version` reports.
 * - `STUB_OMP_VERSION_NEW`: the version reported after `omp update` succeeded.
 * - `STUB_UPDATE_MARKER`: a file the stub creates once the update "happened", so the
 *   version really changes between the two reads — that is what installUpdate compares.
 */
import * as fs from "node:fs";

const args = process.argv.slice(2);
const version = process.env.STUB_OMP_VERSION ?? "18.13.3";
const marker = process.env.STUB_UPDATE_MARKER;

if (args[0] === "update") {
	// `--check` 只是問版本，不會換掉任何東西；真的 `omp update` 才寫標記。
	if (args.includes("--check")) {
		process.stdout.write(process.env.STUB_UPDATE_OUTPUT ?? "");
		process.exit(Number(process.env.STUB_UPDATE_CODE ?? 0));
	}
	if (process.env.STUB_UPDATE_ERROR) console.error(process.env.STUB_UPDATE_ERROR);
	process.stdout.write(process.env.STUB_UPDATE_OUTPUT ?? "");
	// The update "happens" unless the stub was told to fail.
	if (marker && !process.env.STUB_UPDATE_ERROR) fs.writeFileSync(marker, "done");
	process.exit(Number(process.env.STUB_UPDATE_CODE ?? 0));
}

if (args[0] === "--version") {
	const updated = marker && fs.existsSync(marker);
	process.stdout.write(`omp/${updated ? process.env.STUB_OMP_VERSION_NEW ?? version : version}\n`);
	process.exit(0);
}

process.exit(1);
