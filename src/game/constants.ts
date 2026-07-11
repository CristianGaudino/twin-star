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
export const COLLISION_RESTITUTION = 0.45; // bounce-back factor
export const POSITION_CORRECTION_RATE = 20; // per second — fraction of overlap closed each tick, smooths the pop-out

// Mass units for collision impulses (ship vs rock). Rock mass is derived from
// its area, so a single loose cell feels roughly ship-weight while the full
// asteroid is heavy enough to barely register a nudge from one hit.
export const SHIP_MASS = 30;
export const ROCK_MASS_PER_AREA = 0.01; // px^2 -> mass

// --- Cargo ---
export const CARGO_CAPACITY = 16;

// --- Asteroid shape (irregular rock, Voronoi-cell interior) ---
export const ASTEROID_BASE_RADIUS = 190;
export const ASTEROID_OUTLINE_POINTS = 26;
export const ASTEROID_SEED_COUNT = 32;
export const MIN_CELL_AREA = 90; // px^2 — remainder below this ejects wholesale rather than slicing further
// Two cells count as still touching if their boundaries are within this distance — checked
// against current (possibly laser-shrunk) geometry, not just "were they neighbors originally."
export const CELL_TOUCH_EPSILON = 2;

// --- Sensors ---
export const VISION_RADIUS = 300; // always-visible short range, no ping needed
export const SCAN_RANGE = 230;
export const PING_COOLDOWN = 4.5; // seconds
export const PING_SPEED = 900; // px/s expansion speed
export const PING_MAX_RADIUS = 1600;

// A ping/proximity contact is a last-known snapshot, not a live track — it goes stale and is
// eventually forgotten if nothing refreshes it, so radar reflects what you actually know, not
// the ground truth.
export const CONTACT_FORGET_AFTER = 45; // seconds since last refresh before a contact is dropped
export const CONTACT_FADE_DURATION = 8; // seconds — the blip fades out over this final stretch

// Scan is a held action, not a tap: hold E in range and a wave sweeps outward
// from the asteroid's center; leaving range or letting go decays progress.
export const SCAN_HOLD_SECONDS = 1.6;
export const SCAN_PROGRESS_DECAY = 1.0; // per second, when not actively scanning
export const SCAN_DATA_DISPLAY_RANGE = 300; // HUD panel hides once you're this far from the asteroid

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
// Currently unused: anchoring no longer gates on ship speed (a fast/spinning
// drift group made anchoring impossible since the ship has to match its speed
// just to stay in range). Revisit with a relative-velocity check if needed.
export const DRILL_ANCHOR_MAX_SPEED = 30; // px/s
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
export const CHUNK_COLLECT_RADIUS = 16;
export const CHUNK_SHIP_BUMP_RESTITUTION = 0.6; // uncollected chunks bounce off the ship, no damage
export const CHUNK_CHUNK_RESTITUTION = 0.5; // chunks bounce off each other too

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
export const ROCK_ROCK_RESTITUTION = 0.35; // duller than ship-rock — big dumb masses thudding together
// With several cells per group near each other, the single "closest pair" used for the contact
// point can jump between different cell pairs from one frame to the next as things settle —
// each jump nudges the contact normal, and without a floor that noise can needle in tiny,
// inconsistently-directed impulses forever. Below this closing speed, treat it as at rest.
export const ROCK_CONTACT_MIN_CLOSING_SPEED = 3; // px/s
