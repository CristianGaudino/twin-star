# Twin Star — Tools Redesign Spec (Thrown Charges, Drill/Charges as Upgrades)

Companion to `twin-star-spec.md` Section 6 (Mining Sequence, which currently just says "Charges — Manual detonation" with no throw concept) and `upgrades-spec.md` (Drill and Charges join the Ship Basic roster instead of being free from the start). Also ties into `enemies-spec.md` — thrown Charges are one of the two combat tools that spec already designed around, so this isn't a purely-mining change. Not implemented yet.

## 1. Two changes, requested together, that turn out to reinforce each other

- **Charges stop being instant point-and-click placement.** Today: aim within `CHARGE_RANGE`, click, the target cell instantly has a charge on it (`cell.hasCharge = true`), no travel, no physicality. Redesigned: a charge is **thrown/launched from the ship as a real physical object**, travels, and only becomes armed once it actually lands somewhere — then detonation stays exactly what it already is (press R, blow up everything currently armed).
- **Drill and Charges stop being free from the start.** Today: `TOOL_ORDER = ["laser", "drill", "charges"]`, all three usable from the very first frame, no gate at all. Redesigned: only the Laser starts usable; Drill and Charges are unlocked by two new Ship Basic upgrades.

These aren't independent — a thrown, physical charge is a more interesting *thing to unlock* than an instant-placement one was. Gating an upgrade behind "now you can point-and-click place a charge" would've been a thin unlock; gating it behind "now you can throw and remotely detonate a real projectile, including at enemies" is a real capability jump, worth being a deliberate purchase instead of a default.

## 2. Thrown Charges — the actual physical model

**A charge becomes a real projectile the moment it's thrown**, not a flag set on a cell. New entity, `ThrownCharge` — position, velocity, an `attachedTo: Cell | null` reference. Launched toward the aim point (the mouse in RCS mode, same targeting convention laser/charges already use) at a fixed speed, then travels every frame like a `Chunk` does — light drag, real momentum, and it goes through the *exact same generic `Body`/`circleBodies()` collision path* chunks and the ship already use (one more line in `circleBodies()`, same reuse `enemies-spec.md` leans on for enemies themselves) so it can be nudged or blocked by rock and other bodies realistically, for free.

**On hitting an exposed cell surface, it sticks** — zeroes its velocity, sets `attachedTo` to that cell, and (to keep the existing extraction code working untouched) still sets `cell.hasCharge = true` exactly as today. This is the "aim at a rock and stick a charge on it" case, functionally the same end state as today's instant placement, just arrived at by actually throwing instead of clicking.

**On hitting an enemy Body (`enemies-spec.md`), it sticks to the enemy instead** — same `attachedTo` idea, generalized to "whatever it hit," not just cells. Deliberately *not* homing and *not* tracking the enemy's subsequent movement once attached (an enemy that moves away after the charge lands just leaves it behind, floating) — tracking would need a "parent" concept that doesn't exist anywhere else in this game's physics model, and would be an odd asymmetry against how every other projectile (including the enemy projectiles this same spec-family just designed) is deliberately non-homing for the sake of real dodge/counterplay.

**If it hits nothing before running out of range/lifetime, it keeps drifting freely** (light drag, no attachment) rather than auto-detonating — an armed, floating charge the player can still detonate manually whenever they want, useful for "throw it near a cluster / near where an enemy is about to be" plays that don't require a clean hit. A charge that drifts for too long without ever being detonated is eventually lost (a real cost for a bad throw) rather than hanging around forever as clutter.

**Detonation (R key) is barely changed** — it already collects "every cell with `hasCharge`" and blows them all up together; this generalizes to "every currently-armed `ThrownCharge`, whatever it's attached to (or nothing)," extracting the cell if it's attached to one, and just applying the existing `applyExplosion` blast at its current position otherwise (the same function enemy projectiles resolve through — one blast resolver, every explosive thing in the game goes through it).

**What this buys, concretely:** aiming and travel time become real again — the ship's own velocity, the target's distance, and where you're standing when you throw all matter, the same "movement is the core skill" idea (main spec Section 4) mining/combat already lean on everywhere else. It's also the thing that makes Charges a real answer to a Pirate in `enemies-spec.md` (Section 3) — you can't do that at all with instant point-click placement against something that's shooting back and moving.

## 3. Drill and Charges as Ship Basic upgrades

A new, small extension to the upgrade dispatch — Ship gets the same boolean-unlock treatment Hub already has via `hubFlags`:

- **`ShipFlagKey`** (new): `"drillUnlocked" | "chargesUnlocked"`.
- **`UpgradeDef.shipFlags?: ShipFlagKey[]`** (new, parallel to the existing `hubFlags?: HubFlagKey[]`), applied the exact same way: `for (const flag of def.shipFlags) ship[flag] = true`.
- **Two new Ship Basic upgrades**: *Drill Rig* (unlocks the Drill) and *Charge Launcher* (unlocks thrown Charges) — real material costs, no research gate, same tier as Cargo Expansion/Thruster Upgrade/etc. Foundational capability, not an advanced payoff.
- **Tool selection respects ownership.** `ship.selectedTool` starts and stays `"laser"` until something else is unlocked (no change needed there — it's already the default). Direct selection (keys 1/2/3) and cycling (Tab) both skip/ignore a tool that isn't owned — pressing 2 with no Drill Rig does nothing (a quiet no-op, or a brief "LOCKED" HUD message, same treatment `hub.observatoryBuilt` already gets for the gated Map tab).

## 4. Why gate these at all — this isn't gating for its own sake

Every other capability in this game is already something you grow into: vision radius, ping range, cargo capacity, hull, fuel, battery, even the Map/satellites are all locked behind a purchase of some kind. Tools being free from the very first frame was actually the one exception to that whole philosophy, not a deliberate design stance — closing that gap makes the tool roster consistent with everything else instead of standing apart from it. It also gives new players a clearer first purchase: right now the "first thing you buy" among 11 Ship Basic options is fairly arbitrary; Drill Rig and Charge Launcher becoming things you *need* in order to unlock a whole mining/combat approach gives the earliest purchases real weight instead of being interchangeable stat nudges.

**It also sharpens a real early-game choice once `enemies-spec.md` exists**, not just a mining one: Charge Launcher stops being "do I prefer charges to laser for crystal" and becomes "do I want combat capability yet" — buy it early for readiness against Pirates, or delay it if you're deliberately avoiding the belt's danger zones for now. A gate that creates a real decision, not just a paywall in front of something you'd buy immediately regardless.

## 5. Explicitly not designed here

- **Exact numbers** — launch speed, max range, projectile lifetime before a lost charge is forfeit, drag while drifting, Drill Rig/Charge Launcher's costs — none decided here, same discipline as every prior spec.
- **Visual treatment of a thrown charge in flight** — a small moving marker with some kind of trail is the obvious shape, not specified further; this is a rendering detail, not a mechanic.
- **Whether an unowned-tool selection attempt gets a HUD message or is silently ignored** — a small polish call, not a design one, left for whoever implements this to match whatever the rest of the HUD's "you can't do that yet" language already does.
