# Twin Star — Enemies & Combat Spec

Companion to `twin-star-spec.md` Section 8 (Enemies) and Section 5 (Risk Structure, which names the three scaling factors this spec has to actually implement: distance, signature, time-in-zone). Not implemented yet.

**Revision note:** the first draft of Sections 3/4/6 used a hidden-probability "spawn director" that materialized enemies near the player based on a dice roll weighted by distance/signature/time. That directly contradicts an existing scope-discipline rule this spec should have checked against in the first place — main spec Section 14: *"No infinite/procedural-forever map — a fixed, legible twin-star system, so positions and traces stay meaningful over time."* A world that reactively spawns content near the camera isn't a fixed, legible place, it's an arcade loop wearing this game's numbers. Rewritten below around a population that actually exists, all the time, independent of the player — the same way every asteroid in the belt already does.

## 1. What already exists that this builds on

This isn't a system built from nothing — several things already in the codebase were built anticipating this moment, some explicitly:

- **Signature is already fully built and already inert.** `Ship.signature`/`addSignature`/`decaySignature` exist, every mining tool already costs signature. Two entire ship upgrades (Signature Dampener, Emission Baffling) have had zero mechanical consequence since the day they were built, waiting on exactly this. See Section 4 for what signature physically *is* here — not sound, there's no medium for it in vacuum.
- **The collision system was explicitly designed for this.** `ARCHITECTURE.md`, on `Body`/`circleBodies()`: *"A future circular entity (a drone, a simple enemy) is one more line here, not a new collision method."* An enemy that rams the ship goes through `resolveBodyPair`/`resolveBodyVsRock` exactly like a chunk or the ship itself does today — real mass, real material-derived bounce, real damage via the already-generic `reactToCollision`/`applyCollisionImpact`.
- **The whole world is already fully simulated all the time, not streamed in near the camera.** Every asteroid in the belt updates every frame whether it's on screen or not — viewport culling in `renderAsteroids` is a *rendering* optimization only, simulation never stops for anything off-screen. This is the load-bearing fact behind Section 3 below: a persistent enemy population that exists independent of the player isn't a new architectural pattern, it's the pattern this engine already uses for everything.
- **`Explosion`/`applyExplosion` is already a generic "something exploded here" event**, source-tagged (`ExplosionSource`, currently just `"charge"`) — an enemy projectile impact is another source, not a new blast-resolution system.
- **`DamageSource`** (`"collision" | "explosion" | "heat"`) is already required on every `takeImpact` call specifically so a future source could be added without retrofitting call sites — this is that future source (`"enemy"`).
- **The Contact/radar/ping/Map system already treats "anything detectable" generically** (`ContactKind: "rock" | "hub" | "star" | "satellite"`) — an enemy, and an enemy's nest (Section 3), are two more kinds, found and remembered the same way everything else is, riding the entire existing tactical-radar/hub-Map/staleness machinery for free.
- **`ContactMemory`'s own staleness/forgetting model** (`discoveredContacts`, age-based, already exactly how the *player's* sensors work) is the right shape for how an enemy should remember the player too — see Section 4.
- **`COMPOSITION_INFO.recommendedTool`** already establishes "different targets reward different tool choices" as a real, existing idiom — enemies extend the same idea instead of inventing a new one.

## 2. The core decision: mining tools double as weapons, no separate weapon system

The main spec never says how the player fights back — this is the single biggest genuinely new call this spec makes, so it gets real reasoning, not just an assertion.

**Decided: Laser and Charges are real weapons against enemies, exactly as-is — same tool, same signature cost, same battery draw, no new tool slot, no new UI.** The Drill gets no combat role (it's a point-blank anchor tool against a stationary target; it doesn't make sense against something moving or shooting back, and not every tool needs a second job).

