import { v2 } from "./vec2";

// Tunable gameplay constants. Kept in one place so movement feel can be
// iterated on quickly without hunting through the engine code.

// --- Ship ---
export const SHIP_RADIUS = 9;
export const SHIP_THRUST_ACCEL = 260; // px/s^2 — same accel in both modes, RCS stays snappy for precision work
// Terminal speed = SHIP_THRUST_ACCEL / drag. Cruise ~473 px/s, RCS ~208 px/s —
// RCS is deliberately capped well below Cruise so it's clearly the wrong
// choice for covering distance; Cruise is the fast-transit mode.
export const CRUISE_DRAG = 0.55; // fraction of velocity shed per second
export const RCS_DRAG = 1.25; // tighter, for precision positioning — not for travel
export const CRUISE_TURN_RATE = 9; // rad/s, how fast facing eases toward the mouse

// --- Hull / collision ---
export const MAX_HULL = 100;
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
// never recomputed ad hoc per collision type. ROCK_MASS_PER_AREA converts polygon area to
// mass and is shared by rock cells *and* chunks (a chunk is the same material, just no
// longer attached to a larger body), so a single loose cell feels roughly ship-weight, a
// small broken-off chunk is properly much lighter than either, and the full asteroid is
// heavy enough to barely register a nudge from one hit.
export const SHIP_MASS = 30;
export const ROCK_MASS_PER_AREA = 0.01; // px^2 -> mass

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
export const CARGO_CAPACITY = 16;

// --- Hub ---
// The home base: a fixed point you dock at to deposit whatever's in the hold. Deliberately no
// currency conversion — materials are stored as-is, spent directly on whatever needs them
// later (upgrades, crafting), not abstracted into a number first. Sized as a real station —
// clearly bigger than the ship, bigger than most asteroids too — not a slightly-large rock.
export const HUB_RADIUS = 160; // px, visual size in the field
export const HUB_DOCK_RANGE = 260; // px — how close the ship needs to be to dock

// --- World layout (fixed landmarks — see ARCHITECTURE.md) ---
// Loosely modeled on Sirius: a bright ordinary primary (home star, built here) and a distant,
// extreme white-dwarf companion (far star — deliberately not built yet). Distances are
// compressed hard from anything astronomically real; grounded in real astronomy for flavor
// and asymmetry (spec explicitly wants the two stars to feel different), not literal AU scale.
export const HOME_STAR_POS = v2(0, -6000); // fixed, near the hub, well inside the belt's inner edge
export const HOME_STAR_RADIUS = 1100; // visual only, no collision yet

// The asteroid belt is the "normal operating range" around home — its own boundary is a fixed
// landmark, but what's actually scattered inside it (see Engine's belt scattering) is
// procedural content, not permanent map geometry, and can grow/regenerate later without
// touching this geometry.
export const BELT_INNER_RADIUS = 11000; // px from the hub — nothing spawns closer than this
export const BELT_OUTER_RADIUS = 95000; // px from the hub — edge of normal operating range
export const BELT_ASTEROID_COUNT = 9;

// --- Asteroid shape (irregular rock, Voronoi-cell interior) ---
export const ASTEROID_BASE_RADIUS = 190; // reference size — seed count scales off this, see seedCountForRadius
export const ASTEROID_OUTLINE_POINTS = 26;
export const ASTEROID_SEED_COUNT = 32; // seed count at ASTEROID_BASE_RADIUS
export const MIN_CELL_AREA = 90; // px^2 — remainder below this ejects wholesale rather than slicing further
// Two cells count as still touching if their boundaries are within this distance — checked
// against current (possibly laser-shrunk) geometry, not just "were they neighbors originally."
export const CELL_TOUCH_EPSILON = 2;

// A belt should read as varied, not stamped from one template — three rough size classes,
// picked randomly per asteroid (see Engine's belt scattering).
export const ASTEROID_SIZE_CLASSES: { min: number; max: number }[] = [
  { min: 70, max: 140 }, // small
  { min: 160, max: 280 }, // medium — roughly the old single-asteroid scale
  { min: 320, max: 500 }, // large
];

// --- Sensors ---
// Rescaled alongside the belt (see above) — these were tuned for a world a few hundred px
// across. VISION_RADIUS/SCAN_RANGE needed to grow just to stay usable at real asteroid sizes.
// PING_MAX_RADIUS deliberately does NOT try to cover meaningful fractions of the belt — it's a
// short-range "reveal just past the horizon" tool (a bit past typical screen half-diagonal),
// not a way to skip exploring. Longer range is a future upgrade, not the baseline.
export const VISION_RADIUS = 900; // always-visible short range, no ping needed
export const SCAN_RANGE = 350;
export const PING_COOLDOWN = 4.5; // seconds
export const PING_SPEED = 1400; // px/s expansion speed
export const PING_MAX_RADIUS = 3500;

// A ping/proximity contact is a last-known snapshot, not a live track — it goes stale and is
// eventually forgotten if nothing refreshes it, so radar reflects what you actually know, not
// the ground truth.
export const CONTACT_FORGET_AFTER = 45; // seconds since last refresh before a contact is dropped
export const CONTACT_FADE_DURATION = 8; // seconds — the blip fades out over this final stretch

// Scan is a held action, not a tap: hold E in range and a wave sweeps outward
// from the asteroid's center; leaving range or letting go decays progress.
export const SCAN_HOLD_SECONDS = 1.6;
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
