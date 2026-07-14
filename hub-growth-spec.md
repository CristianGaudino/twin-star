# Twin Star — Hub Visual Growth Spec

Companion to `twin-star-spec.md` Section 9 ("Visible growth as the progression readout... new docking arms, reactors, rings, lit sections... Not built yet") and `upgrades-spec.md` (the Hub Facility roster this spec gives a body to).

**Status: implemented**, including the optional `HUB_RADIUS` growth from Section 7 (explicitly approved rather than assumed) — see `ARCHITECTURE.md` for what actually landed.

## 1. The problem with "lit-up ring"

The main spec's own phrasing — "a lit-up ring that changes color" — is explicitly the thing it says *not* to build (`ARCHITECTURE.md`'s Facility section literally quotes this as the failure mode to avoid). Right now the hub is two concentric strokes and a dot (`Renderer.renderHubMarker`) regardless of whether zero upgrades or all twenty-plus are owned. A generic brightness dial doesn't read as *growth* — it reads as a settings toggle. Real growth needs to be legible at a glance: someone should be able to look at the hub and roughly say "they've got a Refinery and an Observatory but no Reactor yet," the same way you can eyeball a real space station's modules.

## 2. Concept: a core with docking clamps, not a ring that glows

The hub is a **Core Ring** (small, always present, exactly what exists today) with **Facility Modules** bolted onto fixed slots around it — one slot per Hub Facility upgrade, filled in only once that facility is actually owned, empty (a dark stub) otherwise. This mirrors real modular stations (Mir, ISS) far more than a mood ring does, and it's a natural fit for a game that already has zero currency and materials-only purchases: nothing here needs new game state, it's a rendering layer over data that already exists (`Hub.purchasedUpgrades`, `.refineryBuilt`/`.observatoryBuilt`/`.reactorBuilt`, `.dockRange`/`.beaconRange`/`.structuralIntegrity`, `Engine.satellites.length`). See Section 6.

**Fixed slot layout, not random placement.** Each of the five existing Hub Facilities gets a permanent angle around the ring, always the same one, so a returning player's mental map of "where's the Refinery" never shifts:

| Facility | Angle | Module read |
|---|---|---|
| Research Lab Expansion | 0° (top) | Dish/antenna cluster — the first thing you'd build, front and center |
| Observatory | 72° | A shallow dome |
| Satellite Bay | 144° | A launch cradle |
| Reactor | 216° | A glowing core block with radiator fins |
| Refinery | 288° | An industrial block with a vent glow |

Reserved slots for the still-unbuilt facilities (Scrapyard, Mining Facility, Shipyard, Foundry — `upgrades-spec.md` Section 3b) don't exist as angles yet since they don't exist as `UpgradeId`s; when one of them is eventually built, this table gains a sixth/seventh/etc. slot the same way, at whatever angle keeps the ring evenly spaced. Nothing here requires deciding the empty-stub treatment for *hypothetical* facilities in advance.

## 3. Facility Modules — each one distinct, not a reskinned copy

Generic "add a box" for every facility would be the same failure mode one level down. Each module's shape/behavior should say what it does:

