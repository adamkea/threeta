# Threeta

Top-down open-city driving game built with three.js, inspired by the overhead view of GTA: Chinatown Wars.
You start in a silver compact hatchback, Golf-style.

## Run

```bash
npm install
npm run dev
```

Controls:
- **In a car:** **W/↑** accelerate, **S/↓** brake/reverse, **A D / ← →** steer, **Space** handbrake (drift — leaves skid marks)
- **On foot:** **WASD / arrows** move (screen-relative), **Shift** run
- **F / Enter** get in or out of a car — works on traffic too (the driver gets thrown out and runs off); walk into shops
- **R** reset
- **M** city map (shows you, police and traffic)
- **Q** draw / holster your pistol (on foot), **mouse** to aim, **left click** (or **Ctrl**) to shoot, **E** reload

## Motorbikes

A sports bike (`motorbike` in `src/vehicles/carModels.js`) turns up in traffic and car parks, and
`spawn motorbike` in the dev console parks one next to you. It drives with the same keys as a car,
but it's quicker and nimbler, leans into corners and stands on its kickstand when parked. You can
see whoever is riding it (you ride in your own jacket and a black helmet). Bikes are light, so they
bounce off cars rather than shove them, and they're fragile. A hard crash (into a wall, or a car,
at roughly 30 km/h or more) **throws the rider off**: they're knocked down and hurt in proportion
to the crash, and the bike lies on its side until someone picks it up (just get back on). The same
goes for AI riders, who get up and run.

Bikes reuse `Car`: `bike: true` on a model builds it with `buildBikeMesh` and switches on the lean
physics, and `cfg.mass` (1 for cars) weights car-vs-car impulses.

## Health & guns

Everyone on foot has health (`src/combat/Health.js`): the player 100, civilians 60, gang members and
cops 100. Getting hit by a car hurts in proportion to its speed (fast hits kill). Your health bar sits
under the wanted stars, and the screen edges flash red when you're hurt. Die and you're **FLATLINED**:
you wake up outside the **hospital** with full health and a clean record. Bodies stay on the street for a while.

You start with a holstered pistol (12-round mag, 60 spare). With a gun out you face the mouse cursor
and can strafe. Bullets are instant hitscan rays stopped by the first person, car or building in the way.
Gunshots send nearby people running; shooting where the police can see or hear it, hitting people
(cops especially) and killing raise your wanted level. At 3+ stars, officers chasing you on foot draw
their own pistols and shoot back.

Guns are data: add an entry to `WEAPONS` in `src/combat/weapons.js` (damage, fire rate, auto,
magazine, reload time, range, spread, pellets, knockback, noise) and give it to the player with
`player.giveWeapon(WEAPONS.x)`; Q cycles through what you carry.

## Shops

Some buildings can be walked into. Each has a glowing yellow ring and a bobbing arrow on the pavement at
its door; stand on it and press **F**. The screen cuts to black and you're inside: only the interior is
drawn (the street outside is frozen and invisible) until you walk back out through the door. Guns stay
holstered indoors, and you can't go in with the police after you.