Why, not just what:
- **Fiction fit.** This is "a solo mining and salvage hub," not a warship (main spec Section 1) — a mining laser repurposed as a weapon of desperation is a better story than a turret bolted on from nowhere with no in-fiction origin.
- **It's the direct payoff of a system that already exists.** Every tool already costs signature. If combat used a separate weapon with its own cost model, that connection would be diluted instead of paid off — fighting with your mining laser means every fight is *also* raising your thermal/EM signature further, a real escalating-risk feedback loop during the fight itself (Section 4), not just before it.
- **Scope discipline, directly from the main spec.** Section 14: "Only one active gameplay mode at launch (mining/combat) — no parallel modes." That line already reads mining and combat as one blended mode sharing one toolkit, not two systems glued together.
- **It reuses the `recommendedTool` idiom for real tension** — see Section 3.

## 3. Enemy archetypes and where they actually come from

Main spec's own bar: "Distinct types, not just scaled stats." Three archetypes, split along an axis worth calling out explicitly: **two are population-based (real, persistent craft operating out of a fixed origin point), one is a fixed, isolated hazard with no origin of its own.**

### Isolated hazard: Turret Wreck
World-generated at construction time, like `NEAR_HUB_ROCK_COUNT`'s guaranteed scatter — a fixed population seeded into the belt (never normal space or near-hub), not produced by anything, doesn't regenerate, doesn't move. Long detection range, slow fire rate, high accuracy, meaningful damage per hit. **Has a facing arc, not 360° coverage** — a real positioning puzzle, the same "where you position matters" skill mining already demands (main spec Section 6: "Placement of the ship... where on the asteroid to mine"), just applied to avoiding a hazard instead of extracting a resource, and it means asteroid cover (Section 5) genuinely matters here specifically. Mechanically a hazard to *learn and route around*, the same relationship the player already has with the star's gravity/heat wells — and once identified, it belongs on the hub's Map tab as a permanent known hazard.

### Population: Scavenger Den (produces Scavengers, fast/aggressive)
A fixed, world-generated origin point in the belt — a den, not a spawn trigger. Small territory (patrol leash radius), low population cap, fast regen — matches the archetype's own "fast/aggressive" character even at the population level: numerous, replaceable, individually weak. A Scavenger defaults to patrolling within its den's leash radius (simple wander, not pathfinding) until it detects the ship (Section 4), then closes distance aggressively and rams rather than shooting, reusing the collision system directly (Section 1). **Doesn't avoid hazards while hunting** — a Scavenger chasing the ship into the star's heat/gravity radius keeps coming, and can genuinely burn or fall in; its aggression is a real, usable weakness, not just flavor. **On a successful ram, skims a small amount of cargo instead of only dealing hull damage** — a Scavenger's actual threat is to your *haul*, not your survival, a real asymmetry from Pirates below.

### Population: Pirate Outpost (produces Pirates, slow/heavy)
Also a fixed, world-generated origin, larger territory, lower population cap, slower regen than a Den — fewer, tougher, more territorial. A Pirate doesn't ram — it stands off at range and fires slow, telegraphed projectiles (Section 5), real dodge-or-tank counterplay. Armored: meaningfully resistant to sustained laser damage, genuinely better countered by Charges' burst damage — a direct extension of `recommendedTool`'s existing idiom. **Actively repositions to avoid the star's hazard radii while hunting** — unlike a Scavenger, luring a Pirate into the star doesn't work, it's cautious by design; the environmental tactic is archetype-specific, something you learn, not a universal trick that trivializes every fight. Threatens hull/survival, not cargo — the mirror of the Scavenger.

**Toughness by geography, not a hidden per-encounter scaler.** A given Den/Outpost's roamers have a fixed strength tier decided once, at world-gen, based on that origin's own distance from the hub — the same pattern already used for asteroid type distribution (`BELT_TYPE_WEIGHTS` vs `NORMAL_AREA_TYPE_WEIGHTS`: a fixed, discoverable, zone-based property). "Deeper = more dangerous" becomes a real geographic fact about specific places you can learn and partially map, not an invisible difficulty dial that scales continuously and imperceptibly with how far you've wandered.

