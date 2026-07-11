# Architecture Notes

Working notes on structure and known tradeoffs, so decisions don't get lost between sessions. Not a spec — see `twin-star-spec.md` for design intent. This is about how the code is organized.

## Current layout

```
src/game/
  vec2.ts        vector math + rotation helpers
  poly.ts        polygon geometry (clipping, point-in-polygon, boundary queries)
  physics.ts      shared 2D rigid-body impulse resolver (mass + moment of inertia + torque)
  constants.ts    every tunable value, flat, one file
  input.ts        keyboard/mouse state
  ship.ts         Ship class (movement, resources)
  asteroid.ts     Asteroid + Cell + composition data, Voronoi generation, adjacency graph
  chunk.ts        collectible debris entity
  tools.ts        tool definitions (laser/drill/charges)
  engine.ts       Engine class — simulation only: update loop, physics, mining, input handling
  renderer.ts     Renderer class — draws one frame from Engine's state, owns nothing
src/components/
  GameCanvas.tsx  mounts canvas, owns the rAF loop, wires Engine + Renderer together
```

## Done: engine/renderer split (this session)

`engine.ts` had grown to 1222 lines — simulation, mining logic, *and* every render call in one class. Split rendering out into `renderer.ts`. `Engine` now only does simulation (785 lines); `Renderer` only reads Engine's state and draws (459 lines). `Renderer` takes `engine: Engine` as a parameter rather than owning any state itself.

This was done now specifically *because* enemies/combat are next on the build order (spec §13 step 5) and would have hit this file first. The render side already follows a one-method-per-entity-type pattern (`renderShip`, `renderAsteroid`, `renderChunk`) — adding `renderEnemy` when the time comes is a drop-in, not a restructure. Same on the simulation side: an `enemies: Enemy[]` array and an `updateEnemies(dt)` step slot into Engine's existing update loop shape.

To make this work, a few things that were `private` on `Engine` became public surface for `Renderer` to read: `screenToWorld()`, `currentTarget`, `blastEffects`. Nothing else changed — `Engine` still fully owns mutation of its own state; `Renderer` only reads.

## Done: decoupling mechanics from their one current trigger (this session)

A recurring smell: a mechanic implemented only inside the one call site that currently needs it, rather than as a capability anything could reach. `Explosion`/`Engine.applyExplosion()` was the first fix (charges used to trigger blast logic directly; now charges just raise a generic `Explosion`). Same pass applied to two more:

- **Tool signature cost** used to be a constant hand-matched to each tool's own code (`ship.addSignature(LASER_SIG_PER_SEC * dt)` inside `cutCell`, etc.) — nothing enforced it stayed in sync with the tool itself. Moved onto `ToolDef` (`sigPerSecond` / `sigPerUse` in `tools.ts`), read generically at each call site. A new tool now declares its own cost instead of needing a new hand-wired call.
- **Collision impact damage** was inline math only `resolveAsteroidCollision` knew how to do. Pulled into `Engine.applyCollisionImpact(closingSpeed, source)` so a future enemy-ramming collision resolver can call the same formula instead of reimplementing it.
- **`Ship.takeImpact`** now requires a `DamageSource` (`"collision" | "explosion"`) on every call, mirroring `Explosion.source` — not consumed anywhere yet, but future per-source feedback (distinct hit messages/sounds) has something to switch on without a retrofit across call sites.

Left alone on purpose: `Cell.hasCharge` is charge-specific boolean state on a cell. It looks like the same smell, but there's only ever been one thing that attaches to a cell — generalizing to a device-type enum now would be designing for a feature that doesn't exist. Rule of three still applies.

Also generalized: cursor highlighting used to be tool-specific (`currentTarget`, range/mode-gated, drove both actual mining *and* the visual outline). Split into two concepts — `Engine.currentTarget` still drives mining eligibility, but `Engine.hoverTarget`/`hover.ts` is a new, independent "what's under the cursor" query that runs every frame regardless of tool or mode, and covers chunks as well as cells. The white outline + tooltip moved to their own render pass (`Renderer.renderHoverHighlight`) drawn after everything else, which as a side effect fixed a z-order bug (drill fracture lines used to render on top of the old per-cell highlight stroke).

