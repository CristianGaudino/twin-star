# Twin Star — Game Design Spec

## 1. Overview
A 2D top-down, real-time extraction game. You are the control system of a solo mining and salvage hub, operating in a twin-star frontier system. You fly out, mine asteroids and salvage wrecks under real-time risk, and choose each trip whether to push further for better rewards or return home safe with what you've got. Death costs you that run's haul only — ship and hub are not lost (for now).

## 2. Setting & Premise
- Twin-star system, both stars real, fixed anchors in the same continuous space — two distinct locations, not opposing factions.
- Home star: safe, developed, where the hub is anchored. Solar-powered — proximity to this star is the mechanical reason the hub can exist here at all.
- Far star: a second, distant, distinctly dangerous location in the same system — different resources, different enemies, different visual identity. Not narratively "hostile," just a harder, richer destination.
- No home planet, no origin story. Independent frontier operator. Premise deliberately avoids needing lore about where you came from.
- Player role: the hub's AI/control system, not a physical pilot.
  - Justifies compressed in-game time.
  - Justifies fast travel across real distances (dispatching assets, not personally commuting).
  - Justifies passive offline progress as narratively true, not just a gameplay abstraction.
  - The AI has no personality or voice — silent narrative justification only. Player is always in charge.

## 3. Core Loop
1. Dock at hub.
2. Review contracts/tasks (optional) or head out.
3. Fly into the field — real-time thrust/rotate/drag controls.
4. Mine, salvage, and/or fight, pushing further from home for better resources and greater risk.
5. Choose at any point: keep pushing, or return home.
6. Die → lose only that run's haul. Ship and hub untouched. (Harsher death consequences are a deliberate future consideration, not in current scope.)
7. Return home, spend haul on hub upgrades. Hub visibly changes — progression is legible in the structure itself, not just numbers.

## 4. Movement System
Two modes, toggled with a dedicated key:

| Mode | Controls | Purpose |
|---|---|---|
| Cruise | WASD thrusts relative to ship facing; mouse controls facing/aim; real drag/inertia | Fast transit between zones |
| RCS | WASD thrusts in absolute directions (up/left/down/right); mouse is free | Precision positioning — required for mining |

- Ships can collide with objects, taking hull damage scaled to impact speed.

## 5. Risk Structure
Risk is not a single distance-based dial. Three factors combine:
- **Distance from home star** — baseline risk/reward curve. Further = harder and more valuable.
- **Heat / signature** — aggressive tools and actions raise detectable energy/vibration signature. Higher signature draws more and tougher enemies.
- **Time-in-zone** — lingering in one sector raises risk independently of signature, discouraging camping a single rich spot indefinitely.

The far star is a genuinely distinct destination — different enemy roster, different resource types, distinct visual identity — reinforcing that direction matters, not just distance.

Environmental gating is organic, not a hard wall:
- A visible asteroid belt boundary marks the edge of normal operating range.
- Distance from a star affects solar power.
- Tougher enemies, harder materials to mine, stuff like that. Nothing physically blocks travel.