The first is **Lock & Load**, a gun shop round the corner from where you start (crosshair badge on the
map). Walk up to the counter and press **F** to buy guns: the **shotgun** (8 pellets a shot) and **SMG**
(full auto), then ammo for anything you own. You start with **$2,500**, shown under your health bar.
(There's no way to earn more yet — use `money <n>` in the dev console.)

To add a shop: give a landmark an `entrance` in `src/world/Landmarks.js`, write its interior (see
`src/interiors/GunShopInterior.js`: its own scene, lights, colliders, spawn point, counter and exit
zone) and register it in `INTERIORS` in `src/interiors/Shops.js`.

## Vehicle damage

Every vehicle has hit points and goes through a series of damage states (`src/vehicles/damage.js`):
**intact → dented → smoking → wrecked → burning → destroyed**. Crashes (into walls or other cars,
scaled by how hard the hit was), bullets and explosions all wear it down. Each state can make the
engine weaker and the steering worse, grime and bend the bodywork, knock off loose parts (bumpers,
mirrors, plates, spoilers, roof signs), smash the headlights, and pour out white then black smoke.
Once a car is **burning**, AI drivers bail out and run, and the fire burns it down in a few seconds.
The final state is **destroyed**: the car explodes, hurting and shoving people and cars nearby
(which can set off other cars in a chain), and leaves a burnt-out shell sitting on its rims that
can't be driven or entered. If you're still inside when it goes up, you won't survive. Blowing up a
police car raises your wanted level. There's no HUD readout: how the car looks tells you its state.

This works for every model, current and future, because it lives in `Car` itself:
- **New model, no extra work:** any entry in `MODELS` (`src/vehicles/carModels.js`) gets the default
  states and 700 hit points.
- **Tune a model** with an optional `damage` entry: `damage: { hp: 950 }` for a tougher van,
  `damage: { engine: -0.35 }` to make smoke and flames come from a rear engine, or
  `damage: { states: [...] }` for a completely different progression (the last state is always the
  destroyed one).
- **States are data:** each entry in `DAMAGE_STATES` sets the health fraction where it starts
  (`at`) plus optional `power`, `steer`, `wear`, `shed`, `lights`, `smoke`, `fire`, `bleed`
  (health lost per second) and `bail`. Add, remove or retune states there.
- **Breakable parts:** in `buildCarMesh`, add a part with `looseAdd(...)` instead of `add(...)` and
  it can be knocked off.
- **Damage it from new code** with `car.damage.hit(amount, source)` or
  `car.damage.impact(deltaV, source)`. `car.wrecked` says whether it's destroyed, and `car.repair()`
  makes it good as new. `VehicleDamageSystem` (`src/vehicles/VehicleDamageSystem.js`) runs the
  world-level side (bailing out, explosions, smoke, fire, debris) and has `onStateChange`,
  `onDestroyed` and `onBlastHit` hooks.

## Wanted level

Crimes raise a 0–5 star wanted level (top right): running people over (cops count for a lot more),
ramming patrol cars, stealing a police car, and carjacking where a cop can see you. While the police
chase you the level creeps up. Patrol cars (sirens flashing) come at you from out of view, cut you off and
ram you. Stop, or go on foot, and an officer jumps out to make the arrest. Beat cops nearby join in on foot.
Get caught and you're **BUSTED**: you lose the car and walk out of the **police station** with a clean record. To get away, break
line of sight and keep your distance. The stars flash, and a bar fills until the police give up.

## The city

The city isn't a plain grid any more. `src/world/CityLayout.js` generates it, deterministically, as a
**road graph**: junctions joined by straight roads of any angle and width. Every system drives, walks and
draws from that graph.

- **Bent streets:** the underlying 8×8 lattice gets uneven row and column widths (34–58 m), then a slow
  warp across town and a little jitter per junction. Streets curve gently and blocks become skewed
  quadrilaterals. The ring road round the island stays straight.
- **Avenues:** one wide (18 m) avenue each way, and **two diagonal avenues** cutting corner to corner
  through runs of blocks. They split those blocks into triangles and make big 6-way junctions with
  three-phase signals.
- **Superblocks:** a 2×2 park and several pairs of blocks joined where a street was closed, which leaves
  T-junctions behind.
- **Blocks are convex polygons** (the faces of the graph). They are filled with buildings by splitting the
  footprint along its longest side, so plots sit square to their street. The police station, hospital and
  car parks are turned to line up with their block. Some blocks are parks or triangular plazas.

To change the layout, edit `generate()` in `CityLayout.js`: block sizes, warp strength, which lines are
avenues, the diagonals' paths, which streets close. Junction geometry (how far each junction box reaches, crosswalks,
stop lines, signal phases and poles) is all derived from the graph.

