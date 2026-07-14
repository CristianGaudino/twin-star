import { v2 } from "./vec2";

// Tunable gameplay constants. Kept in one place so movement feel can be
// iterated on quickly without hunting through the engine code.

// --- Ship ---
export const SHIP_RADIUS = 9;
export const SHIP_THRUST_ACCEL = 260; // px/s^2 (== m/s^2, 1 world unit is 1 meter) at base (empty-cargo) mass
// Real F=ma, not a flat accel — SHIP_THRUST_FORCE / Ship.mass is the actual acceleration applied
// (ship.ts's updateMovement). 7800 = SHIP_THRUST_ACCEL (260) * SHIP_MASS (30, see below) — a
// literal, not a live reference, since SHIP_MASS is declared further down this file; picked
// specifically so an empty ship's handling is bit-for-bit identical to before this existed, and
// only a loaded hold changes anything. Same force in both modes — RCS's own distinct feel comes
// entirely from its higher drag, not a different force output.
export const SHIP_THRUST_FORCE = 7800;
// Terminal speed = SHIP_THRUST_ACCEL / drag. RCS is deliberately capped well below Cruise so
// it's clearly the wrong choice for covering distance; Cruise is the fast-transit mode.
export const CRUISE_DRAG = 0.55; // fraction of velocity shed per second
export const RCS_DRAG = 1.25; // tighter, for precision positioning — not for travel
export const CRUISE_TURN_RATE = 9; // rad/s, how fast facing eases toward the mouse
// m/s — the practical "100%" reference for the HUD speedometer, not a hard cap (gravity,
// collisions, and blast knockback can all push instantaneous speed past this).
export const CRUISE_TERMINAL_SPEED = SHIP_THRUST_ACCEL / CRUISE_DRAG; // ~473 m/s

// --- Hull / collision ---
export const MAX_HULL = 100;
export const DEATH_SCREEN_DURATION = 3; // seconds — auto-dismisses, doesn't block play (see Engine.deathScreen)
export const COLLISION_DAMAGE_SCALE = 0.11; // hull lost = impact speed * scale
export const COLLISION_MIN_SPEED = 55; // below this, a bump does no damage
export const POSITION_CORRECTION_RATE = 20; // per second — fraction of overlap closed each tick, smooths the pop-out

// A frame where something moves far relative to its own size can skip clean over thin
// geometry (a freshly laser-cut sliver, a chunk ejected point-blank from an extraction) since
// collision is checked once per frame at the end position. Splitting a fast frame into a few
// smaller steps (each with its own movement + collision pass) catches what one big jump would
// miss, without needing full continuous/swept collision detection.
export const COLLISION_SUBSTEP_TRAVEL = 6; // px — target max travel per body per substep
export const MAX_COLLISION_SUBSTEPS = 4; // hard cap, so a runaway velocity can't blow up frame cost

// One mass system, shared by every collision in the game (see physics.ts's RigidRef/
// resolveContact, used for all of ship-rock, rock-rock, chunk-rock, chunk-chunk, and
// chunk-ship). SHIP_MASS is the ship's one fixed mass, used everywhere the ship collides —
// never recomputed ad hoc per collision type. ROCK_MASS_PER_AREA converts polygon area to mass
// at ordinary rock's own density — every other resource scales this by its own real density
// relative to rock's (see asteroid.ts's massForArea/massPerAreaFor, the one function every rock
// cell, drift group, *and* loose chunk goes through, so a Nickel-Iron cell is exactly as heavy
// as the Nickel-Iron chunk it becomes once extracted, not two disconnected numbers). A single
// loose cell of ordinary rock feels roughly ship-weight, a small broken-off chunk of it is
// properly much lighter than either, and a full asteroid is heavy enough to barely register a
// nudge from one hit — denser resources (Nickel-Iron, Platinum-Group Ore) shift all of that
// heavier, lighter ones (Water Ice) shift it lighter.
export const SHIP_MASS = 30;
export const ROCK_MASS_PER_AREA = 0.01; // px^2 -> mass, at ordinary rock's density
// How much collision mass a full cargo hold adds to the ship (see Ship.mass) — a loaded ship is
// genuinely heavier, same as a real vessel. 0.04 * CARGO_CAPACITY_KG (750) = +30, i.e. a full
// hold roughly doubles the ship's base mass (30). Feeds both collision momentum *and* thrust
// (SHIP_THRUST_FORCE / mass, see ship.ts's updateMovement) — a full hold is a real, noticeable
// difference in both, not dwarfing either. Reduced by Cargo Stabilizers (upgrades.ts), not
// eliminated.
export const CARGO_MASS_FACTOR = 0.04;

