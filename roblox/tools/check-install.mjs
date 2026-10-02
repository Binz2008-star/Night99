// Reads generated/InstallNight99.lua, parses it, and proves the embedded sources
// are byte-identical to src/**/*.lua with the right instance class and path.
//
// This is the whole safety argument for the paste installer: the scaffolding around
// the sources is ~30 lines that luaparse validates, and everything else is diffed.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { MOUNTS, classFor, listLuaFiles, mountPath } from "./mounts.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INSTALLER = `${ROOT}/generated/InstallNight99.lua`;

const luaparse = createRequire(import.meta.url)("luaparse");

const errors = [];

let text;
try {
	text = readFileSync(INSTALLER, "utf8");
} catch {
	console.error("FAIL  generated/InstallNight99.lua is missing. Run `npm run build` first.");
	process.exit(1);
}

// --- 1. The installer itself must be valid Lua --------------------------------
let ast;
try {
	ast = luaparse.parse(text, { luaVersion: "5.1" });
} catch (err) {
	console.error(`FAIL  generated/InstallNight99.lua does not parse: ${err.message}`);
	process.exit(1);
}

// --- 2. Pull the SOURCES table out of the AST ---------------------------------

/**
 * The decoded value of a string literal.
 *
 * luaparse 0.3.x leaves `value` null for every string and only fills in `raw`
 * (the delimited source text), so decode from that: long brackets first, then
 * quoted strings.
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

// --- find `local SOURCES = { ... }` --------------------------------------------
const sourcesDecl = ast.body.find((s) => {
	if (s.type !== "LocalStatement") return false;
	if (s.variables.length !== 1 || s.variables[0].name !== "SOURCES") return false;
	return initOf(s)?.type === "TableConstructorExpression";
});

if (!sourcesDecl) {
	console.error("FAIL  no `local SOURCES = { ... }` table found in the installer.");
	process.exit(1);
}

/** "line 42: `Max = 100,` != `Max = 999,`" -- the first place two sources differ. */
function describeDiff(a, b) {
	const al = a.split("\n");
	const bl = b.split("\n");
	const n = Math.max(al.length, bl.length);
	for (let i = 0; i < n; i++) {
		if (al[i] === bl[i]) continue;
		return `first difference at line ${i + 1}: embedded ${JSON.stringify(al[i] ?? "<end of file>")}, ` +
			`src/ ${JSON.stringify(bl[i] ?? "<end of file>")}`;
	}
	return "identical line for line but not byte-identical (line endings differ)";
}

const embedded = new Map();

for (const fieldNode of initOf(sourcesDecl).fields) {
	// Each element of SOURCES is itself a table constructor.
	const entryNode = fieldNode.type === "TableValue" ? fieldNode.value : fieldNode;
	if (entryNode?.type !== "TableConstructorExpression") {
		errors.push("SOURCES entry is not a table");
		continue;
	}

	const f = fields(entryNode);
	const pathNode = f.find((x) => x.key === "path")?.value;
	const className = stringOf(f.find((x) => x.key === "className")?.value);
	const source = stringOf(f.find((x) => x.key === "source")?.value);

	if (pathNode?.type !== "TableConstructorExpression") {
		errors.push("SOURCES entry is missing a path array");
		continue;
	}
	if (source === null) {
		errors.push("SOURCES entry has no readable source string");
		continue;
	}

	const path = pathNode.fields
		.map((v) => stringOf(v.type === "TableValue" ? v.value : v))
		.join(".");
	if (path.includes("..") || path === "") {
		errors.push(`SOURCES entry has an unreadable path: "${path}"`);
		continue;
	}
	embedded.set(path, { className, source });
}

// --- 3. Every file on disk must appear, exactly once, byte-for-byte -----------
let expected = 0;
for (const mount of MOUNTS) {
	for (const file of listLuaFiles({ readdirSync, readFileSync }, ROOT, mount.dir)) {
		expected += 1;
		const path = mountPath(mount, file.name).join(".");
		const got = embedded.get(path);
		if (!got) {
			errors.push(`missing from the installer: ${path}`);
			continue;
		}
		if (got.source !== file.source) {
			errors.push(`source differs for ${path}: ${describeDiff(got.source, file.source)}`);
		}
		const wantClass = classFor(mount, file.source);
		if (got.className !== wantClass) {
			errors.push(`wrong class for ${path}: installer says ${got.className}, expected ${wantClass}`);
		}
		embedded.delete(path);
	}
}

for (const leftover of embedded.keys()) {
	errors.push(`in the installer but not in src/: ${leftover}`);
}

// --- report -------------------------------------------------------------------
if (errors.length > 0) {
	for (const e of errors) console.error(`  X  ${e}`);
	console.error(`\nInstaller FAILED with ${errors.length} problem(s).`);
	process.exit(1);
}

console.log("  .  installer parses as Lua 5.1");
console.log(`  .  ${expected} scripts embedded, sources byte-identical to src/`);
console.log("Installer OK.");