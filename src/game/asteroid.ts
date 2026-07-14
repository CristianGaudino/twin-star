import { Vec2, add, distance, dot, fromAngle, normalize, scale, sub, v2 } from "./vec2";
import { Polygon, boundingRadius, clipHalfPlane, pointInPolygon, polygonArea, polygonCentroid } from "./poly";
import {
  ASTEROID_BASE_RADIUS,
  ASTEROID_OUTLINE_POINTS,
  ASTEROID_SEED_COUNT,
  MATERIAL_WEIGHT_SCALE,
  REFERENCE_CELL_AREA,
  ROCK_MASS_PER_AREA,
  SCAN_HOLD_SECONDS,
  SCAN_SECONDS_MAX,
  SCAN_SECONDS_MIN,
} from "./constants";
import { weightedPick } from "./random";
import { ToolId } from "./tools";

/**
 * Real, grounded resource names rather than an abstract "ore/crystal/unstable" placeholder set —
 * see twin-star-spec.md Section 17. Each is tied to which AsteroidType can actually contain it
 * (RESOURCE_WEIGHTS_BY_TYPE below), not just a flat universal chance.
 */
export type Composition = "rock" | "nickelIron" | "crystal" | "platinum" | "ice" | "radioactive";

export interface CompositionInfo {
  composition: Composition;
  label: string;
  color: string;
  hardness: number; // 1-5, shown to the player — denser/tougher material takes more work
  totalPieces: number; // laser: number of cuts to fully consume the cell
  chunkValue: number; // rough size/amount per piece (drill/charges yield totalPieces * chunkValue in one chunk)
  // g/cm^3, real approximate density (ordinary chondrite, iron meteorite, olivine, etc.) — the
  // actual weight (see weightKgFor) a given amount of this resource contributes to the cargo
  // hold's real, mass-limited capacity. Two resources can have the same `chunkValue` (roughly
  // the same physical size) and still weigh very differently, same as in reality.
  density: number;
  cutSeconds: number; // laser: beam-seconds required per cut
  boreSeconds: number; // drill: seconds anchored required to bore out the whole cell
  recommendedTool: ToolId; // internal — biases mining speed, deliberately not surfaced in the UI
}

export const COMPOSITION_INFO: Record<Composition, CompositionInfo> = {
  rock: {
    // Ordinary chondrite — the bulk material of most meteorites ever recovered on Earth, and the
    // bulk of most asteroids in this system. Cargo-space tradeoff, not a resource worth seeking.
    composition: "rock",
    label: "Chondrite Rock",
    color: "#8a7d6b",
    hardness: 1,
    totalPieces: 2,
    chunkValue: 1,
    density: 3.3, // real ordinary chondrite density
    cutSeconds: 0.3,
    boreSeconds: 1.2,
    recommendedTool: "laser",
  },
  nickelIron: {
    // Real structural asteroid metal — the literal material of iron meteorites. The
    // bread-and-butter resource upgrade costs are priced against.
    composition: "nickelIron",
    label: "Nickel-Iron",
    color: "#9aa3ad",
    hardness: 3,
    totalPieces: 4,
    chunkValue: 2,
    density: 7.9, // real iron-nickel meteorite density
    cutSeconds: 0.6,
    boreSeconds: 2.4,
    recommendedTool: "drill",
  },
  crystal: {
    // Olivine/pyroxene crystal formations — real precedent is peridot (gem-grade olivine),
    // genuinely recovered from pallasite meteorites.
    composition: "crystal",
    label: "Silicate Crystal",
    color: "#7fa8ff",
    hardness: 5,
    totalPieces: 6,
    chunkValue: 3,
    density: 3.5, // real olivine density, ~3.3-4.4
    cutSeconds: 0.8,
    boreSeconds: 3.6,
    recommendedTool: "charges",
  },
  platinum: {
    // The actual reason real asteroid-mining proposals target metallic asteroids: rare on Earth,
    // valuable for electronics/catalysis. Only ever found in M-type bodies.
    composition: "platinum",
    label: "Platinum-Group Ore",
    color: "#d9d4c3",
    hardness: 4,
    totalPieces: 5,
    chunkValue: 5,
    density: 7.5, // ore, not pure metal — real platinum itself is ~21.5, this is host rock + PGMs
    cutSeconds: 0.9,
    boreSeconds: 3.0,
    recommendedTool: "drill",
  },
  ice: {
    // Water ice — genuinely rare this close to a hot star (real precedent: Mercury keeps ice in
    // permanently-shadowed polar craters despite being the closest planet to the Sun). Not
    // spendable on anything yet — earmarked for the still-unbuilt fuel/life-support systems.
    // Soft and fast once found — it's finding it that's hard, not clearing it.
    composition: "ice",
    label: "Water Ice",
    color: "#bfe9ff",
    hardness: 1,
    totalPieces: 3,
    chunkValue: 2,
    density: 0.92, // real water ice density — deliberately less dense than rock, same as reality
    cutSeconds: 0.25,
    boreSeconds: 1.0,
    recommendedTool: "laser",
  },
  radioactive: {
    // Uranium/thorium-bearing minerals — real and hazardous. Recommended tool is charges for a
    // safety reason, not a hardness one: place the charge and retreat, rather than lingering
    // next to it boring or lasering for an extended exposure.
    composition: "radioactive",
    label: "Radioactive Ore",
    color: "#7de08d",
    hardness: 2,
    totalPieces: 3,
    chunkValue: 4,
    density: 6.5, // ore, not pure uraninite — real uraninite is ~10.9, this is host rock + it
    cutSeconds: 0.5,
    boreSeconds: 2.0,
    recommendedTool: "charges",
  },
};