// Materials (see physics.ts Material/combineMaterials) — each kind defines its own bounce and
// grip exactly once; every pairing's behavior (ship-rock, chunk-rock, chunk-chunk, chunk-ship,
// rock-rock) is *derived* by combining the two materials involved, not hand-tuned separately.
// Values below were chosen to land close to this game's previously hand-tuned per-pair
// constants once combined — expect pairings to feel very similar to before, not identical.
export const SHIP_RESTITUTION = 0.55;
export const SHIP_FRICTION = 0.92; // a little grip sliding along a surface, not frictionless
export const ROCK_RESTITUTION = 0.35; // duller than ship/chunk — big dumb mass thudding
export const ROCK_FRICTION = 1; // neutral: rock itself adds no extra drag, the other body does
export const CHUNK_RESTITUTION = 0.5;
export const CHUNK_FRICTION = 0.96; // light grip — was previously frictionless everywhere but the ship

// --- Cargo ---
// A real weight limit (kg), not an abstract slot count — see asteroid.ts's weightKgFor. Two
// resources with the same chunkValue (rough physical size) still weigh differently by their real
// density, so a hold full of Nickel-Iron fills up faster than the same hold full of Water Ice.
// 750kg is sized for a small, single-operator mining vessel, not a bulk freighter — picked so a
// "typical" chunk of ordinary rock (chunkValue 1 at REFERENCE_CELL_AREA, density 3.3) works out
// to roughly the same number of pickups-to-full the old abstract 16-unit cap gave.
export const CARGO_CAPACITY_KG = 750;
// kg contributed per (chunkValue unit * g/cm^3 of density) — the conversion factor between the
// game's abstracted "how big a piece is" number and an actual kilogram figure.
export const MATERIAL_WEIGHT_SCALE = 12;

// --- Hub ---
// The home base: a fixed point you dock at to deposit whatever's in the hold. Deliberately no
// currency conversion — materials are stored as-is, spent directly on whatever needs them
// later (upgrades, crafting), not abstracted into a number first. Sized as a real station —
// clearly bigger than the ship, bigger than most asteroids too — not a slightly-large rock.
// Was 160 — smaller than a medium asteroid's max (280), which undercut "bigger than most
// asteroids." Bumped so the hub clearly reads as the biggest artificial structure around,
// beating small/medium asteroids outright (a rare large asteroid can still out-mass it — that's
// fine, a big rock dwarfing a small station is a feature, not a bug).
export const HUB_RADIUS = 220; // px, base visual/collision-contact size — see Hub.radius for the grown value
export const HUB_DOCK_RANGE = 340; // px — how close the ship needs to be to dock

// hub-growth-spec.md — the hub's footprint genuinely grows with what's been built, not just its
// appearance: Hub.radius (hub.ts) adds this per owned Hub Facility on top of HUB_RADIUS, and
// Engine.hubContact() uses that grown value too, so a more built-up hub is also a bigger, easier
// target to spot on ping/vision — a real, deliberate mechanical side effect of visual growth, not
// just a cosmetic one. Capped by construction (5 facilities today, 220 + 5*8 = 260) to stay
// comfortably under the Large asteroid size class (320-420) — a rare large asteroid should still
// be able to out-mass the hub, that's a feature (see ASTEROID_SIZE_CLASSES' own doc comment).
export const HUB_RADIUS_GROWTH_PER_FACILITY = 8;
// Distance beyond the (grown) ring radius a Facility Module's own center sits, and the short
// strut connecting it back to the ring — see Renderer.renderHubModule.
export const HUB_MODULE_OFFSET = 46;