## Done: one mass system for every collision (this session)

Found while auditing the above pattern: the ship had *two* masses. `SHIP_MASS = 30` was the real constant, used in ship-vs-rock — but `resolveChunkShipBumps` independently invented `SHIP_RADIUS * SHIP_RADIUS * 4` (324, a 10x disagreement) rather than using it. Chunk mass was `radius * radius` with no density constant at all, calibrated against nothing. Three unrelated mass conventions for what should be one physical model — almost certainly the concrete cause of the "big things push too easily, size/mass doesn't matter" note in the spec.

Fixed by making mass a single well-defined property per body type: `SHIP_MASS` for the ship, and `Chunk.mass` (a getter sharing `ROCK_MASS_PER_AREA` with rock cells — a chunk is the same material, just detached, computed from its circular radius). A chunk is now properly much lighter than the cell it came from, on the same scale rock mass already used. This mass model was then folded into the generic collision system below, superseding the short-lived `rigidRefForShip`/`rigidRefForChunk` helpers from earlier in the session.

## Done: one generic collision system instead of one method per pair of kinds (this session)

Prompted by a direct question: mass/velocity were already unified (`RigidRef`/`resolveContact`), so why were there still five hand-written collision methods (`resolveAsteroidCollision`, `resolveChunkCollisions`, `resolveChunkChunkCollisions`, `resolveChunkShipBumps`, plus rock-rock) each re-encoding which concrete lists collide with which? What happens when enemies, drones, or satellites need to be added — a sixth, seventh, eighth method, each a variation on the same math? That's the same "trigger vs capability" smell as `Explosion`, just in the physics layer.

Two things were genuinely hardcoded per pair rather than derived:
- **Restitution/friction were hand-tuned constants per pairing** (`COLLISION_RESTITUTION`, `CHUNK_CHUNK_RESTITUTION`, `CHUNK_SHIP_BUMP_RESTITUTION`, `CHUNK_ROCK_RESTITUTION`, `ROCK_ROCK_RESTITUTION` — five numbers for three actual materials). Replaced with `Material` (`physics.ts`: `{ restitution, friction }`) — one per body kind (`SHIP_MATERIAL`, `ROCK_MATERIAL`, `CHUNK_MATERIAL` in `engine.ts`) — and `combineMaterials(a, b)` derives any pairing's behavior (restitution averages, friction multiplies) instead of needing a constant hand-tuned for every existing kind a new one might touch. Friction in particular used to exist only as an unnamed `* 0.92` scrubbed onto the ship post-collision, nowhere else — chunks skated frictionlessly off everything. It's now a first-class part of every material (`applyFriction` in physics.ts), so chunks have real (light) grip too.
- **The pairing itself was five separate broad-phase loops.** Replaced with `Body`/`BodyHandle` (new `body.ts`) — any circle-shaped, independently-moving thing (today: the ship and every chunk, via `Engine.circleBodies()`) collides with every other circle body (`resolveBodyPair`/`resolveCircleCollisions`) and with rock (`resolveBodyVsRock`) through one generic function each, driven by the body's own `mass`/`material`/`radius`. A future circular entity (a drone, a simple enemy) is one more line in `circleBodies()` — zero new collision code, automatically correct against the ship, every chunk, and rock alike.

Rock-vs-rock (`resolveGroupPair`) deliberately stays its own thing — it's genuinely different geometry (irregular polygon via drift groups, not a circle), not laziness. It already scales to "more rocks" for free, since a second asteroid's drift groups would just be more entries in the same `driftGroups` list.

Reactions that aren't pure physics (only a *solid hit against rock* damages the ship — a chunk bump doesn't, matching prior behavior exactly) live in one small `reactToCollision(kindA, kindB, closingSpeed)` dispatch, kept deliberately separate from the physics resolvers — extending "what reacts to what" is a one-line addition there, not a new resolver.