/** Canonical ordering, derived from COMPOSITION_INFO itself rather than hand-duplicated —
 *  used anywhere that needs "every resource" (HUD material lists, scan-data breakdowns) so
 *  adding a seventh resource later doesn't require updating three separate hardcoded arrays. */
export const COMPOSITIONS = Object.keys(COMPOSITION_INFO) as Composition[];

export interface Cell {
  id: number;
  polygon: Polygon;
  centroid: Vec2;
  composition: Composition;
  piecesRemaining: number;
  fractured: boolean;
  hasCharge: boolean;
  cutProgress: number; // laser: accumulated beam-seconds toward the next cut
  boreProgress: number; // drill: 0..1
  fractures: CrackSegment[] | null; // drill fracture visual — see cellLocalToWorld
  shade: string; // pre-scan rock color, varied per cell so the body reads as textured, not flat
  // Permanent back-reference, set once at creation — unlike drift-group membership (which
  // changes when mining splits a body), a cell's origin asteroid never changes. Lets callers
  // that need "which asteroid is this from" (e.g. renderer hover/target lookups) do an O(1)
  // read instead of a linear search over every asteroid's every cell.
  asteroid: Asteroid;
}

/** A point expressed relative to a cell's own centroid, in a basis built from
 *  (centroid -> polygon[0]) and its perpendicular — i.e. it rotates and translates
 *  *with* the cell automatically, since that basis is recomputed from the cell's own
 *  current geometry every time. Used for drill cracks, which must stay glued to a
 *  specific spot on the rock even as the piece drifts and spins. Only valid for the
 *  lifetime of a cell's polygon identity (safe across drift/rotation, not across the
 *  cell being re-sliced by the laser — but a cell is never lasered while being drilled,
 *  they're mutually exclusive actions on the same target). */
export interface LocalPoint {
  a: number;
  b: number;
}

/** One hairline of a fracture network — see `Engine.generateFractures`. `order` is the 0..1
 *  point in `boreProgress` at which this segment finishes growing in, so segments from every
 *  branch at the same "generation" reveal together and the crack visibly spreads and forks as
 *  a whole rather than completing one arm at a time. */
export interface CrackSegment {
  a: LocalPoint;
  b: LocalPoint;
  order: number;
}

function cellBasis(cell: Cell): { x: Vec2; y: Vec2 } {
  let x = normalize(sub(cell.polygon[0], cell.centroid));
  if (x.x === 0 && x.y === 0) x = v2(1, 0);
  return { x, y: v2(-x.y, x.x) };
}

export function cellLocalToWorld(cell: Cell, p: LocalPoint): Vec2 {
  const { x, y } = cellBasis(cell);
  return add(cell.centroid, add(scale(x, p.a), scale(y, p.b)));
}

export function cellWorldToLocal(cell: Cell, point: Vec2): LocalPoint {
  const { x, y } = cellBasis(cell);
  const rel = sub(point, cell.centroid);
  return { a: dot(rel, x), b: dot(rel, y) };
}

/**
 * Real asteroid spectral classification, simplified to what's relevant here (twin-star-spec.md
 * Section 17) — the load-bearing new concept: an asteroid's type is discoverable (scan reveals
 * it, same as composition always has been) and determines which resources are even possible to
 * find on that body, not just flavor text over the same universal chance every asteroid had
 * before.
 */
export type AsteroidType = "S" | "C" | "M" | "Icy";

