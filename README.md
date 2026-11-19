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

## Wanted level

Crimes raise a 0–5 star wanted level (top right): running people over (cops count for a lot more),
ramming patrol cars, stealing a police car, and carjacking where a cop can see you. While the police
chase you the level creeps up. Patrol cars (sirens flashing) come at you from out of view, cut you off and
ram you. Stop, or go on foot, and an officer jumps out to make the arrest. Beat cops nearby join in on foot.
Get caught and you're **BUSTED**: you lose the car and start again with a clean record. To get away, break
line of sight and keep your distance. The stars flash, and a bar fills until the police give up.

## Look

Comic-book rendering in the spirit of Chinatown Wars: toon (banded) materials (`src/render/toon.js`)
plus an ink pass (`src/render/InkRenderer.js`) that draws thick black outlines from depth and normal
edges and boosts saturation. Roads have double-yellow centre lines, stop lines and zebra crossings.

## Layout

- `src/main.js` – renderer, lighting, fixed-step game loop
- `src/world/City.js` – procedural seeded city grid (roads, markings, buildings, parks, lamps) + AABB colliders
- `src/vehicles/Car.js` – arcade car physics (grip/drift, steering, collisions) and mesh
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
- `src/core/CameraRig.js` – high, angled, north-up follow camera with look-ahead and speed zoom
- `src/core/Input.js` – keyboard input