## 6. Mining Sequence
Mining is a full sequence, not a single action, and requires RCS mode (RCS frees the mouse for precision tool input since it doesn't use the mouse for movement):

1. **Ping** — triggered manually (dedicated key), sends an expanding ping from the ship. Ping asteroids, nearby entities, anomalies, etc. Has a cooldown, making it a deliberate action rather than passive detection.
2. **Scan** - Triggered manually when close to a given asteroid. Revealing composition (soft ore / dense crystal / hollow-unstable), recommended tool, and interaction nodes.
2. **Tools** — Should be unique in how they're used and what for, without feeling gimmicky:
   - Laser.
   - Drill.
   - Charges — Manual detonation.
3. **Fracture along real structure** — asteroids are cell-based; mining detaches the specific cell worked on. Visible, physical, not an abstract health bar.
4. **Capture chunks actively** — broken fragments drift with real momentum; must be flown into and collected using the same movement controls as travel and combat, not an automatic pickup.
5. **Signature cost** — louder/more aggressive tool use mines faster but raises detection signature, tying directly into the heat-based risk system.

Mining should be interactive and not just click here move on. Placement of the ship, where on the asteroid to mine, how much to mine and how much you can carry etc.

## 7. Shared Systems
All core mechanics draw from the same few resources, so the game feels like one coherent skill rather than several disconnected ones:

- **Fuel** — pure consumable. Drains only from thrust use (either movement mode). Never regenerates passively. Refills only at dock. Represents raw movement capability.
- **Power** — Shared across all systems except thrust; Initial battery charge, solar-charged near stars power depending on distance. Different systems have different power draw, both passively and actively, e.g. a passive radar vs mining laser. Systems can be enabled or disabled manually.
- **Cargo capacity** — hard limit, forces real prioritization (fill up on common ore now, or save room in case something rarer turns up further out?). Full cargo must give clear player feedback.
- **Hull integrity** — light damage system, not full subsystem simulation. Damaged by collisions.

## 8. Enemies
- Distinct types, not just scaled stats — e.g. fast/aggressive scavengers, slow/heavy pirates, stationary turret wrecks.
- Density and toughness scale with distance + heat + time-in-zone (Section 5).
- No hostile or combat system being worked on yet.

## 9. The Hub
- Visible growth as the progression readout — new docking arms, reactors, rings, lit sections as upgrades are purchased. No separate stats-only progression screen needed to feel progress.
- Passive layer: generates a slow trickle of resources while offline, based on settings left active before logging off — consistent with the always-running AI premise, not just an abstraction.
- Ship identity: Unique ships for different purposes to come in the future.

## 10. Deferred Phases (deliberate sequencing, not gaps)

### Phase 2 — Async Snapshot Coexistence
Other players' hubs and activity become visible as snapshots, never live-synced:
- Scavenger drones — heavy mining in a sector attracts weak automated drones over time, a hazard born from another player's activity.
- Distress beacons — when a player dies, a beacon broadcasts from the wreck; chasing it risks a decoy (pirates waiting for a second victim).
- Trade rumors — another hub can broadcast a one-off buy/sell offer, visitable and tradeable directly, no live market.
- Corpse-run reclaim — a player's own lost cargo drifts and decays rather than vanishing instantly, allowing a risky return trip to reclaim it.
- Hub scarring — recent damage shows as visible wear on a hub, slowly repairing over time — history readable at a glance.
- No shared economy, ever. Consequence and story travel between players; resources do not.
- No live multiplayer sync. Snapshot-only keeps this phase technically buildable.
- Architecture should not hard-code a player cap of 2 — designed to expand to any number of hubs around the home star over time, even though launch is solo-only.

### Phase 3 — Crew & Narrative
- Player is never crew themselves, but crew (pilots, mechanics, etc.) can be hired.
- Crew can age and have real lifespans, given compressed in-game time — genuine mortality stakes and generational turnover.
- Narrative voice/tone layered in once the mechanical foundation and mood are proven.

### Phase 4 (unscheduled) — Orbital/Phase-Cycle Timing
- A slow, cyclical (not fully simulated) shift in lighting/danger across a real-time cycle — not full orbital physics.
- Adds a timing dimension to risk (when is safe, not just where) — not required to validate whether the core loop is fun, so intentionally deferred.

## 11. Visual Direction
- Not yet decided.

## 12. Tech Stack
- TypeScript + Next.js + Tailwind CSS — one language across frontend, backend, and the eventual Phase 2 snapshot-async API.
- Canvas or a lightweight rendering library (e.g. PixiJS) for the game world itself.
- Explicitly not using a dedicated game engine, in favor of stack consistency for the multiplayer phase to come.

## 13. Build Order (Stage 1 priority)
Validate the riskiest, most foundational unknown first, cheaply, before building anything that depends on it:

1. Scaffold the Next.js + Tailwind project with a full-screen canvas mounted. Nothing else.
2. Get a ship moving — thrust, rotate, real drag/inertia. No mining, no enemies, no UI logic. Tune movement until it feels good on its own, with no objective, for several minutes straight. Do not proceed until this is genuinely true.
3. Add one procedurally-generated asteroid and get collision working.
4. Build the full mining sequence (scan → match tool → fracture along stress lines → actively capture drifting chunks) on that one asteroid, still with nothing else in the game.
5. Add one enemy type and test whether mining-while-threatened is actually tense.
6. Only once that minimal loop (flight + mining + one threat) is confirmed fun: layer in the shared systems (fuel, power, cargo, hull, heat), then distance/heat-based risk scaling, then the hub, then additional enemy variety.
7. Ship the solo game. Validate it on its own merits. Only then begin Phase 2.

## 14. Explicit Scope Discipline
- No shared/live economy, ever.
- No live-synced multiplayer — snapshot-only.
- No infinite/procedural-forever map — a fixed, legible twin-star system, so positions and traces stay meaningful over time.
- Only one active gameplay mode at launch (mining/combat) — no parallel modes (escort runs, salvage races, wave-defense) built simultaneously. Prove one loop deeply first, add others as later content.
- Solo phase must stand on its own merits — async is additive, not a crutch compensating for a weak core loop.

## 15. Future Enhancements
-Galactic map & discovery — fog of war, manual relay/ping mapping distinct from the mining scan ping, time-based degradation as bodies shift, and eventual permanent radar placements for mapping + movement detection.

-Crew system — Hub staff essentially, crew in the hub age, need resources, passively or actively work on certain tasks like maintenance, salvaging, research etc. Can be included on ship missions unlocking different types of tasks. Age and time of mission affect crew, stasis for long journeys, and task-specific crew requirements (e.g. planetside research, exploration of an abandoned ship). Noted as an extension of the existing Phase 3 concept rather than a replacement. Resources dedicated to the crew such as water etc. 

-Drones — deployable, purpose intentionally left open for later design.

-Real astronomical basis — the system should map onto an actual existing binary star system with real planets/belts/stars, keeping the future setting grounded in real astronomy rather than invented geography. Flagged as affecting the existing Setting and World Structure sections once picked up.

- Hauling - system for pulling things to certain places. Scrap ships, Ice, larger asteroids, etc. Has its downsides but upsides too, allows for passive gathering of materials as it's broken down.

- Different ships


Lets look into mass and readjust both the size and mass of things, at the moment things that are bigger than the ship are very easily moved and push simply by bouncing into them. It just feels a little too arcadey, size and mass doesnt seem to really matter.