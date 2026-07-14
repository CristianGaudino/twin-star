import { InputState } from "./input";
import {
  BATTERY_CAPACITY,
  CARGO_CAPACITY_KG,
  CARGO_MASS_FACTOR,
  CRUISE_DRAG,
  CRUISE_TURN_RATE,
  FUEL_BURN_PER_FORCE_SECOND,
  FUEL_CAPACITY,
  MATERIAL_WEIGHT_SCALE,
  MAX_HULL,
  PING_MAX_RADIUS,
  PING_SPEED,
  RCS_DRAG,
  SHIP_MASS,
  SHIP_THRUST_FORCE,
  SIGNATURE_DECAY_PER_SEC,
  TEMPERATURE_DAMAGE_THRESHOLD,
  TEMPERATURE_DECAY_PER_SEC,
  TEMPERATURE_RISE_PER_HEAT_UNIT,
  VISION_RADIUS,
} from "./constants";
import { CHARGE_MAX_CARRIED } from "./constants";
import { COMPOSITIONS, COMPOSITION_INFO, Composition, weightKgFor } from "./asteroid";
import { ToolId } from "./tools";
import { Vec2, add, angleDelta, clamp, fromAngle, scale, sub, v2 } from "./vec2";

/** What's actually in the hold — raw materials, not an abstract currency. Deposited at the
 *  hub as-is; whatever they get used for later (upgrades, crafting) draws from these directly. */
export type CargoHold = Record<Composition, number>;

/** Exported so Hub can build its own empty materials store the same way, rather than
 *  hand-listing all six resource keys a second time (see COMPOSITIONS in asteroid.ts). */
export const emptyCargo = (): CargoHold =>
  Object.fromEntries(COMPOSITIONS.map((c) => [c, 0])) as CargoHold;

export type MoveMode = "cruise" | "rcs";

/** What caused a hit — required on every `takeImpact` call so future sources (enemy weapons,
 *  hazards) can't silently skip tagging themselves, the same way `Explosion.source` is required.
 *  Mostly not consumed beyond being available (per-source feedback like distinct hit
 *  messages/sounds is future work), except "heat" — see `Engine`'s radiant-heat handling,
 *  which does use it to distinguish a burn death from a generic one. */
export type DamageSource = "collision" | "explosion" | "heat";

export class Ship {
  pos: Vec2;
  vel: Vec2 = v2(0, 0);
  angle = -Math.PI / 2; // facing "up" initially
  mode: MoveMode = "cruise";

  maxHull = MAX_HULL; // upgradable (Reinforced Hull Plating) — see upgrades.ts
  hull = MAX_HULL;
  cargo: CargoHold = emptyCargo();
  cargoCapacity = CARGO_CAPACITY_KG; // kg — a real weight limit, see weightKgFor
  signature = 0;
  // A warning that builds up under radiant heat exposure (see gravity.ts) before any hull
  // damage happens — see Engine's heat handling for where the threshold/damage ramp lives.
  temperature = 0;

  selectedTool: ToolId = "laser";
  chargeMaxCarried = CHARGE_MAX_CARRIED; // upgradable (Charge Payload Upgrade)
  chargesCarried = CHARGE_MAX_CARRIED;

  /** True while the drill has grappled onto a cell surface; freezes thrust entirely. */
  anchored = false;

  // --- Upgradable stats (upgrades.ts) — absolute effective values, initialized from the same
  // constants everything started as, mutated in place by Engine.purchaseUpgrade so every read
  // site (movement, sensors, mining) just reads the instance field instead of needing to know
  // upgrades exist at all. See upgrades-spec.md for the full roster this backs.
  thrustForce = SHIP_THRUST_FORCE;
  rcsDrag = RCS_DRAG;
  visionRadius = VISION_RADIUS;
  pingMaxRadius = PING_MAX_RADIUS;
  pingSpeed = PING_SPEED;
  temperatureDamageThreshold = TEMPERATURE_DAMAGE_THRESHOLD;
  temperatureDecayPerSec = TEMPERATURE_DECAY_PER_SEC;
  signatureDecayPerSec = SIGNATURE_DECAY_PER_SEC;
  // Tool ranges stay bonuses added at the read site, not absolute overrides — the base value
  // lives in the shared TOOLS table (tools.ts), not a single constant this class owns outright.
  laserRangeBonus = 0;
  drillAnchorRangeBonus = 0;
  // Multiplicative, not additive — each starts at "no change" (1) and an upgrade nudges it down.
  scanSpeedMult = 1;
  signatureGainMult = 1;
  gravityResistMult = 1;
  // How much of the ship's *own* collision mass a full cargo hold adds — see the mass getter
  // below. Reduced, not eliminated, by Cargo Stabilizers.
  cargoMassFactor = CARGO_MASS_FACTOR;

