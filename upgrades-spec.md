# Twin Star — Upgrade System Spec

Companion to `twin-star-spec.md`, not a replacement — references that file's section numbers throughout and doesn't restate mechanics it already owns (materials/no-currency: Section 9; minerals: Section 17; Research System: Section 18). This file owns the upgrade system specifically: what can be bought, in what tiers, and how they relate to each other.

**Implemented**: the full tier system, all Ship Basic/Advanced upgrades, all Hub Standard upgrades, and two Hub Facilities (Research Lab Expansion, Refinery) — see `upgrades.ts`/`research.ts`/`ship.ts`/`hub.ts`/`engine.ts`. **Not implemented**: Scrapyard, Mining Facility, Shipyard, Foundry, Observatory, Reactor (Section 3b) — each needs real new content decisions (what generates salvage? what are the ship classes? what do new tools do?) that this file deliberately left open, not just more upgrade entries. Section 3b marks each accordingly.

## 1. Three Tiers, Not One List

The current game has exactly one upgrade (Cargo Expansion) in one flat list. That doesn't hold once there's more than a handful — different upgrades need fundamentally different purchase logic, not just different numbers in the same shape. Three tiers:

- **Ship Upgrades** — stat/capability improvements to the ship itself. Materials only, immediate effect, no gate. The existing tier.
- **Hub Upgrades** — improvements to the hub. Two distinct kinds within this tier (Section 3) — small standard purchases, and large facility construction.
- **Research** — materials + time, gated by having actually found a sample of the required material first (Section 18 of the main spec already owns the mechanic). Research doesn't apply its own stat effect — it *unlocks* Ship/Hub upgrades that were previously unavailable to buy at all.

Research is the gate, not a fourth parallel currency sink. Something being "researched" means it's now purchasable in one of the other two tiers, not that research itself grants a bonus.

## 2. Ship Upgrades

Same two-layer shape Hub upgrades ended up with (Section 3), applied to the ship instead of the base: a **Basic tier**, buyable from day one, and an **Advanced tier**, gated behind Research (Section 4). Not one flat list — five real subsystems, each with its own basic/advanced pair, grounded in stats that already exist in the code rather than invented from scratch:

### 2a. Propulsion
- *Basic* — **Thruster Upgrade**: raises `SHIP_THRUST_ACCEL`, both modes benefit (same acceleration is shared by Cruise and RCS today).
- *Basic* — **Maneuvering Thrusters**: reduces `RCS_DRAG` *slightly* — RCS is deliberately capped well below Cruise on purpose (main spec Section 4: "clearly the wrong choice for covering distance"), so this is bounded to stay a precision-mode improvement, not a way to make RCS a second Cruise.
- *Advanced* (Research-gated) — **Cargo Stabilizers**: offsets some of the collision-mass penalty below.

