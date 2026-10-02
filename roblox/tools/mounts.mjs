// Single source of truth for where src/** ends up in the DataModel.
//
// Imported by build-installer.mjs (to emit the paste installer) and
// check-install.mjs (to verify it), so the two can never disagree.

export const MOUNTS = [
	{ service: "ReplicatedStorage", dirs: ["Shared"], dir: "src/shared" },
	{ service: "ServerScriptService", dirs: ["Night99"], dir: "src/server" },
	{
		service: "StarterPlayer",
		dirs: ["StarterPlayerScripts", "Night99"],
		dir: "src/client",
	},
];

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
			name: f.slice(0, -4),
			source: fs.readFileSync(`${path}/${dir}/${f}`, "utf8"),
		}));
}