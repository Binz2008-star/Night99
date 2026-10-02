// Minimal Roblox XML (.rbxmx) writer used to generate the Night99 map.
// Only the subset of the schema the map needs is implemented, and every
// property writer emits the modern single-value ("tagged") format that
// Studio and Rojo both read.

export function escapeXml(value) {
	return String(value)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

/** Trim floats so the generated files stay small and diff cleanly. */
function num(n) {
	const r = Math.round(n * 1e4) / 1e4;
	return Object.is(r, -0) ? "0" : String(r);
}

/**
 * Roblox `CFrame.Angles(rx, ry, rz)` applies Z first, then X, then Y,
 * so the composed rotation matrix is Ry * Rx * Rz (row-major).
 */
export function eulerMatrix(rx = 0, ry = 0, rz = 0) {
	const cx = Math.cos(rx), sx = Math.sin(rx);
	const cy = Math.cos(ry), sy = Math.sin(ry);
	const cz = Math.cos(rz), sz = Math.sin(rz);

	const Rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]];
	const Ry = [[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]];
	const Rz = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]];

	const mul = (A, B) =>
		A.map((row, i) => row.map((_, j) => A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j]));

	return mul(mul(Ry, Rx), Rz);
}

// --- typed property writers -------------------------------------------------

export const S = (name, value) => `<string name="${name}">${escapeXml(value)}</string>`;
export const T = (name, value) => `<token name="${name}">${escapeXml(value)}</token>`;
export const B = (name, value) => `<bool name="${name}">${value ? "true" : "false"}</bool>`;
export const I = (name, value) => `<int name="${name}">${Math.round(value)}</int>`;
export const F = (name, value) => `<float name="${name}">${num(value)}</float>`;
export const C3 = (name, rgb) =>
	`<Color3 name="${name}"><r>${num(rgb[0])}</r><g>${num(rgb[1])}</g><b>${num(rgb[2])}</b></Color3>`;
export const V3 = (name, xyz) =>
	`<Vector3 name="${name}"><X>${num(xyz[0])}</X><Y>${num(xyz[1])}</Y><Z>${num(xyz[2])}</Z></Vector3>`;
export const CF = (name, pos, rot = [0, 0, 0]) => {
	const m = eulerMatrix(rot[0], rot[1], rot[2]);
	return (
		`<CFrame name="${name}">` +
		`<X>${num(pos[0])}</X><Y>${num(pos[1])}</Y><Z>${num(pos[2])}</Z>` +
		`<R0>${num(m[0][0])}</R0><R1>${num(m[0][1])}</R1><R2>${num(m[0][2])}</R2>` +
		`<R3>${num(m[1][0])}</R3><R4>${num(m[1][1])}</R4><R5>${num(m[1][2])}</R5>` +
		`<R6>${num(m[2][0])}</R6><R7>${num(m[2][1])}</R7><R8>${num(m[2][2])}</R8>` +
		`</CFrame>`
	);
};

/** Build an <Item> from a map of property name -> pre-rendered XML. */
export function inst(className, props = {}, children = []) {
	const body = Object.values(props).join("");
	const kids = children.filter(Boolean).join("");
	if (!kids) {
		return `<Item class="${className}"><Properties>${body}</Properties></Item>`;
	}
	return `<Item class="${className}"><Properties>${body}</Properties>${kids}</Item>`;
}

export function model(name, children = []) {
	return inst("Model", { Name: S("Name", name) }, children);
}

export function folder(name, children = []) {
	return inst("Folder", { Name: S("Name", name) }, children);
}

/**
 * When `capture.colliders` is an array, every collidable part created by part()
 * records its world AABB into it. The generator uses this so pickups can be
 * validated against real geometry instead of a hand-maintained list.
 */
export const capture = { colliders: null };

export function part(opts) {
	const {
		name,
		size,
		pos = [0, 0, 0],
		rot = [0, 0, 0],
		color = [190, 190, 190],
		material = "Plastic",
		transparency = 0,
		collide = true,
		touch = true,
		query = true,
		castShadow = true,
		reflectance = 0,
		shape = null,
		smooth = false,
		locked = true,
		children = [],
	} = opts;

	if (capture.colliders && collide) {
		capture.colliders.push({
			name,
			x: pos[0],
			y: pos[1],
			z: pos[2],
			sx: size[0],
			sy: size[1],
			sz: size[2],
		});
	}

	const props = {
		Name: S("Name", name),
		Anchored: B("Anchored", true),
		Locked: B("Locked", locked),
		CanCollide: B("CanCollide", collide),
		CanTouch: B("CanTouch", touch),
		CanQuery: B("CanQuery", query),
		CastShadow: B("CastShadow", castShadow),
		Reflectance: F("Reflectance", reflectance),
		Transparency: F("Transparency", transparency),
		Size: V3("Size", size),
		CFrame: CF("CFrame", pos, rot),
		Color: C3("Color", color),
		Material: T("Material", material),
		TopSurface: T("TopSurface", smooth ? "Smooth" : "Inlet"),
		BottomSurface: T("BottomSurface", smooth ? "Smooth" : "Outlet"),
	};
	if (shape) props.Shape = T("Shape", shape);
	return inst("Part", props, children);
}

export function pointLight(name, { color = [255, 220, 150], brightness = 2, range = 16, shadows = false, enabled = true }) {
	return inst("PointLight", {
		Name: S("Name", name),
		Enabled: B("Enabled", enabled),
		Color: C3("Color", color),
		Brightness: F("Brightness", brightness),
		Range: F("Range", range),
		Shadows: B("Shadows", shadows),
		Face: T("Face", "Bottom"),
	});
}

export function spawnLocation({ name, pos, size = [8, 1, 8], color = [92, 100, 108], duration = 8 }) {
	return inst("SpawnLocation", {
		Name: S("Name", name),
		Anchored: B("Anchored", true),
		Neutral: B("Neutral", true),
		Enabled: B("Enabled", true),
		Duration: I("Duration", duration),
		AllowTeamChangeOnTouch: B("AllowTeamChangeOnTouch", false),
		Transparency: F("Transparency", 0.25),
		Color: C3("Color", color),
		Material: T("Material", "Slate"),
		Size: V3("Size", size),
		CFrame: CF("CFrame", pos),
	});
}

export function document(items) {
	return `<roblox version="4">\n${items.filter(Boolean).join("\n")}\n</roblox>\n`;
}