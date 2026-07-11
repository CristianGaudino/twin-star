import { Vec2, add, dot, length, sub, scale, v2 } from "./vec2";

export type Polygon = Vec2[];

export function polygonArea(poly: Polygon): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p0 = poly[i];
    const p1 = poly[(i + 1) % poly.length];
    a += p0.x * p1.y - p1.x * p0.y;
  }
  return Math.abs(a) / 2;
}

export function polygonCentroid(poly: Polygon): Vec2 {
  let cx = 0;
  let cy = 0;
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const p0 = poly[i];
    const p1 = poly[(i + 1) % poly.length];
    const cross = p0.x * p1.y - p1.x * p0.y;
    area += cross;
    cx += (p0.x + p1.x) * cross;
    cy += (p0.y + p1.y) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-6) {
    const n = poly.length || 1;
    return poly.reduce((acc, p) => add(acc, scale(p, 1 / n)), v2(0, 0));
  }
  return v2(cx / (6 * area), cy / (6 * area));
}

/** Second moment of area (∫∫ r² dA) of a polygon about its own centroid, unit density.
 *  Multiply by mass-per-area to get its actual contribution to rotational inertia. This is
 *  the piece's own "spread of mass around its own middle" — treating a cell as a zero-size
 *  point mass (as if all of it sat exactly at its centroid) ignores this entirely, which
 *  makes small/compact pieces (a single cell especially) come out with almost no rotational
 *  inertia at all — and with that, even a light off-center tap produces wildly excessive spin,
 *  since angular response scales with 1/inertia. */
export function polygonSecondMomentOfArea(poly: Polygon): number {
  const c = polygonCentroid(poly);
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const p0 = poly[i];
    const p1 = poly[(i + 1) % poly.length];
    const x0 = p0.x - c.x;
    const y0 = p0.y - c.y;
    const x1 = p1.x - c.x;
    const y1 = p1.y - c.y;
    const cross = x0 * y1 - x1 * y0;
    sum += cross * (x0 * x0 + x0 * x1 + x1 * x1 + y0 * y0 + y0 * y1 + y1 * y1);
  }
  return Math.abs(sum) / 12;
}

export function pointInPolygon(point: Vec2, poly: Polygon): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i];
    const pj = poly[j];
    const intersect =
      pi.y > point.y !== pj.y > point.y &&
      point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Sutherland-Hodgman clip: keeps the part of `poly` where dot(p - planePoint, normal) <= 0. */
export function clipHalfPlane(poly: Polygon, planePoint: Vec2, normal: Vec2): Polygon {
  if (poly.length === 0) return [];
  const output: Polygon = [];
  const side = (p: Vec2) => dot(sub(p, planePoint), normal);
  for (let i = 0; i < poly.length; i++) {
    const curr = poly[i];
    const prev = poly[(i - 1 + poly.length) % poly.length];
    const currSide = side(curr);
    const prevSide = side(prev);
    if (currSide <= 0) {
      if (prevSide > 0) output.push(intersectEdge(prev, curr, planePoint, normal));
      output.push(curr);
    } else if (prevSide <= 0) {
      output.push(intersectEdge(prev, curr, planePoint, normal));
    }
  }
  return output;
}

function intersectEdge(a: Vec2, b: Vec2, planePoint: Vec2, normal: Vec2): Vec2 {
  const da = dot(sub(a, planePoint), normal);
  const db = dot(sub(b, planePoint), normal);
  const t = da / (da - db);
  return add(a, scale(sub(b, a), t));
}

export function boundingRadius(poly: Polygon, centroid: Vec2): number {
  let r = 0;
  for (const p of poly) r = Math.max(r, length(sub(p, centroid)));
  return r;
}

function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const lenSq = ab.x * ab.x + ab.y * ab.y;
  let t = lenSq > 1e-9 ? dot(sub(p, a), ab) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  return length(sub(p, add(a, scale(ab, t))));
}

function segmentDistance(a1: Vec2, a2: Vec2, b1: Vec2, b2: Vec2): number {
  return Math.min(
    pointSegmentDistance(a1, b1, b2),
    pointSegmentDistance(a2, b1, b2),
    pointSegmentDistance(b1, a1, a2),
    pointSegmentDistance(b2, a1, a2),
  );
}

/** Minimum distance between two polygons' boundaries — 0 if they touch or overlap. Used to
 *  tell whether two cells are *still* physically touching after one of them has been cut
 *  down, rather than relying on a frozen "were they neighbors originally" graph. */
export function polygonMinDistance(a: Polygon, b: Polygon): number {
  let min = Infinity;
  for (let i = 0; i < a.length; i++) {
    const a1 = a[i];
    const a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      const b1 = b[j];
      const b2 = b[(j + 1) % b.length];
      const d = segmentDistance(a1, a2, b1, b2);
      if (d < min) min = d;
      if (min <= 0) return 0;
    }
  }
  return min;
}

