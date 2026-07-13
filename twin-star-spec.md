# Twin Star — Game Design Spec

## 1. Overview
A 2D top-down, real-time extraction game. You are the control system of a solo mining and salvage hub, operating in a twin-star frontier system. You fly out, mine asteroids and salvage wrecks under real-time risk, and choose each trip whether to push further for better rewards or return home safe with what you've got. Death costs you that run's haul only — ship and hub are not lost (for now).

## 2. Setting & Premise
- Twin-star system, both stars real, fixed anchors in the same continuous space — two distinct locations, not opposing factions.
- Loosely modeled on Sirius: a bright, ordinary primary (home star, built) and a distant white-dwarf companion (far star, not built yet). Chosen for the visual/danger asymmetry the two stars need — not literal-scale astronomy.
- Home star: safe, developed, where the hub is anchored. Solar-powered — proximity to this star is the mechanical reason the hub can exist here at all. Also the reason it's dangerous to approach directly (Section 5) — the same proximity that powers the hub burns anything that gets too close.
- Far star: a second, distant, distinctly dangerous location in the same system — different resources, different enemies, different visual identity. Not narratively "hostile," just a harder, richer destination.
- No home planet, no origin story. Independent frontier operator. Premise deliberately avoids needing lore about where you came from.
- Player role: the hub's AI/control system, not a physical pilot.
  - Justifies compressed in-game time.
  - Justifies fast travel across real distances (dispatching assets, not personally commuting).
  - Justifies passive offline progress as narratively true, not just a gameplay abstraction.
  - The AI has no personality or voice — silent narrative justification only. Player is always in charge.

## 3. Core Loop
A trip out is an expedition, not a quick round trip — real distance and no fast travel mean minutes out, not seconds, before there's any reason to come back. Returning is a deliberate choice made when it makes sense, not a timer.

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
- Massive bodies pull the ship (and loose debris) off a straight line the closer it gets — a local effect around specific bodies (the home star today), not ambient gravity everywhere. See Section 5.

## 5. Risk Structure
Risk is not a single distance-based dial. Factors combine:
- **Distance from the hub** — baseline risk/reward curve, further = harder and more valuable. Not distance from a star — the star is a fixed landmark for flavor/solar-power/hazard, but what you actually navigate relative to, and what "how far out am I" means, is the hub.
- **Signature** — aggressive tool use raises a detectable energy/vibration meter that decays passively when idle. Built and functional; has no consequence yet since it has nothing to attract — wired up for Section 8 once enemies exist.
- **Proximity to a massive body** — unrelated to signature. Specific bodies (the home star today) have a localized gravity well: drifting or flying too close pulls you in, and touching the surface is instant death regardless of anything else. The approach itself is a separate, survivable hazard — radiant heat raises a hull-temperature warning first, only costing hull once it's crossed a threshold, so getting close is a real, escalating choice rather than a binary safe/dead line. Not full orbital simulation — bounded and local to specific bodies, not ambient physics everywhere (see also Section 10, Phase 4, which is a different — still unbuilt — time-cycle risk dimension, not this).
- **Time-in-zone** — lingering in one sector raises risk independently of signature, discouraging camping a single rich spot indefinitely. Not built yet.

The far star is a genuinely distinct destination — different enemy roster, different resource types, distinct visual identity — reinforcing that direction matters, not just distance.

Environmental gating is organic, not a hard wall:
- The asteroid belt is a real, visible ring around the home star (a specific distance band, not "everywhere") — a deliberate landmark you travel to reach, denser and richer than the space around it. Between the hub and the belt is normal space: not empty, a moderate scatter of mostly-smaller asteroids, but clearly less than the belt itself.
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

- **Fuel** — pure consumable. Drains only from thrust use (either movement mode). Never regenerates passively. Refills only at dock. Represents raw movement capability. Not built yet — thrust is currently unlimited, gated only by drag/inertia feel.
- **Power** — Shared across all systems except thrust; Initial battery charge, solar-charged near stars power depending on distance. Different systems have different power draw, both passively and actively, e.g. a passive radar vs mining laser. Systems can be enabled or disabled manually. Not built yet.
- **Cargo capacity** — hard limit, forces real prioritization (fill up on common ore now, or save room in case something rarer turns up further out?). Full cargo must give clear player feedback. Built — a per-composition hold (ore/crystal/unstable stored as themselves, no currency conversion — see Section 9), raised by hub upgrades.
- **Hull integrity** — light damage system, not full subsystem simulation. Damaged by collisions and, near a massive body, by radiant heat once temperature crosses its damage threshold (Section 5).
- **Temperature** — a warning meter, not damage itself: rises under radiant heat exposure, decays passively once clear of it. Only past a threshold does it start actually costing hull. Separate from hull so getting close to a hazard is legible before it's costly.

