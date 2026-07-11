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