export interface AsteroidTypeInfo {
  type: AsteroidType;
  label: string; // shown once scanned, e.g. "S-type (Silicaceous)"
}

export const ASTEROID_TYPE_INFO: Record<AsteroidType, AsteroidTypeInfo> = {
  S: { type: "S", label: "S-type (Silicaceous)" },
  C: { type: "C", label: "C-type (Carbonaceous)" },
  M: { type: "M", label: "M-type (Metallic)" },
  Icy: { type: "Icy", label: "Icy" },
};

/** What each asteroid type can actually contain, and how much of it — see twin-star-spec.md
 *  Section 17 for the real-world reasoning behind each. Every type carries a small Radioactive
 *  Ore chance ("any type, always rare" per spec) rather than that being a separate mechanic.
 *  Weights don't need to sum to 1, weightedPick normalizes them. */
export const RESOURCE_WEIGHTS_BY_TYPE: Record<AsteroidType, Record<Composition, number>> = {
  // Stony with real metal content — the dominant type this close to the star, mirrors our own
  // solar system's inner belt.
  S: { rock: 0.55, nickelIron: 0.32, crystal: 0.1, platinum: 0, ice: 0, radioactive: 0.03 },
  // Darker, more chemically primitive, mostly bulk rock with less metal than S-type.
  C: { rock: 0.75, nickelIron: 0.1, crystal: 0.1, platinum: 0, ice: 0, radioactive: 0.05 },
  // Dense, mostly metal — no filler rock, no crystal, no ice: finding one is a distinct, worth-
  // seeking-out event, and Platinum-Group Ore only ever comes from here.
  M: { rock: 0, nickelIron: 0.65, crystal: 0, platinum: 0.32, ice: 0, radioactive: 0.03 },
  // "Dirty snowball" — mostly ice with real rock/dust content too, same as real comets.
  Icy: { rock: 0.25, nickelIron: 0, crystal: 0, platinum: 0, ice: 0.68, radioactive: 0.07 },
};

/** Picks this body's actual resource mix from its type's weight table (see
 *  RESOURCE_WEIGHTS_BY_TYPE) — a body's type determines what's possible, this determines which
 *  specific cell gets which resource. */
function makeCompositionPicker(type: AsteroidType) {
  const weights = RESOURCE_WEIGHTS_BY_TYPE[type];
  return (roll: number): Composition => weightedPick(weights, roll);
}

/** Bigger asteroids get proportionally more cells, but sublinearly — a large body should read
 *  as more rock, not as finely subdivided rock (linear-with-area would make big asteroids
 *  absurdly expensive to simulate). Calibrated so the original radius (190) reproduces the
 *  original seed count (32). */
function seedCountForRadius(radius: number): number {
  const scaled = ASTEROID_SEED_COUNT * Math.sqrt(radius / ASTEROID_BASE_RADIUS);
  return Math.round(Math.max(6, Math.min(60, scaled)));
}

/** Bigger asteroids take longer to scan, same sqrt-scaled shape as `seedCountForRadius` — a
 *  large body should feel like more to read, but sublinearly, not 3x the wait for 3x the
 *  radius. Calibrated so the original base radius (190) reproduces the original flat scan time
 *  (SCAN_HOLD_SECONDS), clamped so a tiny rock is never instant and the biggest asteroid never
 *  drags on forever. */
export function scanSecondsForRadius(radius: number): number {
  const scaled = SCAN_HOLD_SECONDS * Math.sqrt(radius / ASTEROID_BASE_RADIUS);
  return Math.max(SCAN_SECONDS_MIN, Math.min(SCAN_SECONDS_MAX, scaled));
}

/** A chunk's actual cargo value from the physical area being extracted — a piece cut from a
 *  huge cell should be worth more than the same resource cut from a sliver, not the same flat
 *  amount either way. Sqrt-scaled around REFERENCE_CELL_AREA, same shape as
 *  seedCountForRadius/scanSecondsForRadius: `baseValue` (COMPOSITION_INFO.chunkValue) applies
 *  exactly at the reference area, less below it, more above it, but never linearly — an extreme
 *  outlier cell shouldn't be able to overflow the whole cargo hold in one grab. Always at least 1
 *  — even a sliver is worth something. */
export function chunkValueForArea(baseValue: number, area: number): number {
  return Math.max(1, Math.round(baseValue * Math.sqrt(area / REFERENCE_CELL_AREA)));
}

