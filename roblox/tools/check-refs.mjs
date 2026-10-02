// Static cross-reference checker.
//
//   node tools/check-refs.mjs
//
// Builds the instance tree that Rojo would produce from default.project.json,
// then verifies that every require()/WaitForChild() chain in the Lua actually
// resolves, that the RemoteEvents the client waits for are created by the
// server, that cross-service calls exist, and that every Config key read is
// defined. This is the part Studio would otherwise catch for you.

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve, relative, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";

import { rojoName } from "./mounts.mjs";

const ROOT = resolve(fileURLToPath(import.meta.url), "..", "..");
const problems = [];
const notes = [];

const read = (p) => {
	try {
		return readFileSync(join(ROOT, p), "utf8");
	} catch {
		problems.push(`missing file: ${p}`);
		return "";
	}
};
const readJSON = (p) => {
	try {
		return JSON.parse(read(p));
	} catch (err) {
		problems.push(`cannot parse ${p}: ${err.message}`);
		return { tree: {} };
	}
};

// --- build the instance tree Rojo would produce -------------------------------

/** path -> { className, context } */
const instances = new Map();
/** dir path -> className (from .project.json) */
const dirClass = new Map();

function collectLuaFiles(dir, out = []) {
	let entries;
	try {
		entries = readdirSync(dir);
	} catch {
		problems.push(`missing directory: ${relative(ROOT, dir)}`);
		return out;
	}
	for (const entry of entries) {
		if (entry === "node_modules" || entry.startsWith(".")) continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) collectLuaFiles(full, out);
		else if (extname(full) === ".lua") out.push(full);
	}
	return out;
}

for (const dir of ["src/shared", "src/server", "src/client"]) {
	const projectFile = readdirSync(join(ROOT, dir)).find((f) => f.endsWith(".project.json"));
	if (projectFile) {
		dirClass.set(dir, readJSON(join(dir, projectFile)).className || "Folder");
	}
}

/**
 * The instance name Rojo gives a .lua file. Delegates to mounts.mjs so this file
 * and the paste installer cannot disagree about names -- when they did, this
 * checker's own assumption hid a WaitForChild("HUD") that could never resolve.
 */
const instanceNameForLua = (file) => rojoName(basename(file));

/** Which side of the network a module runs on: the mount directory, not the filename. */
function luaContext(dir) {
	if (dir.endsWith("server")) return "server";
	if (dir.endsWith("client")) return "client";
	return "shared";
}

/**
 * A .client/.server suffix on a filename is a trap: it survives into the instance
 * name (see instanceNameForLua) and then every WaitForChild("Base") silently hangs
 * forever. src/shared, src/server and src/client already say which side a script
 * runs on, so the suffix can only cost us.
 */
function checkFilenameSuffixes(dir) {
	for (const file of collectLuaFiles(resolve(ROOT, dir))) {
		const name = basename(file, ".lua");
		if (/\.(client|server)$/.test(name)) {
			problems.push(
				`${relative(ROOT, file).replace(/\\/g, "/")}: filename ends in .client/.server, ` +
					`so the instance will be named "${name}" -- not "${name.replace(/\.(client|server)$/, "")}". ` +
					`Either rename the file or require "${name}".`
			);
		}
	}
}

const project = readJSON("default.project.json");

/** Register every .lua file under a Rojo directory. */
function addModules(instancePath, dir) {
	const target = resolve(ROOT, dir);
	if (!existsSync(target)) {
		problems.push(`default.project.json references a path that does not exist: ${dir}`);
		return;
	}
	checkFilenameSuffixes(dir);
	for (const file of collectLuaFiles(target)) {
		const rel = relative(target, file).replace(/\\/g, "/");
		const names = rel.split("/");
		names[names.length - 1] = instanceNameForLua(file);
		instances.set(`${instancePath}.${names.join(".")}`, {
			className: "ModuleScript",
			path: relative(ROOT, file),
			context: luaContext(dir),
		});
	}
}

