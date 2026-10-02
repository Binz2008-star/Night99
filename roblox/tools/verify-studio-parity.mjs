// Verify the sources now living in Roblox Studio match src/** exactly.
//
// Studio reported a length smaller than the on-disk file for every script, by
// exactly one byte per line. That smells like CRLF on disk versus LF in Studio
// rather than truncated content, so this compares both, using the same rolling
// checksum the Luau in Studio computed.
//
//   node tools/verify-studio-parity.mjs                 # print what src/ should hash to
//   node tools/verify-studio-parity.mjs '<studio json>'  # compare against Studio
//
// Line endings are compared separately rather than normalised away silently, because
// a difference that is only ever explained away is a difference nobody is watching.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { MOUNTS, listLuaFiles, mountPath, classFor } from "./mounts.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fs = { readFileSync, readdirSync };

/** Same algorithm as the Luau used in Studio: sum = (sum * 131 + byte) % 2147483647 */
function checksum(s) {
	let sum = 0;
	for (let i = 0; i < s.length; i++) {
		sum = (sum * 131 + s.charCodeAt(i)) % 2147483647;
	}
	return sum;
}

const expected = {};
for (const mount of MOUNTS) {
	for (const file of listLuaFiles(fs, ROOT, mount.dir)) {
		const path = mountPath(mount, file.name).join(".");
		const lf = file.source.replace(/\r\n/g, "\n");
		expected[path] = {
			className: classFor(mount, file.source),
			rawLen: file.source.length,
			rawSum: checksum(file.source),
			lfLen: lf.length,
			lfSum: checksum(lf),
			crlf: file.source.includes("\r\n"),
		};
	}
}

const arg = process.argv[2];
if (!arg) {
	console.log(JSON.stringify(expected, null, 2));
	process.exit(0);
}

let studio;
try {
	studio = JSON.parse(arg);
} catch (err) {
	console.error(`first argument is not JSON: ${err.message}`);
	process.exit(1);
}

const problems = [];
let raw = 0;
let lfOnly = 0;

for (const s of studio) {
	const e = expected[s.path];
	if (!e) {
		problems.push(`${s.path}: present in Studio but not in src/`);
		continue;
	}
	if (e.className !== s.class) {
		problems.push(`${s.path}: Studio has it as ${s.class}, src/ says ${e.className}`);
	}

	const rawMatch = s.len === e.rawLen && s.sum === e.rawSum;
	const lfMatch = s.len === e.lfLen && s.sum === e.lfSum;
	if (rawMatch) raw++;
	else if (lfMatch) lfOnly++;
	else {
		problems.push(
			`${s.path}: Studio(len=${s.len},sum=${s.sum}) matches neither the file on disk ` +
				`(len=${e.rawLen},sum=${e.rawSum}) nor its LF form (len=${e.lfLen},sum=${e.lfSum})`
		);
		continue;
	}
	console.log(`  ${(rawMatch ? "identical" : "LF only").padEnd(10)} ${s.class.padEnd(13)} ${s.path}`);
}

for (const path of Object.keys(expected)) {
	if (!studio.some((s) => s.path === path)) {
		problems.push(`${path}: present in src/ but missing from Studio`);
	}
}

console.log("");
if (problems.length > 0) {
	for (const p of problems) console.error(`  X  ${p}`);
	console.error(`\nStudio parity FAILED with ${problems.length} problem(s).`);
	process.exit(1);
}

console.log(
	`Studio parity OK. ${studio.length} scripts: ${raw} byte-identical, ` +
		`${lfOnly} identical after LF normalisation (Studio stores \`\\n\`; ` +
		`the working copy is ${Object.values(expected).some((e) => e.crlf) ? "CRLF" : "LF"}).`
);