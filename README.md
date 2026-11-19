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
- **F / Enter** get in or out of a car — works on traffic too (the driver gets thrown out and runs off)
- **R** reset
- **M** city map (shows you, police and traffic)
- **Q** draw / holster your pistol (on foot), **mouse** to aim, **left click** (or **Ctrl**) to shoot, **E** reload

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

## Look

Comic-book rendering in the spirit of Chinatown Wars: toon (banded) materials (`src/render/toon.js`)
plus an ink pass (`src/render/InkRenderer.js`) that draws thick black outlines from depth and normal
edges and boosts saturation. Roads have double-yellow centre lines, stop lines and zebra crossings.

## Layout

- `src/main.js` – renderer, lighting, fixed-step game loop
- `src/world/City.js` – procedural seeded city grid (roads, markings, buildings, parks, lamps) + AABB colliders
- `src/vehicles/Car.js` – arcade car physics (grip/drift, steering, collisions) and mesh
- `src/world/Landmarks.js` – special whole-block buildings: the police station (where you end up when busted) and the hospital (where you end up when you die); which blocks they sit on, their meshes, signs, roof markings and respawn points
- `src/vehicles/damage.js` / `VehicleDamageSystem.js` – damage states for every vehicle; smoke, fire, explosions
- `src/world/ColliderGrid.js` – spatial hash so cars only test nearby static colliders
- `src/traffic/RoadNetwork.js` – lane geometry helpers over the intersection grid (right-hand traffic)
- `src/traffic/TrafficLights.js` – per-intersection signal cycles + signal heads on the lamp posts
- `src/traffic/TrafficDriver.js` – AI driver: random routes, pure-pursuit steering, obeys lights, queues, overtakes stopped cars, rejoins lanes after crashes
- `src/traffic/TrafficSystem.js` – pooled AI cars spawned out of view around the player and recycled when far away
- `src/physics/carCollisions.js` – car-vs-car impulses with spin
- `src/characters/Pedestrian.js` – person on foot: movement, collisions, walk/run animation, knockdown; clothing & accessories (hats, jackets, badges, belts, masks…) toggled per look
- `src/characters/outfits.js` – character looks: civilians, cops (white-topped cap, navy uniform, badge, gold epaulettes) and three gangs (Red Fangs: red do-rags & bandanas; Violet Saints: purple tracksuits & backwards caps; Lime Vipers: lime hoodies, hoods up), plus gang turf (neutral downtown, outskirts split three ways) and who spawns where
- `src/characters/NpcManager.js` – pooled pedestrians around the player: stroll the sidewalks, cross at zebra crossings on a green, dodge oncoming cars, scatter when someone gets run over; carjacked drivers flee then calm down
- `src/characters/Sidewalks.js` – pedestrian walk graph (block-corner waypoints, crossings tied to junction lights)
- `src/player/PlayerController.js` – player state: driving vs on foot, entering/exiting/hijacking cars
- `src/physics/pedCollisions.js` – people vs cars (shoved, or knocked down by fast impacts) and people vs people
- `src/police/Wanted.js` – crimes → heat → stars; evasion timer while out of sight
- `src/police/PoliceSystem.js` – spawns/retires patrol cars by wanted level, pulls patrol cars out of traffic, deploys officers, sends beat cops after you, decides arrests
- `src/police/PursuitDriver.js` – police driving: junction-to-junction navigation over the road grid toward you, then straight at you (leading your movement) when in view; three-point turns and backing out when stuck
- `src/police/sight.js` – line-of-sight test against buildings
- `src/combat/Health.js` – hit points (damage / heal / dead) for anything that can be hurt
- `src/combat/weapons.js` – weapon definitions (`WEAPONS`) and `Weapon` (ammo, fire-rate cooldown, reload)
- `src/combat/CombatSystem.js` – fires shots for anyone (player or NPC): hitscan vs people, cars (oriented boxes) and buildings, damage + knockback, panic, tracers / muzzle flashes / impact puffs
- `src/core/CameraRig.js` – high, angled, north-up follow camera with look-ahead and speed zoom
- `src/core/Input.js` – keyboard + mouse input