// Dock range is no longer its own purchasable upgrade (Dock Range Extension was cut — a flat,
// isolated stat purchase disconnected from everything else didn't earn its own slot once the hub
// had a real growth system to hang it on instead). It now passively scales with the same
// facilitiesBuilt count that drives Hub.radius — a bigger, more built-up station is easier to
// approach and dock at for the same reason it's easier to spot on radar, one consistent "size
// matters" idea instead of a separate purchase for it. See Hub.dockRange.
export const HUB_DOCK_RANGE_GROWTH_PER_FACILITY = 40;

// --- World layout (fixed landmarks — see ARCHITECTURE.md) ---
// Loosely modeled on Sirius: a bright ordinary primary (home star, built here) and a distant,
// extreme white-dwarf companion (far star — deliberately not built yet). Distances are
// compressed hard from anything astronomically real; grounded in real astronomy for flavor
// and asymmetry (spec explicitly wants the two stars to feel different), not literal AU scale.
export const HOME_STAR_POS = v2(0, -6000); // fixed, near the hub, well inside the belt's inner edge

// 1 in-fiction "AU" is defined as the hub's own distance from the home star — same logic real
// astronomy uses to define an AU (Earth's distance from the Sun), scaled to this system's
// compressed distances rather than the literal ~150-million-km real value. See coords.ts, the
// galactic standard coordinate system used for the HUD and a future map (not ping/radar, which
// stays plain distance-from-the-ship). Currently equal to distance(HOME_STAR_POS, hub position
// at (0,0)) — hardcoded rather than computed since both endpoints are themselves fixed constants.
export const AU_IN_METERS = 6000;
export const HOME_STAR_RADIUS = 1100; // physical surface — touching this is lethal, see gravity.ts

// Gravity (see gravity.ts's GravitySource) — a localized well around specific big bodies, not
// an ambient force everywhere. Pull radius is comfortably less than the hub's distance from
// the star (6000px) so the dock/hub area is never affected. Strength is tuned to be
// escapable with full thrust (SHIP_THRUST_ACCEL 260) but only with real margin near the
// surface — drift in unpowered and gravity alone will pull you the rest of the way in.
export const HOME_STAR_PULL_RADIUS = 4000;
export const HOME_STAR_PULL_STRENGTH = 200; // px/s^2 felt at dist=0 (never actually reached — see gravityAccel)

// Radiant heat shares the pull radius (if you're being pulled in, you're already cooking) but
// is a wholly separate hazard from the pull itself — and a two-stage one, not instant hull
// damage: exposure first raises Ship.temperature (a visible warning, no damage at all below
// TEMPERATURE_DAMAGE_THRESHOLD), and only once temperature is high does actual hull damage
// begin, ramping up toward TEMPERATURE_MAX_DAMAGE_PER_SEC at full overheat. Touching the
// lethal surface itself is still unconditional instant death regardless of temperature.
export const HOME_STAR_HEAT_INTENSITY = 40; // thermal exposure at dist=0 (never reached) — see radiantHeatDamage

// Solar power (see gravity.ts's solarExposure, fuel-power-spec.md) — deliberately NOT the same
// radius as the pull/heat wells above. Those are short-range hazards; realistic sunlight is
// useful at real interplanetary distances well past any hazard the star itself poses, so this
// reaches out past the belt's own outer edge (40800) — most of the system gets *some* charge,
// with a real gradient the closer you get, while the dangerous zone stays exactly as tight as it
// already was.
export const HOME_STAR_SOLAR_RADIUS = 60000;
export const HOME_STAR_SOLAR_INTENSITY = 40; // exposure at dist=0 (never reached — inside the lethal surface)

// --- Ship temperature (see Engine's heat handling) ---
// Tuned so a full-speed, dead-straight flight from the edge of the heat radius into the
// lethal surface takes real hull damage along the way, not just an instant "touch it, die"
// with no ramp-up — you can still choose to push in close, but it costs you before it kills
// you. (First pass was too gentle here: reaching the damage phase took longer than a direct
// approach actually spends in the heat radius at all, so heat never visibly did anything.)
export const TEMPERATURE_RISE_PER_HEAT_UNIT = 1.3; // %/sec per unit of thermal exposure
export const TEMPERATURE_DECAY_PER_SEC = 15; // passive cool-down whenever not currently exposed
export const TEMPERATURE_DAMAGE_THRESHOLD = 50; // below this, temperature is a pure warning — zero hull damage
export const TEMPERATURE_MAX_DAMAGE_PER_SEC = 35; // hull damage/sec once temperature hits 100