**Also fixed in the same pass, now that collision is unified:** tunneling at speed. Collision was only ever checked at each frame's *end* position, so something moving far enough in one frame (cruise top speed; a chunk ejected point-blank from an extraction) could skip clean over thin geometry — a freshly laser-cut sliver is easily thinner than one frame's travel. Fixed with substepping, not full continuous collision detection: `Engine.substepsFor(speed, dt)` splits a fast frame's ship-movement+rock-collision (and, separately, chunk-movement+rock-collision) into a few smaller steps, each with its own collision check. Free at normal speeds (returns 1 step), capped at `MAX_COLLISION_SUBSTEPS` so a runaway velocity can't blow up frame cost.

## Not done yet, flagged for later

**Scene/mode concept.** Everything currently assumes "always in the field" — there's no notion of being docked at a hub. The spec's own core loop (§3) starts with "dock at hub," and that doesn't exist at all yet. The moment it's built, `Engine` (or something above it) needs a mode switch (field vs. hub) that the current flat structure doesn't have. Not building this preemptively — it's speculative until the hub actually exists — but noting it so the next pass isn't a surprise.

**HUD as DOM/React instead of hand-drawn canvas.** Current HUD is `ctx.fillText`/`ctx.fillRect` with manual `y += lineH` layout — fine for bars and status text, but the wrong tool for an actual hub shop/upgrade UI with buttons and lists. When the hub lands, the likely right move is a hybrid: canvas keeps the in-field HUD (targeting, bars, minimal text), a React overlay handles hub/menu screens. Not worth building the overlay plumbing before there's a screen that needs it.

**Test suite — started.** Vitest is now wired up (`npm test`), with `poly.test.ts` and `physics.test.ts` covering exactly the two files that caused the most "fix physics → break something else → fix that" cycles this session (geometry invariants — polygon area/centroid/second-moment, the corner-normal-blend regression, the `clampInsidePolygon` containment fix — and impulse-resolver conservation properties). Deliberately narrow: `engine.ts`, rendering, and entities are still changing too fast for tests to pay off there yet. Expand this suite as more pure logic (asteroid Voronoi generation/adjacency, drift-group split math) stabilizes, not preemptively.

## Deliberately not doing

- Splitting `constants.ts` into per-system files — defer until it's actually painful to navigate, not before.
- Reorganizing `src/game/` into subfolders (`entities/`, `systems/`, etc.) — wait until there's a third entity family beyond ship/asteroid (enemies would be that trigger), per the rule of three.
- Moving composition/tool/enemy definitions to external JSON/data files — TS modules are fine and type-safe for a solo prototype with no localization or modding requirement. Don't add a data-loading layer for nothing.
- ECS (entity-component-system) architecture or a state-management library (Redux/Zustand) — both are over-engineering for this scope. Class-based entities plus a plain game loop is the right-sized pattern for what this is.

## Known tradeoff: world-space vs. local-space transforms for drift groups

Rock pieces (`DriftGroup`s) that break loose from the asteroid can translate *and* rotate (real rigid-body physics — see `physics.ts`). The way that's implemented: each `Cell.polygon` is stored in absolute world-space coordinates, and every frame the group's rotation/translation delta is applied directly to those vertices in place (`rotateAround` + translate, mutating the array).

The textbook-correct alternative is to store each cell's geometry in **local space** relative to the group's center of mass, plus a single `(position, angle)` transform, and derive the world-space polygon on demand. That avoids any possibility of floating-point drift accumulating over many small incremental rotations, and is the standard approach in general-purpose physics engines.

I went with the world-space/incremental approach instead, deliberately:

- Cell geometry is *read* far more often than it's *written* — targeting, collision queries (`cellAt`, `closestBoundaryPoint`), and rendering all run multiple times per frame, while a group's transform is only updated once per frame. Storing world-space directly means every read is free; local-space-plus-transform would mean recomputing the world polygon on every single query instead.
- Floating-point error from repeated small rotations accumulates *extremely* slowly at double precision — far slower than any realistic play session would ever expose. This is not a tradeoff that matters at "browser game, minutes-to-hours session" scale.

This is the one place in the physics code where I traded theoretical correctness for practical performance. If a future need ever requires long-running deterministic replay, exact rewind, or multiplayer state reconciliation, this is the first place that assumption would need revisiting.
