# Threeta

Top-down open-city driving game built with three.js, inspired by the overhead view of GTA: Chinatown Wars.

## Run

```bash
npm install
npm run dev
```

Controls: **W/↑** accelerate, **S/↓** brake/reverse, **A D / ← →** steer, **Space** handbrake (drift), **R** reset.

## Layout

- `src/main.js` – renderer, lighting, fixed-step game loop
- `src/world/City.js` – procedural seeded city grid (roads, markings, buildings, parks, lamps) + AABB colliders
- `src/vehicles/Car.js` – arcade car physics (grip/drift, steering, collisions) and mesh
- `src/core/CameraRig.js` – high, angled, north-up follow camera with look-ahead and speed zoom
- `src/core/Input.js` – keyboard input
