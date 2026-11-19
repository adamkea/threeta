# Threeta

Top-down open-city driving game built with three.js, inspired by the overhead view of GTA: Chinatown Wars.

## Run

```bash
npm install
npm run dev
```

Controls:
- **In a car:** **W/↑** accelerate, **S/↓** brake/reverse, **A D / ← →** steer, **Space** handbrake (drift)
- **On foot:** **WASD / arrows** move (screen-relative), **Shift** run
- **F / Enter** get in or out of a car — works on traffic too (the driver gets thrown out and runs off)
- **R** reset

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
- `src/characters/Pedestrian.js` – person on foot: movement, collisions, walk/run animation, knockdown
- `src/characters/NpcManager.js` – non-player people (currently: drivers fleeing a carjacking)
- `src/player/PlayerController.js` – player state: driving vs on foot, entering/exiting/hijacking cars
- `src/physics/pedCollisions.js` – people vs cars (shoved, or knocked down by fast impacts)
- `src/core/CameraRig.js` – high, angled, north-up follow camera with look-ahead and speed zoom
- `src/core/Input.js` – keyboard input
