import { Vec2, add, distance, fromAngle, scale, sub } from "./vec2";
import { Polygon, clipHalfPlane, pointInPolygon, polygonArea, polygonCentroid } from "./poly";
import { ASTEROID_BASE_RADIUS, ASTEROID_OUTLINE_POINTS, ASTEROID_SEED_COUNT } from "./constants";
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
  shade: string; // pre-scan rock color, varied per cell so the body reads as textured, not flat
}

const pickComposition = (roll: number): Composition => {
  if (roll < 0.45) return "ore";
  if (roll < 0.75) return "crystal";
  return "unstable";
};

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

export class Asteroid {
  center: Vec2;
  outerRadius = ASTEROID_BASE_RADIUS; // approximate, used for range checks
  outline: Polygon;
  cells: Cell[];
  neighbors: Map<number, number[]>;
  discovered = false;
  scanned = false;
  scanProgress = 0; // 0..1 — climbs while the ship holds a scan in range, decays otherwise

  constructor(center: Vec2, rand: () => number = Math.random) {
    this.center = center;
    this.outline = generateOutline(center, ASTEROID_BASE_RADIUS, rand);
    const seeds = scatterSeeds(center, this.outline, ASTEROID_SEED_COUNT, rand);

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
        shade: `rgb(${tone},${tone},${tone + 4})`,
      });
    }
    this.neighbors = computeNeighbors(this.cells);
  }

  /** Classify a world point into the intact cell containing it, or null. */
  cellAt(worldPos: Vec2): Cell | null {
    for (const cell of this.cells) {
      if (cell.fractured) continue;
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