  // --- Fuel & Power (fuel-power-spec.md) — two separate pools, two separate failure modes.
  // Fuel: thrust-only, never regenerates passively, drained/gated entirely in updateMovement
  // below. Battery: everything else (vision, ping, scan, tools) — Engine owns its regen/draw
  // (solar exposure, passive baseline, per-system costs), this class just holds the numbers.
  fuel = FUEL_CAPACITY;
  fuelCapacity = FUEL_CAPACITY;
  battery = BATTERY_CAPACITY;
  batteryCapacity = BATTERY_CAPACITY;
  // Multiplicative, same convention as scanSpeedMult etc: 1 = no change. solarRegenMult only
  // scales the solar-boosted portion of regen (Solar Collector Array); powerDrawMult scales
  // every draw (Power Efficiency Systems).
  solarRegenMult = 1;
  powerDrawMult = 1;
  // Seconds between automatic sensor sweeps — 0 (default) means disabled. Set by Passive Ping
  // Array (upgrades.ts); ticked by Engine, not here (same reasoning as pingCooldown living on
  // Engine, not Ship — it's a timer over world state, not a ship stat by itself).
  passivePingInterval = 0;

  constructor(pos: Vec2) {
    this.pos = pos;
  }

  get isAlive() {
    return this.hull > 0;
  }

  /** The ship's real mass — heavier when loaded, same as a real vessel actually would be. Feeds
   *  both collision momentum (Engine.shipBody) *and* thrust (updateMovement below computes real
   *  acceleration as thrustForce / mass, not a flat number) — a full hold is measurably more
   *  sluggish to fly, not just heavier to bump into things. Collision *damage* is untouched
   *  either way (still purely closing-speed-based, see Engine.applyCollisionImpact). */
  get mass(): number {
    return SHIP_MASS + this.cargoUsed * this.cargoMassFactor;
  }

  /** Total weight in kg currently held, not a raw item count — see weightKgFor. */
  get cargoUsed(): number {
    return COMPOSITIONS.reduce((sum, key) => sum + weightKgFor(key, this.cargo[key]), 0);
  }

  get cargoFull() {
    return this.cargoUsed >= this.cargoCapacity;
  }

  /** Whether any active system (scan, ping, tools) can run right now — the "out of power" gate.
   *  Passive vision still works at a reduced radius even when false (see Engine.sensorSources) —
   *  zero power means blind-and-toothless, not fully dead, unlike zero fuel. */
  get powered(): boolean {
    return this.battery > 0;
  }

  /** Adjusts battery by `delta` (negative = draw, positive = regen), clamped to
   *  [0, batteryCapacity] — the one place anything touches Ship.battery, so every call site
   *  (Engine's regen tick, every tool/scan/ping draw) shares the same clamp instead of each
   *  reimplementing it. */
  applyPowerDelta(delta: number) {
    this.battery = clamp(this.battery + delta, 0, this.batteryCapacity);
  }

  toggleMode() {
    this.mode = this.mode === "cruise" ? "rcs" : "cruise";
  }