## 8. Enemies
- Distinct types, not just scaled stats — e.g. fast/aggressive scavengers, slow/heavy pirates, stationary turret wrecks.
- Density and toughness scale with distance + signature + time-in-zone (Section 5).
- No hostile or combat system being worked on yet.

## 9. The Hub
- No currency, ever. Materials (ore/crystal/unstable) are deposited and spent exactly as themselves — never converted into an abstract number. Upgrades cost materials directly.
- Docking is a deliberate choice (a key press in range), not automatic or forced by a timer — see Section 3.
- Visible growth as the progression readout — new docking arms, reactors, rings, lit sections as upgrades are purchased. No separate stats-only progression screen needed to feel progress. Not built yet — one purchasable upgrade exists (cargo capacity), no visual change on purchase yet.
- Passive layer: generates a slow trickle of resources while offline, based on settings left active before logging off — consistent with the always-running AI premise, not just an abstraction. Not built yet.
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
- A slow, cyclical (not fully simulated) shift in lighting/danger across a real-time cycle — not full orbital physics. A *time* dimension, distinct from the spatial gravity-well hazard already built around the home star (Section 5) — that landed early because it fell directly out of "environmental interaction," not because this phase moved up.
- Adds a timing dimension to risk (when is safe, not just where) — not required to validate whether the core loop is fun, so intentionally deferred.

## 11. Visual Direction
- Not yet decided.

## 12. Tech Stack
- TypeScript + Next.js + Tailwind CSS — one language across frontend, backend, and the eventual Phase 2 snapshot-async API.
- Plain Canvas 2D for the game world (decided — no PixiJS or other rendering library); a DOM/React overlay for screens with real UI (buttons, lists), e.g. the hub shop, since hand-drawing those on canvas doesn't scale.
- Explicitly not using a dedicated game engine, in favor of stack consistency for the multiplayer phase to come.

## 13. Build Order
Validated the riskiest, most foundational unknown first, cheaply, before building anything that depends on it. Actual order taken, updated as it diverged from the original plan:

1. Scaffold the Next.js + Tailwind project with a full-screen canvas mounted.
2. Get a ship moving — thrust, rotate, real drag/inertia, tuned until it felt good with no objective. Done first, as planned.
3. One asteroid, cell-based fracture, collision. Done, then generalized: mining works the same way against any number of asteroids in a belt, not one hand-placed rock.
4. Full mining sequence (ping → scan → tool-specific fracture → actively capture drifting chunks) — done.
5. **Diverged from the original plan here.** Rather than adding one enemy next, prioritized the hub/materials loop, real world scale (a legible twin-star system instead of one rock near spawn), and environmental hazards (localized gravity/radiant heat around the home star) — enemies still don't exist. This followed from an explicit call to not build combat yet and get the world and its risk/reward shape right first; the original "add one enemy, test tension" step is now next, once flight+mining+hazards+hub are all confirmed to hold together.
6. Remaining: enemies (Section 8), fuel/power (Section 7), the hub's visible growth and passive layer (Section 9), then ship the solo game and validate it on its own merits before Phase 2.

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

-Real astronomical basis — partially picked up: the home star is loosely Sirius-A (Section 2). Still open: the far star (Sirius B, a white dwarf, not built), and whether any real planets belong in the system at all.

- Hauling - system for pulling things to certain places. Scrap ships, Ice, larger asteroids, etc. Has its downsides but upsides too, allows for passive gathering of materials as it's broken down.

- Different ships

## 16. Coordinate Convention
World position is never shown to the player as raw (x, y). A location (the ship, a future waypoint, anything a map would need to plot) is expressed as **distance + angle from the home star**, in AU (an in-fiction unit — 1 AU is the hub's own distance from the star, same logic real astronomy uses to define it, scaled to this compressed system). Angle is fixed to the system itself, not the ship's current heading, so it stays meaningful on a static map. Star-anchored rather than hub-anchored on purpose — the star is the one fixed point a map is actually built around; the hub is just where the player lives, which is why Section 5's risk curve (a different, deliberately hub-relative concept) still measures from the hub.

This is distinct from ping/radar (Section 6), which stays plain distance-from-the-ship — a targeting readout for "which way to point right now," not a location.