// The asteroid belt is a real ring around the STAR (not the hub) — a dense, deliberate landmark
// you travel to reach, the same way a real solar system's belt is a specific band, not "most of
// the system." Distances below are from HOME_STAR_POS. In AU (AU_IN_METERS): inner 4.8 AU,
// outer 6.8 AU — a 2 AU-wide ring centered ~5.8 AU out.
export const BELT_INNER_RADIUS = 28800;
export const BELT_OUTER_RADIUS = 40800;
export const BELT_ASTEROID_COUNT = 24; // full multi-cell bodies — see BELT_SIZE_POOL for size mix
export const BELT_TINY_ROCK_COUNT = 24; // one mineable cell each (see TINY_ROCK_RADIUS)
// Which ASTEROID_SIZE_CLASSES index each new belt body draws from, repeated per relative weight
// (a cheap weighting scheme — not worth a general weighted-pick helper for two call sites, see
// NORMAL_AREA_SIZE_POOL). The belt skews toward its own larger classes (1=medium, 2=large) —
// it's the "big stuff, worth the trip" landmark, unlike the smaller general scatter below.
export const BELT_SIZE_POOL = [0, 1, 1, 2, 2];

// Between the hub/star's safe zone and the belt's inner edge: not empty, and not the belt's own
// density either — a moderate scatter of mostly-smaller asteroids so there's real reason to mine
// on the way out, without undercutting the belt as the destination. Also star-anchored, for the
// same reason the belt is (one consistent reference frame — see coords.ts).
export const NORMAL_AREA_INNER_RADIUS = 7200; // 1.2 AU — clear of the star's own hazard radius
export const NORMAL_AREA_OUTER_RADIUS = BELT_INNER_RADIUS; // fills the gap up to the belt, no overlap
export const NORMAL_AREA_ASTEROID_COUNT = 18;
export const NORMAL_AREA_TINY_ROCK_COUNT = 16;
// Skewed hard toward small (index 0) — occasional medium, no large; large stays belt-exclusive.
export const NORMAL_AREA_SIZE_POOL = [0, 0, 0, 0, 1, 1];

// A separate, guaranteed population of small boulders in a short band just outside the hub
// itself (still hub-relative, unlike everything else above) — regardless of belt/normal-area
// randomness, there's always something to find within the first few seconds of undocking.
export const NEAR_HUB_ROCK_COUNT = 10;
export const NEAR_HUB_ROCK_RADIUS = { min: 1500, max: 7000 }; // px from the hub — well outside dock range

// Most belt bodies start fully at rest — a fraction get a small initial drift instead (see
// Asteroid.initialVelocity), just enough that the field doesn't read as a frozen diagram. Real
// motion after that comes from actual forces (collisions, blasts, and now gravity near a
// massive body), same as everything else in this game's physics.
export const BELT_DRIFT_CHANCE = 0.35; // fraction of bodies that start moving at all
export const BELT_DRIFT_SPEED = { min: 5, max: 20 }; // px/s, random direction

// --- Asteroid shape (irregular rock, Voronoi-cell interior) ---
export const ASTEROID_BASE_RADIUS = 190; // reference size — seed count scales off this, see seedCountForRadius
export const ASTEROID_OUTLINE_POINTS = 26;
export const ASTEROID_SEED_COUNT = 32; // seed count at ASTEROID_BASE_RADIUS
export const MIN_CELL_AREA = 90; // px^2 — remainder below this ejects wholesale rather than slicing further
// A chunk's actual cargo value scales with the physical area extracted (see
// asteroid.ts's chunkValueForArea) rather than a flat per-composition constant — a piece cut
// from a huge cell should yield more than the same composition cut from a tiny one. This is the
// area at which a resource's COMPOSITION_INFO.chunkValue applies exactly as written; smaller
// pieces yield less, bigger pieces yield more, both sublinearly (sqrt, same shape as
// seedCountForRadius/scanSecondsForRadius) so an extreme outlier doesn't overflow cargo in one
// grab. Derived from the original single-asteroid default: pi * ASTEROID_BASE_RADIUS^2 /
// ASTEROID_SEED_COUNT, i.e. the average cell area a "medium" body has always had.
export const REFERENCE_CELL_AREA = 3500;
// Two cells count as still touching if their boundaries are within this distance — checked
// against current (possibly laser-shrunk) geometry, not just "were they neighbors originally."
export const CELL_TOUCH_EPSILON = 2;

