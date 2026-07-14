import { InputState } from "./input";
import { CargoHold, DamageSource, Ship, emptyCargo } from "./ship";
import {
  Asteroid,
  AsteroidType,
  Cell,
  COMPOSITION_INFO,
  COMPOSITIONS,
  CrackSegment,
  cellWorldToLocal,
  chunkValueForArea,
  massForArea,
  massPerAreaFor,
  scanSecondsForRadius,
  sizeLabelForRadius,
} from "./asteroid";
import { BodyHandle } from "./body";
import { Chunk } from "./chunk";
import { Contact, ContactKind, ContactMemory } from "./contacts";
import { Explosion } from "./explosion";
import { GravitySource, gravityAccel, radiantHeatExposure, solarExposure } from "./gravity";
import { HoverTarget } from "./hover";
import { Hub } from "./hub";
import { weightedPick } from "./random";
import { RESEARCH, ResearchId } from "./research";
import { TOOLS, ToolId } from "./tools";
import { HubStatKey, REFINE_RECIPES, RefineRecipeId, ShipStatKey, UPGRADES, UpgradeId, canAfford } from "./upgrades";
import {
  BoundaryHit,
  boundingRadius,
  clampInsidePolygon,
  closestBoundaryPoint,
  closestPointOnPolygon,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  polygonMinDistance,
  polygonSecondMomentOfArea,
  sliceNearPoint,
} from "./poly";
import { Material, RigidRef, applyFriction, applyPointImpulse, combineMaterials, resolveContact } from "./physics";
import {
  ANGULAR_DAMPING,
  ASTEROID_SIZE_CLASSES,
  BATTERY_BASELINE_REGEN_PER_SEC,
  BATTERY_SOLAR_REGEN_MULT,
  BELT_ASTEROID_COUNT,
  BELT_DRIFT_CHANCE,
  BELT_DRIFT_SPEED,
  BELT_INNER_RADIUS,
  BELT_OUTER_RADIUS,
  BELT_SIZE_POOL,
  BELT_TINY_ROCK_COUNT,
  BLAST_VISUAL_DURATION,
  CELL_TOUCH_EPSILON,
  CHARGE_BLAST_DAMAGE_MAX,
  CHARGE_BLAST_PUSH_MAX,
  CHARGE_BLAST_RADIUS,
  CHARGE_CHUNK_PUSH_MAX,
  CHARGE_IMPULSE_PER_CHARGE,
  CHUNK_COLLECT_RADIUS,
  CHUNK_FRICTION,
  CHUNK_RESTITUTION,
  COLLISION_SUBSTEP_TRAVEL,
  DEATH_SCREEN_DURATION,
  DRIFT_DAMPING,
  DRILL_ANCHOR_RANGE,
  DRILL_FRACTURE_GENERATIONS,
  HOME_STAR_HEAT_INTENSITY,
  HOME_STAR_POS,
  HOME_STAR_PULL_RADIUS,
  HOME_STAR_PULL_STRENGTH,
  HOME_STAR_RADIUS,
  HOME_STAR_SOLAR_INTENSITY,
  HOME_STAR_SOLAR_RADIUS,
  HOVER_CHUNK_PADDING,
  LASER_CUT_DEPTH,
  MAP_CONTACT_FORGET_AFTER,
  MAP_SECTOR_SIZE,
  MAX_COLLISION_SUBSTEPS,
  MIN_CELL_AREA,
  NEAR_HUB_ROCK_COUNT,
  NEAR_HUB_ROCK_RADIUS,
  NORMAL_AREA_ASTEROID_COUNT,
  NORMAL_AREA_INNER_RADIUS,
  NORMAL_AREA_OUTER_RADIUS,
  NORMAL_AREA_SIZE_POOL,
  NORMAL_AREA_TINY_ROCK_COUNT,
  PASSIVE_PING_POWER_COST,
  PASSIVE_PING_RADIUS,
  PING_COOLDOWN,
  PING_POWER_COST,
  POSITION_CORRECTION_RATE,
  POWERLESS_VISION_RADIUS,
  REACTOR_DOCK_SOLAR_BOOST,
  ROCK_CONTACT_MIN_CLOSING_SPEED,
  ROCK_FRICTION,
  ROCK_RESTITUTION,
  SATELLITE_DEPLOY_COST,
  SATELLITE_VISION_RADIUS,
  SCAN_POWER_DRAW_PER_SEC,
  SCAN_PROGRESS_DECAY,
  SCAN_RANGE,
  SHIP_FRICTION,
  SHIP_RADIUS,
  SHIP_RESTITUTION,
  TEMPERATURE_MAX_DAMAGE_PER_SEC,
  VISION_POWER_DRAW_PER_SEC,
  TINY_ROCK_RADIUS,
  TOOL_OFF_MULT,
  TOOL_RECOMMENDED_MULT,
  COLLISION_DAMAGE_SCALE,
  COLLISION_MIN_SPEED,
} from "./constants";
import {
  Vec2,
  add,
  distance,
  dot,
  fromAngle,
  length,
  normalize,
  rotateAround,
  scale,
  sub,
  v2,
  velocityAtPoint,
} from "./vec2";

interface FlashMessage {
  text: string;
  timer: number;
  color: string;
}

/** A cluster of cells that mining has disconnected from the asteroid's main mass — a full 2D
 *  rigid body: linear velocity plus angular velocity about its own center of mass. `id` is
 *  stable across frames (carried over whenever recompute finds the same piece) so ping
 *  discovery and radar tracking survive a split instead of resetting. */
interface DriftGroup {
  id: number;
  cells: Cell[];
  vel: Vec2;
  angularVelocity: number;
}

/** A player-deployed fixed-position sensor source (map-radar-spec.md Section 6) — no physics, no
 *  drift, not mineable, just a point with a vision-style radius. `id` doubles as its Contact id. */
interface Satellite {
  id: string;
  pos: Vec2;
}

const TOOL_ORDER: ToolId[] = ["laser", "drill", "charges"];
const SPAWN_POS: Vec2 = v2(0, 0);
let nextGroupId = 1;
let nextSatelliteId = 1;
const SATELLITE_DEPLOY_COST_FULL: CargoHold = { ...emptyCargo(), ...SATELLITE_DEPLOY_COST };

// Each collidable kind's own material, defined once — see physics.ts's combineMaterials for
// how a pair's actual bounce/grip is derived from these rather than hand-tuned per pairing.
const SHIP_MATERIAL: Material = { restitution: SHIP_RESTITUTION, friction: SHIP_FRICTION };
const ROCK_MATERIAL: Material = { restitution: ROCK_RESTITUTION, friction: ROCK_FRICTION };
const CHUNK_MATERIAL: Material = { restitution: CHUNK_RESTITUTION, friction: CHUNK_FRICTION };

// Which asteroid type (see asteroid.ts's RESOURCE_WEIGHTS_BY_TYPE) a newly spawned body in a
// given zone is likely to be — twin-star-spec.md Section 17: normal space stays overwhelmingly
// S-type (safe, unremarkable), the belt ring is where real type variety — and therefore
// Platinum-Group Ore, Water Ice, and Radioactive Ore — actually becomes findable.
const NORMAL_AREA_TYPE_WEIGHTS: Record<AsteroidType, number> = { S: 0.85, C: 0.1, M: 0.03, Icy: 0.02 };
const BELT_TYPE_WEIGHTS: Record<AsteroidType, number> = { S: 0.45, C: 0.25, M: 0.2, Icy: 0.1 };

export class Engine {
  ship: Ship;
  asteroids: Asteroid[] = [];
  hub: Hub;
  chunks: Chunk[] = [];
  input: InputState;
  nearestAsteroid: Asteroid | null = null; // read by Renderer for scan-data HUD; updated every field frame
  // Localized gravity wells around specific big bodies (see gravity.ts) — the home star today,
  // a planet/moon/the far star just another entry here later. Read by Renderer for the
  // pull-radius warning ring.
  gravitySources: GravitySource[] = [];

  paused = false;
  // "field" is everything that exists today; "hub" is a distinct, much simpler screen — see
  // updateHub/updateDocking. Flagged as the next architectural seam in ARCHITECTURE.md before
  // this landed.
  scene: "field" | "hub" = "field";
  nearHub = false; // read by Renderer for the "[F] DOCK" prompt

  pingActive = false;
  pingRadius = 0;
  pingCooldown = 0;
  // Passive Ping (upgrades.ts) — an automatic, weaker sweep on its own timer, independent of the
  // manual Q ping above. Gated by ship.passivePingInterval > 0 (0 = not unlocked); see update().
  private passivePingTimer = 0;
  discoveredContacts = new Map<string, ContactMemory>(); // read by Renderer for radar blips
  // Fog of war (map-radar-spec.md) — coarse grid cells ("sx,sy" keys, MAP_SECTOR_SIZE each) any
  // sensor source has ever swept. Permanent once set — read by the hub's Map tab, not rendered
  // in the field at all (the map is hub-only, see markExplored's own doc comment).
  exploredSectors = new Set<string>();
  // Player-deployed fixed sensor sources (Observatory-gated) — see deploySatellite/sensorSources.
  satellites: Satellite[] = [];
  // A contact's *identity* (what it actually is), separate from just knowing it's out there —
  // only populated by real close-range vision, never by ping alone (see update()'s sensor
  // block), and never removed once set: having actually seen something isn't something you
  // forget just because you've since lost track of where it is.
  identifiedContacts = new Set<string>();
  // Discovery gate for ResearchDef.requiresScannedType (research.ts) — every AsteroidType ever
  // scanned, regardless of whether it was ever mined. Persists across death like identifiedContacts.
  scannedTypes = new Set<AsteroidType>();

  message: FlashMessage | null = null;
  private cargoFullMessageCooldown = 0;
  // A dedicated overlay for "you died," separate from the transient flash-message system —
  // read by Renderer, auto-dismisses on its own timer rather than needing a keypress (death
  // costs a run's haul, not the session, per spec — it shouldn't feel like a hard stop).
  deathScreen: { cause: string; cargoLost: number; timer: number } | null = null;

  activeBeam: { from: Vec2; to: Vec2; tool: ToolId } | null = null;
  currentTarget: Cell | null = null; // tool-specific: range/mode-gated, drives actual mining behavior
  hoverTarget: HoverTarget | null = null; // generic: whatever's under the cursor, any mode, any tool — see hover.ts
  blastEffects: { pos: Vec2; timer: number }[] = []; // read by Renderer for the shockwave visual
  private anchoredCell: Cell | null = null;
  private driftGroups: DriftGroup[] = [];
  // Once two originally-adjacent cells are geometrically confirmed to no longer touch, that
  // connection is gone for good — material doesn't re-fuse just because geometry (e.g. from
  // rotation) happens to bring it back within tolerance a frame later. Without this, a gap
  // sitting near the touch threshold can flicker connected/disconnected forever.
  private severedEdges = new Set<string>();
  // Rebuilt every recomputeDriftGroups call — O(1) lookup for driftGroupOf instead of a linear
  // scan over every group's cells on every call.
  private cellGroupMap = new Map<number, DriftGroup>();
  // Recomputed once per frame (see computeDriftGroupBounds) — shared by resolveGroupCollisions
  // and getContacts so both read the same center-of-mass/bounding-radius work instead of each
  // independently recomputing it.
  private driftGroupBounds: { group: DriftGroup; com: Vec2; radius: number }[] = [];

