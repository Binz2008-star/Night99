// Syntax-checks every Lua file in the project with luaparse, then looks for the one
// class of mistake luaparse cannot see: passing a Roblox datatype to Instance.new.
//   node tools/check-lua.mjs
//
// Datatypes (UDim, Color3, Vector3, NumberSequence, ...) are not Instances. They
// parse fine, luaparse is happy, and they blow up at runtime with a bare
// "Unable to create an Instance of type" that names no file and no line. This is not
// hypothetical: it shipped, and only a playtest caught it.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const luaparse = require("luaparse");

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");

/**
 * Roblox datatypes that are definitely not creatable with Instance.new.
 *
 * Deliberately a list of things that are *not* Instances rather than a list of ones
 * that are: a typo in a real class name then reads as "unknown, not flagged" instead
 * of producing a false positive that trains us to ignore this check.
 */
const DATATYPES = new Set([
	"CFrame", "Color3", "Color3uint8", "Color4", "ColorSequence", "DateTime", "Enum",
	"Font", "GlobalRbxError", "Instance", "NumberRange", "NumberSequence",
	"NumberSequenceKeypoint", "Random", "Ray", "Rect", "Ref", "Region3", "Region3int16",
	"SharedTable", "Time", "UDim", "UDim2", "UniqueId", "Vector2", "Vector2int16",
	"Vector3", "Vector3int16", "typeof",
]);

/**
 * Names a file explicitly routes to their own constructor, i.e. entries in a dispatch
 * table like `{ UDim = UDim.new }`. A local helper that dispatches datatypes is
 * allowed to be asked for one; a helper that does not is not.
 */
function dispatchedDatatypes(source) {
	const found = new Set();
	for (const m of source.matchAll(/^\s*([A-Za-z0-9_]+)\s*=\s*\1\s*\.\s*new\b/gm)) {
		found.add(m[1]);
	}
	return found;
}

/** Local helpers in this file that build Instances via Instance.new. */
function instanceNewForwarders(source) {
	return /\blocal\s+function\s+(\w+)\s*\([^)]*\)\s*\n(?:[^\n]*\n)*?[^\n]*Instance\s*\.\s*new\s*\(/.test(source)
		? [...source.matchAll(/\blocal\s+function\s+(\w+)\s*\([^)]*\)\s*\n(?:[^\n]*\n)*?[^\n]*Instance\s*\.\s*new\s*\(/g)].map((m) => m[1])
		: [];
}

/**
 * Find calls that hand a datatype to Instance.new, or to a local helper that forwards
 * to it without dispatching datatypes first.
 */
function findBadInstanceNew(source) {
	const problems = [];
	const dispatched = dispatchedDatatypes(source);
	const forwarders = instanceNewForwarders(source);

	const callers = [
		{ re: /\bInstance\s*\.\s*new\s*\(\s*"([A-Za-z0-9_]+)"/g, via: "Instance.new", allowsDispatch: false },
		...forwarders.map((name) => ({
			re: new RegExp(`\\b${name}\\s*\\(\\s*"([A-Za-z0-9_]+)"`, "g"),
			via: `${name}() (forwards to Instance.new)`,
			allowsDispatch: true,
		})),
	];

	for (const { re, via, allowsDispatch } of callers) {
		for (const match of source.matchAll(re)) {
			const className = match[1];
			if (!DATATYPES.has(className)) continue;
			if (allowsDispatch && dispatched.has(className)) continue;

			const line = source.slice(0, match.index).split("\n").length;
			const why = allowsDispatch
				? `${via}, and this file does not dispatch "${className}" to its own constructor`
				: `${via} called with "${className}", which is a datatype, not an Instance`;
			problems.push(`line ${line}: ${why} -- use ${className}.new(...) instead`);
		}
	}
	return problems;
}

function walk(dir, out = []) {
	for (const entry of readdirSync(dir)) {
		if (entry === "node_modules" || entry === ".git" || entry.startsWith(".")) continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) walk(full, out);
		else if (extname(full) === ".lua") out.push(full);
	}
	return out;
}

let failures = 0;
const files = walk(ROOT);

for (const file of files) {
	const source = readFileSync(file, "utf8");

	try {
		luaparse.parse(source, { luaVersion: "5.3", comments: false });
	} catch (err) {
		failures += 1;
		console.log(`FAIL ${relative(ROOT, file)}: ${err.message}`);
		continue;
	}

	const problems = findBadInstanceNew(source);
	if (problems.length > 0) {
		failures += 1;
		console.log(`FAIL ${relative(ROOT, file)}:`);
		for (const p of problems) console.log(`       ${p}`);
		continue;
	}

	console.log(`OK   ${relative(ROOT, file)}`);
}

console.log(`\n${files.length - failures}/${files.length} files parsed and datatype-clean`);
process.exit(failures === 0 ? 0 : 1);
