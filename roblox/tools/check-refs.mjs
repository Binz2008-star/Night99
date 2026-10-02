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

/** Rojo strips .client/.server from the instance name. */
function instanceNameForLua(file) {
	const name = basename(file, ".lua");
	return name.replace(/\.(client|server)$/, "");
}

function luaContext(file) {
	const name = basename(file, ".lua");
	if (name.endsWith(".client")) return "client";
	if (name.endsWith(".server")) return "server";
	return "shared";
}

const project = readJSON("default.project.json");

/** Register every .lua file under a Rojo directory, honouring .client/.server. */
function addModules(instancePath, dir) {
	const target = resolve(ROOT, dir);
	if (!existsSync(target)) {
		problems.push(`default.project.json references a path that does not exist: ${dir}`);
		return;
	}
	for (const file of collectLuaFiles(target)) {
		const rel = relative(target, file).replace(/\\/g, "/");
		const parts = rel.split("/");
		const names = parts.map((p, i) => (i === parts.length - 1 ? instanceNameForLua(file) : p.replace(/\.(client|server)$/, "")));
		instances.set(`${instancePath}.${names.join(".")}`, {
			className: "ModuleScript",
			path: relative(ROOT, file),
			context: luaContext(file),
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
const definedKeys = new Set([...configText.matchAll(/^Config\.(\w+)\s*=/gm)].map((m) => m[1]));

for (const file of allLua) {
	const rel = relative(ROOT, file).replace(/\\/g, "/");
	if (rel === "src/shared/Config.lua") continue;
	const text = readFileSync(file, "utf8");
	for (const m of text.matchAll(/Config\.(\w+)\./g)) {
		if (!definedKeys.has(m[1])) problems.push(`${rel}: reads Config.${m[1]} which src/shared/Config.lua does not define`);
	}
}
notes.push(`Config sections = [${[...definedKeys].join(", ")}]`);

// Informational only: config left unused by the scripts. Not an error -- some
// values exist purely for designers, but a stale key is usually a typo.
const usedText = allLua
	.map((f) => ({ f: relative(ROOT, f).replace(/\\/g, "/"), text: readFileSync(f, "utf8") }))
	.filter(({ f }) => f !== "src/shared/Config.lua")
	.map(({ text }) => text)
	.join("\n");

const unusedSections = [...definedKeys].filter((s) => !new RegExp(`[Cc]onfig\\.${s}\\b`).test(usedText));
const unusedLeaves = [];
for (const m of configText.matchAll(/^\t(\w+)\s*=\s*(.+?),?$/gm)) {
	const key = m[1];
	const owner = configText.slice(0, m.index).match(/^Config\.(\w+)\s*=/);
	if (!owner) continue;
	if (!new RegExp(`[Cc]onfig\\.${owner[1]}\\.${key}\\b`).test(usedText)) {
		unusedLeaves.push(`${owner[1]}.${key}`);
	}
}
if (unusedSections.length || unusedLeaves.length) {
	notes.push(`config not read by any script: ${[...unusedSections, ...unusedLeaves].join(", ")}`);
}

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