Dev console (**`**): `tp <x> <z>` or `tp spawn | police | hospital | diagonal | park` teleports you.

## Look

Comic-book rendering in the spirit of Chinatown Wars: toon (banded) materials (`src/render/toon.js`)
plus an ink pass (`src/render/InkRenderer.js`) that draws thick black outlines from depth and normal
edges and boosts saturation. Roads have double-yellow centre lines, stop lines and zebra crossings.

## Layout

- `src/main.js` – renderer, lighting, fixed-step game loop
- `src/world/CityLayout.js` – the city as data: road graph (junctions, roads, setbacks, signal phases), blocks (convex polygons) and what's on them, the pedestrian walk graph, signal pole spots, `groundHeight`
- `src/world/City.js` – meshes and colliders built from the layout (road markings, sidewalks, buildings, parks, car parks, lamps)
- `src/world/geom.js` – 2D convex-polygon helpers (inset, clip, point tests)
- `src/world/colliders.js` – static collider tests shared by cars, people, bullets and sight lines (boxes, plus convex polygons for angled buildings)
- `src/vehicles/Car.js` – arcade car physics (grip/drift, steering, collisions) and mesh
- `src/world/Landmarks.js` – special whole-block buildings: the police station (where you end up when busted), the hospital (where you end up when you die) and the Lock & Load gun shop; their meshes, signs, roof markings and respawn points
- `src/vehicles/damage.js` / `VehicleDamageSystem.js` – damage states for every vehicle; smoke, fire, explosions
- `src/world/ColliderGrid.js` – spatial hash so cars only test nearby static colliders
- `src/core/SpatialHash.js` – grids of the moving cars and people, rebuilt each physics step, so AI and collisions only look at neighbours
- `src/traffic/RoadNetwork.js` – lane geometry helpers over the road graph (right-hand traffic)
- `src/traffic/TrafficLights.js` – per-junction signal phases (opposite approaches share a green) + signal heads on the lamp posts
- `src/traffic/TrafficDriver.js` – AI driver: random routes, pure-pursuit steering, obeys lights, queues, overtakes stopped cars, rejoins lanes after crashes
- `src/traffic/TrafficSystem.js` – pooled AI cars spawned out of view around the player and recycled when far away
- `src/physics/carCollisions.js` – car-vs-car impulses with spin
- `src/characters/Pedestrian.js` – person on foot: movement, collisions, walk/run animation, knockdown; clothing & accessories (hats, jackets, badges, belts, masks…) toggled per look
- `src/characters/outfits.js` – character looks: civilians, cops (white-topped cap, navy uniform, badge, gold epaulettes) and three gangs (Red Fangs: red do-rags & bandanas; Violet Saints: purple tracksuits & backwards caps; Lime Vipers: lime hoodies, hoods up), plus gang turf (neutral downtown, outskirts split three ways) and who spawns where
- `src/characters/NpcManager.js` – pooled pedestrians around the player: stroll the sidewalks, cross at zebra crossings on a green, dodge oncoming cars, scatter when someone gets run over; carjacked drivers flee then calm down
- `src/characters/Sidewalks.js` – pedestrian walk graph (block corners and crosswalk ends, crossings tied to junction lights)
- `src/player/PlayerController.js` – player state: driving vs on foot, entering/exiting/hijacking cars
- `src/physics/pedCollisions.js` – people vs cars (shoved, or knocked down by fast impacts) and people vs people
- `src/police/Wanted.js` – crimes → heat → stars; evasion timer while out of sight
- `src/police/PoliceSystem.js` – spawns/retires patrol cars by wanted level, pulls patrol cars out of traffic, deploys officers, sends beat cops after you, decides arrests
- `src/police/PursuitDriver.js` – police driving: shortest-route navigation over the road graph toward you, then straight at you (leading your movement) when in view; three-point turns and backing out when stuck
- `src/police/sight.js` – line-of-sight test against buildings
- `src/interiors/Shops.js` – walk-in buildings: door markers, the cut to black, swapping the drawn scene to the interior and back, the counter menu and what the gun shop stocks
- `src/interiors/GunShopInterior.js` – the gun shop's interior: room, counter, gun racks, shelves, the clerk, its colliders
- `src/combat/Health.js` – hit points (damage / heal / dead) for anything that can be hurt
- `src/combat/weapons.js` – weapon definitions (`WEAPONS`) and `Weapon` (ammo, fire-rate cooldown, reload)
- `src/combat/CombatSystem.js` – fires shots for anyone (player or NPC): hitscan vs people, cars (oriented boxes) and buildings, damage + knockback, panic, tracers / muzzle flashes / impact puffs
- `src/render/skinBake.js` – bakes a person's or car's many parts into a few skinned meshes (one draw call per person, a handful per car), coloured from per-model palettes
- `src/core/CameraRig.js` – high, angled, north-up follow camera with look-ahead and speed zoom
- `src/core/Input.js` – keyboard + mouse input
