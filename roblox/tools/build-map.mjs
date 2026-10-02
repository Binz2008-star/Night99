// Generates the Night99 Roblox map as .rbxmx files for Rojo.
//
//   node tools/build-map.mjs
//
// Output: generated/Forest.rbxmx, generated/Landmarks.rbxmx, generated/Monster.rbxmx
//
// The layout is deterministic (fixed seed), so re-running the generator always
// produces byte-identical files and the map only changes when this script changes.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { part, model, folder, pointLight, spawnLocation, document, inst, capture, S, CF } from "./rbxxml.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, "..", "generated");

// --- deterministic rng ------------------------------------------------------

function mulberry32(seed) {
	let a = seed >>> 0;
	return function () {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const makeRng = (seed) => {
	const next = mulberry32(seed);
	return {
		next,
		range: (lo, hi) => lo + next() * (hi - lo),
		int: (lo, hi) => Math.floor(lo + next() * (hi - lo + 1)),
		pick: (arr) => arr[Math.floor(next() * arr.length)],
		chance: (p) => next() < p,
		sign: () => (next() < 0.5 ? -1 : 1),
	};
};

// --- world layout ------------------------------------------------------------

const SEED = 99_001;
const rng = makeRng(SEED);
const HALF = 128; // playable half-extent in studs
const WALL_H = 90;

const CLEARINGS = [
	{ name: "CentralClearing", x: 0, z: 0, r: 25 },
	{ name: "Cabin", x: 62, z: -46, r: 21 },
	{ name: "RadioTower", x: -66, z: 58, r: 18 },
	{ name: "CarWreck", x: -28, z: -78, r: 13 },
	{ name: "StoneCircle", x: 80, z: 74, r: 19 },
	{ name: "Marsh", x: -86, z: -74, r: 28 },
	{ name: "Watchtower", x: 34, z: 96, r: 17 },
	{ name: "RockArch", x: 110, z: -20, r: 15 },
	{ name: "SpawnPit", x: -116, z: -116, r: 14 },
];

const PATHS = [
	[[0, 0], [26, -14], [62, -46], [86, -34], [110, -20]],
	[[0, 0], [-30, 20], [-66, 58], [-20, 74], [34, 96]],
	[[-86, -74], [-52, -46], [-24, -14], [0, 0]],
	[[-28, -78], [10, -96], [56, -64], [110, -20]],
	[[80, 74], [62, 86], [34, 96]],
];

const PICKUP_SPOTS = [
	[18, 4], [-22, -6], [66, -38], [54, -52], [-58, 50], [-74, 66],
	[-24, -84], [-92, -80], [74, 68], [88, 82], [40, 92], [104, -14],
	[96, -26], [-46, -50],
];

function segDist(px, pz, ax, az, bx, bz) {
	const dx = bx - ax, dz = bz - az;
	const len2 = dx * dx + dz * dz;
	let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
	t = Math.max(0, Math.min(1, t));
	const cx = ax + dx * t, cz = az + dz * t;
	return Math.hypot(px - cx, pz - cz);
}

function distToPaths(x, z) {
	let best = Infinity;
	for (const line of PATHS) {
		for (let i = 0; i < line.length - 1; i++) {
			const d = segDist(x, z, line[i][0], line[i][1], line[i + 1][0], line[i + 1][1]);
			if (d < best) best = d;
		}
	}
	return best;
}

function clearingDist(x, z) {
	let best = Infinity;
	for (const c of CLEARINGS) best = Math.min(best, Math.hypot(x - c.x, z - c.z) - c.r);
	return best;
}

/** Dart-throwing scatter with rejection zones. */
function scatter(count, minDist, isValid, attempts = 40) {
	const placed = [];
	for (let i = 0; i < count; i++) {
		for (let a = 0; a < attempts; a++) {
			const x = rng.range(-HALF + 6, HALF - 6);
			const z = rng.range(-HALF + 6, HALF - 6);
			if (!isValid(x, z)) continue;
			let ok = true;
			for (let p = placed.length - 1; p >= 0 && p >= placed.length - 60; p--) {
				const q = placed[p];
				if ((q.x - x) ** 2 + (q.z - z) ** 2 < minDist * minDist) { ok = false; break; }
			}
			if (!ok) continue;
			placed.push({ x, z });
			break;
		}
	}
	return placed;
}

// --- palette -----------------------------------------------------------------

const PAL = {
	ground: [34, 37, 30],
	dirt: [46, 39, 31],
	bark: [42, 33, 26],
	barkDark: [30, 24, 20],
	needles: [24, 40, 26],
	canopy: [27, 46, 28],
	deadWood: [46, 43, 40],
	rock: [58, 60, 62],
	rockDark: [42, 44, 47],
	plank: [74, 61, 46],
	plankDark: [52, 43, 33],
	metal: [70, 72, 74],
	rust: [96, 56, 34],
	water: [18, 26, 30],
	reed: [58, 62, 40],
	amber: [255, 196, 84],
	ember: [255, 138, 52],
	monsterSkin: [14, 14, 16],
	monsterEye: [255, 84, 48],
};

// =============================================================================
// FOREST
// =============================================================================

function buildGround() {
	const kids = [
		part({
			name: "Ground",
			size: [HALF * 2 + 8, 4, HALF * 2 + 8],
			pos: [0, -2, 0],
			color: PAL.ground,
			material: "Ground",
			smooth: true,
		}),
	];

	// Blobby undergrowth patches break up the flat plane.
	for (const p of scatter(46, 16, (x, z) => clearingDist(x, z) > 2 && distToPaths(x, z) > 4)) {
		kids.push(
			part({
				name: "Undergrowth",
				size: [rng.range(9, 22), 0.2, rng.range(9, 22)],
				pos: [p.x, 0.05, p.z],
				rot: [0, rng.range(0, Math.PI), 0],
				color: [PAL.ground[0] - 6, PAL.ground[1] + 5, PAL.ground[2] - 5],
				material: "Ground",
				collide: false,
				touch: false,
				query: false,
				locked: true,
			})
		);
	}

	// Dirt paths, drawn as overlapping quads per segment.
	for (const line of PATHS) {
		for (let i = 0; i < line.length - 1; i++) {
			const [ax, az] = line[i];
			const [bx, bz] = line[i + 1];
			const len = Math.hypot(bx - ax, bz - az);
			const yaw = Math.atan2(bx - ax, bz - az);
			const steps = Math.max(1, Math.round(len / 7));
			for (let s = 0; s < steps; s++) {
				const t = (s + 0.5) / steps;
				kids.push(
					part({
						name: "Path",
						size: [rng.range(6.5, 8.5), 0.16, len / steps + 1.2],
						pos: [ax + (bx - ax) * t, 0.08, az + (bz - az) * t],
						rot: [0, yaw, 0],
						color: PAL.dirt,
						material: "Ground",
						collide: false,
						touch: false,
						query: false,
					})
				);
			}
		}
	}
	return kids;
}

function buildBoundary() {
	const kids = [];
	const T = 4;
	const d = HALF + T / 2;
	const specs = [
		{ pos: [0, WALL_H / 2, -d], size: [HALF * 2 + T * 2, WALL_H, T] },
		{ pos: [0, WALL_H / 2, d], size: [HALF * 2 + T * 2, WALL_H, T] },
		{ pos: [-d, WALL_H / 2, 0], size: [T, WALL_H, HALF * 2 + T * 2] },
		{ pos: [d, WALL_H / 2, 0], size: [T, WALL_H, HALF * 2 + T * 2] },
	];
	for (const [i, s] of specs.entries()) {
		kids.push(
			part({
				name: `Barrier{i + 1}`,
				...s,
				color: [0, 0, 0],
				material: "Plastic",
				transparency: 1,
				touch: false,
				query: false,
				castShadow: false,
			})
		);
	}
	return kids;
}

function treeModel(x, z) {
	const kind = rng.chance(0.46) ? "pine" : rng.chance(0.68) ? "oak" : "dead";
	const yaw = rng.range(0, Math.PI * 2);
	const lean = rng.chance(0.22) ? rng.range(-0.07, 0.07) : 0;
	const parts = [];

	if (kind === "pine") {
		const h = rng.range(9, 17);
		parts.push(
			part({
				name: "Trunk",
				size: [rng.range(1.5, 2.1), h, rng.range(1.5, 2.1)],
				pos: [0, h / 2, 0],
				color: PAL.bark,
				material: "Wood",
			})
		);
		const tiers = 3 + (rng.chance(0.5) ? 1 : 0);
		for (let i = 0; i < tiers; i++) {
			const t = i / tiers;
			const w = 11 - t * 6.5 + rng.range(-0.6, 0.6);
			parts.push(
				part({
					name: "Needles",
					size: [w, 3.1, w],
					pos: [rng.range(-0.4, 0.4), h * (0.42 + t * 0.62), rng.range(-0.4, 0.4)],
					rot: [lean, yaw + i * 0.5, lean * 0.6],
					color: PAL.needles,
					material: "LeafyGrass",
					collide: false,
					touch: false,
					query: false,
					castShadow: false,
				})
			);
		}
	} else if (kind === "oak") {
		const h = rng.range(6, 10);
		parts.push(
			part({
				name: "Trunk",
				size: [rng.range(2, 2.7), h, rng.range(2, 2.7)],
				pos: [0, h / 2, 0],
				color: PAL.bark,
				material: "Wood",
			})
		);
		const blobs = rng.int(2, 3);
		for (let i = 0; i < blobs; i++) {
			parts.push(
				part({
					name: "Canopy",
					size: [rng.range(6.5, 9.5), rng.range(5, 7.5), rng.range(6.5, 9.5)],
					pos: [rng.range(-2.4, 2.4), h + rng.range(1, 2.6), rng.range(-2.4, 2.4)],
					rot: [0, rng.range(0, Math.PI), 0],
					color: PAL.canopy,
					material: "LeafyGrass",
					shape: "Ball",
					collide: false,
					touch: false,
					query: false,
					castShadow: false,
				})
			);
		}
	} else {
		const h = rng.range(7, 12);
		parts.push(
			part({
				name: "Trunk",
				size: [rng.range(1.4, 2), h, rng.range(1.4, 2)],
				pos: [0, h / 2, 0],
				rot: [lean * 1.6, yaw, 0],
				color: PAL.deadWood,
				material: "Wood",
			})
		);
		const branches = rng.int(2, 4);
		for (let i = 0; i < branches; i++) {
			const bl = rng.range(3, 6.5);
			const ang = rng.range(0, Math.PI * 2);
			const tilt = rng.range(0.5, 1.1);
			parts.push(
				part({
					name: "Branch",
					size: [rng.range(0.5, 0.9), bl, rng.range(0.5, 0.9)],
					pos: [
						Math.sin(ang) * bl * 0.28,
						h * rng.range(0.55, 0.92),
						Math.cos(ang) * bl * 0.28,
					],
					rot: [Math.cos(ang) * tilt, ang, -Math.sin(ang) * tilt],
					color: PAL.deadWood,
					material: "Wood",
					collide: false,
					touch: false,
					query: false,
				})
			);
		}
	}

	// The Model carries the tree's world transform; children are built in local space.
	return inst("Model", { Name: S("Name", "Tree"), CFrame: CF("CFrame", [x, 0, z], [0, yaw, 0]) }, parts);
}

function buildTrees() {
	const trees = [];
	const spots = scatter(320, 5.2, (x, z) => clearingDist(x, z) > 2.5 && distToPaths(x, z) > 6.5);
	for (const s of spots) trees.push(treeModel(s.x, s.z));
	return trees;
}

function buildTreeline() {
	// Dense band of trees hugging the boundary so the invisible wall reads as
	// "the forest simply ends" rather than "there is a wall here".
	const trees = [];
	for (let side = 0; side < 4; side++) {
		for (let i = 0; i < 58; i++) {
			const t = (i + 0.5) / 58;
			const u = (t - 0.5) * 2 * (HALF - 3);
			const wob = rng.range(-3, 3);
			const x = side === 0 ? u : side === 1 ? u : (side === 2 ? -HALF + 3 + wob : HALF - 3 - wob);
			const z = side === 0 ? -HALF + 3 + wob : side === 1 ? HALF - 3 - wob : u;
			const h = rng.range(14, 21);
			trees.push(
				part({
					name: "Tree",
					size: [2.4, h, 2.4],
					pos: [x, h / 2, z],
					color: PAL.barkDark,
					material: "Wood",
				})
			);
			trees.push(
				part({
					name: "Needles",
					size: [rng.range(11, 15), 5, rng.range(11, 15)],
					pos: [x, h * rng.range(0.55, 0.8), z],
					rot: [0, rng.range(0, Math.PI), 0],
					color: [PAL.needles[0] - 4, PAL.needles[1] - 5, PAL.needles[2] - 4],
					material: "LeafyGrass",
					collide: false,
					touch: false,
					query: false,
					castShadow: false,
				})
			);
		}
	}
	return trees;
}

function buildScatter() {
	const kids = [];

	// Boulders
	for (const p of scatter(120, 7, (x, z) => clearingDist(x, z) > 1 && distToPaths(x, z) > 3.5)) {
		const s = rng.range(1.2, 4.2);
		kids.push(
			part({
				name: "Rock",
				size: [s * rng.range(0.8, 1.4), s * rng.range(0.5, 1), s * rng.range(0.8, 1.4)],
				pos: [p.x, s * 0.32, p.z],
				rot: [rng.range(-0.2, 0.2), rng.range(0, Math.PI), rng.range(-0.2, 0.2)],
				color: rng.chance(0.5) ? PAL.rock : PAL.rockDark,
				material: "Slate",
			})
		);
	}

	// Bushes
	for (const p of scatter(180, 4.5, (x, z) => clearingDist(x, z) > 1 && distToPaths(x, z) > 3)) {
		const n = rng.int(2, 3);
		for (let i = 0; i < n; i++) {
			const s = rng.range(1.6, 3);
			kids.push(
				part({
					name: "Bush",
					size: [s, s * rng.range(0.6, 0.9), s],
					pos: [p.x + rng.range(-1.2, 1.2), s * 0.32, p.z + rng.range(-1.2, 1.2)],
					color: [PAL.canopy[0] - 6, PAL.canopy[1] - 4, PAL.canopy[2] - 4],
					material: "LeafyGrass",
					shape: "Ball",
					collide: false,
					touch: false,
					query: false,
					castShadow: false,
				})
			);
		}
	}

	// Ferns / grass tufts
	for (const p of scatter(150, 2.4, (x, z) => distToPaths(x, z) > 2)) {
		const blades = rng.int(2, 4);
		for (let i = 0; i < blades; i++) {
			const h = rng.range(0.9, 2.1);
			kids.push(
				part({
					name: "Fern",
					size: [rng.range(0.35, 0.6), h, rng.range(0.9, 1.6)],
					pos: [p.x + rng.range(-1.6, 1.6), h / 2, p.z + rng.range(-1.6, 1.6)],
					rot: [rng.range(-0.4, 0.4), rng.range(0, Math.PI), rng.range(-0.4, 0.4)],
					color: [PAL.canopy[0] - 10, PAL.canopy[1] - 2, PAL.canopy[2] - 10],
					material: "LeafyGrass",
					collide: false,
					touch: false,
					query: false,
					castShadow: false,
				})
			);
		}
	}

	// Fallen logs — waist-high cover, useful for breaking line of sight.
	for (const p of scatter(26, 18, (x, z) => clearingDist(x, z) > 3 && distToPaths(x, z) > 5)) {
		const len = rng.range(8, 16);
		kids.push(
			part({
				name: "FallenLog",
				size: [rng.range(1.6, 2.4), rng.range(1.4, 2.2), len],
				pos: [p.x, 0.9, p.z],
				rot: [0, rng.range(0, Math.PI), rng.range(-0.12, 0.12)],
				color: PAL.barkDark,
				material: "Wood",
				shape: "Cylinder",
			})
		);
	}

	return kids;
}

// =============================================================================
// LANDMARKS
// =============================================================================

function plankWall(name, cx, cz, width, height, yaw, gaps, thickness = 0.6) {
	// Emits a wall as horizontal planks, leaving `gaps` ([x0,x1] local spans) open.
	const parts = [];
	const rows = Math.max(1, Math.round(height / 1.1));
	const rh = height / rows;
	const cos = Math.cos(yaw), sin = Math.sin(yaw);
	for (let r = 0; r < rows; r++) {
		const y = 0.5 + rh * (r + 0.5);
		let cursor = -width / 2;
		const rowGaps = (gaps || []).filter((g) => g[2] === r || g[2] === null);
		const sorted = rowGaps.slice().sort((a, b) => a[0] - b[0]);
		const segs = [];
		for (const g of sorted) {
			if (g[0] > cursor) segs.push([cursor, g[0]]);
			cursor = Math.max(cursor, g[1]);
		}
		if (cursor < width / 2) segs.push([cursor, width / 2]);
		for (const [a, b] of segs) {
			if (b - a < 0.2) continue;
			const mid = (a + b) / 2;
			parts.push(
				part({
					name: `${name}_Plank`,
					size: [b - a, rh, thickness],
					pos: [cx + cos * mid, y, cz + sin * mid],
					rot: [0, yaw, 0],
					color: rng.chance(0.7) ? PAL.plank : PAL.plankDark,
					material: "WoodPlanks",
				})
			);
		}
	}
	return parts;
}

function buildCabin() {
	const cx = 62, cz = -46, yaw = -0.42;
	const W = 16, D = 14, H = 9;
	const kids = [];
	const cos = Math.cos(yaw), sin = Math.sin(yaw);
	const at = (lx, lz) => [cx + cos * lx - sin * lz, cz + sin * lx + cos * lz];

	const [fx, fz] = at(0, 0);
	kids.push(
		part({
			name: "Cabin_Floor",
			size: [W + 2, 0.6, D + 2],
			pos: [fx, 0.3, fz],
			rot: [0, yaw, 0],
			color: PAL.plankDark,
			material: "WoodPlanks",
		})
	);

	// Front wall with a doorway (gap in the middle rows) and two windows.
	kids.push(
		...plankWall("Cabin_Front", ...at(0, D / 2), W, H, yaw, [
			[-1.8, 1.8, 4], [-1.8, 1.8, 5], [-1.8, 1.8, 6],
			[-7, -3, 5], [-7, -3, 6], [3, 7, 5], [3, 7, 6],
		])
	);
	kids.push(...plankWall("Cabin_Back", ...at(0, -D / 2), W, H, yaw + Math.PI, [[-2, 2, 6]]));
	kids.push(...plankWall("Cabin_Left", ...at(-W / 2, 0), D, H, yaw + Math.PI / 2, []));
	kids.push(...plankWall("Cabin_Right", ...at(W / 2, 0), D, H, yaw - Math.PI / 2, [[-1, 1, 6], [-1, 1, 7]]));

	// Gabled roof: two slanted slabs, leaning in from each eave to the ridge.
	const LEAN = 0.62;
	const roofLen = Math.hypot(W / 2, D * 0.3);
	for (const s of [-1, 1]) {
		const rx = fx - sin * s * (W / 4);
		const rz = fz + cos * s * (W / 4);
		kids.push(
			part({
				name: "Cabin_Roof",
				size: [roofLen, 0.5, D + 3.2],
				pos: [rx, H + 2.4, rz],
				rot: [0, yaw, s * LEAN],
				color: PAL.plankDark,
				material: "WoodPlanks",
			})
		);
	}
	kids.push(
		part({
			name: "Cabin_Ridge",
			size: [1.4, 0.7, D + 3.4],
			pos: [fx, H + 2.4 + (W / 4) * Math.sin(LEAN), fz],
			rot: [0, yaw, 0],
			color: PAL.barkDark,
			material: "WoodPlanks",
		})
	);

	// Porch posts + railing
	for (const s of [-1, 1]) {
		const [px, pz] = at(s * (W / 2 - 0.8), D / 2 + 3);
		kids.push(
			part({
				name: "Porch_Post",
				size: [0.6, 6, 0.6],
				pos: [px, 3, pz],
				color: PAL.plankDark,
				material: "Wood",
			})
		);
	}

	// Interior dressing
	const [tx, tz] = at(3.5, -2.5);
	kids.push(
		part({ name: "Cabin_Table", size: [5, 0.4, 2.4], pos: [tx, 3.2, tz], rot: [0, yaw, 0], color: PAL.plank, material: "WoodPlanks" })
	);
	for (const [ox, oz] of [[-2.2, -1], [2.2, -1], [-2.2, 1], [2.2, 1]]) {
		const [lx, lz] = at(3.5 + ox, -2.5 + oz);
		kids.push(part({ name: "Cabin_TableLeg", size: [0.4, 3, 0.4], pos: [lx, 1.6, lz], color: PAL.plankDark, material: "Wood" }));
	}
	const [cx2, cz2] = at(-4, 3);
	kids.push(part({ name: "Crate", size: [2.4, 2.4, 2.4], pos: [cx2, 1.2, cz2], rot: [0, yaw + 0.3, 0], color: PAL.plank, material: "WoodPlanks" }));
	const [bx, bz] = at(-5.5, -4);
	kids.push(part({ name: "Crate", size: [1.8, 1.8, 1.8], pos: [bx, 0.9, bz], rot: [0, yaw - 0.5, 0], color: PAL.plankDark, material: "WoodPlanks" }));

	// Faint dying light inside so the cabin reads as a landmark from a distance.
	kids.push(
		part({
			name: "Cabin_Lamp",
			size: [0.6, 0.6, 0.6],
			pos: [fx, 6.4, fz],
			color: PAL.ember,
			material: "Neon",
			collide: false,
			touch: false,
			query: false,
			children: [pointLight("CabinLight", { color: [255, 150, 70], brightness: 1.1, range: 22 })],
		})
	);

	return model("Cabin", kids);
}

function buildRadioTower() {
	const cx = -66, cz = 58;
	const kids = [];
	const H = 30;
	const legs = [[-3.5, -3.5], [3.5, -3.5], [3.5, 3.5], [-3.5, 3.5]];
	for (const [lx, lz] of legs) {
		kids.push(
			part({
				name: "Tower_Leg",
				size: [0.7, H, 0.7],
				pos: [cx + lx, H / 2, cz + lz],
				rot: [lx * 0.006, 0, -lz * 0.006],
				color: PAL.rust,
				material: "CorrodedMetal",
			})
		);
	}
	for (let y = 3; y < H - 1; y += 4.5) {
		for (let i = 0; i < legs.length; i++) {
			const a = legs[i], b = legs[(i + 1) % legs.length];
			const ax = cx + a[0], az = cz + a[1];
			const bx = cx + b[0], bz = cz + b[1];
			for (const dy of [0, 2.25]) {
				const yy = y + dy;
				const midY = yy;
				const dropX = a[0] * 0.006 * midY, dropZ = a[1] * 0.006 * midY;
				const p1 = [ax - dropX, yy, az - dropZ];
				const p2 = [bx - b[0] * 0.006 * midY, yy, bz - b[1] * 0.006 * midY];
				const len = Math.hypot(p2[0] - p1[0], p2[2] - p1[2]);
				kids.push(
					part({
						name: "Tower_Brace",
						size: [0.35, 0.35, len],
						pos: [(p1[0] + p2[0]) / 2, midY, (p1[2] + p2[2]) / 2],
						rot: [0, Math.atan2(p2[0] - p1[0], p2[2] - p1[2]), 0],
						color: PAL.rust,
						material: "CorrodedMetal",
					})
				);
			}
		}
	}
	kids.push(
		part({
			name: "Tower_Platform",
			size: [9, 0.5, 9],
			pos: [cx, H - 1, cz],
			color: PAL.metal,
			material: "DiamondPlate",
		})
	);
	kids.push(
		part({
			name: "Tower_Beacon",
			size: [1, 1, 1],
			pos: [cx, H + 0.6, cz],
			color: [255, 60, 40],
			material: "Neon",
			collide: false,
			touch: false,
			query: false,
			children: [pointLight("BeaconLight", { color: [255, 50, 35], brightness: 3, range: 34 })],
		})
	);

	// Equipment shed at the base.
	kids.push(
		part({ name: "Shed", size: [7, 5, 5], pos: [cx + 8, 2.5, cz - 3], rot: [0, 0.3, 0], color: PAL.metal, material: "CorrodedMetal" })
	);
	kids.push(
		part({ name: "Shed_Roof", size: [7.6, 0.4, 5.6], pos: [cx + 8, 5.2, cz - 3], rot: [0, 0.3, 0], color: PAL.rust, material: "CorrodedMetal" })
	);
	kids.push(
		part({ name: "Generator", size: [2.6, 2.2, 2], pos: [cx - 7, 1.1, cz + 4], rot: [0, -0.6, 0], color: PAL.metal, material: "DiamondPlate" })
	);

	return model("RadioTower", kids);
}

function buildCarWreck() {
	const cx = -28, cz = -78, yaw = 1.1;
	const kids = [];
	const body = (name, size, pos, rot, color, mat = "CorrodedMetal") =>
		part({ name, size, pos, rot, color, material: mat });

	kids.push(body("Car_Body", [4.4, 1.5, 9.2], [cx, 1.5, cz], [0, yaw, 0.1], PAL.rust));
	kids.push(body("Car_Cabin", [4.2, 1.4, 4.4], [cx, 2.9, cz - 0.4], [0, yaw, 0.1], PAL.rust));
	kids.push(body("Car_Hood", [4.2, 0.4, 3], [cx - 0.6, 2.5, cz + 3.6], [0, yaw, 0.22], PAL.rust));
	kids.push(body("Car_Bumper", [4.6, 0.5, 0.6], [cx, 1.3, cz + 4.7], [0, yaw, 0.1], PAL.metal));
	for (const [ox, oz] of [[-2.2, 3.2], [2.2, 3.2], [-2.2, -3.2], [2.2, -3.2]]) {
		const rx = cx + Math.cos(yaw) * ox - Math.sin(yaw) * oz;
		const rz = cz + Math.sin(yaw) * ox + Math.cos(yaw) * oz;
		kids.push(
			part({
				name: "Car_Wheel",
				size: [1.3, 1.3, 0.8],
				pos: [rx, 0.7, rz],
				rot: [0, yaw, Math.PI / 2],
				color: [26, 26, 28],
				material: "Rubber",
				shape: "Cylinder",
			})
		);
	}
	// Rusted scatter around it.
	for (let i = 0; i < 8; i++) {
		const a = rng.range(0, Math.PI * 2);
		const d = rng.range(4, 9);
		kids.push(
			part({
				name: "Debris",
				size: [rng.range(0.8, 2.4), rng.range(0.2, 0.6), rng.range(0.8, 2.4)],
				pos: [cx + Math.cos(a) * d, 0.2, cz + Math.sin(a) * d],
				rot: [0, rng.range(0, Math.PI), 0],
				color: PAL.rust,
				material: "CorrodedMetal",
				collide: false,
			})
		);
	}
	return model("CarWreck", kids);
}

function buildStoneCircle() {
	const cx = 80, cz = 74;
	const kids = [];
	const R = 13;
	for (let i = 0; i < 9; i++) {
		const a = (i / 9) * Math.PI * 2;
		const h = rng.range(8, 14);
		kids.push(
			part({
				name: "StandingStone",
				size: [rng.range(2.2, 3.4), h, rng.range(1.6, 2.4)],
				pos: [cx + Math.cos(a) * R, h / 2 - 0.4, cz + Math.sin(a) * R],
				rot: [rng.range(-0.08, 0.08), a + Math.PI / 2, rng.range(-0.1, 0.1)],
				color: PAL.rock,
				material: "Slate",
			})
		);
	}
	kids.push(
		part({
			name: "Altar",
			size: [4.5, 1.6, 4.5],
			pos: [cx, 0.8, cz],
			color: PAL.rockDark,
			material: "Slate",
			shape: "Cylinder",
		})
	);
	kids.push(
		part({
			name: "Altar_Glyph",
			size: [2.4, 0.2, 2.4],
			pos: [cx, 1.68, cz],
			color: [40, 90, 70],
			material: "Neon",
			collide: false,
			touch: false,
			query: false,
			children: [pointLight("GlyphLight", { color: [70, 190, 140], brightness: 0.9, range: 14 })],
		})
	);
	return model("StoneCircle", kids);
}

function buildMarsh() {
	const cx = -86, cz = -74;
	const kids = [];
	kids.push(
		part({
			name: "Lake",
			size: [48, 0.5, 42],
			pos: [cx, 0.35, cz],
			rot: [0, 0.35, 0],
			color: PAL.water,
			material: "Water",
			transparency: 0.18,
			reflectance: 0.4,
			collide: false,
			touch: false,
			query: false,
			castShadow: false,
		})
	);
	kids.push(
		part({
			name: "LakeBed",
			size: [50, 1, 44],
			pos: [cx, 0, cz],
			rot: [0, 0.35, 0],
			color: [26, 26, 22],
			material: "Ground",
			collide: false,
			touch: false,
			query: false,
			castShadow: false,
		})
	);
	// Reeds around the shoreline.
	for (let i = 0; i < 90; i++) {
		const a = rng.range(0, Math.PI * 2);
		const d = rng.range(23, 30);
		const h = rng.range(2, 4.4);
		kids.push(
			part({
				name: "Reed",
				size: [0.25, h, 0.25],
				pos: [cx + Math.cos(a) * d, h / 2, cz + Math.sin(a) * d],
				rot: [rng.range(-0.25, 0.25), 0, rng.range(-0.25, 0.25)],
				color: PAL.reed,
				material: "LeafyGrass",
				collide: false,
				touch: false,
				query: false,
				castShadow: false,
			})
		);
	}
	return model("Marsh", kids);
}

function buildWatchtower() {
	const cx = 34, cz = 96;
	const kids = [];
	const H = 20;
	for (const [lx, lz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) {
		const h = lz < 0 || lx > 0 ? H : H * 0.55; // two legs snapped off
		kids.push(
			part({ name: "Tower_Leg", size: [0.9, h, 0.9], pos: [cx + lx, h / 2, cz + lz], rot: [lz * 0.02, 0, -lx * 0.02], color: PAL.barkDark, material: "Wood" })
		);
	}
	for (let y = 2.5; y < H - 2; y += 4) {
		kids.push(
			part({ name: "Tower_Beam", size: [9, 0.5, 0.5], pos: [cx, y, cz - 4], color: PAL.plankDark, material: "Wood" })
		);
		kids.push(
			part({ name: "Tower_Beam", size: [9, 0.5, 0.5], pos: [cx, y, cz + 4], color: PAL.plankDark, material: "Wood" })
		);
		kids.push(
			part({ name: "Tower_Beam", size: [0.5, 0.5, 9], pos: [cx - 4, y, cz], color: PAL.plankDark, material: "Wood" })
		);
	}
	kids.push(part({ name: "Tower_Deck", size: [10, 0.5, 10], pos: [cx, H + 0.3, cz], color: PAL.plank, material: "WoodPlanks" }));
	kids.push(part({ name: "Tower_Roof", size: [11, 0.4, 11], pos: [cx, H + 5, cz], rot: [0.14, 0, 0.1], color: PAL.plankDark, material: "WoodPlanks" }));
	for (let i = 0; i < 6; i++) {
		kids.push(
			part({
				name: "Plank",
				size: [rng.range(2, 4), 0.3, rng.range(1.4, 2.4)],
				pos: [cx + rng.range(-7, 7), 0.15, cz + rng.range(-7, 7)],
				rot: [0, rng.range(0, Math.PI), 0],
				color: PAL.plankDark,
				material: "WoodPlanks",
			})
		);
	}
	return model("Watchtower", kids);
}

function buildRockArch() {
	const cx = 110, cz = -20;
	const kids = [];
	const R = 11;
	for (let i = 0; i <= 12; i++) {
		const a = Math.PI * (i / 12);
		const x = cx + Math.cos(a) * R;
		const y = Math.sin(a) * R;
		if (y < 0.6) continue;
		kids.push(
			part({
				name: "Arch_Stone",
				size: [rng.range(4.5, 7), rng.range(3.5, 5.5), rng.range(3, 4.5)],
				pos: [x, y, cz + rng.range(-0.5, 0.5)],
				rot: [0, 0, -a + Math.PI / 2],
				color: rng.chance(0.5) ? PAL.rock : PAL.rockDark,
				material: "Slate",
			})
		);
	}
	for (const s of [-1, 1]) {
		kids.push(
			part({ name: "Arch_Pillar", size: [5.5, 8, 4.5], pos: [cx + s * R, 4, cz], color: PAL.rock, material: "Slate" })
		);
	}
	return model("RockArch", kids);
}

function buildSpawnPit() {
	const cx = -116, cz = -116;
	const kids = [];
	kids.push(part({ name: "Pit_Floor", size: [22, 1, 22], pos: [cx, -0.2, cz], color: [18, 18, 20], material: "Ground", collide: false, touch: false, query: false }));
	for (let i = 0; i < 16; i++) {
		const a = (i / 16) * Math.PI * 2;
		kids.push(
			part({
				name: "Pit_Stone",
				size: [rng.range(2.5, 4), rng.range(1.5, 3.5), rng.range(2.5, 4)],
				pos: [cx + Math.cos(a) * 10, 1.2, cz + Math.sin(a) * 10],
				rot: [0, a, 0],
				color: [30, 30, 34],
				material: "Slate",
			})
		);
	}
	return model("MonsterSpawnPit", kids);
}

function buildClearing() {
	const kids = [];
	// Fire pit ring
	for (let i = 0; i < 11; i++) {
		const a = (i / 11) * Math.PI * 2;
		kids.push(
			part({
				name: "FirePit_Rock",
				size: [rng.range(1.6, 2.4), rng.range(1, 1.6), rng.range(1.6, 2.4)],
				pos: [Math.cos(a) * 3.4, 0.6, Math.sin(a) * 3.4],
				rot: [0, a, 0],
				color: PAL.rockDark,
				material: "Slate",
			})
		);
	}
	kids.push(
		part({
			name: "FirePit_Embers",
			size: [3.4, 0.4, 3.4],
			pos: [0, 0.3, 0],
			color: PAL.ember,
			material: "Neon",
			collide: false,
			touch: false,
			query: false,
			children: [pointLight("FireLight", { color: [255, 140, 55], brightness: 2.2, range: 26, shadows: true })],
		})
	);
	// Log benches
	for (let i = 0; i < 4; i++) {
		const a = (i / 4) * Math.PI * 2 + 0.4;
		kids.push(
			part({
				name: "Bench",
				size: [6, 1.1, 1.6],
				pos: [Math.cos(a) * 9, 0.55, Math.sin(a) * 9],
				rot: [0, -a, 0],
				color: PAL.barkDark,
				material: "Wood",
			})
		);
	}
	kids.push(
		spawnLocation({ name: "Spawn_A", pos: [-7, 0.5, -7], duration: 8 }),
		spawnLocation({ name: "Spawn_B", pos: [7, 0.5, 7], duration: 8 })
	);
	return model("CentralClearing", kids);
}

const PICKUP_SIZE = [1.6, 2.2, 1.6];

/**
 * Works out whether a pickup can sit at (x, z).
 *
 * Returns `{ ok: true, y }` -- including when `y` was raised to rest on top of
 * decking or an altar, which is a valid placement, not a compromise. Returns
 * `{ ok: false }` only when something genuinely blocks the spot (a wall, a
 * boulder, a tree), so the caller can try a nearby offset instead.
 */
function resolvePickupY(x, z) {
	let y = 1.3;
	for (const c of colliders) {
		const overlapX = Math.abs(c.x - x) < (c.sx + PICKUP_SIZE[0]) / 2 - 0.05;
		const overlapZ = Math.abs(c.z - z) < (c.sz + PICKUP_SIZE[2]) / 2 - 0.05;
		if (!overlapX || !overlapZ) continue;

		const top = c.y + c.sy / 2;
		// Low, wide geometry is a floor we can sit on (cabin decking, altar).
		if (c.sy <= 2.5 && c.sx >= 4 && c.sz >= 4 && top < 4) {
			y = Math.max(y, top + PICKUP_SIZE[1] / 2 + 0.05);
		} else {
			// Anything else is a wall, boulder or tree: the spot is unusable.
			return { ok: false, reason: `blocked by ${c.name}` };
		}
	}
	return { ok: true, y };
}

function buildPickups() {
	// Small spiral of offsets so a blocked spot gets nudged rather than dropped.
	const nudges = [[0, 0]];
	for (let ring = 1; ring <= 3; ring++) {
		for (let step = 0; step < 8; step++) {
			const a = (step / 8) * Math.PI * 2;
			nudges.push([Math.cos(a) * ring * 2.5, Math.sin(a) * ring * 2.5]);
		}
	}

	const placed = [];
	const warnings = [];
	const items = PICKUP_SPOTS.map(([sx, sz], i) => {
		let chosen = null;
		let reason = "no free spot found";
		for (const [dx, dz] of nudges) {
			const x = sx + dx;
			const z = sz + dz;
			if (Math.abs(x) > HALF - 4 || Math.abs(z) > HALF - 4) continue;
			const result = resolvePickupY(x, z);
			if (!result.ok) {
				reason = result.reason;
				continue;
			}
			// A nudge is acceptable but worth knowing about, since it means the
			// authored spot drifted.
			chosen = {
				x,
				y: result.y,
				z,
				nudged: dx !== 0 || dz !== 0,
				snapped: result.y > 1.3,
				ok: true,
			};
			if (chosen.nudged) {
				warnings.push(
					`BatteryPickup_${i + 1}: authored spot (${sx}, ${sz}) was ${reason}; ` +
						`moved to (${x.toFixed(1)}, ${z.toFixed(1)})`
				);
			}
			break;
		}
		if (!chosen) {
			// Never silently drop a pickup; fall back to the authored spot and
			// let tools/audit-map.mjs flag it.
			chosen = { x: sx, y: 1.3, z: sz, nudged: false, snapped: false, ok: false };
			warnings.push(
				`BatteryPickup_${i + 1}: could not be placed anywhere near ` +
					`(${sx}, ${sz}) (${reason}); kept the authored spot`
			);
		}
		placed.push(chosen);
		return part({
			name: `BatteryPickup_${i + 1}`,
			size: PICKUP_SIZE,
			pos: [chosen.x, chosen.y, chosen.z],
			rot: [0, rng.range(0, Math.PI), 0],
			color: PAL.amber,
			material: "Neon",
			collide: false,
			touch: false,
			query: false,
			children: [pointLight("PickupLight", { color: [255, 200, 110], brightness: 1.8, range: 16 })],
		});
	});

	return { xml: model("BatteryPickups", items), placed, warnings };
}

// =============================================================================
// MONSTER
// =============================================================================

function buildMonster() {
	const kids = [];
	const skin = PAL.monsterSkin;
	// Body
	kids.push(
		part({
			name: "Body",
			size: [3.4, 4.6, 2.6],
			pos: [0, 4.2, 0],
			color: skin,
			material: "SmoothPlastic",
			shape: "Ball",
			collide: false,
			touch: false,
			query: false,
			locked: false,
		})
	);
	// Head
	kids.push(
		part({
			name: "Head",
			size: [2.4, 2.6, 2.4],
			pos: [0, 7.4, -0.2],
			color: [10, 10, 12],
			material: "SmoothPlastic",
			shape: "Ball",
			collide: false,
			touch: false,
			query: false,
			locked: false,
		})
	);
	// Jaw
	kids.push(
		part({
			name: "Jaw",
			size: [1.9, 0.7, 1.6],
			pos: [0, 6.7, -0.8],
			color: [26, 20, 22],
			material: "SmoothPlastic",
			collide: false,
			touch: false,
			query: false,
			locked: false,
		})
	);
	// Eyes
	for (const s of [-1, 1]) {
		kids.push(
			part({
				name: "Eye",
				size: [0.55, 0.4, 0.4],
				pos: [s * 0.65, 7.9, -1.05],
				color: PAL.monsterEye,
				material: "Neon",
				collide: false,
				touch: false,
				query: false,
				castShadow: false,
				locked: false,
				children: [pointLight("EyeGlow", { color: [255, 80, 40], brightness: 1.4, range: 11 })],
			})
		);
	}
	// Arms
	for (const s of [-1, 1]) {
		kids.push(
			part({
				name: "Arm",
				size: [0.8, 5.2, 0.8],
				pos: [s * 2.2, 4.4, -0.2],
				rot: [0, 0, s * 0.22],
				color: [12, 12, 14],
				material: "SmoothPlastic",
				collide: false,
				touch: false,
				query: false,
				locked: false,
			})
		);
	}
	// Legs
	for (const s of [-1, 1]) {
		kids.push(
			part({
				name: "Leg",
				size: [1, 2.4, 1],
				pos: [s * 0.9, 1.3, 0],
				color: [12, 12, 14],
				material: "SmoothPlastic",
				collide: false,
				touch: false,
				query: false,
				locked: false,
			})
		);
	}

	const xml = model("Monster", kids);
	// Park it below the world; the server takes control of its CFrame on start.
	return document([
		xml.replace(
			`<string name="Name">Monster</string>`,
			`<string name="Name">Monster</string>${CF("CFrame", [0, -400, 0])}`
		),
	]);
}

// =============================================================================
// write
// =============================================================================

function buildForest() {
	return document([
		folder("Ground", buildGround()),
		folder("Boundary", buildBoundary()),
		folder("Treeline", buildTreeline()),
		folder("Trees", buildTrees()),
		folder("Scatter", buildScatter()),
	]);
}

/** World-space AABBs of every solid part, recorded while landmarks are built. */
const colliders = [];

function buildLandmarks() {
	// Record the landmark geometry as it is created so the pickups can be
	// placed against it rather than against a hand-maintained list.
	capture.colliders = colliders;
	const structures = [
		buildClearing(),
		buildCabin(),
		buildRadioTower(),
		buildCarWreck(),
		buildStoneCircle(),
		buildMarsh(),
		buildWatchtower(),
		buildRockArch(),
		buildSpawnPit(),
	];
	capture.colliders = null;

	const { xml: pickups, warnings } = buildPickups();
	for (const w of warnings) console.warn(`  ~ ${w}`);

	return document([...structures, pickups]);
}

mkdirSync(OUT_DIR, { recursive: true });

const files = {
	"Forest.rbxmx": buildForest(),
	"Landmarks.rbxmx": buildLandmarks(),
	"Monster.rbxmx": buildMonster(),
};

for (const [name, xml] of Object.entries(files)) {
	writeFileSync(resolve(OUT_DIR, name), xml, "utf8");
	const parts = (xml.match(/class="Part"/g) || []).length;
	const models = (xml.match(/class="Model"/g) || []).length;
	const lights = (xml.match(/class="PointLight"/g) || []).length;
	console.log(`${name.padEnd(18)} ${(xml.length / 1024).toFixed(0).padStart(5)} KB  parts=${parts} models=${models} lights=${lights}`);
}
console.log("\nGenerated in", OUT_DIR);