// A belt should read as varied, not stamped from one template — three rough size classes,
// picked randomly per asteroid (see Engine's belt scattering). Large's ceiling was 500 —
// trimmed to 420 (with its own outline noise, up to ~570 at the extreme) so nothing in the belt
// can visually rival HOME_STAR_RADIUS (1100), and so the hub (220) unambiguously beats small and
// medium outright, with only large ever coming close to out-sizing it.
export const ASTEROID_SIZE_CLASSES: { min: number; max: number }[] = [
  { min: 70, max: 140 }, // small
  { min: 160, max: 280 }, // medium — roughly the old single-asteroid scale
  { min: 320, max: 420 }, // large
];

// Standalone boulders (BELT_TINY_ROCK_COUNT) — small enough that subdividing into multiple
// Voronoi cells would be silly, so these force a single cell (the whole rock, one mineable
// piece) rather than going through the normal size-based seed count.
export const TINY_ROCK_RADIUS = { min: 20, max: 48 };

// --- Sensors ---
// Rescaled alongside the belt (see above) — these were tuned for a world a few hundred px
// across. VISION_RADIUS/SCAN_RANGE needed to grow just to stay usable at real asteroid sizes.
// PING_MAX_RADIUS deliberately does NOT try to cover meaningful fractions of the belt — it's a
// short-range "reveal just past the horizon" tool, not a way to skip exploring. Nudged up
// slightly so it comfortably reaches the guaranteed near-hub rocks (NEAR_HUB_ROCK_RADIUS).
// Longer range beyond this is a future upgrade, not the baseline.
export const VISION_RADIUS = 900; // always-visible short range, no ping needed
export const SCAN_RANGE = 350;
export const PING_COOLDOWN = 4.5; // seconds
export const PING_SPEED = 2200; // px/s expansion speed
export const PING_MAX_RADIUS = 5500;

// A ping/proximity contact is a last-known snapshot, not a live track — it goes stale and is
// eventually forgotten if nothing refreshes it, so radar reflects what you actually know, not
// the ground truth. Deliberately short: a ping tells you what's nearby right now, not a
// permanent mark — re-ping to refresh instead of it just sitting on screen indefinitely.
export const CONTACT_FORGET_AFTER = 16; // seconds since last refresh before a contact is dropped
export const CONTACT_FADE_DURATION = 6; // seconds — the blip fades out over this final stretch
// A contact past this range from the ship's *current* position no longer shows up on the
// in-field tactical radar (Renderer.renderRadarIndicator) — a ping reveals what's in range, not
// a permanent GPS lock you can wander arbitrarily far from and still see. This is a display-only
// cutoff, not a memory one (see MAP_CONTACT_FORGET_AFTER below) — the hub map is exactly the
// place that longer-range memory is meant to be useful. Set comfortably past PING_MAX_RADIUS so
// a contact caught at the very edge of a ping doesn't instantly vanish from tactical radar.
export const CONTACT_MAX_RANGE = 7000;

// The hub Map screen (map-radar-spec.md) reads the same discoveredContacts memory as tactical
// radar, just with a much longer staleness window and no ship-distance cutoff at all — "a chart,
// not a live feed." A contact between CONTACT_FORGET_AFTER and this age still shows on the map,
// dimmed (stale — last-known, not current); past this it's forgotten there too, same as radar.
export const MAP_CONTACT_FORGET_AFTER = 240; // seconds

// Fog of war (map-radar-spec.md Section 3) — coarse grid, not per-pixel. A sector is "explored"
// permanently once any sensor source's radius has swept it — see Engine.markExplored. Cheap by
// design: every sensor's radius today is small relative to this, so at most a handful of sectors
// are touched per source per frame.
export const MAP_SECTOR_SIZE = 4000; // px per fog-of-war grid cell