export interface SliceResult {
  sliver: Polygon; // small piece nearest `from`, cut away
  remainder: Polygon; // the rest, staying behind
}

/** Cuts `poly` with a plane `depth` inward from its boundary point nearest `from`. */
export function sliceNearPoint(poly: Polygon, from: Vec2, depth: number): SliceResult | null {
  const nearest = closestBoundaryPoint(poly, from);
  if (!nearest) return null;
  const planePoint = add(nearest.point, scale(nearest.normal, -depth));
  const sliver = clipHalfPlane(poly, planePoint, scale(nearest.normal, -1));
  const remainder = clipHalfPlane(poly, planePoint, nearest.normal);
  return { sliver, remainder };
}

export interface BoundaryHit {
  point: Vec2;
  normal: Vec2; // outward-facing (away from the polygon's own centroid)
  distance: number;
}

/** Closest point on the polygon boundary to `from`, considering only edges for which
 * `edgeEnabled(index)` returns true (all edges, by default) — an edge index `i` runs from
 * `poly[i]` to `poly[(i+1) % poly.length]`.
 *
 * Near a convex vertex, both adjacent edges can report that same vertex as their closest
 * point at an equal distance — which edge "wins" the tie is essentially arbitrary (iteration
 * order / floating-point noise), so naively using the winning edge's own perpendicular as the
 * normal makes it flip discontinuously between the two edges' normals as a circle sweeps past
 * the corner. That reads as snagging on nothing. When the closest point resolves to a vertex,
 * this blends both adjacent edges' normals instead — but only if that neighboring edge is
 * also enabled, so a disabled (e.g. internal-seam) edge never contributes to the blend. */
export function closestPointOnPolygon(
  poly: Polygon,
  from: Vec2,
  edgeEnabled: (index: number) => boolean = () => true,
): BoundaryHit | null {
  const n = poly.length;
  if (n < 2) return null;
  const centroid = polygonCentroid(poly);

  const edgeNormal = (i: number): Vec2 => {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    let normal = v2(b.y - a.y, -(b.x - a.x));
    const len = length(normal);
    normal = len > 1e-6 ? scale(normal, 1 / len) : v2(1, 0);
    if (dot(normal, sub(a, centroid)) < 0) normal = scale(normal, -1);
    return normal;
  };

  let bestIndex = -1;
  let bestPoint = v2(0, 0);
  let bestDist = Infinity;
  let bestT = 0;

  for (let i = 0; i < n; i++) {
    if (!edgeEnabled(i)) continue;
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const edge = sub(b, a);
    const edgeLenSq = edge.x * edge.x + edge.y * edge.y;
    let t = edgeLenSq > 1e-9 ? dot(sub(from, a), edge) / edgeLenSq : 0;
    t = Math.max(0, Math.min(1, t));
    const point = add(a, scale(edge, t));
    const d = length(sub(from, point));
    if (d < bestDist) {
      bestDist = d;
      bestPoint = point;
      bestIndex = i;
      bestT = t;
    }
  }
  if (bestIndex < 0) return null;

  const prev = (bestIndex - 1 + n) % n;
  const next = (bestIndex + 1) % n;
  let normal: Vec2;
  if (bestT <= 1e-6 && edgeEnabled(prev)) {
    const blended = add(edgeNormal(bestIndex), edgeNormal(prev));
    const len = length(blended);
    normal = len > 1e-6 ? scale(blended, 1 / len) : edgeNormal(bestIndex);
  } else if (bestT >= 1 - 1e-6 && edgeEnabled(next)) {
    const blended = add(edgeNormal(bestIndex), edgeNormal(next));
    const len = length(blended);
    normal = len > 1e-6 ? scale(blended, 1 / len) : edgeNormal(bestIndex);
  } else {
    normal = edgeNormal(bestIndex);
  }

  return { point: bestPoint, normal, distance: bestDist };
}

/** Closest point across every edge of the polygon (see `closestPointOnPolygon`). */
export function closestBoundaryPoint(poly: Polygon, from: Vec2): BoundaryHit | null {
  return closestPointOnPolygon(poly, from);
}

/** Pulls `target` back along the segment from `origin` (which must already be inside `poly`)
 *  until it lands inside `poly`, backing off slightly from the exact crossing. Used to keep
 *  procedurally generated detail confined to its own polygon — e.g. drill fractures growing
 *  outward from a cell's centroid should never spill into a neighboring section or open space. */
export function clampInsidePolygon(poly: Polygon, origin: Vec2, target: Vec2): Vec2 {
  if (pointInPolygon(target, poly)) return target;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    const p = add(origin, scale(sub(target, origin), mid));
    if (pointInPolygon(p, poly)) lo = mid;
    else hi = mid;
  }
  return add(origin, scale(sub(target, origin), lo * 0.92));
}
