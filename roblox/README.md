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

## Play it in Studio — no install needed

This is the fastest way to see it working. You only need Roblox Studio, which you
already have installed. Nothing to download, no Rojo, no plugins.

**1. Open a place.** Launch Roblox Studio and use the **Baseplate** template.

**2. Drop the map in.** Open `generated/Night99.rbxmx` in Windows Explorer and drag
it onto **Workspace** in Studio's Explorer panel. You should see a model called
`Night99` appear containing `Forest`, `Landmarks` and `Monster` — about 3,265 parts.
Switch the viewport to see it.

**3. Paste the code.** Open `generated/InstallNight99.lua` in any text editor, select
all, copy. In Studio go to **View → Command Window**, paste, press **Enter**.

You should see two `[Night99]` lines in the Output confirming the scripts were
created. This is safe to repeat: it replaces `Source` on scripts that already exist.

> **If the paste gets truncated** — 49 KB is a lot of text and some editors and chat
> boxes will chop it — use `generated/install-parts/` instead. Same 14 scripts,
> split into six small files:
>
> ```bash
> roblox/generated/install-parts/1-of-6.lua
> roblox/generated/install-parts/2-of-6.lua
> ...
> roblox/generated/install-parts/6-of-6.lua
> ```
>
> Paste each one into the Command Window in order. Each is independent and safe to
> repeat, so if part 3 fails you can just fix it and carry on.

**4. Set Lighting.** **Properties → Lighting → Technology** → **Future** (or leave
**ShadowMap**). This one property cannot be set from a script — everything else in
`LightingService` is applied at runtime.

**5. Press Play.** You spawn in the fire-pit clearing with a battery at 100 and the
flashlight off.

### What to look for when you press Play

| Try | Expected |
| --- | --- |
| Press **F** | A spot light switches on; the cone gets shorter and dimmer as the battery drains |
| Watch the leaderboard | `Battery` falls while lit, trickles back up while dark |
| Walk to a glowing amber box | `+40` battery, box respawns after 25s |
| Stand still in the dark for a while | The vignette reddens and a heartbeat ramps up as something closes in |
| Get within ~40 studs with the light on | The monster turns and backs off |
| Let the battery drop under 34% | The light stops working as a weapon — this is the intended tension |

If the Output window shows red, the most likely cause is the map not being at
`Workspace.Night99`. `ServerScriptService.Night99.Main` waits for it, so check you
dragged into **Workspace** and not into some other folder.

---

## Day-to-day development (Rojo)

Redo edits by running `npm run build`, then re-paste the installer. For live syncing
without copy-paste, use Rojo:

```bash
cd roblox               # only if you cloned this alongside the Unity project
npm install             # luaparse, for the static checks
npm run check           # syntax + cross-reference + installer check
npm test                # the above, plus map audit and fault injection

rojo serve              # then connect Studio with the Rojo plugin
```

1. Install the **Rojo Studio plugin** and point it at the port `rojo serve` prints.
2. Open your place (or `rojo build -o Night99.rbxl` to create one).
3. Press **Play**. You should spawn in the fire pit clearing.

> If `rojo` is blocked from running, that is usually Smart App Control or a WDAC/AppLocker
> policy rejecting unsigned executables. `Windows Security → App & browser control →
> Smart App Control` can be switched off, but it is a one-way door (re-enabling needs a
> Windows reset), which is why the paste route above exists.

---

## Layout

```
default.project.json      Rojo project definition
generated/                Build output -- all of it is plain text, reviewable in git
  Night99.rbxmx           Whole map in one droppable file (Workspace.Night99)
  Forest.rbxmx            Ground, boundary, trees, scatter
  Landmarks.rbxmx         8 landmarks + 14 battery pickups + spawns
  Monster.rbxmx           The monster model
  InstallNight99.lua      Paste-into-Studio script installer (see above)
  install-parts/          The same 14 scripts as six small pastes, for when one
                          paste is too big for wherever you are pasting it
src/shared/               Config + the RemoteEvent accessor
src/server/               Authoritative game logic
src/client/               Flashlight, HUD, camera, monster tracker
tools/
  build-map.mjs           Generates generated/*.rbxmx from a fixed seed
  build-installer.mjs     Generates generated/InstallNight99.lua
  mounts.mjs              Where src/** lands in the DataModel, shared by the
                          installer, the Rojo cross-check and check-refs.mjs
  rbxxml.mjs              Minimal .rbxmx writer
  check-lua.mjs           Lua parse check
  check-refs.mjs          require/remote/map-name cross-reference check
  check-install.mjs       Proves the installer matches src/ byte-for-byte
  audit-map.mjs           Map layout audit
  test-check-install.ps1  Fault injection for check-install.mjs
```

`Workspace.Night99` holds everything map-related, so it never collides with
Studio's default baseplate or anything you add.

**Filename rule:** a `.lua` file's instance name is the filename minus `.lua`, and
nothing else. Rojo does *not* strip a `.client` / `.server` suffix, so
`HUD.client.lua` becomes an instance called `HUD.client` — and any
`WaitForChild("HUD")` then hangs forever with no error. The directory already says
which side a script runs on (`src/client`, `src/server`), so these files are
deliberately named plain: `HUD.lua`, `Main.lua`. `check-refs.mjs` fails the build if
a `.client`/`.server` suffix reappears, and `check-install.mjs` fails if the
installer's target paths and Rojo's ever stop matching.

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

`npm run check` runs three things Studio would otherwise catch for you:

- **`check-lua.mjs`** — parses every `.lua` file (catches syntax errors).
- **`check-refs.mjs`** — builds the instance tree Rojo would produce from
  `default.project.json`, then verifies that every `require()` chain resolves to a
  real ModuleScript, every awaited RemoteEvent is created by `Net.lua`, every
  cross-service call exists, every `Config.*` key read is defined, every
  `workspace:WaitForChild(...)` name exists in the generated map, and no filename
  carries a `.client`/`.server` suffix that would rename its instance.
- **`check-install.mjs`** — parses `generated/InstallNight99.lua` and every file in
  `generated/install-parts/`, then diffs each embedded source against `src/`, so a
  paste installer can never ship a stale or mangled copy of a script. Also checks
  the parts cover each script exactly once, and that every target path matches what
  Rojo would create — the installer and `rojo serve` are two ways to install the
  same scripts and must never disagree about where one lives.

`npm test` adds `audit-map.mjs` (no tree inside a clearing, no pickup buried in
geometry, no spawn point in the pit) and `test-check-install.ps1`, which breaks the
installers seven ways and asserts the checker fails each time.

All of these are validated against deliberately broken copies of the project, so a
clean run means something. That last point is not decoration: the cross-reference
checker originally asserted that Rojo strips `.client`/`.server` from instance
names, which it does not — so it cheerfully validated a `WaitForChild("HUD")` that
could never resolve and would have hung the game on the first Play. The bug lived in
the validator, which is why the validators get fault-injected too.

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
  Checks), not at runtime. The play-test checklist is at the top of this file;
  the things most worth looking at first are the flashlight toggle, the monster
  chase, and whether the battery drain feels right at your chosen `Config` values.