| Archetype | Origin | Movement | Attack | Real threat | Countered by |
|---|---|---|---|---|---|
| Turret Wreck | Isolated, world-gen, no population | None (facing arc) | Long-range, slow, accurate | Hull, if approached from its arc | Positioning / cover |
| Scavenger | Scavenger Den (population) | Fast, closes in, ignores hazards | Ram (collision) | Cargo (skimmed on hit) | Laser before it closes, or the star |
| Pirate | Pirate Outpost (population), hazard-avoidant | Slow, stands off | Ranged projectile | Hull | Charges (armored vs. laser) |

## 4. Detection — thermal/EM signature and range, not a spawn roll

Section 3 covers *where enemies come from*; this section covers *how they notice the player*, which is the actual mechanical home for "distance + signature + time-in-zone." No probability anywhere in this — every check below is a plain distance comparison, the same idiom ping/vision/beacon already use.

**Signature is heat and electromagnetic emission, not sound.** There's no medium for acoustic noise or "vibration" to travel through in open space (the original main-spec phrasing said "energy/vibration," corrected — see `twin-star-spec.md` Section 5). What's actually detectable across a vacuum: waste heat radiating off an active mining laser, thrusters, a reactor under load — real infrared bloom, the same physical basis hard-sci-fi settings use for "stealth in space" — plus direct electromagnetic emission from active systems (the laser itself, an active scan, a ping's own broadcast). `Ship.signature` already represents exactly this combined thermal+EM total; nothing about the underlying stat changes, only its description does.

**Detection is a radius, and signature extends it — the exact falloff-with-distance idiom `gravityAccel`/`radiantHeatExposure`/`solarExposure` already use, just pointed outward from something else at the ship instead of a well at anything nearby.** Every roamer has a base detection radius; the ship's current signature adds to how far that radius effectively reaches. A ship running hot (mid-fight, mid-extraction) is detectable from real distance; an idle, cooled-down ship has to be found the ordinary way, at short range. Deterministic and learnable — the same "is X within Y of Z" check every other sensor in this game already runs, not a hidden dice roll layered on top of it.

**Once a roamer detects the ship, it starts hunting — and remembers the same way the player's own radar does.** Reuses `ContactMemory`'s exact age/staleness shape: a hunting roamer keeps closing on the ship's last-known position for a while after losing direct detection, then gives up and returns to patrol near its den/outpost if it doesn't reacquire. Breaking a chase means actually breaking detection range *and* outlasting the memory window — real evasion, not an instant safe-toggle the moment you're technically out of range.

**Distance from the hub is where this whole system actually lives, geographically.** Near-hub and normal space have no Dens/Outposts at all (matches how those zones are already "comparatively safe and unremarkable"); the belt is where real population exists — the same zone that's already the mining destination becomes the combat destination too. Depth into the belt naturally means more nearby territories with overlapping patrol/detection ranges — encounter density falls directly out of geography, not out of a formula reading the ship's distance-from-hub as an input.

**Fighting is its own detection event, for free, with no bespoke mechanic needed.** A firefight is a real, temporary burst of signature — exactly what extends detection radius above. Any other roamer within that extended radius, from the same den or a neighboring one, can independently notice on its own terms, using the identical check every roamer always runs. "This spot is dangerous again right after a kill" isn't a separate system bolted onto wrecks, it's a direct consequence of the one detection model already covering everything else.

**Dens and Outposts are themselves discoverable landmarks**, riding the exact Contact/Map machinery Section 1 already covers — scan or observe one enough and it's permanently on the hub's Map tab as a known danger zone, the same treatment a Turret Wreck or the star gets. "There's a den in that pocket of the belt" becomes real, learnable, partially-mappable intel, not an invisible density gradient.

**Signature Dampener/Emission Baffling's payoff, restated precisely:** they reduce how far a ship's own thermal/EM signature reaches — a smaller effective detection radius for every roamer in range, not a lower probability of "something spawning." A quiet ship can genuinely fly past an active Scavenger Den without ever being noticed, a felt, moment-to-moment payoff instead of a background number nobody perceives.

## 5. Projectiles — simple, dodgeable, not hitscan

Pirates and Turret Wrecks fire projectiles, not instant beams — real counterplay (see the ship's whole movement system, main spec Section 4, being "the core skill expression"; an unavoidable hitscan tick would bypass that entirely). A projectile is deliberately minimal: position, velocity, damage, source, a max lifetime/range. Straight-line travel, no homing (homing would make dodging pointless, undermining the exact thing projectiles are for). On reaching the ship, resolves through `applyExplosion` with a small/zero radius — reusing the existing falloff-damage-plus-knockback function wholesale rather than writing a second impact resolver. On reaching an asteroid cell first, it's simply consumed — real cover with zero extra code, since cell collision geometry already exists for everything else, and now specifically matters against a Turret Wreck's facing arc (Section 3).

## 6. Wrecks — persistent, not a drop, and the thing that finally connects three dormant spec bullets

A destroyed Scavenger or Pirate does **not** disappear into an instant chunk. It becomes a **Wreck** — a real, persistent object left in the world at the death site, sitting there until the player actually salvages it. This is the thing that finally gives concrete content to three bullets that have been sitting unbuilt, in two different spec files, for exactly this reason:

- `upgrades-spec.md`'s **Scrapyard** facility: *"Blocked on: nothing in the game currently generates salvage to haul back (no wrecks, no derelicts) — needs that content to exist first."*
- Main spec Section 15, **Hauling**: *"Scrap ships, Ice, larger asteroids, etc. Has its downsides but upsides too, allows for passive gathering of materials as it's broken down."* — already names "scrap ships" as a hauling target, before enemies existed to produce any.
- Main spec Section 10, **Phase 3 Crew**: *"task-specific crew requirements (e.g. planetside research, exploration of an abandoned ship)"* — boarding a wreck is already the example given for what crew-only tasks would look like.

**A Wreck is mechanically just an Asteroid.** Reuse, not new content: spawn it as a single-cell `Asteroid` (`seedCount: 1`, the exact same shape `TINY_ROCK_RADIUS` bodies already use) at the death position, inheriting the enemy's velocity at time of death via the already-existing `initialVelocity` field so it drifts and settles under the same drift-group physics everything else does — for free. Laser-mineable through the exact existing `cutCell`/`extractWholeCell` path, radar-visible through the existing rock-`Contact` path, physically collidable through the existing generic collision system — zero new mining/detection/physics code. The only genuinely new things are a flavor label ("Wreck" instead of "Asteroid") and a distinct, angular render treatment instead of the organic Voronoi-noise outline every real asteroid uses — cosmetic only.

**Three salvage tiers, escalating effort for escalating yield:**

1. **Laser, available the moment this ships.** Cut it apart yourself, same as any rock — real signature cost (and, per Section 4, a real risk of that signature drawing in whatever else is nearby), real time investment, bounded by what you can carry. The baseline, no new system required.
2. **Boarding, deferred to Phase 3 Crew.** Send crew aboard for a better yield than an outside cut can get — literally the example Section 10 already gives for a crew-only task. Not designed here; depends entirely on the Crew system existing first.
3. **Towing to the Scrapyard, deferred to Hauling + the Scrapyard facility.** Haul the *whole* wreck home and let Scrapyard process it passively over time — the best yield across the board. Depends on both Hauling (not designed anywhere yet) and Scrapyard's own facility mechanics (also not designed) existing first.

**Left as an open question, not decided here:** whether Wreck salvage should yield plain Nickel-Iron (zero new content, defensible — a defeated ship's hull is exactly the kind of thing that resource already represents) or a distinct new resource that makes the higher-effort tiers feel like a genuinely different reward rather than just *more* of an ore already available elsewhere. Worth deciding once tier 1 is built and felt, not now.

**Also not decided:** whether a Den/Outpost should be directly attackable/destroyable as a structure (permanently reducing or ending its output), versus only ever thinnable by killing roamers faster than the regen timer replaces them. The latter is simpler and already gives "clearing a territory" real, felt meaning for a while without committing to permanent world-state removal; the former is a bigger design question (can something you've permanently destroyed ever come back? does that contradict "positions and traces stay meaningful over time," or fulfill it?) worth its own pass later, not assumed here.

**Also not decided:** whether wrecks should ever expire if left unsalvaged indefinitely. Nothing else in the belt despawns on its own, so the default is that they don't either — flagged as the same class of unbounded-growth tradeoff already noted for `exploredSectors` (`ARCHITECTURE.md`), real but not worth solving pre-emptively.

- **Death.** No new death handling for the *player* — `handleShipDestroyed` already does exactly the right thing (lose the run's haul, respawn at the hub, ship/hub untouched, per main spec Section 3's own death rule). Just a new `DamageSource: "enemy"` tag for message text, the same way `"heat"` got its own death message without any structural change.

## 7. New upgrades this unlocks — and one research gate shape worth adding

Not a large roster — enough to make the existing generic dispatch (`ShipStatKey`/`HubStatKey`/`hubFlags`) do real work here too, not a parallel combat-upgrade system:

- **Ship Basic — Point Defense Coating**: a flat hull-damage-reduction-from-enemies stat (`enemyDamageMult`, same multiplicative convention as `powerDrawMult`).
- **Ship Advanced (research-gated) — Signature Baffling II** or similar: a deeper version of the existing `signatureGainMult`/`signatureDecayPerSec` upgrades, now with a precise, concrete payoff — a smaller effective detection radius against every Den/Outpost roamer in range (Section 4) — instead of the vague "wired up for enemies" promise those upgrades have carried since they were built.
- **A fifth research gate shape**: `requiresDefeated: EnemyKind` (research.ts's four existing gate shapes — `requiresSample`/`requiresScannedType`/`requiresFacility`/none — get a natural fifth: "must have survived an encounter with this archetype at least once"). A project like "Captured Weapon Analysis" gated on having defeated a Pirate is a genuine discovery-gate in the same spirit as the existing ones, not a stat wall.

## 8. Explicitly not designed here

- **No pathfinding/obstacle avoidance for roamers.** Patrol and hunting steering is direct-line only; if that line runs through an asteroid, the existing generic rock collision just resolves it physically, same as anything else bumping a rock. Matches the "depth, not sim-level" discipline the mineral/research systems were already held to. A Pirate's hazard-avoidance (Section 3) is a special case of steering *away from* a known fixed danger zone, not general obstacle navigation — a much smaller, already-scoped problem.
- **Faction identity / narrative** — deliberately not needed yet, per direct feedback. Dens and Outposts are mechanically distinct (territory size, population cap, regen rate, toughness tier) without any decision about who these people are or why, and nothing here blocks deciding that later.
- **The far star's enemy roster** — main spec Section 2/17 already establish the far star as "a genuinely distinct destination — different enemy roster," but explicitly defer designing it until the far star itself exists. Not touched here.
- **Scavenger drones / distress beacons** (main spec Section 10, Phase 2) — async-multiplayer hazards born from *other players'* activity, a different mechanic from this spec's locally-populated enemies, out of scope until Phase 2 exists at all.
- **Wreck salvage tiers 2 and 3 (boarding, towing)** — see Section 6.
- **Exact numbers** — territory radii, population caps, regen timers, detection radii, damage, projectile speed, HP, toughness tiers by distance — none of it decided here, same discipline as every prior spec. This fixes the shape (a real, persistent population with fixed origins; deterministic distance-based detection built on thermal/EM signature, not probability; memory-based hunting reusing the player's own sensor idiom; reuse over invention everywhere reuse was honestly available), not the tuning.
