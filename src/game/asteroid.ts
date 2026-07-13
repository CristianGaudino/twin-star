import { Vec2, add, distance, dot, fromAngle, normalize, scale, sub, v2 } from "./vec2";
import { Polygon, boundingRadius, clipHalfPlane, pointInPolygon, polygonArea, polygonCentroid } from "./poly";
import {
  ASTEROID_BASE_RADIUS,
  ASTEROID_OUTLINE_POINTS,
  ASTEROID_SEED_COUNT,
  SCAN_HOLD_SECONDS,
  SCAN_SECONDS_MAX,
  SCAN_SECONDS_MIN,
} from "./constants";
import { ToolId } from "./tools";

export type Composition = "ore" | "crystal" | "unstable";

export interface CompositionInfo {
  composition: Composition;
  label: string;
  color: string;
  hardness: number; // 1-5, shown to the player — denser/tougher material takes more work
  totalPieces: number; // laser: number of cuts to fully consume the cell
  chunkValue: number; // cargo value per piece (drill/charges yield totalPieces * chunkValue in one chunk)
  cutSeconds: number; // laser: beam-seconds required per cut
  boreSeconds: number; // drill: seconds anchored required to bore out the whole cell
  recommendedTool: ToolId; // internal — biases mining speed, deliberately not surfaced in the UI
}

export const COMPOSITION_INFO: Record<Composition, CompositionInfo> = {
  ore: {
    composition: "ore",
    label: "Soft Ore",
    color: "#b08a5c",
    hardness: 2,
    totalPieces: 3,
    chunkValue: 1,
    cutSeconds: 0.5,
    boreSeconds: 2.0,
    recommendedTool: "drill",
  },
  crystal: {
    composition: "crystal",
    label: "Dense Crystal",
    color: "#7fa8ff",
    hardness: 5,
    totalPieces: 6,
    chunkValue: 1,
    cutSeconds: 0.8,
    boreSeconds: 3.6,
    recommendedTool: "charges",
  },
  unstable: {
    composition: "unstable",
    label: "Hollow-Unstable",
    color: "#7de08d",
    hardness: 1,
    totalPieces: 2,
    chunkValue: 1,
    cutSeconds: 0.35,
    boreSeconds: 1.4,
    recommendedTool: "laser",
  },
};

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

const DEFAULT_COMPOSITION_WEIGHTS: Record<Composition, number> = { ore: 0.45, crystal: 0.3, unstable: 0.25 };

/** Named composition profiles a belt can draw from so asteroids read as different "types," not
 *  copies of the same rock with random paint — see Engine's belt scattering, which picks one
 *  of these per asteroid. */
export const ASTEROID_ARCHETYPES: Record<Composition, number>[] = [
  { ore: 0.7, crystal: 0.2, unstable: 0.1 }, // ore-rich
  { ore: 0.2, crystal: 0.7, unstable: 0.1 }, // crystal-rich
  { ore: 0.25, crystal: 0.25, unstable: 0.5 }, // unstable-rich
  DEFAULT_COMPOSITION_WEIGHTS, // balanced
];

/** Lets one asteroid skew ore-rich, another crystal-rich, etc. (see Engine's belt scattering) —
 *  weights don't need to sum to 1, they're normalized here. */
function makeCompositionPicker(weights: Record<Composition, number> = DEFAULT_COMPOSITION_WEIGHTS) {
  const total = weights.ore + weights.crystal + weights.unstable;
  return (roll: number): Composition => {
    const r = roll * total;
    if (r < weights.ore) return "ore";
    if (r < weights.ore + weights.crystal) return "crystal";
    return "unstable";
  };
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
  compositionWeights?: Record<Composition, number>; // lets one body skew ore-rich, another crystal-rich, etc.
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
  outline: Polygon;
  cells: Cell[];
  neighbors: Map<number, number[]>;
  scanned = false;
  scanProgress = 0; // 0..1 — climbs while the ship holds a scan in range, decays otherwise
  initialVelocity: Vec2;

  constructor(center: Vec2, rand: () => number = Math.random, options: AsteroidOptions = {}) {
    const radius = options.radius ?? ASTEROID_BASE_RADIUS;
    const pickComposition = makeCompositionPicker(options.compositionWeights);

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