/** Real weight in kg for a given amount of a resource — the actual constraint on the cargo
 *  hold's real, mass-limited capacity (see CARGO_CAPACITY_KG). Two resources can have the same
 *  `amount` (roughly the same physical size, via chunkValueForArea) and still weigh very
 *  differently, driven by COMPOSITION_INFO's real density figures — a hold full of Nickel-Iron
 *  weighs much more than the same hold full of Water Ice, same as in reality. */
export function weightKgFor(composition: Composition, amount: number): number {
  return amount * COMPOSITION_INFO[composition].density * MATERIAL_WEIGHT_SCALE;
}

/** The single source of truth for "how much does this much rock actually weigh, physically" —
 *  every place in the game that turns a polygon's area into a collision/rigid-body mass
 *  (a cell, a group of cells, a loose chunk) goes through this, so a Nickel-Iron cell is exactly
 *  as heavy as the Nickel-Iron chunk it becomes once extracted, not two disconnected numbers.
 *  ROCK_MASS_PER_AREA is the baseline rate at ordinary rock's own density; every other resource
 *  scales it by its real density relative to rock's (see COMPOSITION_INFO). */
export function massPerAreaFor(composition: Composition): number {
  return ROCK_MASS_PER_AREA * (COMPOSITION_INFO[composition].density / COMPOSITION_INFO.rock.density);
}

export function massForArea(composition: Composition, area: number): number {
  return area * massPerAreaFor(composition);
}

/** Coarse human-readable size bucket for a radius — used for radar contact labels (see Engine's
 *  getContacts) so an identified rock reads as e.g. "Large Asteroid" instead of just "Asteroid".
 *  Thresholds sit at the midpoints between ASTEROID_SIZE_CLASSES/TINY_ROCK_RADIUS's own gaps,
 *  not exact range membership — a drift group's *current* bounding radius shrinks as it's mined
 *  down, so it won't always land cleanly inside one of those original spawn ranges. */
export function sizeLabelForRadius(radius: number): string {
  if (radius < 55) return "Tiny";
  if (radius < 150) return "Small";
  if (radius < 300) return "Medium";
  return "Large";
}

function generateOutline(center: Vec2, baseRadius: number, rand: () => number): Polygon {
  const points = ASTEROID_OUTLINE_POINTS;
  const h1Amp = baseRadius * (0.14 + rand() * 0.08);
  const h2Amp = baseRadius * (0.06 + rand() * 0.06);
  const h1Phase = rand() * Math.PI * 2;
  const h2Phase = rand() * Math.PI * 2;
  const h1Freq = 3 + Math.floor(rand() * 2);
  const h2Freq = 5 + Math.floor(rand() * 3);
  const poly: Polygon = [];
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2;
    const noise =
      Math.sin(angle * h1Freq + h1Phase) * h1Amp +
      Math.sin(angle * h2Freq + h2Phase) * h2Amp +
      (rand() - 0.5) * baseRadius * 0.05;
    const r = Math.max(baseRadius * 0.45, baseRadius + noise);
    poly.push(add(center, fromAngle(angle, r)));
  }
  return poly;
}

function scatterSeeds(center: Vec2, outline: Polygon, count: number, rand: () => number): Vec2[] {
  const seeds: Vec2[] = [];
  let maxR = 0;
  for (const p of outline) maxR = Math.max(maxR, distance(p, center));
  const minSpacing = (maxR / Math.sqrt(count)) * 0.55;
  let attempts = 0;
  while (seeds.length < count && attempts < count * 60) {
    attempts++;
    const angle = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * maxR * 0.94;
    const candidate = add(center, fromAngle(angle, r));
    if (!pointInPolygon(candidate, outline)) continue;
    if (seeds.some((s) => distance(s, candidate) < minSpacing)) continue;
    seeds.push(candidate);
  }
  return seeds;
}

function computeVoronoiCellPolygon(index: number, seeds: Vec2[], outline: Polygon): Polygon {
  let poly: Polygon = outline;
  const seed = seeds[index];
  for (let j = 0; j < seeds.length; j++) {
    if (j === index) continue;
    const other = seeds[j];
    const mid = scale(add(seed, other), 0.5);
    const normal = sub(other, seed);
    poly = clipHalfPlane(poly, mid, normal);
    if (poly.length < 3) return [];
  }
  return poly;
}

const EDGE_MATCH_EPS = 0.75;

const pointsClose = (a: Vec2, b: Vec2, eps: number): boolean =>
  Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps;

