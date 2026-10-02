# Night 99 — Roblox

A Roblox port of the **Night99** Unity game: you are alone in a black forest with
a flashlight, and something out there is hunting you by the light you cannot
switch off.

Built as a [Rojo](https://rojo.space) project so the map and the code are both
version controlled.

> This lives in the `roblox/` folder of the Night99 repo, alongside the original
> Unity project, on the `roblox-port` branch. The Unity project in the repo root
> is untouched. Run every command from inside this folder.

---

## Quick start

Everything below runs from this directory:

```bash
cd roblox               # only if you cloned this alongside the Unity project
npm install             # luaparse, for the Lua syntax check
npm run check          # syntax + cross-reference check
npm run build          # regenerate the map (only needed if you edit the generator)

rojo serve             # then connect Studio with the Rojo plugin
```

1. Install the **Rojo Studio plugin** and point it at the port `rojo serve` prints.
2. Open your place (or `rojo build -o Night99.rbxl` to create one).
3. Press **Play**. You should spawn in the fire pit clearing.

### One manual step

`Lighting.Technology` cannot be set from a script. In Studio, open
**Properties → Lighting → Technology** and set it to **Future** (or leave
**ShadowMap**). Everything else in `LightingService` is applied at runtime.

---

## Layout

```
default.project.json      Rojo project definition
generated/                The map, as .rbxmx (regenerate with `npm run build`)
  Forest.rbxmx            Ground, boundary, trees, scatter
  Landmarks.rbxmx         8 landmarks + 14 battery pickups + spawns
  Monster.rbxmx           The monster model
src/shared/               Config + the RemoteEvent accessor
src/server/               Authoritative game logic
src/client/               Flashlight, HUD, camera, monster tracker
tools/
  build-map.mjs           Generates generated/*.rbxmx from a fixed seed
  rbxxml.mjs              Minimal .rbxmx writer
  check-lua.mjs           Lua parse check
  check-refs.mjs          require/remote/map-name cross-reference check
```

`Workspace.Night99` holds everything map-related, so it never collides with
Studio's default baseplate or anything you add.

---

## The map

256 × 256 studs, walled by a dense treeline with invisible collision barriers
just outside it.

| Landmark | Location | Notes |
| --- | --- | --- |
| Central Clearing | `0, 0` | Fire pit, benches, 2 spawn points |
| Cabin | `62, -46` | Plank walls with window and door gaps, interior table + crates, a dying lamp |
| Radio Tower | `-66, 58` | 30-stud lattice tower with a red beacon, equipment shed |
| Car Wreck | `-28, -78` | Rusted body, wheels, scattered debris |
| Stone Circle | `80, 74` | Nine standing stones and a glowing altar |
| Marsh | `-86, -74` | Reflective water, shoreline reeds |
| Watchtower | `34, 96` | Collapsed tower, two legs snapped off |
| Rock Arch | `110, -20` | Natural stone arch |
| Monster Spawn Pit | `-116, -116` | Where the monster wakes up each night |

Around 320 trees (pine / broadleaf / dead), a 232-tree boundary treeline, plus
rocks, bushes, ferns and fallen logs. Five dirt paths connect the landmarks —
they are the fastest route between cover, and they are also where you are most
likely to be seen.

**All of it is real geometry in `generated/*.rbxmx`, so you can open it in Studio
and move things by hand.** The generator is only the starting point.

### Changing the map

Edit `tools/build-map.mjs` (layout constants are all at the top) and re-run
`npm run build`, or just edit the instances directly in Studio. The generator is
deterministic — same seed, same map — so diffs stay readable.

Pickup spots are hints rather than hard positions: the generator records every
solid landmark part as it builds, then snaps each battery onto decking, the
stone-circle altar, or open ground — and nudges it to the nearest free spot if
its authored position is blocked. Anything it has to move is printed as a `~`
warning during the build, and `node tools/audit-map.mjs` independently re-checks
that all 14 batteries are reachable.

---

## Gameplay

Ported from `Assets/Scripts/GameParameters.cs`, re-tuned for Roblox units.

**Flashlight** — spot light on your head, `F` to toggle (touch button on mobile).
Range and brightness scale with your charge, so a weak battery literally means a
shorter cone of light.

**Battery** — 100 max, drains while lit, trickles back very slowly while dark.
Battery pickups give +40 and respawn after 25s.

**Monster** — server-authoritative, broadcast at 15 Hz and interpolated on the
client. It roams, chases anything it can see within 40 studs, and attacks within
6.

**The one deliberate change from the Unity version.** In Unity the monster flees
any enabled player light, which makes "hold the torch on forever" a total win.
Here the flashlight only wards it off while you are above
`Config.Monster.RepelBatteryFactor` (34%). As your charge falls the light shrinks,
the monster closes, and you have to break for a battery. Same systems, actual game.

**Line of sight is a real raycast**, so trees, the cabin and the boulders all work
as cover. That is most of what the forest is for.

**Nights** — survive 80 seconds to clear a night, then get 10 seconds of quiet to
scavenge. Each night is faster, and the light drains faster. Death resets you to
night 1; your best night is kept in the leaderboard for the session.

### Where the numbers live

Everything tunable is in [`src/shared/Config.lua`](src/shared/Config.lua). Camera
mode is there too: default `FirstPerson`, set `"ThirdPerson"` for the high orbiting
rig the Unity original used.

---

## Checks

`npm run check` runs two things Studio would otherwise catch for you:

- **`check-lua.mjs`** — parses every `.lua` file (catches syntax errors).
- **`check-refs.mjs`** — builds the instance tree Rojo would produce from
  `default.project.json`, then verifies that every `require()` chain resolves to a
  real ModuleScript, every awaited RemoteEvent is created by `Net.lua`, every
  cross-service call exists, every `Config.*` key read is defined, and every
  `workspace:WaitForChild(...)` name exists in the generated map.

Both are validated against deliberately broken copies of the project, so a clean
run means something.

---

## Known gaps

- **No audio.** There are no sound assets in this repo. `TODO(audio)` markers sit
  at the three places sound belongs: the monster's attack
  (`MonsterService`), the battery pickup (`BatteryService`) and the proximity
  heartbeat (`HUD`). Drop in asset IDs and they are one-liners.
- **No real monster rig.** The monster is built from primitives in
  `tools/build-map.mjs` (`buildMonster`). Swap in a rig and point
  `MonsterService.Init` at it — only `Body` is used as the pivot, and the
  transform is driven by `PivotTo`, so an animated Model works as-is.
- **Not play-tested in Studio.** Everything here is validated statically (see
  Checks), not at runtime. First thing to verify by hand is that the flashlight
  toggle, monster chase and battery drain feel right at your chosen
  `Config` values.