**Decided and built:** `Ship.mass` is no longer the flat `SHIP_MASS` constant (30) — it's `SHIP_MASS + cargoUsed * cargoMassFactor`, so a loaded ship is genuinely heavier, same as cargo's real kg figure (Section 7/17) would suggest it should be. Deliberately scoped to collision *momentum* only (how much the ship's own velocity changes in a hit), not thrust/acceleration — `SHIP_THRUST_ACCEL` stays flat regardless of load, since main spec's movement feel was locked down early in the project and this wasn't the moment to reopen it. Cargo Stabilizers reduces `cargoMassFactor`, not eliminates it.

### 2b. Extraction (per-tool, not a single "mining upgrade")
- *Basic* — **Laser Focusing Lens**: extends effective laser range.
- *Basic* — **Reinforced Drill Head**: extends `DRILL_ANCHOR_RANGE` — tiny today (26px), unforgiving to line up. Turned out `DRILL_RANGE` (part of the original sketch) isn't actually read anywhere — drilling is decided by ship-proximity/anchor range, not a cursor-range check the way laser/charges are — so this upgrade only touches the stat that's actually load-bearing, rather than wiring a bonus onto a dead constant.
- *Advanced* (Research-gated) — **Charge Payload Upgrade**: more charges carried. (The original sketch also floated a larger blast radius as an alternative — dropped for the actual build to avoid touching `applyExplosion`'s self-damage falloff in the same pass; carried-count alone is the whole implemented effect.)

### 2c. Sensors (three distinct stats, not one "Sensor Array")
- *Basic* — **Proximity Sensors**: bigger `VISION_RADIUS` — passive detection, no ping needed.
- *Basic* — **Rapid Scan Module**: faster `scanSecondsForRadius` — matters more now that scan time scales with the target's size (main spec Section 17's asteroid types make some bodies genuinely slow to read).
- *Advanced* (Research-gated) — **Long-Range Ping**: bigger `PING_MAX_RADIUS`/`PING_SPEED`. Already promised, not new — `constants.ts` has said "Longer range beyond this is a future upgrade, not the baseline" since the ping-range work earlier this session. This is that upgrade, finally with a home.

### 2d. Survivability
- *Basic* — **Heat Shield**: raises `TEMPERATURE_DAMAGE_THRESHOLD` (already flagged, main spec's radiant-heat work).
- *Basic* — **Radiator Vanes**: raises `TEMPERATURE_DECAY_PER_SEC` — a *different* axis from Heat Shield: not "how close can I get," but "how fast do I recover once I back off." The two stack meaningfully rather than overlapping.
- *Advanced* (Research-gated) — **Inertial Dampeners**: reduces gravity's felt pull specifically for the ship (a ship-side multiplier on `gravityAccel`'s result, not a change to the star itself — rock/chunks still feel the real thing) — lets a well-equipped ship push closer to a gravity well with a real margin, rather than the well itself getting weaker for everyone.

### 2e. Signature / Stealth
- *Basic* — **Signature Dampener**: reduces per-tool signature gain (`LASER_SIG_PER_SEC`/`DRILL_SIG_PER_SEC`/`CHARGE_SIG_PER_USE`).
- *Basic* — **Emission Baffling**: raises `SIGNATURE_DECAY_PER_SEC`.
- Both have **zero effect today** — signature has no consequence until something reads it (main spec Section 5/8, enemies not being built yet). Same forward-compatible reasoning as Structural Reinforcement (Section 3a) — buy it now, it pays off the moment detection becomes real, and the numbers won't need retuning after the fact since the stat they modify already exists and is already the right shape.

## 3. Hub Upgrades — Standard and Facility

Splits into two kinds, deliberately different in scale:

### 3a. Standard Hub Upgrades
Small, cheap, immediate — the hub's own equivalent of a Ship Upgrade, not tied to any facility. No new system, just the hub doing something it already does, better:

- ~~Dock Range Extension~~ — cut once `hub-growth-spec.md` gave the hub a real `radius` derived from facilities built: dock range is now a passive function of the same value (`Hub.dockRange` getter) instead of an isolated flat-stat purchase. A bigger, more built-up station is naturally easier to approach, no separate upgrade needed to say so.
- **Repair Bay** — docking partially (or fully, over time) repairs hull. Doesn't exist at all today — currently the *only* way hull ever resets is dying and respawning, which is a strange gap once you notice it: there's no reason returning home successfully shouldn't fix your ship. This upgrade is what makes docking-to-repair an actual mechanic instead of death being the only reset button.
- **Beacon Range** — the hub passively sweeps a small radius around itself for contacts, same as the ship's own passive vision (Section 6's Scan/Ping systems), so home base isn't a total blind spot when you're docked.
- **Structural Reinforcement** — the hub's own durability stat. Nothing can damage the hub yet, so the *stat itself* still has no mechanical effect — bought now, pays off once Phase 2's "hub scarring" (main spec Section 10) or any other hub-damage mechanic eventually lands, forward-compatible on purpose, same reasoning as Research being designed before it's built. It did pick up a real, immediate payoff of a different kind once `hub-growth-spec.md` landed: it's the one Standard upgrade that visibly thickens the hub's Core Ring and adds girder ticks around it, so it no longer reads as pure dead weight while waiting on a damage system that doesn't exist yet.

