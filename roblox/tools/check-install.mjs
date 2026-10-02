// Reads the generated installers, parses them, and proves the embedded sources are
// byte-identical to src/**/*.lua with the right instance class and path.
//
// Covers both forms:
//   generated/InstallNight99.lua     every script in one file
//   generated/install-parts/*.lua     every script, split into small chunks
//
// This is the whole safety argument for paste-installing: the scaffolding around
// the sources is ~30 lines that luaparse validates, and everything else is diffed
// against the files they claim to be.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { MOUNTS, classFor, listLuaFiles, mountPath, rojoTreeFrom } from "./mounts.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const GENERATED = `${ROOT}/generated`;
const WHOLE = `${GENERATED}/InstallNight99.lua`;
const PARTS = `${GENERATED}/install-parts`;

const luaparse = createRequire(import.meta.url)("luaparse");

const errors = [];

// --- string decoding -----------------------------------------------------------

/**
 * The decoded value of a string literal.
 *
 * luaparse 0.3.x leaves `value` null for every string and only fills in `raw` (the
 * delimited source text), so decode from that: long brackets first, then quotes.
 */
function stringOf(node) {
	if (node?.type !== "StringLiteral") return null;
	if (typeof node.value === "string") return node.value;

	const raw = node.raw;
	if (typeof raw !== "string") return null;

	const long = /^\[(=*)\[/.exec(raw);
	if (long) {
		const edge = 2 + long[1].length;
		const closer = "]" + long[1] + "]";
		if (!raw.endsWith(closer)) return null;
		return raw.slice(edge, raw.length - edge);
	}

	const quote = raw[0];
	if ((quote === '"' || quote === "'") && raw.length >= 2 && raw.endsWith(quote)) {
		const escapes = { n: "\n", t: "\t", r: "\r" };
		return raw.slice(1, -1).replace(/\\(.)/g, (_, c) => escapes[c] ?? c);
	}
	return null;
}

/**
 * A table constructor as { key, valueNode } pairs. luaparse 0.3.x emits
 * TableValue / TableKeyString, where the key of the latter is an Identifier.
 */
function fields(tableNode) {
	return tableNode.fields.map((f) => {
		if (f.type === "TableKeyString") {
			return { key: f.key.name ?? f.key.value, value: f.value };
		}
		if (f.type === "TableValue") {
			return { key: null, value: f.value };
		}
		return { key: null, value: f };
	});
}

/** luaparse stores LocalStatement.init as one expression per variable. */
function initOf(statement) {
	return Array.isArray(statement.init) ? statement.init[0] : statement.init;
}

/** "line 42: `a` != `b`" -- the first place two sources differ. */
function describeDiff(a, b) {
	const al = a.split("\n");
	const bl = b.split("\n");
	const n = Math.max(al.length, bl.length);
	for (let i = 0; i < n; i++) {
		if (al[i] === bl[i]) continue;
		return (
			`first difference at line ${i + 1}: embedded ${JSON.stringify(al[i] ?? "<end of file>")}, ` +
			`src/ ${JSON.stringify(bl[i] ?? "<end of file>")}`
		);
	}
	return "identical line for line but not byte-identical (line endings differ)";
}

/**
 * Parse one installer file into Map<path, { className, source }>.
 * Returns { ok: false, reason } when the file will not yield a clean SOURCES table.
 */
function extract(label, text) {
	let ast;
	try {
		ast = luaparse.parse(text, { luaVersion: "5.1" });
	} catch (err) {
		return { ok: false, reason: `${label} does not parse: ${err.message}` };
	}

	const decl = ast.body.find((s) => {
		if (s.type !== "LocalStatement") return false;
		if (s.variables.length !== 1 || s.variables[0].name !== "SOURCES") return false;
		return initOf(s)?.type === "TableConstructorExpression";
	});
	if (!decl) {
		return { ok: false, reason: `${label} has no \`local SOURCES = { ... }\` table` };
	}

	const map = new Map();
	for (const fieldNode of initOf(decl).fields) {
		const entryNode = fieldNode.type === "TableValue" ? fieldNode.value : fieldNode;
		if (entryNode?.type !== "TableConstructorExpression") {
			return { ok: false, reason: `${label} has a SOURCES entry that is not a table` };
		}

		const f = fields(entryNode);
		const pathNode = f.find((x) => x.key === "path")?.value;
		const className = stringOf(f.find((x) => x.key === "className")?.value);
		const source = stringOf(f.find((x) => x.key === "source")?.value);

		if (pathNode?.type !== "TableConstructorExpression") {
			return { ok: false, reason: `${label} has a SOURCES entry with no path array` };
		}
		if (source === null) {
			return { ok: false, reason: `${label} has a SOURCES entry with no readable source` };
		}

		const path = pathNode.fields.map((v) => stringOf(v.type === "TableValue" ? v.value : v)).join(".");
		if (path === "" || path.includes("..")) {
			return { ok: false, reason: `${label} has a SOURCES entry with an unreadable path` };
		}
		if (map.has(path)) {
			return { ok: false, reason: `${label} lists ${path} twice` };
		}
		map.set(path, { className, source });
	}

	return { ok: true, map };
}

// --- what should exist on disk --------------------------------------------------
const onDisk = new Map();
for (const mount of MOUNTS) {
	for (const file of listLuaFiles({ readdirSync, readFileSync }, ROOT, mount.dir)) {
		const path = mountPath(mount, file.name).join(".");
		onDisk.set(path, { className: classFor(mount, file.source), source: file.source });
	}
}

/**
 * Compare one installer's contents against disk. `label` goes in any error.
 *
 * A single-file installer must carry everything, so `requireComplete` is on there.
 * The parts each carry only a slice, so for those we compare what is present and let
 * the caller check coverage across the whole set.
 */
function verify(label, map, requireComplete) {
	const seen = new Set();
	for (const [path, got] of map) {
		const want = onDisk.get(path);
		if (!want) {
			errors.push(`${label}: ${path} is not a file in src/`);
			continue;
		}
		seen.add(path);
		if (got.source !== want.source) {
			errors.push(`${label}: source differs for ${path} -- ${describeDiff(got.source, want.source)}`);
		}
		if (got.className !== want.className) {
			errors.push(`${label}: wrong class for ${path} -- installer says ${got.className}, expected ${want.className}`);
		}
	}
	if (requireComplete) {
		for (const path of onDisk.keys()) {
			if (!seen.has(path)) errors.push(`${label}: missing ${path}`);
		}
	}
	return seen;
}

// --- the single-paste installer -------------------------------------------------
let wholeCount = 0;
try {
	const res = extract("InstallNight99.lua", readFileSync(WHOLE, "utf8"));
	if (!res.ok) {
		errors.push(res.reason);
	} else {
		wholeCount = verify("InstallNight99.lua", res.map, true).size;
	}
} catch {
	errors.push("generated/InstallNight99.lua is missing -- run `npm run build`");
}

// --- the numbered parts ---------------------------------------------------------
let partFiles = [];
try {
	partFiles = readdirSync(PARTS).filter((f) => f.endsWith(".lua")).sort();
} catch {
	errors.push("generated/install-parts/ is missing -- run `npm run build`");
}

const covered = new Map();
for (const file of partFiles) {
	const res = extract(`install-parts/${file}`, readFileSync(`${PARTS}/${file}`, "utf8"));
	if (!res.ok) {
		errors.push(res.reason);
		continue;
	}
	for (const path of verify(`install-parts/${file}`, res.map, false)) {
		if (covered.has(path)) {
			errors.push(`install-parts: ${path} is covered by more than one part`);
		}
		covered.set(path, true);
	}
}
for (const path of onDisk.keys()) {
	if (!covered.has(path)) errors.push(`install-parts: no part covers ${path}`);
}

// --- the installer and Rojo must target the same instances ---------------------
//
// The paste installer and `rojo serve` are two ways to install the same scripts.
// If they disagree about an instance name, one of them works and the other hangs,
// so the disagreement has to be impossible rather than merely unlikely.
let rojoMatch = 0;
try {
	const rojo = rojoTreeFrom(ROOT, JSON.parse(readFileSync(`${ROOT}/default.project.json`, "utf8")));
	for (const path of onDisk.keys()) {
		if (!rojo.has(path)) {
			errors.push(`rojo disagreement: installer targets ${path} but Rojo would not create it`);
		} else {
			rojoMatch++;
		}
	}
} catch (err) {
	errors.push(`cannot cross-check against default.project.json: ${err.message}`);
}

// --- report --------------------------------------------------------------------
if (errors.length > 0) {
	for (const e of errors) console.error(`  X  ${e}`);
	console.error(`\nInstaller FAILED with ${errors.length} problem(s).`);
	process.exit(1);
}

console.log(`  .  InstallNight99.lua parses, ${wholeCount} scripts byte-identical to src/`);
console.log(`  .  install-parts/ ${partFiles.length} parts cover the same ${covered.size} scripts`);
console.log(`  .  all ${rojoMatch} target paths match what Rojo would create`);
console.log("Installer OK.");