  /** Steers/thrusts the ship for one tick. worldMouse only matters in cruise mode (aim). */
  updateMovement(dt: number, input: InputState, worldMouse: Vec2) {
    if (this.anchored) {
      this.vel = v2(0, 0);
      return;
    }
    const thrustInput = v2(0, 0);
    const up = input.isDown("w");
    const down = input.isDown("s");
    const left = input.isDown("a");
    const right = input.isDown("d");

    if (this.mode === "cruise") {
      const toMouse = sub(worldMouse, this.pos);
      if (toMouse.x !== 0 || toMouse.y !== 0) {
        const targetAngle = Math.atan2(toMouse.y, toMouse.x);
        const delta = angleDelta(this.angle, targetAngle);
        const maxStep = CRUISE_TURN_RATE * dt;
        this.angle += clamp(delta, -maxStep, maxStep);
      }
      const forward = fromAngle(this.angle);
      const rightVec = fromAngle(this.angle + Math.PI / 2);
      if (up) {
        thrustInput.x += forward.x;
        thrustInput.y += forward.y;
      }
      if (down) {
        thrustInput.x -= forward.x;
        thrustInput.y -= forward.y;
      }
      if (right) {
        thrustInput.x += rightVec.x;
        thrustInput.y += rightVec.y;
      }
      if (left) {
        thrustInput.x -= rightVec.x;
        thrustInput.y -= rightVec.y;
      }
    } else {
      if (up) thrustInput.y -= 1;
      if (down) thrustInput.y += 1;
      if (left) thrustInput.x -= 1;
      if (right) thrustInput.x += 1;
    }

    const mag = Math.hypot(thrustInput.x, thrustInput.y);
    // Fuel gates thrust entirely — out of fuel, thrust input does nothing at all (the ship keeps
    // whatever velocity it already had, drag still applies) rather than a soft slowdown. This is
    // the one deliberately harsh failure mode in the fuel/power system (fuel-power-spec.md
    // Section 4) — real stranding, the mechanical teeth behind "a trip out is an expedition."
    if (mag > 1e-6 && this.fuel > 0) {
      const norm = scale(thrustInput, 1 / mag);
      // Real F=ma — a loaded hold means a real force still only buys real acceleration, same
      // engine working harder for less. Empty (base mass), this is identical to a flat accel.
      const accel = this.thrustForce / this.mass;
      this.vel = add(this.vel, scale(norm, accel * dt));
      // Burn is keyed off thrustForce itself, not the resulting (mass-penalized) acceleration —
      // the engine pushes the same amount of reaction mass regardless of what the ship weighs,
      // so a loaded ship burns at the same rate as an empty one for the same throttle input; the
      // mass penalty already lives entirely on the acceleration side.
      this.fuel = Math.max(0, this.fuel - this.thrustForce * FUEL_BURN_PER_FORCE_SECOND * dt);
    }

    const drag = this.mode === "cruise" ? CRUISE_DRAG : this.rcsDrag;
    this.vel = scale(this.vel, Math.max(0, 1 - drag * dt));
    this.pos = add(this.pos, scale(this.vel, dt));
  }

  takeImpact(damage: number, source: DamageSource) {
    void source; // not consumed here — Engine uses it for per-cause messaging (e.g. heat)
    this.hull = clamp(this.hull - damage, 0, this.maxHull);
  }

  /** Net temperature change for one tick — rises with current thermal `exposure` (see
   *  `radiantHeatExposure`) while any exposure at all is present, cools passively only once
   *  exposure drops to exactly zero (i.e. fully outside the heat radius). Deliberately not a
   *  simultaneous rise-minus-decay: at realistic exposure levels the decay rate would dominate
   *  and temperature could never climb at all (an actual bug this replaced — decay was always
   *  subtracted, even mid-exposure, and always outweighed the rise). Purely a stat; the
   *  exposure-to-danger conversion (the warning threshold, the damage ramp) lives in Engine. */
  updateTemperature(exposure: number, dt: number) {
    const delta = exposure > 0 ? exposure * TEMPERATURE_RISE_PER_HEAT_UNIT : -this.temperatureDecayPerSec;
    this.temperature = clamp(this.temperature + delta * dt, 0, 100);
  }

  /** Takes up to `amount` of `composition`, limited by remaining *weight* room, not a flat item
   *  count — a dense material (Nickel-Iron) fills the hold faster per unit than a light one
   *  (Water Ice). Returns how much amount was actually taken, which can be less than requested
   *  (or 0) if there isn't enough weight room left; capped to whole units, since a fractional
   *  rock isn't a thing. */
  addCargo(composition: Composition, amount: number): number {
    const roomKg = this.cargoCapacity - this.cargoUsed;
    const maxAmountThatFits = Math.floor(roomKg / (COMPOSITION_INFO[composition].density * MATERIAL_WEIGHT_SCALE));
    const taken = Math.max(0, Math.min(amount, maxAmountThatFits));
    this.cargo[composition] += taken;
    return taken;
  }

  /** Empties the hold entirely, returning what was taken — e.g. to deposit at the hub, or
   *  lose on destruction. */
  clearCargo(): CargoHold {
    const taken = this.cargo;
    this.cargo = emptyCargo();
    return taken;
  }

  addSignature(amount: number) {
    this.signature = clamp(this.signature + amount, 0, 100);
  }

  decaySignature(dt: number, perSec: number) {
    this.signature = clamp(this.signature - perSec * dt, 0, 100);
  }
}