### 3b. Facility Upgrades
Large, one-time construction, each one a real building added to the hub — this is what "visible growth" (main spec Section 9) actually means once built: the hub reads as a *sequence of additions*, not a lit-up ring that changes color. Each facility is the entry point into its own small progression branch (further purchases scoped to that facility), not a single one-off buy. The hub starts as a bare research outpost; every facility is a deliberate step toward it becoming a real base.

- **Research Lab Expansion** — Built. The Research tier (Section 1/4) doesn't actually need this to function — the outpost starts with a minimal lab and research is possible from the very beginning, just slower. This purchase is what scales research speed further (stacks with Research Methodology, Section 4d's self-improving project) — the physical-upgrade half of that speed, as opposed to the technique/knowledge half. A second parallel research slot is not built.
- **Refinery** — Built (gated behind the Cryo Fuel Processing research project). Converts bulk low-value material into something worth having. Chondrite Rock is deliberately the most common, least valuable resource in the game (main spec Section 17) — without this it's pure cargo-space friction with no upside once you have enough for the one thing that wants it. Ships with two fixed recipes (Rock→Nickel-Iron, Rock→Crystal, both a 5:1 loss ratio) — not a free converter, not an arbitrary N-by-N table.
- **Scrapyard** — Not built. Processes hauled-in salvage (wrecks, larger asteroid fragments) into materials passively over time — the mechanical home for "Hauling," already flagged as a future item in the main spec's Section 15. Blocked on: nothing in the game currently generates salvage to haul back (no wrecks, no derelicts) — needs that content to exist first, not just the facility.
- **Mining Facility** — Not built. Deploys drones (also already flagged, main spec Section 15, "purpose intentionally left open") to a *scanned* asteroid, yielding a passive trickle of material over time without a trip out — the concrete system Section 9's long-standing "passive layer" idea has never actually had. Blocked on: drone deployment/travel/limit mechanics don't exist yet.
- **Observatory** — Built (`map-radar-spec.md`). Turned out to be exactly "needs its own hub-centered discovery pass designed" made real: unlocks the hub's Map tab and satellite deployment, rather than the pre-identify-near-hub idea originally sketched here.
- **Reactor** — Built (`fuel-power-spec.md`). The mechanical home for the main spec's Section 7 "Power" system, now that it exists — boosts battery regen near the hub. Water Ice's purpose (Section 17) ended up tied to Reactor's own research gate (a real ice sample requirement) rather than a refine recipe — see that spec for why a recipe didn't hold up.
- **Shipyard** — Not built. Structurally the biggest of these: sells *ship variants*, not upgrades — matches the main spec's "unique ships for different purposes" note (Section 9). Blocked on: no second ship class is designed (stats, role, visual) — this needs real game-design work, not just a purchase flow.
- **Foundry** — Not built. Component/tool-level manufacturing, deliberately separated from Shipyard so that one doesn't become a dumping ground for everything ship-adjacent. Blocked on: no new tool or tool-variant is designed yet.

## 4. Research Projects

Main spec Section 18 defined one gate: `requiresSample` (must have found a material before researching what it enables). That's the common case, but not the only reasonable one — four distinct gate shapes below, since "found a rare rock" isn't the only kind of thing worth requiring before something unlocks:

All seven built (`research.ts`). Two adjustments from the original sketch, both because Observatory/Reactor weren't built (Section 3b): "Deep Sensor Calibration" became a Refinery-gated project instead of an Observatory one (still demonstrates 4c, just with infrastructure that actually exists), and a fourth material-gated project (Reinforced Alloy Frames) was added since Cargo Stabilizers needed its own gate.

### 4a. Material-gated (the original pattern)
- **Platinum Alloy Plating** (Platinum-Group Ore sample) → unlocks Reinforced Hull Plating (Ship Advanced) — platinum's real use in precision alloys, read straight as hull plating.
- **Radiation Shielding** (Radioactive Ore sample) → unlocks Charge Payload Upgrade (Ship Advanced) — radioactive ore is already handled with charges specifically for safety (Section 17), shielding research extends into carrying more of them.
- **Reinforced Alloy Frames** (Nickel-Iron sample) → unlocks Cargo Stabilizers (Ship Advanced) — real structural metal, direct read as frame reinforcement/mass compensation.
- **Cryo Fuel Processing** (Water Ice sample) → unlocks the Refinery facility — the actual payoff for ice's long-flagged "nothing to spend it on yet" (main spec Section 17), even without Reactor existing yet.

