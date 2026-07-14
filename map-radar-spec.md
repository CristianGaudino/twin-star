# Twin Star — Map & Radar System Spec

Companion to `twin-star-spec.md` and `upgrades-spec.md`, not a replacement — references both throughout.

**Status: implemented**, except Research — "Orbital Mapping" (Section 7's fourth bullet) was descoped; nothing else in the actually-built research/upgrade set needed it, and it didn't tie to a real mechanic beyond a vague "bigger fog reveal," unlike every other project in the game which unlocks something concrete. See ARCHITECTURE.md for what actually landed and where it differs from this file (mainly: Passive Ping is an instant reveal pulse, not a second expanding-wave visual — a deliberate simplification, not a missed detail).

**The map is a hub-only screen.** Out in the field, the only spatial awareness is the existing radar (off-screen contact arrows, Section 4's live/stale distinction still applies there) — there's no in-field map key, no pause-and-check-the-chart moment while flying. The full star chart only opens back at the hub, alongside the Ship/Hub/Research tabs (Section 7), which is also a better fit for "a chart, not a live feed" (Section 2) — a map you can only consult when docked reads as a real planning tool between expeditions, not a HUD element you'd otherwise just leave open.

## 1. What Exists Today (the actual starting point)

- **Ping** (Section 6 of the main spec) — manual, cooldown-gated, an expanding wave from the ship that reveals whatever it sweeps past.
- **Vision** — passive, short-radius, continuous, ship-centered.
- **Beacon Range** (upgrades-spec.md Section 3a) — the same passive idea, hub-centered, just built.
- **Coordinate system** (main spec Section 16) — star-anchored bearing+range in AU, the convention any future map has to speak.
- **`ContactMemory`** (`contacts.ts`/`engine.ts`) — a discovered contact is a snapshot, not a live link: it ages, fades, and is forgotten (`CONTACT_FORGET_AFTER`, 16s) or dropped once too far away (`CONTACT_MAX_RANGE`).
- **No map screen exists.** The only spatial awareness beyond what's on screen is radar arrows pointing at off-screen tracked contacts (`Renderer.renderRadarIndicators`) — there's no way to see the system at large, no persistent sense of "what have I actually explored."

This spec is about building that missing piece — a real map — and generalizing "what feeds it" (ping, vision, beacon) into a coherent sensor model rather than three separate hand-wired loops.

## 2. Two Layers of Knowledge, Not One

The current `discoveredContacts` map conflates two genuinely different things, and the map needs to keep them separate:

- **Terrain** — the star, the hub, the belt ring's boundary, the general shape of normal space. Fixed, doesn't move, and once you've been somewhere, you don't forget the *place* exists — same reasoning the hub already gets ("you always know where home is," main spec Section 16). This is what a map is mostly made of: a chart, not a live feed.
- **Contacts** — individual mineable/mobile things (asteroids, a future satellite, anything with a `Contact` id). These genuinely go stale — an asteroid drifts, gets mined out, or was simply never re-observed — so they need the existing memory/decay model, not permanent placement.

Concretely: the map renders terrain permanently once explored (a `Set` of explored map-grid cells or a simple "have I been within N of this belt sector" flag — coarse, not per-pixel), and overlays contacts on top of it using the existing `ContactMemory` age/distance rules, visually distinguished by how fresh they are (Section 4).

## 3. Fog of War

The map starts almost entirely blank — you know the hub (always) and roughly where the star and belt are meant to be (flavor: you know the *system*, not its contents), but nothing about what's actually out there until you've either flown through a region or had a sensor sweep it (ping, vision, beacon, or a satellite — Section 5). Exploring a region of normal space or the belt ring permanently un-fogs that area's terrain (not its contents — a body can still drift, be mined out, or simply not currently be tracked, even in fully-explored territory).

This gives exploration itself a visible, permanent payoff distinct from the mining haul — something the game doesn't currently have (the belt/normal-space redesign made the world feel real, but nothing records that you've *seen* it).

## 4. Live vs. Stale — the actual design problem worth solving

Right now, a contact is either tracked (age-refreshed, full information) or gone (deleted after `CONTACT_FORGET_AFTER`/`CONTACT_MAX_RANGE`) — binary, and tuned for a fast in-field radar (16 seconds is right for "what's near me right now," wrong for "what do I remember about the belt"). A map needs a third state:

- **Live** — currently within some active sensor's range (ship vision/ping, hub beacon, satellite coverage — Section 5). Rendered at full brightness/color, real-time position.
- **Recently stale** — was tracked, isn't anymore, still within the *map's* own (much longer) memory window. Rendered dimmed/grayed, with a "last seen" indicator (already have the data for this — `ContactMemory.age`, just needs a second, longer threshold and a different visual treatment instead of deletion).
- **Forgotten** — past the map's own memory window. Gone from the map entirely, same as today, but on a much longer timer than the tactical radar's 16 seconds.

This means **two decay rates on the same underlying data**, not one: the existing fast in-field radar (`CONTACT_FORGET_AFTER`) stays exactly as tuned (it's a HUD element, needs to feel current), while the map keeps its own separate, longer-lived memory (minutes, not seconds) of the same contacts. Cleanest implementation: the map doesn't need its own parallel contact-tracking system — it reads the same `ContactMemory` map, just with a different, map-specific age threshold for what counts as "still worth showing, just stale" vs. "gone."

This is also where the real strategic tension the main spec's risk structure has always wanted lives: a grayed-out "last seen 4 minutes ago, Large M-type" marker is a genuine bet — go find out if it's still there and still worth it, or trust a marker that might be wrong by now.

## 5. Sensor Sources — generalized, not three separate systems

The passive-detection loop (`Engine.update`'s sensor block) already independently repeats the same "distance from X, radius Y, refresh discovery" check for ship vision and hub beacon. Formalize this into one list of **sensor sources** — `{ pos: Vec2 | (() => Vec2), radius: number, kind: "vision" | "beacon" | "satellite" }` — and one loop over all of them, the same generalization `GravitySource` already got for gravity/heat. Concretely, three kinds:

- **Ship Vision** — existing, mobile, follows the ship.
- **Hub Beacon** — existing, fixed at the hub.
- **Satellite** (new, Section 6) — fixed wherever it was deployed, not tied to the ship or hub.

Layered on top, two distinct *modes* of active detection, matching "passive ping systems vs. active monitoring":

- **Active Monitoring** — the existing manual ping (Q key): a deliberate, cooldown-gated burst, player-triggered, largest single-moment radius of anything in the game. Stays exactly as it is — this is the "I need to know *right now*" tool.
- **Passive Ping** (new) — an upgrade-gated automatic sweep on its own timer (e.g. every 45s, smaller radius/slower expansion than a manual ping), firing on its own without player input. Doesn't replace manual ping — it's weaker, but it means the map keeps filling in a little even if you forget to press Q, and it's what makes a deployed satellite actually useful for more than a fixed vision bubble (Section 6).

## 6. Satellites

A genuinely new entity — not the ship, not the hub, a third kind of fixed sensor source the player places. Deploying one is a real action, not a purchase-and-forget: fly to a chosen spot, use a new tool/action to drop it (materials consumed on placement, same "spend directly" rule as everything else), and it stays there permanently, providing its own Vision-radius coverage (Section 5) plus, once the Passive Ping upgrade/research exists, its own automatic sweeps from that fixed position — coverage the ship doesn't have to sit in.

- Deliberately capped (starts at 1, more via upgrades — Section 7) — otherwise the right answer is always "carpet the belt in satellites," which trivializes exploration and undercuts fog of war entirely.
- A satellite is itself a `Contact` (has a position, shows up on radar/map) — nothing new needed there, it slots into the existing `Contact`/`getContacts()` model the same way the star and rock do.
- Natural deployment spots: the belt ring's inner edge (covers the transition from normal space), or deep in the belt near a valuable-but-far cluster you don't want to keep re-pinging.

## 7. Upgrades & Balancing (ties into `upgrades-spec.md`'s three tiers)

- **Hub Facility — Observatory** (previously flagged in `upgrades-spec.md` Section 3b as *not built*, blocked on "needs its own hub-centered discovery pass designed") — this spec is that design. Observatory is what unlocks the Map tab itself (the hub overlay shows only Ship/Hub/Research until it's built — the outpost starts too simple to have a proper star-chart) and the ability to deploy satellites at all.
- **Ship Advanced (Research-gated) — Passive Ping Array**: adds the automatic sweep (Section 5) to the ship itself, independent of satellites.
- **Hub Facility follow-on (Observatory's own progression branch, matching every other facility's shape) — Satellite Bay**: raises the satellite cap by one per purchase.
- **Research — "Orbital Mapping"** (discovery-gated: requires having scanned at least one body of every asteroid type, i.e. a genuine "you've seen enough of the system" milestone, not a material) → unlocks the map's fog-of-war reveal radius being larger per-explored-cell, rewarding having actually explored broadly rather than just materially.
- **Balancing**: satellite cost should be steep enough that "just spam them everywhere" isn't the answer (materials, not a trivial cost, and the hard cap regardless); Passive Ping's radius/interval should be tuned clearly below manual ping (e.g. half the radius, a third the speed) so manual ping is never obsolete; the map's own stale-data window (Section 4) should be long enough to feel like a real memory (minutes) but short enough that trusting a very old marker is a real gamble, not a safe bet.

## 8. Scope Discipline

- No live multiplayer/shared map data — this is entirely single-player knowledge, consistent with the main spec's Phase 2 boundary (snapshot-only, no live sync, when that eventually lands).
- No per-pixel fog of war — coarse regions (sectors or a grid, not a soft-edged reveal radius rendered per frame) is enough and far cheaper.
- Satellites don't move, don't have their own drift/physics, aren't mineable, aren't a combat target (no hostiles yet regardless) — a fixed point with a radius, nothing more, until there's a real reason to add more.
- Exact fog-of-war grid size, satellite cost/cap numbers, and Passive Ping's exact radius/interval are not decided here — this file fixes the *shape* (two knowledge layers, live/stale distinction, three sensor-source kinds, Observatory as the gate), not the numbers, same discipline as the other two specs.