/** Two Voronoi cells are adjacent iff they share a boundary edge (traversed in opposite order). */
function polygonsShareEdge(a: Polygon, b: Polygon): boolean {
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i];
    const a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const b1 = b[j];
      const b2 = b[(j + 1) % b.length];
      if (
        (pointsClose(a1, b2, EDGE_MATCH_EPS) && pointsClose(a2, b1, EDGE_MATCH_EPS)) ||
        (pointsClose(a1, b1, EDGE_MATCH_EPS) && pointsClose(a2, b2, EDGE_MATCH_EPS))
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Adjacency, computed once from the original geometry — used to tell whether mining has
 *  disconnected a cluster of cells from the rest of the body. */
function computeNeighbors(cells: Cell[]): Map<number, number[]> {
  const map = new Map<number, number[]>();
  for (const cell of cells) map.set(cell.id, []);
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      if (polygonsShareEdge(cells[i].polygon, cells[j].polygon)) {
        map.get(cells[i].id)!.push(cells[j].id);
        map.get(cells[j].id)!.push(cells[i].id);
      }
    }
  }
  return map;
}

let nextCellId = 1;

export interface AsteroidOptions {
  radius?: number; // defaults to ASTEROID_BASE_RADIUS — the belt scatters a range of sizes
  type?: AsteroidType; // defaults to "S" — determines the resource mix, see RESOURCE_WEIGHTS_BY_TYPE
  // Overrides seedCountForRadius — a small standalone boulder (see Engine's belt scattering)
  // wants exactly 1 cell (the whole body, one mineable piece) rather than the handful the
  // normal size-based formula would still produce at a small-but-not-tiny radius.
  seedCount?: number;
  // Picked up once by Engine.recomputeDriftGroups on the very first frame only, to seed that
  // body's initial drift — most of the belt starts fully at rest, but a few bodies drifting
  // from the start reads as a livelier field. Irrelevant after the first frame (the group's own
  // `vel` takes over from there).
  initialVelocity?: Vec2;
}

export class Asteroid {
  center: Vec2;
  outerRadius: number; // approximate, used for range checks
  type: AsteroidType; // spectral classification — determines possible resources, revealed on scan
  outline: Polygon;
  cells: Cell[];
  neighbors: Map<number, number[]>;
  scanned = false;
  scanProgress = 0; // 0..1 — climbs while the ship holds a scan in range, decays otherwise
  initialVelocity: Vec2;

  constructor(center: Vec2, rand: () => number = Math.random, options: AsteroidOptions = {}) {
    const radius = options.radius ?? ASTEROID_BASE_RADIUS;
    this.type = options.type ?? "S";
    const pickComposition = makeCompositionPicker(this.type);

    this.center = center;
    this.outerRadius = radius;
    this.initialVelocity = options.initialVelocity ?? v2(0, 0);
    this.outline = generateOutline(center, radius, rand);
    const seeds = scatterSeeds(center, this.outline, options.seedCount ?? seedCountForRadius(radius), rand);

    this.cells = [];
    for (let i = 0; i < seeds.length; i++) {
      const polygon = computeVoronoiCellPolygon(i, seeds, this.outline);
      if (polygon.length < 3 || polygonArea(polygon) < 20) continue;
      const composition = pickComposition(rand());
      const tone = 62 + Math.floor(rand() * 22); // 62-84, subtle rock-to-rock variance
      this.cells.push({
        id: nextCellId++,
        polygon,
        centroid: polygonCentroid(polygon),
        composition,
        piecesRemaining: COMPOSITION_INFO[composition].totalPieces,
        fractured: false,
        hasCharge: false,
        cutProgress: 0,
        boreProgress: 0,
        fractures: null,
        shade: `rgb(${tone},${tone},${tone + 4})`,
        asteroid: this,
      });
    }
    this.neighbors = computeNeighbors(this.cells);
  }

  /** Classify a world point into the intact cell containing it, or null. Cheap bounding-radius
   *  reject before the real point-in-polygon test — this is called every single frame
   *  (Engine.computeHoverTarget runs unconditionally, any mode/tool) across every asteroid in
   *  the belt, so a cell nowhere near worldPos should never pay for a full ray-cast. Keyed off
   *  the cell's own current centroid/shape rather than the asteroid's fixed origin, so it stays
   *  correct for cells that have drifted far from where this asteroid originally spawned. */
  cellAt(worldPos: Vec2): Cell | null {
    for (const cell of this.cells) {
      if (cell.fractured) continue;
      const reach = boundingRadius(cell.polygon, cell.centroid);
      if (distance(worldPos, cell.centroid) > reach) continue;
      if (pointInPolygon(worldPos, cell.polygon)) return cell;
    }
    return null;
  }

  remainingCells(): number {
    return this.cells.filter((c) => !c.fractured).length;
  }

  totalCells(): number {
    return this.cells.length;
  }
}