### 4b. Discovery-gated, not material-gated
A different kind of prerequisite: having *identified* something, not necessarily mined it. Asteroid type is scan-revealed (main spec Section 17) — a body can be scanned without ever being touched, so "have you scanned an M-type" is a real, distinct signal from "do you have Nickel-Iron in the hold."
- **Metallic Body Cartography** (requires having scanned at least one M-type asteroid) → unlocks Long-Range Ping (Section 2c). You don't need to have *mined* a metallic body to know better sensors are worth building — you just need to have found one.

### 4c. Cross-gated — material *and* facility
Some research should need both a sample *and* the infrastructure to use it, not just one or the other:
- **Refined Materials Handling** (requires the Refinery built *and* a Water Ice sample) → unlocks Inertial Dampeners (Ship Advanced). Cryo/refined-materials handling extending into inertial compensation is a bit of a reach thematically compared to the platinum/hull or radioactive/charges pairings above — the mechanic (facility + material both required) is the point being demonstrated here, not a perfect thematic fit.

### 4d. Self-improving — no material gate at all
- **Research Methodology** (cost + time only, no sample required) → reduces future `researchSeconds` across every other project (`researchSpeedMultBonus`). Stacks with Research Lab Expansion's own speed bonus (Section 3b) — one bought directly with materials, one unlocked via research, same stat.

## 5. Data Model (as implemented)

`UpgradeDef` (`upgrades.ts`) stopped being hardcoded to one effect shape (`cargoCapacityBonus: number`). Actual shape — slightly simpler than the original sketch below (no `requires?: UpgradeId` between two purchasable upgrades ended up needed; every current gate is `requiresResearch`):

```
category: "ship" | "hubStandard" | "hubFacility"
cost: CargoHold
requiresResearch?: ResearchId
shipStats?: Partial<Record<ShipStatKey, number>>  // e.g. { thrustAccel: 60 }
hubStats?: Partial<Record<HubStatKey, number>>
hubFlags?: HubFlagKey[]                            // boolean unlocks, e.g. "repairOnDock"
```

An upgrade can set any combination of the three effect fields at once (Reinforced Drill Head bumps a single ship stat; a facility might only set a flag). `Engine.purchaseUpgrade` applies them through one generic dispatch (`applyShipStatBonus`/`applyHubStatBonus`, one explicit `case` per stat key rather than dynamic property access) — a new upgrade is a new data entry, a genuinely new *stat* is one new case in that switch.

`ResearchDef` (`research.ts`) supports all four gate shapes from Section 4, independently combinable rather than a `gateType` enum (4c is literally `requiresFacility` + `requiresSample` both set):

```
id, label, description, cost (materials), researchSeconds
requiresSample?: Composition       // 4a — must have ever deposited this (Hub.everDeposited)
requiresScannedType?: AsteroidType // 4b — must have scanned this type (Engine.scannedTypes)
requiresFacility?: UpgradeId       // 4c — must own this facility already
unlocks: UpgradeId[]
researchSpeedMultBonus?: number    // 4d — Research Methodology's own effect on research itself
```

## 6. Scope Discipline

- No branching tech tree — Research gates individual upgrades, it isn't a graph with multiple paths to the same node.
- No parallel research beyond what the Research Lab facility explicitly buys (starts at 1 slot).
- Facility sub-branches (e.g. Mining Facility's second drone) are real but shallow — a handful of follow-on purchases per facility, not their own infinite ladder.
- Exact costs, effect magnitudes, and the full roster of Ship/Standard-Hub upgrades are deliberately not decided here — this file fixes the *shape* (tiers, facilities, gating), not the numbers. Same discipline as main spec Section 17 applied to minerals before those numbers existed either.