- **Research Lab Expansion** — a small dish/antenna cluster, pale blue-white. While `Hub.activeResearch` is non-null, it slowly rotates/sweeps — the one module with a "currently working" animation, since research is the one facility whose activity is genuinely intermittent and worth surfacing.
- **Observatory** — a shallow translucent dome, matching its actual job (map-radar-spec.md: it's what unlocked the Map tab and satellites). A slow, subtle sweep line inside the dome reads as "scanning" without needing new state — a pure cosmetic animation, not tied to any real detection event.
- **Satellite Bay** — a launch cradle with small dot indicators, one per deployed satellite up to `Hub.satelliteCap` (lit if deployed, dim outline if capacity exists but unused). This is the one module that visibly reflects a number the player already tracks mentally ("2/2 deployed") — seeing it on the hub itself instead of only in a HUD line is the payoff.
- **Reactor** — a glowing core block, warm amber-white, with two or three thin radiator fins that rotate slowly (a station needs to shed heat; a reactor is the one facility where that's the correct visual cliché, not a random flourish). Brightness pulses gently on a fixed period — "always on," not tied to the actual battery-regen math, since making it react to real-time exposure would need the renderer reaching into gravity/solar state for a cosmetic-only payoff not worth the coupling.
- **Refinery** — a blockier industrial module, duller material tone, with a flickering amber vent glow (two or three overlapping semi-transparent circles at varying alpha, cheap to fake convincingly) — the one module that should look like it's *doing manufacturing*, not just sitting there.

## 4. Core Ring growth — the standard upgrades get a payoff too

Facilities aren't the only Hub-tier purchases; the four Standard upgrades (`upgrades-spec.md` Section 3a) currently have zero visual footprint even though they're real, felt stat changes. Each gets a small, specific tell on the Core Ring itself rather than a module (they're refinements to the base station, not new construction):

- **Structural Reinforcement** — thickens the ring's stroke and adds a faint girder/plating texture (a few short radial tick marks around the circumference). This is a genuinely new payoff for a stat the upgrade's own description admits does nothing yet ("Nothing can damage the hub yet — this pays off once something can") — it stops being purely inert the moment this ships, without needing a damage system to justify it.
- **Beacon Range Upgrade** — a slowly pulsing beacon light on the ring, period loosely tied to `Hub.beaconRange` (a bigger beacon pulses a little slower/broader) — visually explains what was previously just a number in the upgrade description.
- **Repair Bay** — a small cross-marked panel on the ring, lit green. Minor, but it's the one upgrade whose entire job is "you feel safe here," and a station literally advertising a med-bay supports that read.
- ~~Dock Range Extension~~ — cut during implementation, not built as its own upgrade. It was a flat, isolated `+dockRange` purchase with no connection to anything else the moment `Hub.radius` existed as a real, derived "how big is this station" value — dock range now scales passively off the same `facilitiesBuilt` count `radius` already uses (`Hub.dockRange` getter, `hub.ts`), no purchase needed. The existing dashed approach-guide ring (drawn when `nearHub`) already reflects the live value automatically as the hub grows.

## 5. Baseline, unlocked from the start: solar arrays

Not gated behind any upgrade — present from the very first frame, because the fiction already demands it. Main spec Section 2: *"Solar-powered — proximity to this star is the mechanical reason the hub can exist here at all."* That line has had zero visual representation since it was written. Two flat panel shapes, angled to face `HOME_STAR_POS` (a fixed, one-time-computed angle, since both the hub and the star are fixed points — no per-frame recomputation needed), on opposite sides of the Core Ring. Free, retroactively justifies existing fiction, and now directly ties into the fuel/power system's own solar-exposure mechanic without costing it anything new.

## 6. Data model: this needs nothing new

Worth stating plainly because it changes the implementation risk profile: every input this spec needs already exists. `Hub.purchasedUpgrades: Set<UpgradeId>` tells you which facility slots are filled and which standard upgrades to draw; `Hub.refineryBuilt`/`.observatoryBuilt`/`.reactorBuilt` are redundant with `purchasedUpgrades.has(...)` but already there either way; `Hub.dockRange`/`.beaconRange`/`.structuralIntegrity` feed the ring tells directly; `Engine.satellites.length`/`Hub.satelliteCap` feed the Satellite Bay dots; `Hub.activeResearch` feeds the Research Lab's sweep animation. This is purely a rewrite of `Renderer.renderHubMarker` (plus small per-module draw helpers, same one-method-per-thing pattern `renderShip`/`renderAsteroid`/`renderChunk` already use) — no new Engine state, no new persistence, no new save-data shape to worry about.

## 7. Scope discipline

- **Procedural Canvas 2D only** — shapes, gradients, simple rotation/pulse animation via a time value, same toolkit every other visual in this game already uses (the star's radial gradient, asteroid Voronoi outlines, the starfield). No sprite/image assets, no new rendering pipeline.
- **Deterministic slot layout, not randomized** — a facility always renders at the same angle for the same reason the belt's own landmarks are fixed rather than randomized per session: a returning player's mental map should never be invalidated by their own progress.
- **Animations are cosmetic-only, not read from deep game state** — the Reactor's pulse, the Observatory's sweep, are on fixed timers, not wired to real-time solar exposure or detection events. Coupling them to real state would be a second feature (and a renderer→gravity/sensor dependency that doesn't exist today) for a payoff nobody would notice frame-to-frame; not worth it here.
- **`HUB_RADIUS` growth — decided and built.** The hub's physical footprint genuinely creeps with facility count (+8px per facility owned via `Hub.radius`, capping at 260 with all five existing facilities), and `Engine.hubContact()` uses that same grown value — a more built-up hub really is easier to spot on radar/ping, a deliberate mechanical consequence approved before building rather than assumed. Stays comfortably under the Large asteroid size class (320-420), so the existing "hub beats small/medium outright, a rare large asteroid can still dwarf it" balance note holds.
- **Not in scope**: the still-separate "passive layer" bullet from main spec Section 9 (offline resource trickle) — a fully-modular hub makes that idea more tempting (each module could plausibly justify its own passive output) but that's a mechanical system, not a rendering one, and deserves its own spec once this exists to hang it on, not a scope-creep add-on here.
