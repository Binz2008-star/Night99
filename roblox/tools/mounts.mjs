// Single source of truth for where src/** ends up in the DataModel.
//
// Imported by build-installer.mjs (to emit the paste installer),
// check-install.mjs (to verify it) and check-refs.mjs (to verify what Rojo would
// produce), so the three can never disagree about an instance name.

import { readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, basename, extname } from "node:path";

export const MOUNTS = [
	{ service: "ReplicatedStorage", dirs: ["Shared"], dir: "src/shared" },
	{ service: "ServerScriptService", dirs: ["Night99"], dir: "src/server" },
	{
		service: "StarterPlayer",
		dirs: ["StarterPlayerScripts", "Night99"],
		dir: "src/client",
	},
];

/**
 * The instance name a .lua file gets.
 *
 * Rojo strips the file extension and nothing else, so `HUD.client.lua` becomes an
 * instance called `HUD.client`. Getting this wrong is silent and fatal at runtime:
 * a WaitForChild("HUD") that can never resolve just hangs forever. Every tool that
 * needs a name must use this function rather than re-deriving it.
 */
export function rojoName(fileName) {
	return fileName.replace(/\.lua$/, "");
}

/** DataModel path for a file, e.g. ["ReplicatedStorage", "Shared", "Config"]. */
export function mountPath(mount, fileName) {
	return [mount.service, ...mount.dirs, fileName];
}

/** Which mount owns a file name that lives in `dir`, or null. */
export function mountForDir(dir) {
	return MOUNTS.find((m) => m.dir === dir) ?? null;
}

/**
 * A file is a ModuleScript when its last meaningful line returns a table;
 * anything else under src/server is the bootstrap Script, and anything else under
 * src/client is a LocalScript (a plain Script in StarterPlayerScripts never runs).
 */
export function classFor(mount, source) {
	const meaningful = source
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l !== "" && !l.startsWith("--"));
	const last = meaningful[meaningful.length - 1] ?? "";
	if (/^return\b/.test(last)) return "ModuleScript";
	return mount.dir === "src/client" ? "LocalScript" : "Script";
}

/** Files on disk for a mount directory, sorted, as { name, source }. */
export function listLuaFiles(fs, path, dir) {
	return fs
		.readdirSync(`${path}/${dir}`)
		.filter((f) => f.endsWith(".lua"))
		.sort()
		.map((f) => ({
			name: rojoName(f),
			source: fs.readFileSync(`${path}/${dir}/${f}`, "utf8"),
		}));
}

/**
 * Every instance path Rojo will create from a .project.json tree, including the
 * modules it synthesises from src/**. Used by check-install.mjs to prove the paste
 * installer targets exactly the instances Rojo would produce -- the two used to be
 * derived separately and could drift apart without anyone noticing.
 */
export function rojoTreeFrom(root, project) {
	const out = new Set();

	function walk(node, prefix) {
		for (const [key, value] of Object.entries(node)) {
			if (key === "$className" || key === "properties" || key === "$properties") continue;
			if (typeof value !== "object" || value === null) continue;

			const here = prefix ? `${prefix}.${key}` : key;
			const dir = value.$path;
			if (!dir) {
				walk(value, here);
				continue;
			}

			const target = resolve(root, dir);
			if (!existsSync(target)) continue;

			if (statSync(target).isDirectory()) {
				out.add(here);
				// Rojo emits one instance per file, keeping subdirectory structure.
				const stack = [[target, []]];
				while (stack.length > 0) {
					const [at, sub] = stack.pop();
					for (const entry of readdirSync(at)) {
						if (entry === "node_modules" || entry.startsWith(".")) continue;
						const full = join(at, entry);
						if (statSync(full).isDirectory()) {
							stack.push([full, [...sub, entry]]);
						} else if (extname(full) === ".lua") {
							out.add([here, ...sub, rojoName(basename(full))].join("."));
						}
					}
				}
			} else {
				out.add(here);
			}
		}
	}

	// A Rojo project file wraps the real tree in `tree`; tolerate a bare tree too.
	walk(project.tree ?? project, "");
	return out;
}