/** Walk default.project.json, recording every instance Rojo will create. */
function walkProject(node, path) {
	for (const [key, value] of Object.entries(node)) {
		if (key === "$className" || key === "properties" || key === "$properties") continue;
		if (typeof value !== "object" || value === null) continue;

		const here = path ? `${path}.${key}` : key;
		const dir = value.$path;

		if (dir) {
			const target = resolve(ROOT, dir);
			if (!existsSync(target)) {
				problems.push(`default.project.json: ${key} points at ${dir} which does not exist`);
				continue;
			}
			if (statSync(target).isDirectory()) {
				instances.set(here, { className: dirClass.get(dir) || "Folder", path: dir });
				addModules(here, dir);
			} else if (extname(target) === ".rbxmx") {
				instances.set(here, { className: "<rbxmx>", path: dir });
			} else {
				problems.push(`default.project.json: ${key} points at ${dir} which is neither a folder nor a .rbxmx`);
			}
			continue;
		}

		// A service configured purely with properties, e.g. Lighting.
		const childKeys = Object.keys(value).filter((k) => k !== "$className");
		if (childKeys.length === 0 || childKeys.every((k) => k === "properties" || k === "$properties")) {
			instances.set(here, { className: value.$className || "<service>", path: null });
			continue;
		}

		instances.set(here, { className: value.className || value.$className || "Folder", path: null });
		walkProject(value, here);
	}
}

walkProject(project.tree, "");

// --- resolve require() chains ----------------------------------------------

const GAME_SERVICES = new Set([
	"ReplicatedStorage", "ServerScriptService", "ServerStorage", "Workspace", "Players",
	"Lighting", "StarterPlayer", "StarterGui", "ReplicatedFirst", "SoundService",
	"UserInputService", "RunService", "TweenService", "HttpService", "ContextActionService",
]);

/** Services that default.project.json actually maps, so we can validate them. */
const MAPPED_ROOTS = new Set(["ReplicatedStorage", "ServerScriptService", "StarterPlayer", "Workspace", "Lighting"]);

/**
 * Finds `local Server = script.Parent` style aliases so `Server:WaitForChild("Net")`
 * can be resolved to a real instance path.
 */
function findScriptAliases(text) {
	const aliases = new Map();
	for (const m of text.matchAll(/local\s+(\w+)\s*=\s*(script(?:\.Parent)*)/g)) {
		const depth = (m[2].match(/\.Parent/g) || []).length;
		aliases.set(m[1], depth);
	}
	return aliases;
}

/** Pulls out the balanced argument of every require(...) call. */
function findRequireArgs(text) {
	const out = [];
	let i = 0;
	while (true) {
		const at = text.indexOf("require(", i);
		if (at === -1) break;
		let depth = 0;
		let j = at + "require(".length - 1;
		for (; j < text.length; j++) {
			const ch = text[j];
			if (ch === "(") depth++;
			else if (ch === ")") {
				depth--;
				if (depth === 0) break;
			}
		}
		out.push(text.slice(at + "require(".length, j).trim());
		i = j + 1;
	}
	return out;
}

/**
 * Turns `ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config")` or
 * `Server:WaitForChild("Net")` into a dotted instance path.
 */
function resolveChain(chain, fromPath, aliases) {
	if (!chain.includes(":")) {
		// A bare module name, e.g. require(Remote)
		const base = fromPath.slice(0, fromPath.lastIndexOf("."));
		return { full: `${base}.${chain}`, root: base };
	}
	const segments = chain
		.split(":")
		.map((s) => {
			const m = s.match(/WaitForChild\("([^"]+)"\)/);
			return m ? m[1] : s.trim();
		})
		.filter(Boolean);

	const root = segments[0];
	const tail = segments.slice(1).join(".");

	// The root may already be a full instance path (e.g. a chain rooted at a
	// local we resolved earlier: `Workspace.Night99.Landmarks:WaitForChild(...)`).
	if (instances.has(root)) {
		return { full: [root, tail].filter(Boolean).join("."), root, verify: true };
	}

	// Roblox globals are often lowercased (`workspace`, `game`) -- normalise so
	// `workspace:WaitForChild("Night99")` matches the mapped Workspace tree.
	const canonical = root.charAt(0).toUpperCase() + root.slice(1);
	if (GAME_SERVICES.has(canonical)) {
		return { full: [canonical, tail].filter(Boolean).join("."), root: canonical, verify: MAPPED_ROOTS.has(canonical) };
	}

	// `local Server = script.Parent` then `Server:WaitForChild("Net")`.
	if (aliases.has(root)) {
		const parts = fromPath.split(".");
		const depth = aliases.get(root);
		const base = parts.slice(0, Math.max(1, parts.length - depth)).join(".");
		return { full: [base, tail].filter(Boolean).join("."), root: base, verify: true };
	}

	// Anything else is an unknown local, so we cannot resolve it statically.
	return { full: null, root, verify: false };
}

