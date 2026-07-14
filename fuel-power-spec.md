# Twin Star — Fuel & Power System Spec

Companion to `twin-star-spec.md` (Section 7 already names this system, unbuilt) and `upgrades-spec.md`.

**Status: implemented**, except Section 7's rescue/tow mechanic (explicitly out of scope in that same section) and the manual per-system enable/disable toggle (also explicitly deferred there). The Reactor/Water-Ice connection landed differently than first drafted here — see the Section 6 Reactor bullet, corrected in place once the Ice→Fuel refine idea turned out to contradict fuel's own free-refill-at-dock rule.

## 1. Does the split make sense? Yes.

Fuel-for-thrust / battery-for-everything-else is the right cut, for reasons beyond "it sounds right":

- It's not actually a new idea grafted on — Section 7 of the main spec already describes almost exactly this ("Fuel... Drains only from thrust use... Power — Shared across all systems except thrust... solar-charged near stars"), written before either was built. This spec is that section made concrete, not a redesign.
- It maps cleanly onto a distinction the code already has: thrust (`updateMovement`, just made mass-dependent — Section 2 below) is the one system that's continuous, mechanical, and directly tied to the ship's physical mass, while everything else (vision, ping, scan, tools, beacon) is discrete, electrical, and already reads as "systems" in the spec's own language ("Systems can be enabled or disabled manually"). Two different consumables for two different *kinds* of draw is more legible than one number trying to represent both.
- It gives the solar-proximity idea (main spec Section 2: "Solar-powered — proximity to this star is the mechanical reason the hub can exist here at all") a matching player-facing mechanic instead of leaving it as hub-only flavor. Right now the ship gets nothing from being near the star except risk (heat) — power gives it something to actually gain there too, which is a real risk/reward axis the belt currently lacks (get close to the star, refuel passively, but the heat clock is also running).
- It creates two distinct failure modes instead of one generic "out of resource" state, which is more interesting than it sounds (Section 4).

The one thing worth flagging, not changing: fuel has *no* passive regen at all (main spec is explicit — "Never regenerates passively. Refills only at dock"), which makes it strictly harsher than power. That's correct — fuel is the resource that enforces "a trip out is an expedition" (main spec Section 1); if it trickled back on its own, running low would stop being a real deadline.

## 2. Fuel