// Scan is a held action, not a tap: hold E in range and a wave sweeps outward
// from the asteroid's center; leaving range or letting go decays progress. Duration scales with
// the target's own size (see asteroid.ts's scanSecondsForRadius) — a bigger asteroid takes
// longer to read, sublinearly, so it's noticeable but never absurd.
export const SCAN_HOLD_SECONDS = 1.6; // reference duration at ASTEROID_BASE_RADIUS
export const SCAN_SECONDS_MIN = 0.6; // floor — even a tiny rock takes a moment
export const SCAN_SECONDS_MAX = 3.2; // ceiling — even the biggest asteroid caps out here
export const SCAN_PROGRESS_DECAY = 1.0; // per second, when not actively scanning
// Must comfortably exceed the largest asteroid's radius (see ASTEROID_SIZE_CLASSES) — this is
// measured from the asteroid's *center*, so sitting right on the surface of a large asteroid
// already means being several hundred px away from its center.
export const SCAN_DATA_DISPLAY_RANGE = 800; // HUD panel hides once you're this far from the asteroid

// --- Tools ---
export const TOOL_RECOMMENDED_MULT = 1.6;
export const TOOL_OFF_MULT = 0.65;

// Laser: shaves a sliver off the surface facing the ship on each completed cut,
// repeating until the remainder is small enough to eject as the final chunk.
export const LASER_RANGE = 170;
export const LASER_SIG_PER_SEC = 9;
export const LASER_CUT_DEPTH = 20; // px carved inward per cut

// Drill: must anchor (come to rest, point-blank) against the surface and hold;
// on completion, extracts the entire cell as one large core chunk.
export const DRILL_RANGE = 60;
export const DRILL_ANCHOR_RANGE = 26; // max ship-to-surface distance to stay anchored
export const DRILL_SIG_PER_SEC = 15;
// Bore progress is persistent — once you've drilled into a section it stays put across
// tool switches, flying off, and re-anchoring, only resetting when the section is fully
// extracted (or fractured by other means).

// Drill fracture visual: the crack network grows in discrete generations (see
// Engine.generateFractures) — shared with the renderer so the reveal band lines up exactly
// with how the data was generated.
export const DRILL_FRACTURE_GENERATIONS = 7;

// Charges: place then remotely detonate; each detonated cell is extracted whole.
export const CHARGE_RANGE = 150;
export const CHARGE_SIG_PER_USE = 22;
export const CHARGE_MAX_CARRIED = 6;

// Blast physics: each detonated charge imparts a fixed impulse (momentum, not
// velocity) at the blast point, so heavier bodies move less from the same
// charge and several charges going off together stack additively. Calibrated
// to be a clearly bigger kick than a casual ship bump (~6000-8000 impulse at
// typical cruise speed against a small loose piece) — an explosive should hit
// harder than an incidental collision, not softer. If the ship is caught in
// the radius it takes falloff damage and knockback too.
export const CHARGE_IMPULSE_PER_CHARGE = 9000; // mass-units*px/s, divided by group mass -> delta-v
export const CHARGE_BLAST_RADIUS = 90; // px
export const CHARGE_BLAST_DAMAGE_MAX = 18; // hull damage at point-blank, falls off to 0 at the radius edge
export const CHARGE_BLAST_PUSH_MAX = 220; // px/s knockback at point-blank
export const CHARGE_CHUNK_PUSH_MAX = 260; // px/s knockback for loose chunks at point-blank — light debris flies far
export const BLAST_VISUAL_DURATION = 0.5; // seconds, shockwave ring + flash lifetime

export const SIGNATURE_DECAY_PER_SEC = 10;

// --- Fuel & Power (fuel-power-spec.md) ---
// Fuel: pure consumable, thrust-only, never regenerates passively — see Ship.updateMovement.
// Burn is keyed off thrustForce itself (not the resulting acceleration), so a loaded ship burns
// at the same rate as an empty one for the same throttle input — the mass penalty already lives
// entirely on the acceleration side (SHIP_THRUST_FORCE / mass), fuel burn doesn't double-tax it.
export const FUEL_CAPACITY = 100;
export const FUEL_BURN_PER_FORCE_SECOND = 0.00015; // fuel/sec = thrustForce * this, while thrusting