  private width = 0;
  private height = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.input = new InputState(canvas);
    this.ship = new Ship(SPAWN_POS);
    this.hub = new Hub({ ...SPAWN_POS });
    this.asteroids = this.scatterSystem();
    this.gravitySources = [
      {
        id: "home-star",
        kind: "star",
        pos: HOME_STAR_POS,
        radius: HOME_STAR_RADIUS,
        pullRadius: HOME_STAR_PULL_RADIUS,
        pullStrength: HOME_STAR_PULL_STRENGTH,
        lethal: true,
        // Shares the pull radius — if you're being pulled in, you're already in the heat too.
        heatRadius: HOME_STAR_PULL_RADIUS,
        heatIntensity: HOME_STAR_HEAT_INTENSITY,
        // Deliberately a much bigger radius than the pull/heat above — see gravity.ts's
        // GravitySource doc comment and fuel-power-spec.md: sunlight is useful far past any
        // hazard the star itself poses.
        solarRadius: HOME_STAR_SOLAR_RADIUS,
        solarIntensity: HOME_STAR_SOLAR_INTENSITY,
      },
    ];
  }

  /** Scatters every procedural asteroid in the system — three distinct populations, not one
   *  homogeneous scatter (see constants.ts for the reasoning behind each):
   *  - **The belt**: a real ring around the *star* (`BELT_INNER_RADIUS`/`BELT_OUTER_RADIUS`),
   *    dense, skewed toward its own larger size classes — the landmark you travel to reach.
   *  - **Normal space**: also star-anchored, filling the gap between the safe zone and the
   *    belt's inner edge — moderate density, skewed toward smaller classes, so there's real
   *    reason to mine on the way out without competing with the belt as the destination.
   *  - **Near-hub boulders**: still hub-relative (unlike the other two) — a small guaranteed
   *    population right outside the hub regardless of where the belt/normal-area randomness
   *    happens to land, so undocking never means "immediately nothing to do."
   *  All three place bodies uniformly across their own distance band (no inner-edge bias) — the
   *  earlier hub-wide annulus needed that bias to taper across a single huge span; three
   *  separate, deliberately-sized bands don't. */
  private scatterSystem(): Asteroid[] {
    const asteroids: Asteroid[] = [];
    const beltRange = { min: BELT_INNER_RADIUS, max: BELT_OUTER_RADIUS };
    const normalRange = { min: NORMAL_AREA_INNER_RADIUS, max: NORMAL_AREA_OUTER_RADIUS };

    for (let i = 0; i < BELT_ASTEROID_COUNT; i++) {
      const sizeClass = ASTEROID_SIZE_CLASSES[BELT_SIZE_POOL[Math.floor(Math.random() * BELT_SIZE_POOL.length)]];
      asteroids.push(
        this.spawnSystemBody(sizeClass.min, sizeClass.max, {
          origin: HOME_STAR_POS,
          distRange: beltRange,
          typeWeights: BELT_TYPE_WEIGHTS,
        }),
      );
    }
    for (let i = 0; i < BELT_TINY_ROCK_COUNT; i++) {
      asteroids.push(
        this.spawnSystemBody(TINY_ROCK_RADIUS.min, TINY_ROCK_RADIUS.max, {
          seedCount: 1,
          origin: HOME_STAR_POS,
          distRange: beltRange,
          typeWeights: BELT_TYPE_WEIGHTS,
        }),
      );
    }

    for (let i = 0; i < NORMAL_AREA_ASTEROID_COUNT; i++) {
      const sizeClass =
        ASTEROID_SIZE_CLASSES[NORMAL_AREA_SIZE_POOL[Math.floor(Math.random() * NORMAL_AREA_SIZE_POOL.length)]];
      asteroids.push(
        this.spawnSystemBody(sizeClass.min, sizeClass.max, {
          origin: HOME_STAR_POS,
          distRange: normalRange,
          typeWeights: NORMAL_AREA_TYPE_WEIGHTS,
        }),
      );
    }
    for (let i = 0; i < NORMAL_AREA_TINY_ROCK_COUNT; i++) {
      asteroids.push(
        this.spawnSystemBody(TINY_ROCK_RADIUS.min, TINY_ROCK_RADIUS.max, {
          seedCount: 1,
          origin: HOME_STAR_POS,
          distRange: normalRange,
          typeWeights: NORMAL_AREA_TYPE_WEIGHTS,
        }),
      );
    }

    for (let i = 0; i < NEAR_HUB_ROCK_COUNT; i++) {
      asteroids.push(
        this.spawnSystemBody(TINY_ROCK_RADIUS.min, TINY_ROCK_RADIUS.max, {
          seedCount: 1,
          origin: this.hub.pos,
          distRange: NEAR_HUB_ROCK_RADIUS,
          typeWeights: NORMAL_AREA_TYPE_WEIGHTS,
        }),
      );
    }
    return asteroids;
  }

  private spawnSystemBody(
    minRadius: number,
    maxRadius: number,
    options: {
      seedCount?: number;
      distRange: { min: number; max: number };
      origin: Vec2;
      typeWeights: Record<AsteroidType, number>;
    },
  ): Asteroid {
    const angle = Math.random() * Math.PI * 2;
    const dist = options.distRange.min + Math.random() * (options.distRange.max - options.distRange.min);
    const center = add(options.origin, fromAngle(angle, dist));

    const radius = minRadius + Math.random() * (maxRadius - minRadius);
    const type = weightedPick(options.typeWeights, Math.random());

    // Most bodies start fully at rest — a fraction get a small initial drift instead, just
    // enough that the field doesn't read as a frozen diagram.
    const initialVelocity =
      Math.random() < BELT_DRIFT_CHANCE
        ? fromAngle(Math.random() * Math.PI * 2, BELT_DRIFT_SPEED.min + Math.random() * (BELT_DRIFT_SPEED.max - BELT_DRIFT_SPEED.min))
        : undefined;

    return new Asteroid(center, Math.random, { radius, type, seedCount: options.seedCount, initialVelocity });
  }

  dispose() {
    this.input.dispose();
  }

  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  /** Public: Renderer also needs this for reticle/targeting math. */
  screenToWorld(screen: Vec2): Vec2 {
    return add(sub(screen, v2(this.width / 2, this.height / 2)), this.ship.pos);
  }

  private setMessage(text: string, color = "#e8e8e8") {
    this.message = { text, timer: 2, color };
  }

  update(dtRaw: number) {
    const dt = Math.min(dtRaw, 1 / 20);
    const { input } = this;

    if (input.wasJustPressed("escape") || input.wasJustPressed("p")) {
      this.paused = !this.paused;
    }
    if (this.paused) {
      input.endFrame();
      return;
    }

    // Research (research.ts) ticks regardless of scene — "meanwhile, back at the hub" is the
    // whole point (twin-star-spec.md Section 9's long-flagged passive layer), not something
    // that only progresses while docked and staring at it.
    this.updateResearch(dt);

    if (this.scene === "hub") {
      this.updateHub(dt);
      input.endFrame();
      return;
    }

    const { ship } = this;

    if (input.wasJustPressed(" ")) ship.toggleMode();
    if (input.wasJustPressed("tab")) this.cycleTool();
    // DEV-ONLY — see debugMaxHub's own doc comment. Bound here (field scene) rather than the hub
    // screen since the actual payoff (the grown ring + facility modules) only renders out in the
    // field, looking at the hub from outside.
    if (input.wasJustPressed("0")) this.debugMaxHub();

    // Move every rock body first, so collision this frame resolves against
    // where it actually is now rather than lagging a frame behind. Rock-vs-rock
    // contacts are settled before the ship reacts to the resulting positions.
    this.recomputeDriftGroups();
    this.updateDriftGroups(dt);
    this.destroyGroupsInLethalContact();
    // Computed once here — cell positions are settled for the rest of this frame (nothing after
    // this moves them again until next frame's updateDriftGroups), so both resolveGroupCollisions
    // and getContacts (in the sensor block below) can share this instead of each recomputing
    // every group's center of mass and bounding radius independently.
    this.computeDriftGroupBounds();
    this.resolveGroupCollisions(dt);

    // Substepped so a fast frame (cruise top speed, or right after a hard hit) can't skip
    // clean over thin geometry — a freshly laser-cut sliver is easily thinner than one frame's
    // travel at speed. Costs nothing extra when moving slowly (see substepsFor).
    const shipSteps = this.substepsFor(length(ship.vel), dt);
    const shipSubDt = dt / shipSteps;
    for (let s = 0; s < shipSteps; s++) {
      this.applyGravityTo(ship, shipSubDt, ship.gravityResistMult);
      const stepMouse = this.screenToWorld(input.mouseScreen);
      ship.updateMovement(shipSubDt, input, stepMouse);
      if (this.lethalGravityContact(ship.pos)) {
        this.handleShipDestroyed("PULLED INTO THE STAR");
        break;
      }

      // Heat is a two-stage threat from the same wells: exposure always raises temperature (a
      // visible warning — see Ship.temperature), but only once temperature crosses
      // ship.temperatureDamageThreshold (upgradable — Heat Shield) does it actually start
      // costing hull, escalating toward TEMPERATURE_MAX_DAMAGE_PER_SEC at full overheat.
      // Touching the surface is still unconditionally instant death regardless of temperature —
      // this is a separate, gentler threat for lingering nearby, not a replacement for it.
      const exposure = this.totalRadiantHeatExposure(ship.pos);
      const wasOverheating = ship.temperature > ship.temperatureDamageThreshold;
      ship.updateTemperature(exposure, shipSubDt);
      if (ship.temperature > ship.temperatureDamageThreshold) {
        if (!wasOverheating) this.setMessage("HULL TEMPERATURE CRITICAL", "#ff8f6b");
        const overheatFrac =
          (ship.temperature - ship.temperatureDamageThreshold) / (100 - ship.temperatureDamageThreshold);
        ship.takeImpact(overheatFrac * TEMPERATURE_MAX_DAMAGE_PER_SEC * shipSubDt, "heat");
        if (ship.hull <= 0) {
          this.handleShipDestroyed("BURNED UP");
          break;
        }
      }

      const result = this.resolveBodyVsRock(this.shipBody(), shipSubDt);
      if (result) this.reactToCollision(result.kind, "rock", result.closingSpeed);
    }

    const worldMouse = this.screenToWorld(input.mouseScreen);

    this.updateDocking();

    // Cursor highlighting is informational only — unlike tool targeting (currentTarget,
    // set in updateMining) it doesn't care what's selected or which mode the ship is in.
    this.hoverTarget = this.computeHoverTarget(worldMouse);

    // --- sensors: ping + passive close-range detection ---
    // Both sweep the *current* contact list, so a piece that's drifted away after a
    // split still gets found — nothing is hardcoded to "the one asteroid" anymore.
    // What's "discovered" is a snapshot, not a live link: it ages and is eventually
    // forgotten if nothing refreshes it, so radar reflects what you actually know.
    this.pingCooldown = Math.max(0, this.pingCooldown - dt);
    if (input.wasJustPressed("q") && this.pingCooldown <= 0 && ship.powered) {
      this.pingActive = true;
      this.pingRadius = 0;
      this.pingCooldown = PING_COOLDOWN;
      ship.applyPowerDelta(-PING_POWER_COST * ship.powerDrawMult);
    }
    const contacts = this.getContacts();
    for (const memory of this.discoveredContacts.values()) memory.age += dt;

    // Home itself is the one exception — never "discovered," you always know where the hub is,
    // unlike everything else on radar (including the star and every other gravity source,
    // which now go through the normal ping/vision discovery below like any other contact).
    // Refreshed every frame so it never goes stale/forgotten the way a real discovery does.
    const hubContact = this.hubContact();
    this.discoveredContacts.set(hubContact.id, { contact: hubContact, age: 0 });
    // Satellites are the same "you don't have to find it, you put it there" case as the hub —
    // always known, never subject to the forget loop below. Identity is handled the same way
    // the hub's is too: Renderer/GameCanvas special-case `kind === "satellite"` as always
    // identified, rather than this loop also stuffing it into identifiedContacts redundantly.
    for (const sat of this.satellites) {
      const satContact = this.satelliteContact(sat);
      this.discoveredContacts.set(satContact.id, { contact: satContact, age: 0 });
    }

    if (this.pingActive) {
      this.pingRadius += ship.pingSpeed * dt;
      let newlyDetected = 0;
      for (const contact of contacts) {
        const surfaceDist = distance(ship.pos, contact.pos) - contact.radius;
        if (this.pingRadius >= surfaceDist) {
          if (!this.discoveredContacts.has(contact.id)) newlyDetected++;
          this.discoveredContacts.set(contact.id, { contact, age: 0 });
        }
      }
      if (newlyDetected > 0) {
        this.setMessage(
          newlyDetected > 1 ? `${newlyDetected} CONTACTS DETECTED` : "CONTACT DETECTED",
          "#7fe0ff",
        );
      }
      if (this.pingRadius > ship.pingMaxRadius) this.pingActive = false;
    }
    // Passive Ping (map-radar-spec.md Section 5) — an automatic, weaker sweep on its own timer,
    // independent of the manual ping above. ship.passivePingInterval is 0 until Passive Ping
    // Array is bought, so this is a no-op for most of the game. Unlike manual ping, this is an
    // instant reveal (no expanding-wave visual) rather than a second animated ring to render.
    // Gated by ship.powered and costs battery on each pulse, same as manual ping — it's still an
    // active sensor sweep, "automatic" doesn't mean "free," and it shouldn't keep working at full
    // strength while every other active system has gone dark. The timer keeps accumulating even
    // while unpowered (deliberately not paused/reset) — the sensor was ready, just starved; once
    // power returns it fires on whatever's left of its cycle rather than restarting from zero.
    if (ship.passivePingInterval > 0) {
      this.passivePingTimer += dt;
      if (this.passivePingTimer >= ship.passivePingInterval && ship.powered) {
        this.passivePingTimer = 0;
        ship.applyPowerDelta(-PASSIVE_PING_POWER_COST * ship.powerDrawMult);
        for (const contact of contacts) {
          const surfaceDist = distance(ship.pos, contact.pos) - contact.radius;
          if (surfaceDist <= PASSIVE_PING_RADIUS) {
            this.discoveredContacts.set(contact.id, { contact, age: 0 });
          }
        }
      }
    }
    // Passive close-range detection — generalized over every sensor source (ship vision, hub
    // beacon, every deployed satellite) rather than one hand-written loop per kind (map-radar-spec.md
    // Section 5) — a future sensor kind is one more entry in sensorSources(), not a new loop here.
    // Also feeds fog-of-war: anywhere any of these has swept is permanently "explored" for the
    // hub's Map tab, regardless of whether anything was actually there to detect.
    const sensors = this.sensorSources();
    for (const source of sensors) {
      for (const contact of contacts) {
        if (distance(source.pos, contact.pos) - contact.radius < source.radius) {
          this.discoveredContacts.set(contact.id, { contact, age: 0 });
        }
      }
    }
    this.markExplored(sensors);
    // Identification is different — it means having actually seen the thing with your own eyes,
    // so unlike passive detection above it requires it to genuinely be on the ship's screen right
    // now, not just within an abstract sensor radius (any sensor's radius can exceed half the
    // viewport, and a beacon/satellite sighting isn't the ship actually looking at it).
    const camOffset = sub(ship.pos, v2(this.width / 2, this.height / 2));
    for (const contact of contacts) {
      const screenPos = sub(contact.pos, camOffset);
      const onScreen =
        screenPos.x + contact.radius >= 0 &&
        screenPos.x - contact.radius <= this.width &&
        screenPos.y + contact.radius >= 0 &&
        screenPos.y - contact.radius <= this.height;
      if (onScreen) this.identifiedContacts.add(contact.id);
    }
    // Forgotten for either of two reasons: the thing itself no longer exists at all (mined out,
    // destroyed — getContacts() always lists every rock body currently alive anywhere in the
    // world, not just nearby ones, so "not in this frame's contacts" reliably means gone), or the
    // memory of it has simply outlived the hub map's own much longer staleness window
    // (MAP_CONTACT_FORGET_AFTER — see constants.ts). There's deliberately no ship-distance cutoff
    // here anymore: that's now a tactical-radar-only display concern (Renderer.renderRadarIndicator,
    // CONTACT_MAX_RANGE), not a memory one — the hub Map tab is exactly the place a contact seen
    // far away and long since left behind is still meant to be useful, dimmed as stale. The hub
    // and every satellite are exempt from this entirely, same as before.
    const liveContactIds = new Set(contacts.map((c) => c.id));
    for (const [id, memory] of this.discoveredContacts) {
      if (id === hubContact.id || id.startsWith("satellite-")) continue;
      const gone = !liveContactIds.has(id);
      if (gone || memory.age > MAP_CONTACT_FORGET_AFTER) this.discoveredContacts.delete(id);
    }

    // --- power: battery regen (baseline + solar, boosted near the hub once Reactor is built)
    // and the passive vision draw — every other draw (ping above; scan, tools below) happens at
    // its own call site instead of being centralized here, same reasoning tool signature cost
    // already uses (the cost lives with what causes it, not a hand-matched central list).
    const solarRegen = this.totalSolarExposure(ship.pos) * BATTERY_SOLAR_REGEN_MULT * ship.solarRegenMult;
    const reactorBoost = this.nearHub && this.hub.reactorBuilt ? REACTOR_DOCK_SOLAR_BOOST : 0;
    ship.applyPowerDelta((BATTERY_BASELINE_REGEN_PER_SEC + solarRegen + reactorBoost) * dt);
    ship.applyPowerDelta(-VISION_POWER_DRAW_PER_SEC * ship.powerDrawMult * dt);

    // --- scan: hold E in range while a wave sweeps outward from the nearest asteroid ---
    // With a whole belt instead of one rock, "the asteroid" becomes "whichever one you're
    // actually near" — nearestAsteroid also drives the SCAN DATA HUD panel (see Renderer).
    this.nearestAsteroid = this.findNearestAsteroid(ship.pos);
    const scanTarget = this.nearestAsteroid;
    if (scanTarget && !scanTarget.scanned) {
      const surfaceDist = distance(ship.pos, scanTarget.center) - scanTarget.outerRadius;
      const canScan = surfaceDist <= SCAN_RANGE;
      if (canScan && input.isDown("e") && ship.powered) {
        const scanSeconds = scanSecondsForRadius(scanTarget.outerRadius) * ship.scanSpeedMult;
        scanTarget.scanProgress = Math.min(1, scanTarget.scanProgress + dt / scanSeconds);
        ship.applyPowerDelta(-SCAN_POWER_DRAW_PER_SEC * ship.powerDrawMult * dt);
        if (scanTarget.scanProgress >= 1) {
          scanTarget.scanned = true;
          this.scannedTypes.add(scanTarget.type);
          this.setMessage("ASTEROID SCANNED — see SCAN DATA panel", "#7fe0ff");
        }
      } else {
        scanTarget.scanProgress = Math.max(0, scanTarget.scanProgress - dt * SCAN_PROGRESS_DECAY);
      }
    }

    // --- tool selection (direct) ---
    if (input.wasJustPressed("1")) ship.selectedTool = "laser";
    if (input.wasJustPressed("2")) ship.selectedTool = "drill";
    if (input.wasJustPressed("3")) ship.selectedTool = "charges";

    if (input.wasJustPressed("g")) this.deploySatellite();

    this.activeBeam = null;
    this.updateMining(dt, worldMouse);

    ship.decaySignature(dt, ship.signatureDecayPerSec);

    this.blastEffects = this.blastEffects.filter((b) => {
      b.timer -= dt;
      return b.timer > 0;
    });

    // --- chunks ---
    this.cargoFullMessageCooldown = Math.max(0, this.cargoFullMessageCooldown - dt);

    // Same tunneling insurance as the ship — a chunk ejected point-blank from an extraction
    // starts touching the rock it just left and can be moving fast enough to skip past it in
    // a single frame otherwise.
    let fastestChunk = 0;
    for (const chunk of this.chunks) fastestChunk = Math.max(fastestChunk, length(chunk.vel));
    const chunkSteps = this.substepsFor(fastestChunk, dt);
    const chunkSubDt = dt / chunkSteps;
    for (let s = 0; s < chunkSteps; s++) {
      for (const chunk of this.chunks) {
        this.applyGravityTo(chunk, chunkSubDt);
        chunk.update(chunkSubDt);
      }
      for (const chunk of this.chunks) {
        const result = this.resolveBodyVsRock(this.chunkBody(chunk), chunkSubDt);
        if (result) this.reactToCollision(result.kind, "rock", result.closingSpeed);
      }
    }
    this.resolveCircleCollisions(dt); // chunk-chunk + chunk-ship, one generic sweep

    this.chunks = this.chunks.filter((chunk) => {
      if (this.lethalGravityContact(chunk.pos)) return false; // drifted into a lethal body — lost

      const d = distance(chunk.pos, ship.pos);
      if (d < SHIP_RADIUS + CHUNK_COLLECT_RADIUS) {
        if (!ship.cargoFull) {
          const taken = ship.addCargo(chunk.composition, chunk.value);
          if (taken > 0) {
            this.setMessage(
              `+${taken} ${COMPOSITION_INFO[chunk.composition].label}`,
              COMPOSITION_INFO[chunk.composition].color,
            );
            return false;
          }
        } else if (this.cargoFullMessageCooldown <= 0) {
          this.setMessage("CARGO FULL", "#ffcf5c");
          this.cargoFullMessageCooldown = 1.5;
        }
      }
      return true;
    });

    if (this.message) {
      this.message.timer -= dt;
      if (this.message.timer <= 0) this.message = null;
    }
    if (this.deathScreen) {
      this.deathScreen.timer -= dt;
      if (this.deathScreen.timer <= 0) this.deathScreen = null;
    }

    if (ship.hull <= 0) this.handleShipDestroyed();

    input.endFrame();
  }

  private cycleTool() {
    const idx = TOOL_ORDER.indexOf(this.ship.selectedTool);
    this.ship.selectedTool = TOOL_ORDER[(idx + 1) % TOOL_ORDER.length];
  }

  /** `cause` lets whatever killed the ship say so (e.g. gravity) instead of a generic message —
   *  DamageSource already tags *why* a hit happened; this is the same idea for the death screen. */
  private handleShipDestroyed(cause = "SHIP DESTROYED") {
    const lost = this.ship.cargoUsed;
    this.ship.clearCargo();
    this.ship.hull = this.ship.maxHull;
    this.ship.temperature = 0;
    this.ship.fuel = this.ship.fuelCapacity;
    this.ship.battery = this.ship.batteryCapacity;
    this.ship.pos = { ...SPAWN_POS };
    this.ship.vel = v2(0, 0);
    this.ship.chargesCarried = this.ship.chargeMaxCarried;
    this.ship.anchored = false;
    this.anchoredCell = null;
    this.chunks = [];
    // Radar reflects what you currently know, not a permanent record — respawning back at the
    // hub with zero sensor contact on anything out in the field should read that way, not carry
    // over blips from wherever the ship just died. The hub itself needs no special-casing here:
    // it's refreshed unconditionally every frame regardless of this map's contents (see update()).
    this.discoveredContacts.clear();
    // Death can happen mid-frame, while a ping is still expanding (the ship movement substep
    // loop that can trigger this runs before the sensor block later in the same frame) — an
    // in-flight ping has to be cancelled here too, not just the memory above. Otherwise it keeps
    // sweeping this same frame from the *new*, teleported position with whatever radius it had
    // already grown to, which can easily "reach" something (the star, if that's what you just
    // died to) that was never actually pinged from the hub — instantly undoing the clear above.
    this.pingActive = false;
    this.pingRadius = 0;
    this.deathScreen = { cause, cargoLost: lost, timer: DEATH_SCREEN_DURATION };
  }

  /** Applies every gravity source's pull to any mover with a position/velocity — the ship, a
   *  chunk, or a drift group's own center of mass (see updateDriftGroups), all through this one
   *  path. Still not real orbital mechanics for the whole belt (no per-body orbit is computed
   *  or maintained) — bodies simply feel the same local pull everything else does, and mostly
   *  never get close enough to a well to notice, since the belt's inner edge sits outside the
   *  home star's pull radius entirely. `resistMult` defaults to 1 (full pull) for everything —
   *  only the ship ever passes something else, via Inertial Dampeners (upgrades.ts); rock/chunks
   *  always feel the real thing regardless of what the ship has bought. */
  private applyGravityTo(mover: { pos: Vec2; vel: Vec2 }, dt: number, resistMult = 1) {
    for (const source of this.gravitySources) {
      const accel = gravityAccel(source, mover.pos);
      mover.vel = add(mover.vel, scale(accel, dt * resistMult));
    }
  }

  /** Whether `pos` has crossed into a lethal gravity source's physical surface — the pull alone
   *  doesn't hurt you, touching what's pulling you does. */
  private lethalGravityContact(pos: Vec2): boolean {
    return this.gravitySources.some((source) => source.lethal && distance(pos, source.pos) <= source.radius);
  }

  /** A drift group that's fallen into a lethal body is simply consumed — every cell in it is
   *  marked fractured (same as a normal extraction) but with no `spawnChunk` call, so nothing
   *  drops. `recomputeDriftGroups` picks up the now-all-fractured group as gone on its own next
   *  frame, the same way it already handles any other cell being fractured. */
  private destroyGroupsInLethalContact() {
    for (const group of this.driftGroups) {
      const doomed = group.cells.some((cell) => this.lethalGravityContact(cell.centroid));
      if (!doomed) continue;
      for (const cell of group.cells) {
        cell.fractured = true;
        cell.hasCharge = false;
      }
    }
  }

  /** Summed thermal exposure from every gravity source at `pos` — more than one overlapping
   *  well (a future close binary, say) just adds up. Feeds Ship.temperature, not hull damage
   *  directly — see the ship substep loop for the warning-then-damage conversion. */
  private totalRadiantHeatExposure(pos: Vec2): number {
    let total = 0;
    for (const source of this.gravitySources) total += radiantHeatExposure(source, pos);
    return total;
  }

  /** Summed solar exposure from every gravity source at `pos` — same shape as
   *  totalRadiantHeatExposure above, but feeds Ship.battery regen (see update()'s power block),
   *  not hull/temperature. Deliberately a separate total: a source can radiate one without the
   *  other (see gravity.ts's GravitySource doc comment). */
  private totalSolarExposure(pos: Vec2): number {
    let total = 0;
    for (const source of this.gravitySources) total += solarExposure(source, pos);
    return total;
  }

  /** The hub as a radar Contact — used to keep it permanently "known" (see the discovery
   *  refresh in update()), not run through the normal ping/vision discovery gates everything
   *  else on radar goes through. You always know where home is. */
  private hubContact(): Contact {
    // hub.radius, not the flat HUB_RADIUS constant — a more built-up hub (hub-growth-spec.md) is
    // genuinely bigger and easier to spot, the same "grown footprint" the renderer draws.
    return { id: "hub", kind: "hub", pos: this.hub.pos, radius: this.hub.radius, label: "Home Hub" };
  }

  /** A deployed satellite as a radar Contact — same "always known" treatment as the hub (see
   *  update()), not something you have to find. */
  private satelliteContact(sat: Satellite): Contact {
    return { id: sat.id, kind: "satellite", pos: sat.pos, radius: 20, label: "Satellite" };
  }

  /** Every currently-active passive sensor — ship vision, hub beacon (if built), every deployed
   *  satellite — as one generic list (map-radar-spec.md Section 5), so both passive contact
   *  discovery and fog-of-war exploration (markExplored below) read the same source of truth
   *  instead of each hand-listing "ship, hub, satellites" separately. A future sensor kind is one
   *  more entry pushed here, not a new loop at either call site. Ship vision drops to
   *  POWERLESS_VISION_RADIUS while the battery is empty — blind, not eyes-closed; the hub beacon
   *  and any satellite are unaffected by the *ship's* power state, they run on their own. */
  private sensorSources(): { pos: Vec2; radius: number }[] {
    const sources = [{ pos: this.ship.pos, radius: this.ship.powered ? this.ship.visionRadius : POWERLESS_VISION_RADIUS }];
    if (this.hub.beaconRange > 0) sources.push({ pos: this.hub.pos, radius: this.hub.beaconRange });
    for (const sat of this.satellites) sources.push({ pos: sat.pos, radius: SATELLITE_VISION_RADIUS });
    return sources;
  }

  /** Marks every fog-of-war sector any sensor source currently reaches as permanently explored
   *  (map-radar-spec.md Section 3) — coarse grid, not per-pixel, and cheap: every sensor radius
   *  today is small relative to MAP_SECTOR_SIZE, so this touches only a handful of sectors per
   *  source per frame. Only read by the hub's Map tab — the field itself never renders fog, the
   *  map is a hub-only screen (deliberately, so it reads as a chart you consult between
   *  expeditions rather than a HUD element). */
  private markExplored(sensors: { pos: Vec2; radius: number }[]) {
    for (const source of sensors) {
      const minSx = Math.floor((source.pos.x - source.radius) / MAP_SECTOR_SIZE);
      const maxSx = Math.floor((source.pos.x + source.radius) / MAP_SECTOR_SIZE);
      const minSy = Math.floor((source.pos.y - source.radius) / MAP_SECTOR_SIZE);
      const maxSy = Math.floor((source.pos.y + source.radius) / MAP_SECTOR_SIZE);
      for (let sx = minSx; sx <= maxSx; sx++) {
        for (let sy = minSy; sy <= maxSy; sy++) {
          const cx = (sx + 0.5) * MAP_SECTOR_SIZE;
          const cy = (sy + 0.5) * MAP_SECTOR_SIZE;
          // Generous margin (a full sector) so a source near a sector's edge doesn't leave an
          // obviously-in-range neighbor unmarked just because its *center* is a bit further off.
          if (distance(v2(cx, cy), source.pos) <= source.radius + MAP_SECTOR_SIZE * 0.7) {
            this.exploredSectors.add(`${sx},${sy}`);
          }
        }
      }
    }
  }

  /** Bound to a field-only key (G) in update(), not called from anywhere outside this class —
   *  unlike purchaseUpgrade/startResearch (which the hub's DOM overlay calls directly), so this
   *  stays private. Deploys a satellite at the ship's current position — a real, costed decision
   *  (materials spent from the ship's own cargo, not hub storage, since this happens out in the
   *  field) capped by Hub.satelliteCap so "carpet the belt in them" isn't the answer
   *  (map-radar-spec.md Section 6/7). */
  private deploySatellite(): boolean {
    if (this.scene !== "field") return false;
    const { ship, hub } = this;
    if (!hub.observatoryBuilt) {
      this.setMessage("OBSERVATORY REQUIRED", "#ff8f6b");
      return false;
    }
    if (this.satellites.length >= hub.satelliteCap) {
      this.setMessage("SATELLITE CAP REACHED", "#ff8f6b");
      return false;
    }
    if (!canAfford(ship.cargo, SATELLITE_DEPLOY_COST_FULL)) {
      this.setMessage("NOT ENOUGH MATERIALS", "#ff8f6b");
      return false;
    }
    for (const key of COMPOSITIONS) ship.cargo[key] -= SATELLITE_DEPLOY_COST_FULL[key];
    this.satellites.push({ id: `satellite-${nextSatelliteId++}`, pos: { ...ship.pos } });
    this.setMessage("SATELLITE DEPLOYED", "#7de08d");
    return true;
  }

  /** A gravity source (the star today) as a radar Contact — goes through the normal ping/vision
   *  discovery gate in `getContacts()` like any other contact, not the hub's always-known
   *  treatment; a landmark being fixed in place doesn't mean you already know it's there.
   *  `kind` is cast since `GravitySource` intentionally keeps its own `kind` as a free-form
   *  string (nothing else about gravity cares what it's labeled) while `ContactKind` is a
   *  closed union radar rendering switches on. */
  private gravitySourceContact(source: GravitySource): Contact {
    return {
      id: source.id,
      kind: source.kind as ContactKind,
      pos: source.pos,
      radius: source.radius,
      label: source.kind === "star" ? "Home Star" : source.kind,
    };
  }

  /** Checked every frame while in the field — docking is a deliberate action (press F in
   *  range), not automatic, so drifting near the hub mid-expedition doesn't interrupt anything. */
  private updateDocking() {
    const { ship, hub, input } = this;
    this.nearHub = distance(ship.pos, hub.pos) <= hub.dockRange;
    if (this.nearHub && input.wasJustPressed("f")) {
      const deposited = ship.clearCargo();
      hub.deposit(deposited);
      this.scene = "hub";
      // Repair Bay (upgrades.ts) — before this existed, hull only ever reset on death.
      if (hub.repairOnDock) ship.hull = ship.maxHull;
      // Fuel/battery refill unconditionally on dock — unlike hull repair (an upgrade-gated
      // convenience), refueling is baseline: fuel-power-spec.md Section 2 treats "refills only
      // at dock" as fuel's basic rule, not something you have to earn.
      ship.fuel = ship.fuelCapacity;
      ship.battery = ship.batteryCapacity;
      this.setMessage("DOCKED", "#7de08d");
    }
  }

  /** The hub screen is deliberately much simpler than the field update — no physics, no
   *  mining, nothing at risk. Just launch back out when ready. */
  private updateHub(dt: number) {
    if (this.input.wasJustPressed("f")) this.launchFromHub();
    if (this.message) {
      this.message.timer -= dt;
      if (this.message.timer <= 0) this.message = null;
    }
  }

  /** Public: the hub's DOM overlay (see HubOverlay.tsx) calls this directly from a button —
   *  it isn't reachable through canvas input at all, so it needs its own entry point rather
   *  than piggybacking on a keypress the way docking does. */
  launchFromHub() {
    if (this.scene !== "hub") return;
    this.scene = "field";
    this.setMessage("LAUNCHED", "#7fe0ff");
  }

  /** Public: called from the hub's DOM overlay. Spends materials exactly (no currency, no
   *  partial refunds) — debited generically over every resource key (COMPOSITIONS), then hands
   *  off to applyUpgradeEffects for the actual stat/flag dispatch, shared with debugMaxHub below
   *  so the two paths can never drift apart. A `requiresResearch` upgrade can't be bought until
   *  the gating project is in `hub.completedResearch`. */
  purchaseUpgrade(id: UpgradeId): boolean {
    if (this.scene !== "hub") return false;
    const { hub } = this;
    if (hub.purchasedUpgrades.has(id)) return false;

    const def = UPGRADES[id];
    if (def.requiresResearch && !hub.completedResearch.has(def.requiresResearch)) {
      this.setMessage("RESEARCH REQUIRED", "#ff8f6b");
      return false;
    }
    if (!canAfford(hub.materials, def.cost)) {
      this.setMessage("NOT ENOUGH MATERIALS", "#ff8f6b");
      return false;
    }

    for (const key of COMPOSITIONS) hub.materials[key] -= def.cost[key];
    this.applyUpgradeEffects(id);
    this.setMessage(`PURCHASED — ${def.label}`, "#7de08d");
    return true;
  }

  /** The actual effect dispatch (upgrades-spec.md Section 5) — one pass over
   *  `shipStats`/`hubStats`/`hubFlags` regardless of what's calling it. Deliberately separate
   *  from cost/gate checks so `debugMaxHub` can reuse it directly instead of faking a purchase. */
  private applyUpgradeEffects(id: UpgradeId) {
    const { hub, ship } = this;
    const def = UPGRADES[id];
    hub.purchasedUpgrades.add(id);
    if (def.shipStats) {
      for (const [stat, bonus] of Object.entries(def.shipStats) as [ShipStatKey, number][]) {
        this.applyShipStatBonus(ship, stat, bonus);
      }
    }
    if (def.hubStats) {
      for (const [stat, bonus] of Object.entries(def.hubStats) as [HubStatKey, number][]) {
        this.applyHubStatBonus(hub, stat, bonus);
      }
    }
    if (def.hubFlags) {
      for (const flag of def.hubFlags) hub[flag] = true;
    }
  }

  /** DEV-ONLY: instantly owns every Hub-tier upgrade (Standard + Facility), bypassing cost and
   *  research gates entirely — bound to a debug key (0) in update(), not reachable from the DOM
   *  overlay. A fast way to see the hub's full visual growth (hub-growth-spec.md) without
   *  grinding materials/research for every facility one at a time. Ship-tier upgrades are
   *  untouched — this is specifically for previewing the hub, not a general cheat. */
  private debugMaxHub() {
    for (const def of Object.values(UPGRADES)) {
      if (def.category === "ship" || this.hub.purchasedUpgrades.has(def.id)) continue;
      this.applyUpgradeEffects(def.id);
    }
    this.setMessage("DEBUG: HUB MAXED", "#c8a0ff");
  }

  /** One explicit case per stat rather than dynamic `ship[stat] += bonus` — keeps this type-safe
   *  and matches the small-dispatch pattern already used elsewhere (e.g. reactToCollision)
   *  instead of leaning on an index signature that would happily accept a typo'd key. */
  private applyShipStatBonus(ship: Ship, stat: ShipStatKey, bonus: number) {
    switch (stat) {
      case "thrustForce":
        ship.thrustForce += bonus;
        break;
      case "rcsDrag":
        ship.rcsDrag += bonus;
        break;
      case "visionRadius":
        ship.visionRadius += bonus;
        break;
      case "pingMaxRadius":
        ship.pingMaxRadius += bonus;
        break;
      case "pingSpeed":
        ship.pingSpeed += bonus;
        break;
      case "temperatureDamageThreshold":
        ship.temperatureDamageThreshold += bonus;
        break;
      case "temperatureDecayPerSec":
        ship.temperatureDecayPerSec += bonus;
        break;
      case "signatureDecayPerSec":
        ship.signatureDecayPerSec += bonus;
        break;
      case "maxHull":
        ship.maxHull += bonus;
        ship.hull += bonus; // a hull upgrade should feel like a heal too, not just a higher cap
        break;
      case "chargeMaxCarried":
        ship.chargeMaxCarried += bonus;
        ship.chargesCarried += bonus;
        break;
      case "cargoCapacity":
        ship.cargoCapacity += bonus;
        break;
      case "laserRangeBonus":
        ship.laserRangeBonus += bonus;
        break;
      case "drillAnchorRangeBonus":
        ship.drillAnchorRangeBonus += bonus;
        break;
      case "scanSpeedMult":
        ship.scanSpeedMult += bonus;
        break;
      case "signatureGainMult":
        ship.signatureGainMult += bonus;
        break;
      case "gravityResistMult":
        ship.gravityResistMult += bonus;
        break;
      case "cargoMassFactor":
        ship.cargoMassFactor = Math.max(0, ship.cargoMassFactor + bonus);
        break;
      case "fuelCapacity":
        ship.fuelCapacity += bonus;
        ship.fuel += bonus; // a fuel upgrade should feel like a top-up too, not just a higher cap
        break;
      case "batteryCapacity":
        ship.batteryCapacity += bonus;
        ship.battery += bonus;
        break;
      case "solarRegenMult":
        ship.solarRegenMult += bonus;
        break;
      case "powerDrawMult":
        ship.powerDrawMult = Math.max(0.1, ship.powerDrawMult + bonus);
        break;
      case "passivePingInterval":
        ship.passivePingInterval += bonus;
        break;
    }
  }

  private applyHubStatBonus(hub: Hub, stat: HubStatKey, bonus: number) {
    switch (stat) {
      case "beaconRange":
        hub.beaconRange += bonus;
        break;
      case "structuralIntegrity":
        hub.structuralIntegrity += bonus;
        break;
      case "researchSpeedMult":
        hub.researchSpeedMult = Math.max(0.1, hub.researchSpeedMult + bonus);
        break;
      case "satelliteCap":
        hub.satelliteCap += bonus;
        break;
    }
  }

  /** Public: called from the hub's DOM overlay. Starts the one active research project (Hub
   *  Facility research capacity is a single slot until a future Research Lab tier adds a
   *  second — see upgrades-spec.md Section 3b) — checks every gate a project can have
   *  (research.ts's four shapes), debits materials the same way a purchase does, and begins
   *  ticking down in `updateResearch`. */
  startResearch(id: ResearchId): boolean {
    if (this.scene !== "hub") return false;
    const { hub } = this;
    if (hub.activeResearch) {
      this.setMessage("RESEARCH ALREADY IN PROGRESS", "#ff8f6b");
      return false;
    }
    if (hub.completedResearch.has(id)) return false;

    const def = RESEARCH[id];
    if (def.requiresSample && !hub.everDeposited.has(def.requiresSample)) {
      this.setMessage("SAMPLE REQUIRED", "#ff8f6b");
      return false;
    }
    if (def.requiresScannedType && !this.scannedTypes.has(def.requiresScannedType)) {
      this.setMessage("UNSCANNED BODY TYPE", "#ff8f6b");
      return false;
    }
    if (def.requiresFacility && !hub.purchasedUpgrades.has(def.requiresFacility)) {
      this.setMessage("FACILITY REQUIRED", "#ff8f6b");
      return false;
    }
    if (!canAfford(hub.materials, def.cost)) {
      this.setMessage("NOT ENOUGH MATERIALS", "#ff8f6b");
      return false;
    }

    for (const key of COMPOSITIONS) hub.materials[key] -= def.cost[key];
    hub.activeResearch = { id, remainingSeconds: def.researchSeconds };
    this.setMessage(`RESEARCH STARTED — ${def.label}`, "#7fe0ff");
    return true;
  }

  private updateResearch(dt: number) {
    const { hub } = this;
    if (!hub.activeResearch) return;
    hub.activeResearch.remainingSeconds -= dt * hub.researchSpeedMult;
    if (hub.activeResearch.remainingSeconds > 0) return;

    const def = RESEARCH[hub.activeResearch.id];
    hub.completedResearch.add(def.id);
    hub.activeResearch = null;
    if (def.researchSpeedMultBonus) {
      hub.researchSpeedMult = Math.max(0.1, hub.researchSpeedMult + def.researchSpeedMultBonus);
    }
    this.setMessage(`RESEARCH COMPLETE — ${def.label}`, "#7de08d");
  }

  /** Public: called from the hub's DOM overlay, only available once Refinery is built. A small
   *  fixed recipe table (not an arbitrary N-by-N converter) — grinds a batch of bulk material
   *  into a smaller amount of something worth having, at a real loss, so Chondrite Rock (the
   *  most common, least valuable resource — twin-star-spec.md Section 17) has somewhere to go
   *  once you've got more than any upgrade actually wants. */
  refineMaterial(recipeId: RefineRecipeId): boolean {
    if (this.scene !== "hub" || !this.hub.refineryBuilt) return false;
    const { hub } = this;
    const recipe = REFINE_RECIPES[recipeId];
    if (hub.materials[recipe.from] < recipe.inputAmount) {
      this.setMessage("NOT ENOUGH MATERIAL", "#ff8f6b");
      return false;
    }
    hub.materials[recipe.from] -= recipe.inputAmount;
    hub.materials[recipe.to] += recipe.outputAmount;
    hub.everDeposited.add(recipe.to);
    this.setMessage(`REFINED ${recipe.inputAmount} ${recipe.from} → ${recipe.outputAmount} ${recipe.to}`, "#7de08d");
    return true;
  }

  /** Classifies a world point into whichever asteroid's intact cell contains it, or null —
   *  the multi-asteroid equivalent of the old single-`asteroid.cellAt`. */
  private cellAt(worldPos: Vec2): Cell | null {
    for (const asteroid of this.asteroids) {
      const cell = asteroid.cellAt(worldPos);
      if (cell) return cell;
    }
    return null;
  }

  private findNearestAsteroid(pos: Vec2): Asteroid | null {
    let best: Asteroid | null = null;
    let bestDist = Infinity;
    for (const asteroid of this.asteroids) {
      const d = distance(pos, asteroid.center);
      if (d < bestDist) {
        bestDist = d;
        best = asteroid;
      }
    }
    return best;
  }

  /** Checks a circular body (ship or chunk) against every intact cell across every asteroid —
   *  not just whichever one its exact center lands inside, so a body can't slip through a gap
   *  narrower than itself. Collision only ever considers a cell's *exposed* edges (see
   *  `exposedEdgeMask`) — edges shared with another still-connected cell in the same group are
   *  internal seams, not walls, since the two cells together form one continuous solid there.
   *  A cheap bounding-radius pre-filter skips cells nowhere near `pos` before doing the real
   *  work; belt-scale cell counts are small enough that no coarser per-asteroid filter is
   *  needed (and a per-asteroid one would be unsafe anyway once cells have drifted). */
  private findCellContact(pos: Vec2, radius: number): { cell: Cell; boundary: BoundaryHit } | null {
    let bestCell: Cell | null = null;
    let bestBoundary: BoundaryHit | null = null;
    let bestPenetration = 0;

    for (const asteroid of this.asteroids) {
      for (const cell of asteroid.cells) {
        if (cell.fractured || cell.polygon.length < 3) continue;
        const roughReach = boundingRadius(cell.polygon, cell.centroid) + radius;
        if (distance(cell.centroid, pos) > roughReach) continue;

        const mask = this.exposedEdgeMask(cell);
        const boundary = closestPointOnPolygon(cell.polygon, pos, (i) => mask[i]);
        if (!boundary) continue; // cell has no exposed edges at all (fully buried) — nothing to hit
        const inside = pointInPolygon(pos, cell.polygon);
        const penetration = inside ? boundary.distance + radius : radius - boundary.distance;
        if (penetration <= 0) continue;
        if (penetration > bestPenetration) {
          bestPenetration = penetration;
          bestCell = cell;
          bestBoundary = boundary;
        }
      }
    }
    return bestCell && bestBoundary ? { cell: bestCell, boundary: bestBoundary } : null;
  }

  /** Per-edge exposure: edge `i` (poly[i] -> poly[i+1]) counts as real, collidable rock only
   *  if its *midpoint* isn't sitting inside (or right up against) another intact cell in the
   *  same drift group. A midpoint is never at a shared vertex, so unlike testing an arbitrary
   *  query point, this can't be fooled by a corner or a concave dip — it's always squarely in
   *  the middle of one specific edge, where "is there more solid material right here" has an
   *  unambiguous answer. */
  private exposedEdgeMask(cell: Cell): boolean[] {
    const group = this.driftGroupOf(cell);
    const poly = cell.polygon;
    const n = poly.length;
    const mask = new Array<boolean>(n).fill(true);
    if (!group) return mask;

    for (let i = 0; i < n; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % n];
      const mid = v2((a.x + b.x) / 2, (a.y + b.y) / 2);
      for (const other of group.cells) {
        if (other === cell || other.fractured) continue;
        if (pointInPolygon(mid, other.polygon)) {
          mask[i] = false;
          break;
        }
        const hit = closestBoundaryPoint(other.polygon, mid);
        if (hit && hit.distance <= CELL_TOUCH_EPSILON) {
          mask[i] = false;
          break;
        }
      }
    }
    return mask;
  }

  /** Speed-scaled hull damage from a solid impact — shared by every collision resolver so a
   *  future enemy ramming the ship (or the ship ramming an enemy) hits exactly the same way a
   *  rock does, rather than each collision type reimplementing its own damage formula. */
  private applyCollisionImpact(closingSpeed: number, source: DamageSource) {
    if (closingSpeed <= COLLISION_MIN_SPEED) return;
    const damage = (closingSpeed - COLLISION_MIN_SPEED) * COLLISION_DAMAGE_SCALE;
    this.ship.takeImpact(damage, source);
    this.setMessage(`HULL DAMAGE -${damage.toFixed(0)}`, "#ff6b6b");
  }

  /** The only place collision *reactions* (as opposed to the physics itself) are decided.
   *  Adding a new kind that should take or deal damage is one more line here, not a new
   *  physics resolver. Only a solid hit against rock currently damages the ship — a loose
   *  chunk bump stays a soft nudge, matching the game's previous behavior exactly. */
  private reactToCollision(kindA: string, kindB: string, closingSpeed: number) {
    const involvesShip = kindA === "ship" || kindB === "ship";
    const involvesRock = kindA === "rock" || kindB === "rock";
    if (involvesShip && involvesRock) {
      this.applyCollisionImpact(closingSpeed, "collision");
    }
  }

  /** How many smaller steps to split a frame's movement+collision into, so a fast-moving body
   *  can't skip clean over thin geometry between one frame and the next (see
   *  COLLISION_SUBSTEP_TRAVEL) — cheap insurance against tunneling without full continuous
   *  collision detection. Costs nothing extra at normal speeds (returns 1). */
  private substepsFor(speed: number, dt: number): number {
    const steps = Math.ceil((speed * dt) / COLLISION_SUBSTEP_TRAVEL);
    return Math.min(MAX_COLLISION_SUBSTEPS, Math.max(1, steps));
  }

  private shipBody(): BodyHandle {
    const { ship } = this;
    // ship.mass, not the flat SHIP_MASS constant — a loaded cargo hold is real collision mass
    // now (see Ship.mass), same physics-through-line as the density-aware rock/chunk mass.
    return {
      body: { kind: "ship", pos: ship.pos, vel: ship.vel, radius: SHIP_RADIUS, mass: ship.mass, material: SHIP_MATERIAL },
      write: (pos, vel) => {
        ship.pos = pos;
        ship.vel = vel;
      },
    };
  }

  private chunkBody(chunk: Chunk): BodyHandle {
    return {
      body: { kind: "chunk", pos: chunk.pos, vel: chunk.vel, radius: chunk.radius, mass: chunk.mass, material: CHUNK_MATERIAL },
      write: (pos, vel) => {
        chunk.pos = pos;
        chunk.vel = vel;
      },
    };
  }

  /** Every circle-shaped, independently-moving thing in the world right now. Anything added
   *  here automatically collides correctly with everything else on this list *and* with rock
   *  through the shared resolvers below — a future circular entity (a drone, a simple enemy)
   *  is one more line here, not a new collision method. */
  private circleBodies(): BodyHandle[] {
    const handles: BodyHandle[] = [this.shipBody()];
    for (const chunk of this.chunks) handles.push(this.chunkBody(chunk));
    return handles;
  }

  /** One circle body against another — the physics (mass, material-derived bounce/friction,
   *  position correction) is fully generic; only the geometry (both are circles) and the
   *  reaction (see reactToCollision) know which kinds are actually involved. */
  private resolveBodyPair(a: BodyHandle, b: BodyHandle, dt: number): { kindA: string; kindB: string; closingSpeed: number } | null {
    const d = distance(a.body.pos, b.body.pos);
    const minDist = a.body.radius + b.body.radius;
    if (d >= minDist || d < 1e-6) return null;

    const normal = scale(sub(a.body.pos, b.body.pos), 1 / d);
    const contact = scale(add(a.body.pos, b.body.pos), 0.5);
    const refA: RigidRef = { pos: a.body.pos, vel: a.body.vel, angVel: 0, invMass: 1 / a.body.mass, invInertia: 0 };
    const refB: RigidRef = { pos: b.body.pos, vel: b.body.vel, angVel: 0, invMass: 1 / b.body.mass, invInertia: 0 };
    const material = combineMaterials(a.body.material, b.body.material);

    const closingSpeed = -dot(sub(refA.vel, refB.vel), normal);
    let velA = refA.vel;
    let velB = refB.vel;
    if (closingSpeed > 0) {
      const result = resolveContact(refA, refB, contact, normal, material.restitution);
      velA = applyFriction(result.velA, normal, material.friction);
      velB = applyFriction(result.velB, normal, material.friction);
    }

    let posA = a.body.pos;
    let posB = b.body.pos;
    const penetration = minDist - d;
    const totalInv = refA.invMass + refB.invMass;
    if (penetration > 0 && totalInv > 1e-9) {
      const factor = Math.min(1, POSITION_CORRECTION_RATE * dt);
      posA = add(a.body.pos, scale(normal, penetration * (refA.invMass / totalInv) * factor));
      posB = sub(b.body.pos, scale(normal, penetration * (refB.invMass / totalInv) * factor));
    }

    a.write(posA, velA);
    b.write(posB, velB);
    return { kindA: a.body.kind, kindB: b.body.kind, closingSpeed };
  }

  /** All-pairs circle-vs-circle collision (chunk-chunk, chunk-ship) in one generic sweep —
   *  the ship only ever appears once, so this naturally covers both without two methods. */
  private resolveCircleCollisions(dt: number) {
    const bodies = this.circleBodies();
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const result = this.resolveBodyPair(bodies[i], bodies[j], dt);
        if (result) this.reactToCollision(result.kindA, result.kindB, result.closingSpeed);
      }
    }
  }

  /** A circle body against the asteroid's irregular polygon geometry — a real rigid-body
   *  contact against the rock's actual velocity *and* spin at the contact point (not just its
   *  center velocity), so a moving or spinning piece properly shoves whatever hits it. Shared
   *  by the ship and every chunk instead of being duplicated per kind. */
  private resolveBodyVsRock(handle: BodyHandle, dt: number): { kind: string; closingSpeed: number } | null {
    const contact = this.findCellContact(handle.body.pos, handle.body.radius);
    if (!contact) return null;
    const { cell, boundary } = contact;

    // Close the overlap gradually rather than snapping straight to the surface — a hard
    // teleport is what reads as a "jump" when the rock itself is moving. The resting distance
    // here MUST match the radius findCellContact used to detect the contact, or the body can
    // never actually reach a position collision considers fully resolved.
    const targetPos = add(boundary.point, scale(boundary.normal, handle.body.radius + 0.5));
    const correctionFactor = Math.min(1, POSITION_CORRECTION_RATE * dt);
    const correctedPos = add(handle.body.pos, scale(sub(targetPos, handle.body.pos), correctionFactor));

    const group = this.driftGroupOf(cell);
    const rockBody = this.rigidRefForGroup(group);
    const bodyRef: RigidRef = {
      pos: correctedPos,
      vel: handle.body.vel,
      angVel: 0,
      invMass: 1 / handle.body.mass,
      invInertia: 0,
    };

    const rB = sub(boundary.point, rockBody.pos);
    const contactVelRock = velocityAtPoint(rockBody.vel, rockBody.angVel, rB);
    const closingSpeed = -dot(sub(bodyRef.vel, contactVelRock), boundary.normal);

    let velOut = bodyRef.vel;
    if (closingSpeed > 0) {
      const material = combineMaterials(handle.body.material, ROCK_MATERIAL);
      const result = resolveContact(bodyRef, rockBody, boundary.point, boundary.normal, material.restitution);
      velOut = applyFriction(result.velA, boundary.normal, material.friction);
      if (group) {
        group.vel = result.velB;
        group.angularVelocity = result.angVelB;
      }
    }

    handle.write(correctedPos, velOut);
    return { kind: handle.body.kind, closingSpeed };
  }

  /** Rock-vs-rock: separate drift groups now collide with each other instead of passing through.
   *  Broad+narrow phase in one pass, approximating each cell as a circle (cells are small and
   *  roughly convex, so this is close enough without full polygon-polygon SAT).
   *
   *  Group-level bounding-circle reject happens *here*, once per group per frame, before any
   *  pair is even considered — without it, every one of the O(n^2) group pairs ran a full
   *  per-cell double loop regardless of whether the two bodies were anywhere near each other
   *  (two asteroids on opposite sides of the belt still paid full price). Fine at the old ~46-body
   *  count; with the belt redesign roughly doubling body count (quadrupling the O(n^2) pair
   *  count) and skewing toward larger, more-celled bodies, this was the actual cause of a real
   *  frame-rate regression, not just a theoretical inefficiency. */
  private computeDriftGroupBounds() {
    this.driftGroupBounds = this.driftGroups.map((group) => {
      const com = this.groupCenterOfMass(group.cells);
      return { group, com, radius: this.groupBoundingRadius(group, com) };
    });
  }

  private resolveGroupCollisions(dt: number) {
    const bounds = this.driftGroupBounds;
    for (let i = 0; i < bounds.length; i++) {
      for (let j = i + 1; j < bounds.length; j++) {
        const a = bounds[i];
        const b = bounds[j];
        if (distance(a.com, b.com) - a.radius - b.radius > CELL_TOUCH_EPSILON) continue;
        this.resolveGroupPair(a.group, b.group, dt);
      }
    }
  }

  private resolveGroupPair(groupA: DriftGroup, groupB: DriftGroup, dt: number) {
    // Bounding circles are only a cheap pre-filter here — they're generous enough
    // (they cover the whole irregular cell shape) to report "touching" well before
    // the actual polygons are anywhere near each other, which was enough to trigger
    // a bogus collision the moment a piece split off and was still merely adjacent.
    // The real contact test is exact polygon-to-polygon distance.
    let bestGap = Infinity;
    let bestA: Cell | null = null;
    let bestB: Cell | null = null;

    // Precomputed once per cellB rather than recomputed on every cellA iteration.
    const bCells = groupB.cells.map((cell) => ({ cell, r: boundingRadius(cell.polygon, cell.centroid) }));
    for (const cellA of groupA.cells) {
      const rA = boundingRadius(cellA.polygon, cellA.centroid);
      for (const { cell: cellB, r: rB } of bCells) {
        const centroidDist = distance(cellA.centroid, cellB.centroid);
        if (centroidDist - rA - rB > CELL_TOUCH_EPSILON) continue; // circles alone rule this out
        const gap = polygonMinDistance(cellA.polygon, cellB.polygon);
        if (gap < bestGap) {
          bestGap = gap;
          bestA = cellA;
          bestB = cellB;
        }
      }
    }
    if (!bestA || !bestB || bestGap > CELL_TOUCH_EPSILON) return;

    const bestDist = distance(bestA.centroid, bestB.centroid);
    const normal = bestDist > 1e-6 ? scale(sub(bestA.centroid, bestB.centroid), 1 / bestDist) : v2(1, 0);
    const contact = scale(add(bestA.centroid, bestB.centroid), 0.5);

    const bodyA = this.rigidRefForGroup(groupA);
    const bodyB = this.rigidRefForGroup(groupB);

    // Only actually apply an impulse if they're meaningfully closing — two pieces
    // resting near-motionless against each other shouldn't get nudged every frame
    // just because the nearest cell pair flickers between near-identical candidates.
    const rA = sub(contact, bodyA.pos);
    const rB = sub(contact, bodyB.pos);
    const closingSpeed = -dot(sub(velocityAtPoint(bodyA.vel, bodyA.angVel, rA), velocityAtPoint(bodyB.vel, bodyB.angVel, rB)), normal);
    if (closingSpeed > ROCK_CONTACT_MIN_CLOSING_SPEED) {
      const material = combineMaterials(ROCK_MATERIAL, ROCK_MATERIAL);
      const result = resolveContact(bodyA, bodyB, contact, normal, material.restitution);
      groupA.vel = applyFriction(result.velA, normal, material.friction);
      groupA.angularVelocity = result.angVelA;
      groupB.vel = applyFriction(result.velB, normal, material.friction);
      groupB.angularVelocity = result.angVelB;
    }

    const penetration = Math.max(0, CELL_TOUCH_EPSILON - bestGap);
    if (penetration > 0) {
      const invA = bodyA.invMass;
      const invB = bodyB.invMass;
      const totalInv = invA + invB;
      if (totalInv > 1e-9) {
        const factor = Math.min(1, POSITION_CORRECTION_RATE * dt);
        this.translateGroup(groupA, scale(normal, penetration * (invA / totalInv) * factor));
        this.translateGroup(groupB, scale(normal, -penetration * (invB / totalInv) * factor));
      }
    }
  }

  private translateGroup(group: DriftGroup, delta: Vec2) {
    for (const cell of group.cells) {
      cell.polygon = cell.polygon.map((p) => add(p, delta));
      cell.centroid = add(cell.centroid, delta);
    }
  }

  /** Every cell in a group can be a different resource (a Voronoi tessellation isn't
   *  single-material) — massForArea (asteroid.ts) is keyed per-cell by its own composition, the
   *  same density-aware formula a loose Chunk uses, so a group's mass reflects what it's
   *  actually made of rather than treating every cell as equally dense rock. */
  private groupMass(group: DriftGroup): number {
    const mass = group.cells.reduce((sum, c) => sum + massForArea(c.composition, polygonArea(c.polygon)), 0);
    return Math.max(1, mass);
  }

  /** Mass-weighted center of mass — the pivot every group rotates and is pushed around.
   *  Takes a raw cell list (not a DriftGroup) so it can also be used for a candidate
   *  component before it's been wrapped into a group, e.g. right after a split. */
  private groupCenterOfMass(cells: Cell[]): Vec2 {
    let totalMass = 0;
    let acc = v2(0, 0);
    for (const cell of cells) {
      const m = massForArea(cell.composition, polygonArea(cell.polygon));
      acc = add(acc, scale(cell.centroid, m));
      totalMass += m;
    }
    return totalMass > 1e-6 ? scale(acc, 1 / totalMass) : v2(0, 0);
  }

  /** Moment of inertia about `com` — each cell's own rotational inertia about its own
   *  centroid (its actual size/shape, via the parallel axis theorem) plus its point-mass
   *  contribution from being offset from the group's center. The point-mass term alone
   *  is a fine approximation for a many-celled body, but degenerates badly for a small or
   *  single-cell piece (a lone cell IS its own center of mass, so the offset term is ~0),
   *  which is exactly the case that matters most right after something splits off. */
  private groupInertia(group: DriftGroup, com: Vec2): number {
    let inertia = 0;
    for (const cell of group.cells) {
      const massPerArea = massPerAreaFor(cell.composition);
      const m = polygonArea(cell.polygon) * massPerArea;
      const ownInertia = polygonSecondMomentOfArea(cell.polygon) * massPerArea;
      const d = distance(cell.centroid, com);
      inertia += ownInertia + m * d * d;
    }
    return Math.max(1, inertia);
  }

  private rigidRefForGroup(group: DriftGroup | undefined): RigidRef {
    if (!group) return { pos: v2(0, 0), vel: v2(0, 0), angVel: 0, invMass: 0, invInertia: 0 };
    const com = this.groupCenterOfMass(group.cells);
    return {
      pos: com,
      vel: group.vel,
      angVel: group.angularVelocity,
      invMass: 1 / this.groupMass(group),
      invInertia: 1 / this.groupInertia(group, com),
    };
  }

  private groupBoundingRadius(group: DriftGroup, com: Vec2): number {
    let maxR = 0;
    for (const cell of group.cells) {
      for (const v of cell.polygon) maxR = Math.max(maxR, distance(v, com));
    }
    return Math.max(10, maxR);
  }

  /** Every currently-trackable thing in the world, for ping/radar — rock pieces and gravity
   *  sources (the star today, a planet later) alike. Everything here goes through the same
   *  discovery gate (ping sweep or passive vision range) and the same staleness/forgetting —
   *  a landmark being fixed in place doesn't make it any less something you have to actually
   *  find first; only the hub (home base, always known) is exempt from that. */
  getContacts(): Contact[] {
    const rockContacts: Contact[] = this.driftGroupBounds.map(({ group, com, radius }) => {
      return {
        id: `rock-${group.id}`,
        kind: "rock" as const,
        pos: com,
        radius,
        label: `${sizeLabelForRadius(radius)} Asteroid`,
      };
    });
    const gravityContacts = this.gravitySources.map((source) => this.gravitySourceContact(source));
    return [...rockContacts, ...gravityContacts];
  }

  /** Recomputes which clusters of intact cells are still connected to their parent mass.
   *  Once a body has been split, every resulting piece drifts — including whatever remains of
   *  the original mass. A never-cut asteroid stays put. Cell adjacency is scoped per-asteroid
   *  (each one's Voronoi tessellation is its own graph — cells from different asteroids are
   *  never neighbors), but cell ids are globally unique across every asteroid, so their
   *  adjacency maps merge into one without collisions and every asteroid's cells feed the same
   *  flat list of drift groups.
   *
   *  Also keeps `Asteroid.center` itself live — it started as just the fixed spawn point, which
   *  went stale the moment a whole (never-split) body drifted under gravity: nearest-asteroid
   *  selection, scan range gating, and the scan sweep visual all read `asteroid.center` as "where
   *  this body currently is," so a frozen value meant the scan circle visibly stopped following
   *  a moving rock. Recomputed here (mass-weighted centroid of the asteroid's own intact cells)
   *  since this loop already walks every cell once per frame regardless — no new pass needed.
   *  Known gap: if a body has split into more than one drift group without being scanned yet,
   *  this averages across all of them, which isn't any single piece's real position — not
   *  handled, revisit if it turns out to matter in practice. */
  private recomputeDriftGroups() {
    const intact: Cell[] = [];
    const neighbors = new Map<number, number[]>();
    const cellOrigin = new Map<number, Asteroid>(); // only needed to seed a fresh group's initial drift
    for (const asteroid of this.asteroids) {
      let sumX = 0;
      let sumY = 0;
      let totalMass = 0;
      for (const cell of asteroid.cells) {
        if (cell.fractured) continue;
        intact.push(cell);
        cellOrigin.set(cell.id, asteroid);
        const m = massForArea(cell.composition, polygonArea(cell.polygon));
        sumX += cell.centroid.x * m;
        sumY += cell.centroid.y * m;
        totalMass += m;
      }
      if (totalMass > 1e-6) asteroid.center = v2(sumX / totalMass, sumY / totalMass);
      for (const [id, list] of asteroid.neighbors) neighbors.set(id, list);
    }
    if (intact.length === 0) {
      this.driftGroups = [];
      return;
    }

    const idToCell = new Map(intact.map((c) => [c.id, c]));
    const visited = new Set<number>();
    const components: Cell[][] = [];

    for (const cell of intact) {
      if (visited.has(cell.id)) continue;
      const stack = [cell.id];
      visited.add(cell.id);
      const comp: Cell[] = [];
      while (stack.length) {
        const id = stack.pop()!;
        const c = idToCell.get(id);
        if (!c) continue;
        comp.push(c);
        for (const neighborId of neighbors.get(id) ?? []) {
          if (visited.has(neighborId) || !idToCell.has(neighborId)) continue;
          const edgeKey = id < neighborId ? `${id}:${neighborId}` : `${neighborId}:${id}`;
          if (this.severedEdges.has(edgeKey)) continue;
          const neighborCell = idToCell.get(neighborId)!;
          // Cells that were adjacent in the original tessellation only stay
          // connected while their *current* geometry still touches — a cell
          // the laser has shaved thin no longer holds a piece together just
          // because it hasn't been fully cut through yet. Once confirmed
          // apart, remember it permanently instead of re-checking forever —
          // otherwise a gap sitting near the threshold (e.g. while the piece
          // is rotating) can flicker connected/disconnected every frame.
          if (polygonMinDistance(c.polygon, neighborCell.polygon) > CELL_TOUCH_EPSILON) {
            this.severedEdges.add(edgeKey);
            continue;
          }
          visited.add(neighborId);
          stack.push(neighborId);
        }
      }
      components.push(comp);
    }

    // Every component is its own body, always — including a still-whole
    // asteroid, which simply starts (and stays) at rest until something
    // actually hits it. `id` carries over from whichever previous group this
    // one overlaps with, so ping discovery and radar tracking survive a split.
    const previousGroups = this.driftGroups;
    const isInitial = previousGroups.length === 0;

    const matches = components.map((comp) => {
      const ids = new Set(comp.map((c) => c.id));
      const prev = previousGroups.find((g) => g.cells.some((c) => ids.has(c.id)));
      return { comp, prev };
    });

    // If two-or-more of this frame's components trace back to the *same* previous
    // group, that group just split this frame.
    const claimCount = new Map<DriftGroup, number>();
    for (const { prev } of matches) {
      if (prev) claimCount.set(prev, (claimCount.get(prev) ?? 0) + 1);
    }

    this.driftGroups = matches.map(({ comp, prev }) => {
      if (isInitial) {
        // Whole, never-yet-touched bodies start with whatever drift their source Asteroid was
        // given at scatter time (see scatterBelt) — most are zero, a fraction aren't.
        const vel = cellOrigin.get(comp[0].id)?.initialVelocity ?? v2(0, 0);
        return { id: nextGroupId++, cells: comp, vel, angularVelocity: 0 };
      }
      const isFreshSplit = !prev || (claimCount.get(prev) ?? 0) > 1;
      if (!isFreshSplit && prev) {
        return { id: prev.id, cells: comp, vel: prev.vel, angularVelocity: prev.angularVelocity };
      }
      if (!prev) {
        return { id: nextGroupId++, cells: comp, vel: v2(0, 0), angularVelocity: 0 };
      }
      // A genuine split: no force has acted on either resulting piece, so neither
      // gets an invented kick. Each simply keeps the parent's angular velocity
      // (spin rate is unaffected by where a body happens to separate) and inherits
      // the real velocity its own center of mass already had — which, if the
      // parent was rotating, is *not* the same as the parent's center-of-mass
      // velocity. A rigid body's velocity at any offset point r from its center
      // is v + ω×r; that's a genuine consequence of the parent's existing spin,
      // not a fabricated push, and it's exactly why a spinning body's fragments
      // really do separate on their own once free, while a body at rest doesn't.
      const newCom = this.groupCenterOfMass(comp);
      const parentCom = this.groupCenterOfMass(prev.cells);
      const vel = velocityAtPoint(prev.vel, prev.angularVelocity, sub(newCom, parentCom));
      return { id: nextGroupId++, cells: comp, vel, angularVelocity: prev.angularVelocity };
    });

    // O(1) lookup for driftGroupOf below — without this it was a linear scan over every group's
    // every cell (`driftGroups.find(g => g.cells.includes(cell))`), paid on every call. Cheap to
    // rebuild here since this function already visits every cell once regardless.
    this.cellGroupMap.clear();
    for (const group of this.driftGroups) {
      for (const cell of group.cells) this.cellGroupMap.set(cell.id, group);
    }
  }

  private updateDriftGroups(dt: number) {
    for (const group of this.driftGroups) {
      const com = this.groupCenterOfMass(group.cells);

      // Rocks feel gravity too — same wells as the ship/chunks (see applyGravityTo), computed
      // before the at-rest early-continue below so a stationary body near a massive one
      // actually starts moving instead of being exempt just because nothing had hit it yet.
      const mover = { pos: com, vel: group.vel };
      this.applyGravityTo(mover, dt);
      group.vel = mover.vel;

      if (Math.abs(group.angularVelocity) < 1e-5 && length(group.vel) < 1e-5) continue;

      const dAngle = group.angularVelocity * dt;
      const dPos = scale(group.vel, dt);
      for (const cell of group.cells) {
        const rotated = cell.polygon.map((p) => rotateAround(p, com, dAngle));
        cell.polygon = rotated.map((p) => add(p, dPos));
        cell.centroid = add(rotateAround(cell.centroid, com, dAngle), dPos);
      }

      group.vel = scale(group.vel, Math.max(0, 1 - DRIFT_DAMPING * dt));
      group.angularVelocity *= Math.max(0, 1 - ANGULAR_DAMPING * dt);
    }
  }

  private driftGroupOf(cell: Cell): DriftGroup | undefined {
    return this.cellGroupMap.get(cell.id);
  }

  /** Whatever's directly under the cursor, checked closest-first (a chunk sitting on top of
   *  the asteroid should win over the cell behind it). Independent of tool/mode — see
   *  `HoverTarget`. */
  private computeHoverTarget(worldMouse: Vec2): HoverTarget | null {
    const chunk = this.chunks.find(
      (c) => distance(c.pos, worldMouse) <= c.radius + HOVER_CHUNK_PADDING,
    );
    if (chunk) return { kind: "chunk", chunk };

    const cell = this.cellAt(worldMouse);
    return cell ? { kind: "cell", cell } : null;
  }

  private updateMining(dt: number, worldMouse: Vec2) {
    const { ship, input } = this;
    this.currentTarget = null;
    if (ship.mode !== "rcs") {
      ship.anchored = false;
      return;
    }

    // Drilling is decided by ship proximity, not the cursor — see runDrill.
    if (ship.selectedTool === "drill") {
      this.runDrill(dt);
      return;
    }

    ship.anchored = false;
    this.anchoredCell = null;

    const toolDef = TOOLS[ship.selectedTool];
    // Laser Focusing Lens (upgrades.ts) only applies while the laser is actually selected — the
    // bonus lives on the ship, but it shouldn't quietly extend charges' range too.
    const rangeBonus = ship.selectedTool === "laser" ? ship.laserRangeBonus : 0;
    const inRange = distance(ship.pos, worldMouse) <= toolDef.range + rangeBonus;
    const cell = inRange ? this.cellAt(worldMouse) : null;
    const validCell = cell && !cell.fractured ? cell : null;
    if (validCell) this.currentTarget = validCell;

    if (ship.selectedTool === "laser") {
      if (input.mouseDown && validCell && ship.powered) this.cutCell(validCell, dt);
    } else {
      if (
        input.mouseJustPressed &&
        validCell &&
        !validCell.hasCharge &&
        ship.chargesCarried > 0 &&
        ship.powered
      ) {
        validCell.hasCharge = true;
        ship.chargesCarried -= 1;
        this.setMessage("CHARGE PLACED", "#ffcf5c");
      }
      if (input.wasJustPressed("r") && ship.powered) this.detonateCharges();
    }
  }

  /** "Away from the body" direction for a cell — used to fling freshly-cut/extracted debris
   *  outward. Uses the cell's *current* drift group center of mass rather than the origin
   *  asteroid's fixed center: a piece that's drifted a long way from where its parent asteroid
   *  originally spawned should still eject away from where its own mass actually is now, not
   *  away from a stale point. Also sidesteps needing per-cell "which asteroid did this come
   *  from" bookkeeping now that there's more than one. */
  private outwardDirection(cell: Cell): Vec2 {
    const group = this.driftGroupOf(cell);
    const center = group ? this.groupCenterOfMass(group.cells) : cell.centroid;
    return normalize(sub(cell.centroid, center));
  }

  /** Laser: shaves a sliver off the cell each completed cut, in place, until it's small enough to eject whole. */
  private cutCell(cell: Cell, dt: number) {
    const { ship } = this;
    const info = COMPOSITION_INFO[cell.composition];
    const mult = info.recommendedTool === "laser" ? TOOL_RECOMMENDED_MULT : TOOL_OFF_MULT;
    cell.cutProgress += dt * mult;
    ship.addSignature((TOOLS.laser.sigPerSecond ?? 0) * dt * ship.signatureGainMult);
    ship.applyPowerDelta(-(TOOLS.laser.powerPerSecond ?? 0) * ship.powerDrawMult * dt);

    const nearest = closestBoundaryPoint(cell.polygon, ship.pos);
    if (nearest) this.activeBeam = { from: ship.pos, to: nearest.point, tool: "laser" };

    if (cell.cutProgress < info.cutSeconds) return;
    cell.cutProgress = 0;
    cell.piecesRemaining -= 1;

    const result = sliceNearPoint(cell.polygon, ship.pos, LASER_CUT_DEPTH);
    const outDir = this.outwardDirection(cell);

    if (!result || cell.piecesRemaining <= 0 || result.remainder.length < 3 || polygonArea(result.remainder) < MIN_CELL_AREA) {
      this.extractWholeCell(cell, 60 + Math.random() * 30);
      return;
    }

    if (result.sliver.length >= 3 && polygonArea(result.sliver) > 4) {
      this.spawnChunk(
        polygonCentroid(result.sliver),
        cell.composition,
        chunkValueForArea(info.chunkValue, polygonArea(result.sliver)),
        scale(outDir, 55 + Math.random() * 30),
      );
    }

    cell.polygon = result.remainder;
    cell.centroid = polygonCentroid(result.remainder);
  }

  /** Finds the intact cell whose exposed surface the ship is currently close enough to anchor
   *  to (within `DRILL_ANCHOR_RANGE`). Ship-position-based, not cursor-based — drilling is
   *  about physical contact with the rock, not aim, so unlike the laser/charges (which target
   *  wherever you point) the drill anchors to whatever you're actually touching, regardless of
   *  where the cursor happens to be. */
  private nearestDrillableCell(): { cell: Cell; boundary: BoundaryHit } | null {
    let best: { cell: Cell; boundary: BoundaryHit } | null = null;
    let bestDist = DRILL_ANCHOR_RANGE + this.ship.drillAnchorRangeBonus;
    for (const asteroid of this.asteroids) {
      for (const cell of asteroid.cells) {
        if (cell.fractured) continue;
        // Same cheap reject as findCellContact — DRILL_ANCHOR_RANGE is tiny (a few px), so
        // without this every intact cell in the whole belt gets an exact boundary query every
        // frame the drill is selected, no matter how far away it actually is.
        const roughReach = boundingRadius(cell.polygon, cell.centroid) + bestDist;
        if (distance(cell.centroid, this.ship.pos) > roughReach) continue;
        const mask = this.exposedEdgeMask(cell);
        const boundary = closestPointOnPolygon(cell.polygon, this.ship.pos, (i) => mask[i]);
        if (!boundary || boundary.distance > bestDist) continue;
        bestDist = boundary.distance;
        best = { cell, boundary };
      }
    }
    return best;
  }

  private runDrill(dt: number) {
    const { ship, input } = this;
    const releasingFrom = ship.anchored ? this.anchoredCell : null;

    // Speed gate disabled for now — a fast-moving/spinning drift group made anchoring
    // impossible since the ship has to match its speed just to stay in range.
    const nearby = this.nearestDrillableCell();
    this.currentTarget = nearby?.cell ?? null;

    if (this.anchoredCell && nearby?.cell !== this.anchoredCell) {
      this.anchoredCell = null;
    }

    const canAnchor = !!nearby && input.mouseDown && this.ship.powered;

    if (canAnchor && nearby) {
      const { cell: validTarget, boundary } = nearby;
      ship.anchored = true;
      this.anchoredCell = validTarget;

      // Grappled onto the rock, not onto fixed space — if the piece is
      // drifting or spinning, the ship rides along with it (including the
      // tangential speed from rotation) rather than staying fixed in world space.
      const group = this.driftGroupOf(validTarget);
      if (group) {
        const com = this.groupCenterOfMass(group.cells);
        const dAngle = group.angularVelocity * dt;
        ship.pos = add(rotateAround(ship.pos, com, dAngle), scale(group.vel, dt));
        const r = sub(ship.pos, com);
        ship.vel = velocityAtPoint(group.vel, group.angularVelocity, r);
      } else {
        ship.vel = v2(0, 0);
      }

      if (!validTarget.fractures) {
        this.generateFractures(validTarget, boundary.point);
      }

      const info = COMPOSITION_INFO[validTarget.composition];
      const mult = info.recommendedTool === "drill" ? TOOL_RECOMMENDED_MULT : TOOL_OFF_MULT;
      validTarget.boreProgress += (dt * mult) / info.boreSeconds;
      ship.addSignature((TOOLS.drill.sigPerSecond ?? 0) * dt * ship.signatureGainMult);
      ship.applyPowerDelta(-(TOOLS.drill.powerPerSecond ?? 0) * ship.powerDrawMult * dt);
      this.activeBeam = { from: ship.pos, to: boundary.point, tool: "drill" };

      if (validTarget.boreProgress >= 1) {
        this.extractWholeCell(validTarget, 40 + Math.random() * 20);
        this.anchoredCell = null;
        ship.anchored = false;
        this.setMessage("CORE EXTRACTED", "#ffb35c");
      }
    } else {
      // Letting go — keep whatever momentum the rock had at that point (including
      // its spin) rather than snapping to a dead stop. Bore progress is persistent
      // and does not decay when the drill is released.
      if (releasingFrom) {
        const group = this.driftGroupOf(releasingFrom);
        if (group) {
          const com = this.groupCenterOfMass(group.cells);
          const r = sub(ship.pos, com);
          ship.vel = velocityAtPoint(group.vel, group.angularVelocity, r);
        }
      }
      ship.anchored = false;
    }
  }

  /** Grows a hairline fracture network outward from `originWorld` — the ship's actual point of
   *  contact on the cell's surface, so damage reads as coming from where it happened (a future
   *  impact/blast could raise fractures from its own contact point the same way). Modeled as a
   *  handful of random walkers that wander, occasionally fork into two, and occasionally fizzle
   *  out — a small Lichtenberg-figure-style branching walk — rather than a fixed spoke of
   *  straight lines, so it reads as an actual spreading crack instead of a wheel. Every walker
   *  step is clamped to stay inside the cell's own polygon (`clampInsidePolygon`) and stops
   *  there, so fractures never spill into a neighboring section or open space. Segments are
   *  stored flat with a generation-based `order` (see `CrackSegment`) so the whole network grows
   *  together in the renderer rather than one branch completing before the next starts. Points
   *  are kept in the cell's own rotating local frame (`cellWorldToLocal`) so the fracture stays
   *  glued to that spot as the piece drifts and spins, and persists across drift-group splits
   *  since it lives on the `Cell` itself. */
  private generateFractures(cell: Cell, originWorld: Vec2) {
    // The origin must be strictly inside the polygon for the containment clamp below to have a
    // safe anchor — the drill's contact point sits right on the boundary, so nudge it slightly
    // inward first.
    const origin = add(originWorld, scale(sub(cell.centroid, originWorld), 0.08));

    const cellRadius = boundingRadius(cell.polygon, cell.centroid);
    const stepLen = cellRadius * 0.14;
    const maxGenerations = DRILL_FRACTURE_GENERATIONS;
    const minSegments = 16;
    const maxSeeds = 30;

    interface Walker {
      pos: Vec2;
      dir: number;
    }

    const segments: CrackSegment[] = [];
    let seeds = 0;
    // A single seed can die out almost immediately in a small or thin cell — every step lands
    // right back on the edge — which reads as barely any crack at all. Keep planting fresh
    // hairlines from the origin until the network actually has enough segments to look like one.
    while (segments.length < minSegments && seeds < maxSeeds) {
      seeds++;
      let walkers: Walker[] = [{ pos: origin, dir: Math.random() * Math.PI * 2 }];
      for (let gen = 0; gen < maxGenerations && walkers.length > 0; gen++) {
        const next: Walker[] = [];
        for (const w of walkers) {
          const dir = w.dir + (Math.random() - 0.5) * 1.2;
          const candidate = add(w.pos, fromAngle(dir, stepLen * (0.6 + Math.random() * 0.8)));
          const end = clampInsidePolygon(cell.polygon, w.pos, candidate);
          segments.push({
            a: cellWorldToLocal(cell, w.pos),
            b: cellWorldToLocal(cell, end),
            order: gen / maxGenerations,
          });

          const hitEdge = distance(end, candidate) > 1e-3;
          if (hitEdge) continue; // this hairline reached the surface — stop growing it

          const roll = Math.random();
          if (roll < 0.2 && gen < maxGenerations - 1) {
            next.push({ pos: end, dir: dir + 0.5 + Math.random() * 0.6 });
            next.push({ pos: end, dir: dir - 0.5 - Math.random() * 0.6 });
          } else if (roll < 0.9) {
            next.push({ pos: end, dir });
          }
          // else: this hairline fizzles out here
        }
        walkers = next;
      }
    }
    cell.fractures = segments;
  }

  private detonateCharges() {
    const { ship } = this;
    const charged = this.asteroids.flatMap((asteroid) => asteroid.cells).filter((c) => c.hasCharge);
    if (charged.length === 0) {
      this.setMessage("NO CHARGES PLACED", "#ff8f6b");
      return;
    }

    const blastPositions = charged.map((c) => c.centroid);

    // Extract everything first, so the explosions below (which each push whichever
    // rock body they land nearest) react to the pieces that actually result — if
    // this blast splits the body, each half recoils from the blast(s) nearest it.
    for (const cell of charged) {
      cell.hasCharge = false;
      this.extractWholeCell(cell, 210 + Math.random() * 60);
    }
    this.recomputeDriftGroups();

    let shipHit = false;
    for (const pos of blastPositions) {
      const hit = this.applyExplosion({
        pos,
        radius: CHARGE_BLAST_RADIUS,
        shipDamage: CHARGE_BLAST_DAMAGE_MAX,
        shipPushSpeed: CHARGE_BLAST_PUSH_MAX,
        chunkPushSpeed: CHARGE_CHUNK_PUSH_MAX,
        rockImpulse: CHARGE_IMPULSE_PER_CHARGE,
        source: "charge",
      });
      if (hit) shipHit = true;
    }

    ship.addSignature((TOOLS.charges.sigPerUse ?? 0) * charged.length * ship.signatureGainMult);
    ship.applyPowerDelta(-(TOOLS.charges.powerPerUse ?? 0) * charged.length * ship.powerDrawMult);
    this.setMessage(
      shipHit
        ? `DETONATED ${charged.length} CHARGE${charged.length > 1 ? "S" : ""} — CAUGHT IN THE BLAST`
        : `DETONATED ${charged.length} CHARGE${charged.length > 1 ? "S" : ""}`,
      shipHit ? "#ff6b6b" : "#ffa25c",
    );
  }

  /** Generic explosion handling — anything that raises an Explosion gets the same treatment:
   *  a visible shockwave, ship damage + knockback, loose chunks flung outward, and the nearest
   *  rock body recoiling from the blast point (off-center hits induce spin, same as any other
   *  impulse in this game). Charges are the only source today; future ones (enemies, hazards,
   *  other weapons) should build an Explosion and call this rather than reimplementing it.
   *  Returns whether the ship was caught in the blast. */
  applyExplosion(explosion: Explosion): boolean {
    const { ship } = this;
    this.blastEffects.push({ pos: explosion.pos, timer: BLAST_VISUAL_DURATION });

    let shipHit = false;
    const shipDist = distance(ship.pos, explosion.pos);
    if (shipDist <= explosion.radius) {
      shipHit = true;
      const falloff = 1 - shipDist / explosion.radius;
      const damage = explosion.shipDamage * falloff;
      if (damage > 0.2) ship.takeImpact(damage, "explosion");
      const pushDir = shipDist > 1e-6 ? normalize(sub(ship.pos, explosion.pos)) : v2(1, 0);
      ship.vel = add(ship.vel, scale(pushDir, explosion.shipPushSpeed * falloff));
    }

    for (const chunk of this.chunks) {
      const d = distance(chunk.pos, explosion.pos);
      if (d > explosion.radius) continue;
      const falloff = 1 - d / explosion.radius;
      const pushDir = d > 1e-6 ? normalize(sub(chunk.pos, explosion.pos)) : v2(1, 0);
      chunk.vel = add(chunk.vel, scale(pushDir, explosion.chunkPushSpeed * falloff));
    }

    const group = this.nearestDriftGroup(explosion.pos);
    if (group) {
      const body = this.rigidRefForGroup(group);
      const dir = normalize(sub(body.pos, explosion.pos));
      const impulse = scale(dir, explosion.rockImpulse);
      const applied = applyPointImpulse(body, explosion.pos, impulse);
      group.vel = applied.vel;
      group.angularVelocity = applied.angVel;
    }

    return shipHit;
  }

  private nearestDriftGroup(pos: Vec2): DriftGroup | undefined {
    let best: DriftGroup | undefined;
    let bestDist = Infinity;
    for (const group of this.driftGroups) {
      for (const cell of group.cells) {
        const d = distance(cell.centroid, pos);
        if (d < bestDist) {
          bestDist = d;
          best = group;
        }
      }
    }
    return best;
  }

  /** Ejects a cell's entire remaining mass as a single chunk (drill completion / charge detonation / laser's final piece). */
  private extractWholeCell(cell: Cell, impulseSpeed: number) {
    const info = COMPOSITION_INFO[cell.composition];
    const value = chunkValueForArea(info.chunkValue, polygonArea(cell.polygon));
    const pos = cell.centroid;
    const outDir = this.outwardDirection(cell);
    cell.fractured = true;
    cell.hasCharge = false;
    this.spawnChunk(pos, cell.composition, value, scale(outDir, impulseSpeed));
  }

  private spawnChunk(worldPos: Vec2, composition: Cell["composition"], value: number, vel: Vec2) {
    this.chunks.push(new Chunk(worldPos, vel, composition, value));
  }
}