// --- run the checks ----------------------------------------------------------

const allLua = collectLuaFiles(join(ROOT, "src"));
const fileToInstance = new Map();
for (const [inst, meta] of instances) {
	if (meta.path && meta.className === "ModuleScript") {
		fileToInstance.set(resolve(ROOT, meta.path), inst);
	}
}

for (const file of allLua) {
	const rel = relative(ROOT, file).replace(/\\/g, "/");
	const instance = fileToInstance.get(resolve(file));
	if (!instance) {
		problems.push(`${rel}: Rojo would not place this file anywhere (no .project.json mapping?)`);
		continue;
	}

	const text = readFileSync(file, "utf8");
	const aliases = findScriptAliases(text);
	for (const chain of findRequireArgs(text)) {
		const { full, verify } = resolveChain(chain, instance, aliases);
		if (!verify || !full) continue;
		if (!instances.has(full)) {
			problems.push(`${rel}: require(${chain}) -> "${full}" is not created by default.project.json`);
		} else if (instances.get(full).className !== "ModuleScript") {
			problems.push(`${rel}: require(${chain}) -> "${full}" is a ${instances.get(full).className}, not a ModuleScript`);
		}
	}
}

// --- remotes: created by the server, awaited by the client ------------------

const netLua = readFileSync(join(ROOT, "src/server/Net.lua"), "utf8");
const created = new Set([...netLua.matchAll(/add\("RemoteEvent",\s*"(\w+)"\)/g)].map((m) => m[1]));
const allText = allLua.map((f) => readFileSync(f, "utf8")).join("\n");
const awaited = new Set([...allText.matchAll(/Remote\.WaitFor\("(\w+)"\)/g)].map((m) => m[1]));

for (const name of awaited) {
	if (!created.has(name)) problems.push(`client awaits Remote "${name}" but Net.lua never creates it`);
}
for (const name of created) {
	if (!awaited.has(name)) problems.push(`remote "${name}" is created but never awaited by a client`);
}
notes.push(`remotes created = [${[...created].sort().join(", ")}]`);

// --- workspace / map references ---------------------------------------------

const night99 = instances.get("Workspace.Night99");
if (!night99) {
	problems.push("Workspace.Night99 is not mapped in default.project.json");
} else {
	notes.push(`Workspace.Night99 contains = [${[...instances.keys()].filter((k) => k.startsWith("Workspace.Night99.")).join(", ")}]`);
}

const landmarksXml = read("generated/Landmarks.rbxmx");
const monsterXml = read("generated/Monster.rbxmx");
const forestXml = read("generated/Forest.rbxmx");

const namedModels = (xml) =>
	new Set([...xml.matchAll(/<Item class="(?:Model|Folder)"><Properties><string name="Name">([^<]+)</g)].map((m) => m[1]));

for (const name of ["BatteryPickups", "CentralClearing", "Cabin", "MonsterSpawnPit"]) {
	if (!namedModels(landmarksXml).has(name)) problems.push(`generated/Landmarks.rbxmx is missing model "${name}"`);
}
for (const name of ["Body", "Head", "Jaw", "Eye", "Arm", "Leg"]) {
	if (!new RegExp(`<string name="Name">${name}</string>`).test(monsterXml)) {
		problems.push(`generated/Monster.rbxmx is missing the "${name}" part`);
	}
}
for (const name of ["Ground", "Boundary", "Trees", "Treeline", "Scatter"]) {
	if (!namedModels(forestXml).has(name)) problems.push(`generated/Forest.rbxmx is missing folder "${name}"`);
}
notes.push("map model/part names verified against the scripts");

// --- cross-service calls -----------------------------------------------------