- Pure consumable, ship-only stat (like hull, temperature). Drains only while actual thrust is being applied — checked at the same site as the existing F=ma calculation (`updateMovement`'s `mag > 1e-6` branch), not a flat per-second cost, so sitting still or drifting under drag costs nothing.
- Both movement modes drain it identically — RCS is not a "free" fine-control mode, it's just a different thrust profile (main spec already treats Cruise/RCS as the same underlying force system, different drag/turn tuning).
- **Drain rate should scale with force actually applied, not be flat.** This is the natural extension of the thrust fix just built: `updateMovement` already computes `accel = thrustForce / mass` every tick that thrust is held — fuel burn can reuse that same `thrustForce` figure (burn ∝ thrustForce, not ∝ accel, so a heavier ship doesn't get a *cheaper* burn just because its acceleration is lower — it's still pushing the same amount of reaction mass out the back regardless of what the ship weighs). Concretely: a loaded ship burns fuel at the same rate as an empty one for the same throttle input, but *gets less acceleration for it* — the mass penalty already lives entirely in the accel side, fuel burn doesn't need to double-tax it.
- No passive regen, ever. Refills only at dock (full, on docking — same moment Repair Bay already heals hull, a natural single "you're home, everything resets" beat).
- Zero fuel = thrust input does nothing (silently, or with a UI cue — Section 5) — the ship still has whatever velocity it had, drag still applies, but no more correction or acceleration is possible. This is a real stranding state (Section 4), not a soft slowdown.

## 3. Power (Battery)

- Ship-only stat, separate pool from fuel. Passive baseline drain from whatever systems are currently active, plus discrete costs for active tool use.
- **What draws power**: passive vision (small constant draw, always on), an active ping (one-time cost per ping, on top of its existing cooldown — a second reason pings are deliberate, not spammable), scanning (draw for scan duration), and each mining tool while in use (laser continuous, drill continuous while anchored, charges a flat cost per detonation). Beacon range is hub-side (Section 6), not ship battery.
- **Passive regen, always on, boosted by solar proximity.** Reuses the exact falloff shape `gravity.ts` already has for `radiantHeatExposure` — same linear "strongest at the surface, zero past a radius" convention — as a second, independent field on `GravitySource`: `solarRadius`/`solarIntensity`, mirroring `heatRadius`/`heatIntensity` structurally but a completely separate exposure value (a source could radiate heat without power, or vice versa, same reasoning the file already documents for why pull and heat are independent fields). A small flat baseline regen applies everywhere, even deep in the belt far from the star — running fully dark forever shouldn't be required, just slow.
- **`solarRadius` should be much larger than `pullRadius`/`heatRadius`, not the same number.** Gravity and lethal heat are deliberately short-range hazards (`HOME_STAR_PULL_RADIUS` — you have to actually be diving at the star to feel either). Sunlight isn't short-range in reality — a real solar panel gets useful output from a star at real interplanetary distances, well past any hazard the star itself poses; realism here means the *usable* light a star throws is a much bigger circle than the *dangerous* one. Concretely: `solarRadius` should reach out well past the belt's outer edge (so the whole system is at least faintly lit, with real, felt gradient the closer you get — near the star it's a strong charge, out past the belt it's barely above the flat baseline), while `pullRadius`/`heatRadius` stay exactly as tight and dangerous as they already are. This also sharpens the risk/reward axis (Section 1): the fast, strong charge is still only available by accepting real heat/gravity risk near the surface, but a slow, safe trickle is available from much further out than "basically touching the star."
- This deliberately reuses an existing pattern instead of inventing a new falloff model — same reasoning that kept the mass system on one function (`massForArea`) instead of two.
- Zero power = every active system stops working (no scan, no tools, no ping) and passive vision drops to a bare minimum radius — the ship goes effectively dark and can't interact with anything until it regens (passively, or by getting closer to the star, or by docking).

## 4. Two Failure Modes, Not One

The split matters most here — running out of fuel and running out of power should feel different, not like the same "empty tank" state twice:

- **Out of fuel** = stranded. You keep your last velocity, drag bleeds it off, and you drift — no more course correction. Recoverable only by drag eventually stopping you somewhere (possibly somewhere worse — a heat radius, a hazard) or, longer-term, a rescue/tow mechanic (not in scope here — flagged as a real gap, Section 7). This is the harsh one, and deliberately so: it's the direct, mechanical teeth behind "a trip out is an expedition" — miscalculate the round trip and the consequence is real, not a slap on the wrist.
- **Out of power** = blind and toothless, but still mobile. You can still fly home (thrust isn't power-gated) — you just can't scan, ping, mine, or see past a short radius while you do. This is the recoverable one: annoying, makes the trip back tenser (you can't proactively spot hazards), but never strands you outright.
- This asymmetry is the actual design payoff of splitting them: a single "energy" bar would have to pick one failure feel for both draws, and neither "stranded" nor "just blind" is right for the other resource.

## 5. UI

- Two new gauges alongside the existing hull/temperature/speedometer HUD (per the earlier speedometer work this session) — Fuel and Battery, both simple depleting bars, not numeric readouts (matches the existing HUD's style).
- Battery gauge gets a subtle "charging" tint/tick when within a star's solar radius and net-positive, so the risk/reward of hugging the star for power (against the heat clock) is legible in the moment, not just inferred.
- Both hit zero with a clear, distinct visual/audio cue (not the same alarm as hull-critical) — the player should immediately know *which* resource failed, since the correct response differs completely (Section 4).

## 6. Upgrades & the Hub payoff (ties into `upgrades-spec.md`)

- **Ship Basic — Auxiliary Fuel Tank**: raises fuel capacity. Same shape as Cargo Expansion.
- **Ship Basic — Battery Capacity**: raises power capacity.
- **Ship Advanced (Research-gated) — Solar Collector Array**: multiplies solar-boosted regen specifically (not the flat baseline) — a real payoff for players who lean into star-adjacent play, gated behind a research project themed around it.
- **Ship Advanced (Research-gated) — Power Efficiency**: reduces passive/active draw across the board — the "do more with the same battery" answer, parallel to how Cargo Stabilizers softens the mass penalty rather than removing it.
- **Hub Facility — Reactor** (already flagged in `upgrades-spec.md` Section 3b as *not built*, blocked on "needs the fuel/power system this spec now defines") — this spec is that unblock. Its mechanical job: raises the hub's own passive solar regen field, so *docking range itself* becomes a partial-recharge zone even before you're actually docked — a real spatial payoff for the hub's location, not just an instant refill on arrival.
  - Not a Refinery-style Ice→Fuel recipe, on reflection: fuel already refills for free, in full, on every dock (Section 2) — there's no bankable "fuel" resource to convert *into*, so a refine recipe here would be spending a real material on something you'd get for free thirty seconds later anyway. Instead, Water Ice's connection to this system is the *research gate itself*: Reactor Engineering (the research project that unlocks Reactor) requires an actual ice sample, not just materials — cryogenic fuel handling is exactly the domain Water Ice has been earmarked for (main spec Section 17), so the tie is in "you need to have found ice to research this," which is honest about what's actually being unlocked, rather than inventing a conversion mechanic that doesn't hold up.

## 7. Explicitly Not In Scope Here

- No rescue/tow mechanic for a truly stranded (zero-fuel, drifted somewhere unrecoverable) ship — flagged as a real gap this system creates, not solved by it. Worth a future spec of its own once this exists and the problem is actually felt in play, not guessed at in advance.
- No per-system manual enable/disable toggle UI (main spec Section 7 mentions "systems can be enabled or disabled manually" as an eventual idea) — starting with always-on-while-equipped is simpler and enough to prove the resource loop; a manual power-management layer is a natural but separate follow-on.
- Exact capacities, drain rates, and solar falloff numbers are not decided here, same discipline as the other two specs — this fixes the shape (two pools, two failure modes, solar-boosted regen reusing the existing falloff pattern, Reactor as the payoff facility), not the tuning.
