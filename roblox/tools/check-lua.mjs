// Syntax-checks every Lua file in the project with luaparse.
//   node tools/check-lua.mjs
//
// This catches parse errors only -- it cannot see Roblox globals such as
// `Instance` or `Enum`. Run luau-analyze inside Studio for full checking.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const luaparse = require("luaparse");

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");

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
		console.log(`OK   ${relative(ROOT, file)}`);
	} catch (err) {
		failures += 1;
		console.log(`FAIL ${relative(ROOT, file)}: ${err.message}`);
	}
}

console.log(`\n${files.length - failures}/${files.length} files parsed`);
process.exit(failures === 0 ? 0 : 1);