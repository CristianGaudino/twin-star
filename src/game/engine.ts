import { InputState } from "./input";
import { Ship } from "./ship";
import { Asteroid, Cell, COMPOSITION_INFO } from "./asteroid";
import { Chunk } from "./chunk";
import { Contact, ContactMemory } from "./contacts";
import { TOOLS, ToolId } from "./tools";
import {
  BoundaryHit,
  boundingRadius,
  closestBoundaryPoint,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  polygonMinDistance,
  polygonSecondMomentOfArea,
  sliceNearPoint,
} from "./poly";
import { RigidRef, applyPointImpulse, resolveContact } from "./physics";
import {
  ANGULAR_DAMPING,
  BLAST_VISUAL_DURATION,
  CELL_TOUCH_EPSILON,
  CHARGE_BLAST_DAMAGE_MAX,
  CHARGE_BLAST_PUSH_MAX,
  CHARGE_BLAST_RADIUS,
  CHARGE_IMPULSE_PER_CHARGE,
  CHARGE_MAX_CARRIED,
  CHARGE_SIG_PER_USE,
  CHUNK_COLLECT_RADIUS,
  CHUNK_SHIP_BUMP_RESTITUTION,
  CONTACT_FORGET_AFTER,
  DRIFT_DAMPING,
  DRILL_ANCHOR_RANGE,
  DRILL_PROGRESS_DECAY,
  DRILL_SIG_PER_SEC,
  LASER_CUT_DEPTH,
  LASER_SIG_PER_SEC,
  MAX_HULL,
  MIN_CELL_AREA,
  PING_COOLDOWN,
  PING_MAX_RADIUS,
  PING_SPEED,
  POSITION_CORRECTION_RATE,
  ROCK_CONTACT_MIN_CLOSING_SPEED,
  ROCK_MASS_PER_AREA,
  ROCK_ROCK_RESTITUTION,
  SCAN_HOLD_SECONDS,
  SCAN_PROGRESS_DECAY,
  SCAN_RANGE,
  SHIP_MASS,
  SHIP_RADIUS,
  SIGNATURE_DECAY_PER_SEC,
  TOOL_OFF_MULT,
  TOOL_RECOMMENDED_MULT,
  VISION_RADIUS,
  COLLISION_DAMAGE_SCALE,
  COLLISION_MIN_SPEED,
  COLLISION_RESTITUTION,
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

interface Star {
  pos: Vec2;
  r: number;
  brightness: number;
}

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

const WORLD_BOX = 1600; // half-extent of the starfield box around the origin
const TOOL_ORDER: ToolId[] = ["laser", "drill", "charges"];
const SPAWN_POS: Vec2 = v2(0, 0);
let nextGroupId = 1;

export class Engine {
  ship: Ship;
  asteroid: Asteroid;
  chunks: Chunk[] = [];
  input: InputState;
  stars: Star[] = [];

  paused = false;

  pingActive = false;
  pingRadius = 0;
  pingCooldown = 0;
  discoveredContacts = new Map<string, ContactMemory>(); // read by Renderer for radar blips

  message: FlashMessage | null = null;
  private cargoFullMessageCooldown = 0;

  activeBeam: { from: Vec2; to: Vec2; tool: ToolId } | null = null;
  currentTarget: Cell | null = null; // read by Renderer for target highlight/HUD, mutated only here
  blastEffects: { pos: Vec2; timer: number }[] = []; // read by Renderer for the shockwave visual
  private anchoredCell: Cell | null = null;
  private driftGroups: DriftGroup[] = [];
  // Once two originally-adjacent cells are geometrically confirmed to no longer touch, that
  // connection is gone for good — material doesn't re-fuse just because geometry (e.g. from
  // rotation) happens to bring it back within tolerance a frame later. Without this, a gap
  // sitting near the touch threshold can flicker connected/disconnected forever.
  private severedEdges = new Set<string>();

  private width = 0;
  private height = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.input = new InputState(canvas);
    this.ship = new Ship(SPAWN_POS);
    const asteroidAngle = Math.random() * Math.PI * 2;
    const asteroidDist = 620;
    this.asteroid = new Asteroid(fromAngle(asteroidAngle, asteroidDist));

    for (let i = 0; i < 260; i++) {
      this.stars.push({
        pos: v2((Math.random() * 2 - 1) * WORLD_BOX, (Math.random() * 2 - 1) * WORLD_BOX),
        r: Math.random() < 0.15 ? 1.6 : 0.9,
        brightness: 0.35 + Math.random() * 0.65,
      });
    }
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

    const { ship, asteroid } = this;

    if (input.wasJustPressed(" ")) ship.toggleMode();
    if (input.wasJustPressed("tab")) this.cycleTool();

    // Move every rock body first, so collision this frame resolves against
    // where it actually is now rather than lagging a frame behind. Rock-vs-rock
    // contacts are settled before the ship reacts to the resulting positions.
    this.recomputeDriftGroups();
    this.updateDriftGroups(dt);
    this.resolveGroupCollisions(dt);

    const worldMouse = this.screenToWorld(input.mouseScreen);
    ship.updateMovement(dt, input, worldMouse);
    this.resolveAsteroidCollision(dt);

    // --- sensors: ping + passive close-range detection ---
    // Both sweep the *current* contact list, so a piece that's drifted away after a
    // split still gets found — nothing is hardcoded to "the one asteroid" anymore.
    // What's "discovered" is a snapshot, not a live link: it ages and is eventually
    // forgotten if nothing refreshes it, so radar reflects what you actually know.
    this.pingCooldown = Math.max(0, this.pingCooldown - dt);
    if (input.wasJustPressed("q") && this.pingCooldown <= 0) {
      this.pingActive = true;
      this.pingRadius = 0;
      this.pingCooldown = PING_COOLDOWN;
    }
    const contacts = this.getContacts();
    for (const memory of this.discoveredContacts.values()) memory.age += dt;

    if (this.pingActive) {
      this.pingRadius += PING_SPEED * dt;
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
      if (this.pingRadius > PING_MAX_RADIUS) this.pingActive = false;
    }
    for (const contact of contacts) {
      if (distance(ship.pos, contact.pos) - contact.radius < VISION_RADIUS) {
        this.discoveredContacts.set(contact.id, { contact, age: 0 });
      }
    }
    for (const [id, memory] of this.discoveredContacts) {
      if (memory.age > CONTACT_FORGET_AFTER) this.discoveredContacts.delete(id);
    }

    // --- scan: hold E in range while a wave sweeps outward from the asteroid ---
    if (!asteroid.scanned) {
      const surfaceDist = distance(ship.pos, asteroid.center) - asteroid.outerRadius;
      const canScan = surfaceDist <= SCAN_RANGE;
      if (canScan && input.isDown("e")) {
        asteroid.scanProgress = Math.min(1, asteroid.scanProgress + dt / SCAN_HOLD_SECONDS);
        if (asteroid.scanProgress >= 1) {
          asteroid.scanned = true;
          this.setMessage("ASTEROID SCANNED — see SCAN DATA panel", "#7fe0ff");
        }
      } else {
        asteroid.scanProgress = Math.max(0, asteroid.scanProgress - dt * SCAN_PROGRESS_DECAY);
      }
    }

    // --- tool selection (direct) ---
    if (input.wasJustPressed("1")) ship.selectedTool = "laser";
    if (input.wasJustPressed("2")) ship.selectedTool = "drill";
    if (input.wasJustPressed("3")) ship.selectedTool = "charges";

    this.activeBeam = null;
    this.updateMining(dt, worldMouse);

    ship.decaySignature(dt, SIGNATURE_DECAY_PER_SEC);

    this.blastEffects = this.blastEffects.filter((b) => {
      b.timer -= dt;
      return b.timer > 0;
    });

    // --- chunks ---
    this.cargoFullMessageCooldown = Math.max(0, this.cargoFullMessageCooldown - dt);
    for (const chunk of this.chunks) chunk.update(dt);
    this.resolveChunkCollisions();
    this.chunks = this.chunks.filter((chunk) => {
      const d = distance(chunk.pos, ship.pos);
      if (d < SHIP_RADIUS + CHUNK_COLLECT_RADIUS) {
        if (!ship.cargoFull) {
          const taken = ship.addCargo(chunk.value);
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
    this.resolveChunkShipBumps();

    if (this.message) {
      this.message.timer -= dt;
      if (this.message.timer <= 0) this.message = null;
    }

    if (ship.hull <= 0) this.handleShipDestroyed();

    input.endFrame();
  }

  private cycleTool() {
    const idx = TOOL_ORDER.indexOf(this.ship.selectedTool);
    this.ship.selectedTool = TOOL_ORDER[(idx + 1) % TOOL_ORDER.length];
  }

  private handleShipDestroyed() {
    const lost = this.ship.cargoUsed;
    this.ship.cargoUsed = 0;
    this.ship.hull = MAX_HULL;
    this.ship.pos = { ...SPAWN_POS };
    this.ship.vel = v2(0, 0);
    this.ship.chargesCarried = CHARGE_MAX_CARRIED;
    this.ship.anchored = false;
    this.anchoredCell = null;
    this.chunks = [];
    this.setMessage(lost > 0 ? `SHIP DESTROYED — ${lost} CARGO LOST` : "SHIP DESTROYED", "#ff5c5c");
  }

  /** Checks a circular body (ship or chunk) against the asteroid. When the body's center is
   *  cleanly inside a single cell (the common case — pressed against solid rock), resolves
   *  against *that* cell only, so the contact normal stays stable while sliding along a
   *  multi-cell surface instead of flickering between neighboring cells' slightly different
   *  edge angles at every seam (which reads as snagging on nothing). Only when the center is
   *  out in open space does it fall back to the nearest edge within `radius` of any cell —
   *  that's the narrow-gap case, where a body could otherwise slip through a gap thinner than
   *  itself because no single cell's point-in-polygon test ever notices it. */
  private findCellContact(pos: Vec2, radius: number): { cell: Cell; boundary: BoundaryHit } | null {
    for (const cell of this.asteroid.cells) {
      if (cell.fractured || cell.polygon.length < 3) continue;
      if (!pointInPolygon(pos, cell.polygon)) continue;
      const boundary = closestBoundaryPoint(cell.polygon, pos);
      if (boundary) return { cell, boundary };
    }

    let bestCell: Cell | null = null;
    let bestBoundary: BoundaryHit | null = null;
    let bestDist = radius;

    for (const cell of this.asteroid.cells) {
      if (cell.fractured || cell.polygon.length < 3) continue;
      const boundary = closestBoundaryPoint(cell.polygon, pos);
      if (!boundary || boundary.distance >= bestDist) continue;
      bestDist = boundary.distance;
      bestCell = cell;
      bestBoundary = boundary;
    }
    return bestCell && bestBoundary ? { cell: bestCell, boundary: bestBoundary } : null;
  }

  /** Ship-vs-rock collision, resolved as a real rigid-body contact against the rock's actual
   *  velocity *and spin* (not just its center velocity) — a moving or spinning piece properly
   *  shoves the ship instead of just snapping its position every frame. The ship itself never
   *  spins from a hit (its orientation is player/thruster-controlled, not tumbling debris). */
  private resolveAsteroidCollision(dt: number) {
    const { ship } = this;
    const contact = this.findCellContact(ship.pos, SHIP_RADIUS);
    if (!contact) return;
    const { cell, boundary } = contact;

    // Close the overlap gradually rather than snapping straight to the surface —
    // a hard teleport is what reads as a "jump" when the rock itself is moving.
    const targetPos = add(boundary.point, scale(boundary.normal, SHIP_RADIUS * 0.6 + 0.5));
    const correctionFactor = Math.min(1, POSITION_CORRECTION_RATE * dt);
    ship.pos = add(ship.pos, scale(sub(targetPos, ship.pos), correctionFactor));

    const group = this.driftGroupOf(cell);
    const rockBody = this.rigidRefForGroup(group);
    const shipBody: RigidRef = { pos: ship.pos, vel: ship.vel, angVel: 0, invMass: 1 / SHIP_MASS, invInertia: 0 };

    const rB = sub(boundary.point, rockBody.pos);
    const contactVelRock = velocityAtPoint(rockBody.vel, rockBody.angVel, rB);
    const closingSpeed = -dot(sub(ship.vel, contactVelRock), boundary.normal);
    if (closingSpeed <= 0) return; // already separating

    if (closingSpeed > COLLISION_MIN_SPEED) {
      const damage = (closingSpeed - COLLISION_MIN_SPEED) * COLLISION_DAMAGE_SCALE;
      ship.takeImpact(damage);
      this.setMessage(`HULL DAMAGE -${damage.toFixed(0)}`, "#ff6b6b");
    }

    const result = resolveContact(shipBody, rockBody, boundary.point, boundary.normal, COLLISION_RESTITUTION);
    ship.vel = result.velA;
    if (group) {
      group.vel = result.velB;
      group.angularVelocity = result.angVelB;
    }

    const tangent = sub(ship.vel, scale(boundary.normal, dot(ship.vel, boundary.normal)));
    ship.vel = add(scale(boundary.normal, dot(ship.vel, boundary.normal)), scale(tangent, 0.92));
  }

  /** Rock-vs-rock: separate drift groups now collide with each other instead of passing through.
   *  Broad+narrow phase in one pass, approximating each cell as a circle (cells are small and
   *  roughly convex, so this is close enough without full polygon-polygon SAT). */
  private resolveGroupCollisions(dt: number) {
    for (let i = 0; i < this.driftGroups.length; i++) {
      for (let j = i + 1; j < this.driftGroups.length; j++) {
        this.resolveGroupPair(this.driftGroups[i], this.driftGroups[j], dt);
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

    for (const cellA of groupA.cells) {
      const rA = boundingRadius(cellA.polygon, cellA.centroid);
      for (const cellB of groupB.cells) {
        const rB = boundingRadius(cellB.polygon, cellB.centroid);
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
      const result = resolveContact(bodyA, bodyB, contact, normal, ROCK_ROCK_RESTITUTION);
      groupA.vel = result.velA;
      groupA.angularVelocity = result.angVelA;
      groupB.vel = result.velB;
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

  private groupMass(group: DriftGroup): number {
    const area = group.cells.reduce((sum, c) => sum + polygonArea(c.polygon), 0);
    return Math.max(1, area * ROCK_MASS_PER_AREA);
  }

  /** Mass-weighted center of mass — the pivot every group rotates and is pushed around.
   *  Takes a raw cell list (not a DriftGroup) so it can also be used for a candidate
   *  component before it's been wrapped into a group, e.g. right after a split. */
  private groupCenterOfMass(cells: Cell[]): Vec2 {
    let totalMass = 0;
    let acc = v2(0, 0);
    for (const cell of cells) {
      const m = polygonArea(cell.polygon) * ROCK_MASS_PER_AREA;
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
      const m = polygonArea(cell.polygon) * ROCK_MASS_PER_AREA;
      const ownInertia = polygonSecondMomentOfArea(cell.polygon) * ROCK_MASS_PER_AREA;
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

  /** Every currently-trackable thing in the world, for ping/radar. Rock pieces are the only
   *  kind today — other asteroids, ships, drones, enemies, and satellites should plug in here
   *  the same way once they exist, rather than ping/radar needing new special-case code. */
  getContacts(): Contact[] {
    return this.driftGroups.map((group) => {
      const com = this.groupCenterOfMass(group.cells);
      return {
        id: `rock-${group.id}`,
        kind: "rock" as const,
        pos: com,
        radius: this.groupBoundingRadius(group, com),
        label: "Rock Mass",
      };
    });
  }

  /** Keeps drifting/collected chunks from passing straight through solid rock. */
  private resolveChunkCollisions() {
    for (const chunk of this.chunks) {
      const contact = this.findCellContact(chunk.pos, chunk.radius);
      if (!contact) continue;
      const { boundary } = contact;

      chunk.pos = add(boundary.point, scale(boundary.normal, chunk.radius * 0.6 + 0.5));
      const radial = dot(chunk.vel, boundary.normal);
      if (radial < 0) {
        chunk.vel = sub(chunk.vel, scale(boundary.normal, radial * 1.5));
      }
    }
  }

  /** Chunks the ship couldn't collect (cargo full) still physically bump it — no damage. */
  private resolveChunkShipBumps() {
    const { ship } = this;
    for (const chunk of this.chunks) {
      const d = distance(ship.pos, chunk.pos);
      const minDist = SHIP_RADIUS + chunk.radius;
      if (d >= minDist || d < 1e-6) continue;

      const normal = scale(sub(ship.pos, chunk.pos), 1 / d);
      const penetration = minDist - d;
      const chunkMass = chunk.radius * chunk.radius;
      const shipMass = SHIP_RADIUS * SHIP_RADIUS * 4;
      const totalMass = chunkMass + shipMass;
      const shipPush = chunkMass / totalMass;
      const chunkPush = shipMass / totalMass;

      ship.pos = add(ship.pos, scale(normal, penetration * shipPush));
      chunk.pos = sub(chunk.pos, scale(normal, penetration * chunkPush));

      const relVel = sub(ship.vel, chunk.vel);
      const closingSpeed = -dot(relVel, normal);
      if (closingSpeed <= 0) continue;
      const impulse = closingSpeed * CHUNK_SHIP_BUMP_RESTITUTION;
      ship.vel = add(ship.vel, scale(normal, impulse * chunkPush));
      chunk.vel = sub(chunk.vel, scale(normal, impulse * shipPush));
    }
  }

  /** Recomputes which clusters of intact cells are still connected to the main mass.
   *  Once the body has been split, every resulting piece drifts — including
   *  whatever remains of the original mass. A never-cut asteroid stays put. */
  private recomputeDriftGroups() {
    const { asteroid } = this;
    const intact = asteroid.cells.filter((c) => !c.fractured);
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
        for (const neighborId of asteroid.neighbors.get(id) ?? []) {
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
        return { id: nextGroupId++, cells: comp, vel: v2(0, 0), angularVelocity: 0 };
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
  }

  private updateDriftGroups(dt: number) {
    for (const group of this.driftGroups) {
      if (Math.abs(group.angularVelocity) < 1e-5 && length(group.vel) < 1e-5) continue;

      const com = this.groupCenterOfMass(group.cells);
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
    return this.driftGroups.find((g) => g.cells.includes(cell));
  }

  private updateMining(dt: number, worldMouse: Vec2) {
    const { ship, asteroid, input } = this;
    this.currentTarget = null;
    if (ship.mode !== "rcs") {
      ship.anchored = false;
      return;
    }

    const toolDef = TOOLS[ship.selectedTool];
    const inRange = distance(ship.pos, worldMouse) <= toolDef.range;
    const cell = inRange ? asteroid.cellAt(worldMouse) : null;
    const validCell = cell && !cell.fractured ? cell : null;
    if (validCell) this.currentTarget = validCell;

    if (ship.selectedTool === "laser") {
      ship.anchored = false;
      this.anchoredCell = null;
      if (input.mouseDown && validCell) this.cutCell(validCell, dt);
    } else if (ship.selectedTool === "drill") {
      this.runDrill(validCell, dt);
    } else {
      ship.anchored = false;
      this.anchoredCell = null;
      if (
        input.mouseJustPressed &&
        validCell &&
        !validCell.hasCharge &&
        ship.chargesCarried > 0
      ) {
        validCell.hasCharge = true;
        ship.chargesCarried -= 1;
        this.setMessage("CHARGE PLACED", "#ffcf5c");
      }
      if (input.wasJustPressed("r")) this.detonateCharges();
    }
  }

  /** Laser: shaves a sliver off the cell each completed cut, in place, until it's small enough to eject whole. */
  private cutCell(cell: Cell, dt: number) {
    const { ship, asteroid } = this;
    const info = COMPOSITION_INFO[cell.composition];
    const mult = info.recommendedTool === "laser" ? TOOL_RECOMMENDED_MULT : TOOL_OFF_MULT;
    cell.cutProgress += dt * mult;
    ship.addSignature(LASER_SIG_PER_SEC * dt);

    const nearest = closestBoundaryPoint(cell.polygon, ship.pos);
    if (nearest) this.activeBeam = { from: ship.pos, to: nearest.point, tool: "laser" };

    if (cell.cutProgress < info.cutSeconds) return;
    cell.cutProgress = 0;
    cell.piecesRemaining -= 1;

    const result = sliceNearPoint(cell.polygon, ship.pos, LASER_CUT_DEPTH);
    const outDir = normalize(sub(cell.centroid, asteroid.center));

    if (!result || cell.piecesRemaining <= 0 || result.remainder.length < 3 || polygonArea(result.remainder) < MIN_CELL_AREA) {
      this.extractWholeCell(cell, 60 + Math.random() * 30);
      return;
    }

    if (result.sliver.length >= 3 && polygonArea(result.sliver) > 4) {
      this.spawnChunk(
        polygonCentroid(result.sliver),
        cell.composition,
        info.chunkValue,
        scale(outDir, 55 + Math.random() * 30),
      );
    }

    cell.polygon = result.remainder;
    cell.centroid = polygonCentroid(result.remainder);
  }

  private runDrill(validTarget: Cell | null, dt: number) {
    const { ship, input } = this;
    const releasingFrom = ship.anchored ? this.anchoredCell : null;

    if (this.anchoredCell && this.anchoredCell !== validTarget) {
      this.anchoredCell = null;
    }

    const boundary = validTarget ? closestBoundaryPoint(validTarget.polygon, ship.pos) : null;
    const withinAnchorRange = boundary ? boundary.distance <= DRILL_ANCHOR_RANGE : false;
    // Speed gate disabled for now — a fast-moving/spinning drift group made anchoring
    // impossible since the ship has to match its speed just to stay in range.
    const canAnchor = !!validTarget && withinAnchorRange && input.mouseDown;

    if (canAnchor && validTarget) {
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

      const info = COMPOSITION_INFO[validTarget.composition];
      const mult = info.recommendedTool === "drill" ? TOOL_RECOMMENDED_MULT : TOOL_OFF_MULT;
      validTarget.boreProgress += (dt * mult) / info.boreSeconds;
      ship.addSignature(DRILL_SIG_PER_SEC * dt);
      if (boundary) this.activeBeam = { from: ship.pos, to: boundary.point, tool: "drill" };

      if (validTarget.boreProgress >= 1) {
        this.extractWholeCell(validTarget, 40 + Math.random() * 20);
        this.anchoredCell = null;
        ship.anchored = false;
        this.setMessage("CORE EXTRACTED", "#ffb35c");
      }
    } else {
      // Letting go — keep whatever momentum the rock had at that point (including
      // its spin) rather than snapping to a dead stop.
      if (releasingFrom) {
        const group = this.driftGroupOf(releasingFrom);
        if (group) {
          const com = this.groupCenterOfMass(group.cells);
          const r = sub(ship.pos, com);
          ship.vel = velocityAtPoint(group.vel, group.angularVelocity, r);
        }
      }
      ship.anchored = false;
      if (validTarget) {
        validTarget.boreProgress = Math.max(0, validTarget.boreProgress - dt * DRILL_PROGRESS_DECAY);
      }
    }
  }

  private detonateCharges() {
    const { asteroid, ship } = this;
    const charged = asteroid.cells.filter((c) => c.hasCharge);
    if (charged.length === 0) {
      this.setMessage("NO CHARGES PLACED", "#ff8f6b");
      return;
    }

    const blastPositions = charged.map((c) => c.centroid);
    let shipHit = false;

    for (const blastPos of blastPositions) {
      this.blastEffects.push({ pos: blastPos, timer: BLAST_VISUAL_DURATION });

      const shipDist = distance(ship.pos, blastPos);
      if (shipDist <= CHARGE_BLAST_RADIUS) {
        shipHit = true;
        const falloff = 1 - shipDist / CHARGE_BLAST_RADIUS;
        const damage = CHARGE_BLAST_DAMAGE_MAX * falloff;
        if (damage > 0.2) ship.takeImpact(damage);
        const pushDir = shipDist > 1e-6 ? normalize(sub(ship.pos, blastPos)) : v2(1, 0);
        ship.vel = add(ship.vel, scale(pushDir, CHARGE_BLAST_PUSH_MAX * falloff));
      }
    }

    // Extract everything first, so if this blast splits the body, the drift
    // groups we recoil below reflect the pieces that actually result from it.
    for (const cell of charged) {
      cell.hasCharge = false;
      this.extractWholeCell(cell, 210 + Math.random() * 60);
    }

    this.recomputeDriftGroups();

    // Each blast pushes whichever resulting piece it actually ended up next
    // to — so if this detonation split the body in half, each half recoils
    // away from the blast(s) nearest it. Several charges on the same piece
    // stack additively (more charges = stronger push), and since the impulse
    // is applied at the actual blast point rather than the center of mass, an
    // off-center charge also imparts spin — a lopsided blast induces tumble.
    for (const blastPos of blastPositions) {
      const group = this.nearestDriftGroup(blastPos);
      if (!group) continue;
      const body = this.rigidRefForGroup(group);
      const dir = normalize(sub(body.pos, blastPos));
      const impulse = scale(dir, CHARGE_IMPULSE_PER_CHARGE);
      const applied = applyPointImpulse(body, blastPos, impulse);
      group.vel = applied.vel;
      group.angularVelocity = applied.angVel;
    }

    ship.addSignature(CHARGE_SIG_PER_USE * charged.length);
    this.setMessage(
      shipHit
        ? `DETONATED ${charged.length} CHARGE${charged.length > 1 ? "S" : ""} — CAUGHT IN THE BLAST`
        : `DETONATED ${charged.length} CHARGE${charged.length > 1 ? "S" : ""}`,
      shipHit ? "#ff6b6b" : "#ffa25c",
    );
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
    const value = info.chunkValue * Math.max(1, cell.piecesRemaining);
    const pos = cell.centroid;
    const outDir = normalize(sub(pos, this.asteroid.center));
    cell.fractured = true;
    cell.hasCharge = false;
    this.spawnChunk(pos, cell.composition, value, scale(outDir, impulseSpeed));
  }

  private spawnChunk(worldPos: Vec2, composition: Cell["composition"], value: number, vel: Vec2) {
    this.chunks.push(new Chunk(worldPos, vel, composition, value));
  }
}
