# Threeta

Top-down open-city driving game built with three.js, inspired by the overhead view of GTA: Chinatown Wars.

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
- `src/core/CameraRig.js` – high, angled, north-up follow camera with look-ahead and speed zoom
- `src/core/Input.js` – keyboard input