// Battery: everything except thrust. Passive baseline regen everywhere (never fully dark
// forever), boosted by solar exposure near a star — see Engine's power handling.
export const BATTERY_CAPACITY = 100;
export const BATTERY_BASELINE_REGEN_PER_SEC = 1.5;
export const BATTERY_SOLAR_REGEN_MULT = 0.15; // battery/sec per unit of solar exposure (see gravity.ts)
export const REACTOR_DOCK_SOLAR_BOOST = 8; // extra battery/sec while near the hub, once Reactor is built

// Passive vision drops to this once battery is empty — blind but not helpless, matches the
// two-different-failure-modes design (out of fuel = stranded, out of power = blind but mobile).
export const POWERLESS_VISION_RADIUS = 150;
export const VISION_POWER_DRAW_PER_SEC = 0.5;
export const PING_POWER_COST = 8; // one-time, on trigger
export const SCAN_POWER_DRAW_PER_SEC = 2;
export const LASER_POWER_PER_SEC = 3;
export const DRILL_POWER_PER_SEC = 4;
export const CHARGE_POWER_PER_USE = 10;

// --- Passive Ping (map-radar-spec.md Section 5) — Ship.passivePingInterval (upgradable, 0 =
// disabled) gates whether this fires at all; radius is deliberately well under a manual ping's,
// so manual ping (Q) stays the stronger, deliberate tool rather than becoming obsolete.
export const PASSIVE_PING_INTERVAL = 45; // seconds between automatic sweeps, once unlocked
export const PASSIVE_PING_RADIUS = 2500; // instant reveal radius — no expanding-wave visual, unlike manual ping
export const PASSIVE_PING_POWER_COST = 4; // per pulse — half of manual ping's cost, gated by ship.powered same as it

// --- Satellites (map-radar-spec.md Section 6) — fixed-position, player-deployed sensor sources.
// Capped via Hub.satelliteCap (Observatory/Satellite Bay) so "carpet the belt in them" isn't the
// answer — deploying one is a real, costed decision, not a trivial spam.
export const SATELLITE_VISION_RADIUS = 1600;
export const SATELLITE_DEPLOY_COST = { nickelIron: 20, crystal: 10 } as const;

// --- Chunks ---
export const CHUNK_DRAG = 0.15;
export const CHUNK_COLLECT_RADIUS = 16; // uncollected chunks still physically bump the ship, no damage — see CHUNK_RESTITUTION/CHUNK_FRICTION

// --- Cursor hover (see hover.ts) ---
// Extra forgiveness around a chunk's small collision radius so hovering one with the
// mouse doesn't require pixel-perfect aim.
export const HOVER_CHUNK_PADDING = 6; // px

// --- Drift groups ---
// Every connected cluster of intact cells is a full 2D rigid body — center of
// mass, moment of inertia (derived from cell area/placement), linear velocity,
// and angular velocity — including the whole, never-cut asteroid (it just
// starts at rest). Collisions and blasts push whichever body they actually
// hit, off-center contacts induce spin, and two separate pieces now collide
// with each other instead of passing through.
//
// Cutting a piece loose (laser/drill) applies zero extra impulse — nothing
// has collided with it, so there's no force to fling it with. It simply keeps
// whatever motion its parent already had, including the real tangential
// velocity a piece picks up if the parent was spinning (conservation of
// momentum, not a fudge). Only an actual force — a collision, or a charge's
// blast impulse — changes a piece's velocity.
export const DRIFT_DAMPING = 0.04; // per second — very light, so drift is slow and lasting
export const ANGULAR_DAMPING = 0.06; // per second — spin settles a bit faster than translation
// Rock's own bounce/grip against another rock body — see ROCK_RESTITUTION/ROCK_FRICTION above.
// With several cells per group near each other, the single "closest pair" used for the contact
// point can jump between different cell pairs from one frame to the next as things settle —
// each jump nudges the contact normal, and without a floor that noise can needle in tiny,
// inconsistently-directed impulses forever. Below this closing speed, treat it as at rest.
export const ROCK_CONTACT_MIN_CLOSING_SPEED = 3; // px/s