/** owner alias (as written in the source) -> { file, module } that defines it */
const serviceFiles = {
	Players: { file: "src/server/PlayerService.lua", module: "PlayerService" },
	players: { file: "src/server/PlayerService.lua", module: "PlayerService" },
	Net: { file: "src/server/Net.lua", module: "Net" },
	net: { file: "src/server/Net.lua", module: "Net" },
	Monster: { file: "src/server/MonsterService.lua", module: "MonsterService" },
	monster: { file: "src/server/MonsterService.lua", module: "MonsterService" },
	Battery: { file: "src/server/BatteryService.lua", module: "BatteryService" },
	Night: { file: "src/server/NightService.lua", module: "NightService" },
	Lighting: { file: "src/server/LightingService.lua", module: "LightingService" },
};
const bodies = Object.fromEntries(
	Object.values(serviceFiles).map(({ file }) => [file, read(file)])
);

for (const file of allLua) {
	const rel = relative(ROOT, file).replace(/\\/g, "/");
	const text = readFileSync(file, "utf8");
	for (const m of text.matchAll(/\b(Players|players|Monster|monster|Battery|Night|Lighting)\.([A-Z]\w+)\(/g)) {
		const [, owner, method] = m;
		const target = serviceFiles[owner];
		if (!target) continue;
		const body = bodies[target.file] || "";
		// Definitions live on the module table, calls use a local alias.
		const defined = new RegExp(
			`function\\s+${target.module}\\.${method}\\b|${target.module}\\.${method}\\s*=\\s*function`
		);
		if (!defined.test(body)) {
			problems.push(`${rel}: calls ${owner}.${method}() which ${target.file} does not define`);
		}
	}
}

// --- workspace instance names referenced by the scripts ---------------------

const xmlFor = new Map([
	["Workspace.Night99.Forest", "generated/Forest.rbxmx"],
	["Workspace.Night99.Landmarks", "generated/Landmarks.rbxmx"],
	["Workspace.Night99.Monster", "generated/Monster.rbxmx"],
]);

for (const file of allLua) {
	const rel = relative(ROOT, file).replace(/\\/g, "/");
	const text = readFileSync(file, "utf8");

	// Track `local landmarks = workspace:WaitForChild("Night99"):WaitForChild("Landmarks")`
	// so later `landmarks:WaitForChild("BatteryPickups")` can be resolved too.
	const bound = new Map();
	for (const m of text.matchAll(/local\s+(\w+)\s*=\s*(workspace(\s*:\s*WaitForChild\("[^"]+"\))+)/g)) {
		const chain = m[2].replace(/\s+/g, "");
		const { full } = resolveChain(chain, "X", new Map());
		if (full) bound.set(m[1], full);
	}

	const chains = [
		...[...text.matchAll(/\bworkspace(\s*:\s*WaitForChild\("[^"]+"\))+/g)].map((m) => m[0]),
		...[...text.matchAll(/\b(\w+)\s*:\s*WaitForChild\("[^"]+"\)/g)]
			.filter((m) => bound.has(m[1]))
			.map((m) => `${bound.get(m[1])}${m[0].slice(m[1].length)}`),
	];

	for (const chain of chains) {
		const normalised = chain.replace(/\s+/g, "");
		const { full, verify } = resolveChain(normalised, "X", new Map());
		if (!verify || !full) continue;

		const dot = full.lastIndexOf(".");
		const parentPath = full.slice(0, dot);
		const childName = full.slice(dot + 1);
		const parentInstance = instances.get(parentPath);

		if (!parentInstance) {
			problems.push(`${rel}: ${normalised} -> parent "${parentPath}" is not created by default.project.json`);
			continue;
		}

		// Children of an .rbxmx container live in the XML, not in `instances`.
		const xml = xmlFor.get(parentPath);
		if (xml) {
			if (!new RegExp(`<string name="Name">${childName}</string>`).test(read(xml))) {
				problems.push(`${rel}: ${normalised} -> "${childName}" does not exist in ${xml}`);
			}
		} else if (!instances.has(full)) {
			problems.push(`${rel}: ${normalised} -> "${full}" is not created by default.project.json`);
		}
	}
}

// --- Config keys -------------------------------------------------------------

const configText = read("src/shared/Config.lua");

/**
 * Every key Config.lua actually defines: the sections, and each "Section.Field".
 *
 * Read from the source rather than hardcoded so renaming a value immediately breaks
 * every script reading the old name. Checking only the section is what let
 * `config.Map.Monster.HeightOffset` through -- Monster is a real section, but
 * HeightOffset lives under Config.Monster, so the monster threw
 * "attempt to index nil with 'HeightOffset'" sixty times a second during play.
 */
function parseConfigKeys(text) {
	const sections = new Set();
	const leaves = new Set();
	let current = null;

	for (const line of text.split(/\r?\n/)) {
		const open = line.match(/^Config\.(\w+)\s*=\s*\{/);
		if (open) {
			current = open[1];
			sections.add(current);
			continue;
		}
		if (/^\}/.test(line)) {
			current = null;
			continue;
		}
		const field = line.match(/^\t+(\w+)\s*=/);
		if (field && current) leaves.add(`${current}.${field[1]}`);
	}
	return { sections, leaves };
}

const configKeys = parseConfigKeys(configText);

/** `local X = require(<balanced arg>)` pairs, in source order. */
function findRequireBindings(text) {
	const out = [];
	for (const m of text.matchAll(/local\s+(\w+)\s*=\s*require\s*\(/g)) {
		const open = m.index + m[0].length - 1;
		let depth = 0;
		let j = open;
		for (; j < text.length; j++) {
			if (text[j] === "(") depth++;
			else if (text[j] === ")") {
				depth--;
				if (depth === 0) break;
			}
		}
		out.push({ name: m[1], arg: text.slice(open + 1, j) });
	}
	return out;
}

const splitNames = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);

/**
 * Which names hold the Config module, resolved across the whole project.
 *
 * The scripts do not all reach Config the same way, and matching only the obvious
 * spelling validates nothing while still reporting green. Some files require Config
 * directly; the server modules take it as an injected argument --
 * `function MonsterService.Init(c, n, p)`, called from Main.lua as
 * `MonsterService.Init(Config, Net, Players)`, then parked in a lower-cased forward
 * declaration (`local config, net, players`) via `config = c`.
 *
 * Matching only `local X = require(...Config...)` found the capital-C name and then
 * skipped every actual `config.Monster.*` read, so this check reported green while
 * the monster threw "attempt to index nil" sixty times a second. Call sites have to
 * be followed across files for that reason: the callee's parameter list lives in
 * MonsterService.lua but the argument that reveals it lives in Main.lua.
 *
 * Single-character names bridge those two steps but are never validated themselves:
 * `c` is also a perfectly ordinary loop variable, so checking `c.Width` would fire on
 * innocent code.
 */
const fnParams = new Map();
const allCalls = [];
const allCopies = [];

for (const file of allLua) {
	const text = readFileSync(file, "utf8");
	if (relative(ROOT, file).replace(/\\/g, "/") === "src/shared/Config.lua") continue;

	for (const m of text.matchAll(/function\s+([\w.]+)\s*\(([^)]*)\)/g)) {
		fnParams.set(m[1], splitNames(m[2]));
	}
	for (const m of text.matchAll(/([\w.]+)\s*\(([^()]*)\)/g)) {
		allCalls.push([m[1], splitNames(m[2])]);
	}
	// `dst = src` with bare identifiers on both sides: covers `config = c` and
	// `local cfg = Config`. The leading [^\w.] keeps table fields out (`t.x = y`).
	for (const m of text.matchAll(/(^|[^\w.])([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*)[ \t]*$/gm)) {
		allCopies.push([m[2], m[3]]);
	}
}

const configNames = new Set();
for (const file of allLua) {
	const text = readFileSync(file, "utf8");
	if (relative(ROOT, file).replace(/\\/g, "/") === "src/shared/Config.lua") continue;
	for (const binding of findRequireBindings(text)) {
		if (/\bConfig\b/.test(binding.arg)) configNames.add(binding.name);
	}
}

// One pass is not enough: the parameter is bound by a call site in a *different* file
// from the one that declares it, and `config = c` sits at the bottom of the module.
for (let changed = true; changed; ) {
	changed = false;
	const add = (name) => {
		if (!configNames.has(name)) {
			configNames.add(name);
			changed = true;
		}
	};
	for (const [callee, args] of allCalls) {
		const params = fnParams.get(callee);
		if (!params) continue;
		for (let i = 0; i < params.length && i < args.length; i++) {
			if (configNames.has(args[i])) add(params[i]);
		}
	}
	for (const [dst, src] of allCopies) {
		if (configNames.has(src)) add(dst);
	}
}

const checkableNames = [...configNames].filter((n) => n.length > 1);

/** Is `Section`, or `Section.Field`, a path Config.lua actually defines? */
function isRealConfigPath(segments) {
	if (!configKeys.sections.has(segments[0])) return false;
	if (segments.length === 1) return true;
	return configKeys.leaves.has(`${segments[0]}.${segments[1]}`);
}

for (const file of allLua) {
	const rel = relative(ROOT, file).replace(/\\/g, "/");
	if (rel === "src/shared/Config.lua") continue;
	const text = readFileSync(file, "utf8");

	// Only the resolved names this file actually mentions, so one module's injected
	// parameter cannot make an unrelated file look like it reads Config.
	const mine = checkableNames.filter((n) => new RegExp(`\\b${n}\\b`).test(text));
	const pattern = mine.map((a) => a.replace(/\$/g, "\\$")).join("|");
	if (!pattern) {
		// Plenty of files genuinely never touch Config (Net, Remote, client/Main), so
		// having no alias is not itself wrong. What is wrong is a file that *mentions*
		// Config yet gets no alias -- that is the signature of the alias analysis
		// silently matching nothing, which is how this whole check sat inert while
		// reporting green. Only the specific shape is an error.
		if (/\b[Cc]onfig\b/.test(text)) {
			problems.push(`${rel}: mentions Config but no resolved alias covers it, so its settings are not validated`);
		}
		continue;
	}

	// Up to three dotted segments: Config.lua has no nested tables, so anything past
	// Section.Field is already a mistake, and the extra segments make a good hint.
	for (const m of text.matchAll(new RegExp(`\\b(?:${pattern})((?:\\.\\w+){1,3})`, "g"))) {
		const segments = m[1].split(".").filter(Boolean);
		if (isRealConfigPath(segments)) continue;

		const shown = segments.join(".");
		const withoutPrefix = segments.slice(1);
		const hint =
			withoutPrefix.length && isRealConfigPath(withoutPrefix)
				? ` Did you mean ${withoutPrefix.join(".")}?`
				: "";

		if (!configKeys.sections.has(segments[0])) {
			problems.push(`${rel}: reads ${segments[0]} as a Config section, which Config.lua does not define`);
		} else {
			problems.push(`${rel}: reads ${shown}, but Config.lua defines no such key.${hint}`);
		}
	}
}
notes.push(`Config sections = [${[...configKeys.sections].join(", ")}], ${configKeys.leaves.size} keys`);

// Informational only: config left unused by the scripts. Not an error -- some
// values exist purely for designers, but a stale key is usually a typo.
const usedText = allLua
	.map((f) => ({ f: relative(ROOT, f).replace(/\\/g, "/"), text: readFileSync(f, "utf8") }))
	.filter(({ f }) => f !== "src/shared/Config.lua")
	.map(({ text }) => text)
	.join("\n");

const escaped = (path) => path.replace(/\./g, "\\.");
const isUsed = (path) => new RegExp(`\\b[Cc]onfig\\.${escaped(path)}\\b`).test(usedText);

const unused = [
	...[...configKeys.sections].filter((s) => !isUsed(s)),
	...[...configKeys.leaves].filter((leaf) => !isUsed(leaf)),
];
if (unused.length) notes.push(`config not read by any script: ${unused.join(", ")}`);

// --- report ------------------------------------------------------------------

for (const n of notes) console.log(`  .  ${n}`);
if (problems.length === 0) {
	console.log(`\nAll cross-references OK (${instances.size} instances mapped).`);
} else {
	console.log("");
	for (const p of [...new Set(problems)]) console.log(`  X  ${p}`);
	console.log(`\n${new Set(problems).size} problem(s)`);
	process.exit(1);
}