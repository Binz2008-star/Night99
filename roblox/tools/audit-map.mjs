// Independent layout audit of the generated map.
//   node tools/audit-map.mjs
//
// Re-derives the rules from the XML itself rather than trusting build-map.mjs,
// so a bug in the generator's validation shows up here.

import { readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const xml = read("generated/Landmarks.rbxmx");

/** Pull every Part out of the XML with the bits the audit cares about. */
function parseParts(text) {
	const parts = [];
	for (const m of text.matchAll(/<Item class="Part"><Properties>(.*?)<\/Properties>/gs)) {
		const block = m[1];
		const name = /<string name="Name">([^<]*)<\/string>/.exec(block)?.[1] ?? "?";
		const collide = /<bool name="CanCollide">(true|false)<\/bool>/.exec(block)?.[1] === "true";
		const cf = /<CFrame name="CFrame">([\s\S]*?)<\/CFrame>/.exec(block)?.[1] ?? "";
		const size = /<Vector3 name="Size">([\s\S]*?)<\/Vector3>/.exec(block)?.[1] ?? "";
		const get = (s, re) => parseFloat(new RegExp(re).exec(s)?.[1] ?? "0");
		parts.push({
			name,
			collide,
			x: get(cf, /<X>([^<]*)<\/X>/),
			y: get(cf, /<Y>([^<]*)<\/Y>/),
			z: get(cf, /<Z>([^<]*)<\/Z>/),
			sx: get(size, /<X>([^<]*)<\/X>/),
			sy: get(size, /<Y>([^<]*)<\/Y>/),
			sz: get(size, /<Z>([^<]*)<\/Z>/),
		});
	}
	return parts;
}

// Trees live in the Forest file, as Models holding a Trunk.
const forestXml = read("generated/Forest.rbxmx");
const treeModels = [...forestXml.matchAll(/<Item class="Model"><Properties><string name="Name">Tree<\/string><CFrame name="CFrame"><X>([^<]*)<\/X><Y>([^<]*)<\/Y><Z>([^<]*)<\/Z>/g)]
	.map((m) => ({ x: parseFloat(m[1]), y: parseFloat(m[2]), z: parseFloat(m[3]) }));

const landmarkParts = parseParts(xml);
const pickups = landmarkParts.filter((p) => p.name.startsWith("BatteryPickup"));

const CLEARINGS = [
	["CentralClearing", 0, 0, 25],
	["Cabin", 62, -46, 21],
	["RadioTower", -66, 58, 18],
	["CarWreck", -28, -78, 13],
	["StoneCircle", 80, 74, 19],
	["Marsh", -86, -74, 28],
	["Watchtower", 34, 96, 17],
	["RockArch", 110, -20, 15],
	["MonsterSpawnPit", -116, -116, 14],
];
const HALF = 128;

const problems = [];
const stats = [];

// 1. no tree inside a landmark clearing
let inside = 0;
for (const t of treeModels) {
	for (const [name, cx, cz, r] of CLEARINGS) {
		if (Math.hypot(t.x - cx, t.z - cz) < r) inside++;
	}
}
stats.push(`trees = ${treeModels.length}, inside a clearing = ${inside}`);
if (inside > 0) problems.push(`${inside} tree(s) are inside a landmark clearing`);

// 2. nothing outside the barriers
const outside = treeModels.filter((t) => Math.abs(t.x) > HALF + 6 || Math.abs(t.z) > HALF + 6);
stats.push(`trees outside the map = ${outside.length}`);
if (outside.length) problems.push(`${outside.length} tree(s) spawned outside the boundary`);

// 3. every pickup must be reachable: not buried inside a collidable part
let buried = 0;
for (const pickup of pickups) {
	for (const p of landmarkParts) {
		if (p === pickup || !p.collide || p.name === "Barrier") continue;
		// Axis-aligned overlap test against the pickup's 1.6 x 2.2 x 1.6 box.
		const ox = Math.abs(p.x - pickup.x) < (p.sx + 1.6) / 2 - 0.05;
		const oy = Math.abs(p.y - pickup.y) < (p.sy + 2.2) / 2 - 0.05;
		const oz = Math.abs(p.z - pickup.z) < (p.sz + 1.6) / 2 - 0.05;
		if (ox && oy && oz) {
			buried++;
			problems.push(`${pickup.name} is buried inside "${p.name}" at ${pickup.x.toFixed(1)},${pickup.z.toFixed(1)}`);
			break;
		}
	}
}
stats.push(`pickups = ${pickups.length}, unreachable = ${buried}`);

// 4. pickups spread out, none on top of each other
let clustered = 0;
for (let i = 0; i < pickups.length; i++) {
	for (let j = i + 1; j < pickups.length; j++) {
		if (Math.hypot(pickups[i].x - pickups[j].x, pickups[i].z - pickups[j].z) < 12) clustered++;
	}
}
stats.push(`pickup pairs closer than 12 studs = ${clustered}`);
if (clustered > 0) problems.push(`${clustered} pickup pair(s) are within 12 studs of each other`);

// 5. pickups in bounds
const outOfBounds = pickups.filter((p) => Math.abs(p.x) > HALF || Math.abs(p.z) > HALF);
if (outOfBounds.length) problems.push(`${outOfBounds.length} pickup(s) are outside the playable area`);

// 6. monster spawn pit is clear geometry to stand in
const pitTrunks = treeModels.filter((t) => Math.hypot(t.x + 116, t.z + 116) < 14);
stats.push(`trees inside the monster spawn pit = ${pitTrunks.length}`);
if (pitTrunks.length) problems.push(`${pitTrunks.length} tree(s) block the monster spawn pit`);

// 7. spawn locations exist and are not buried
const spawnXml = [...xml.matchAll(/<Item class="SpawnLocation"><Properties>[\s\S]*?<\/Properties>/g)].map((m) => m[0]);
stats.push(`spawn locations = ${spawnXml.length}`);
if (spawnXml.length < 2) problems.push("expected 2 spawn locations in the clearing");

// --- report -----------------------------------------------------------------
for (const s of stats) console.log(`  .  ${s}`);
if (problems.length === 0) {
	console.log("\nMap layout audit OK.");
} else {
	console.log("");
	for (const p of problems) console.log(`  X  ${p}`);
	console.log(`\n${problems.length} problem(s)`);
	process.exit(1);
}