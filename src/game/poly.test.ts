import { describe, expect, it } from "vitest";
import {
  Polygon,
  clampInsidePolygon,
  closestBoundaryPoint,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
  polygonMinDistance,
  polygonSecondMomentOfArea,
} from "./poly";
import { v2 } from "./vec2";

const square = (half: number, center = v2(0, 0)): Polygon => [
  v2(center.x - half, center.y - half),
  v2(center.x + half, center.y - half),
  v2(center.x + half, center.y + half),
  v2(center.x - half, center.y + half),
];

describe("polygonArea", () => {
  it("computes the area of an axis-aligned square", () => {
    expect(polygonArea(square(1))).toBeCloseTo(4, 6);
  });

  it("is winding-independent", () => {
    const poly = square(2);
    expect(polygonArea([...poly].reverse())).toBeCloseTo(polygonArea(poly), 6);
  });
});

describe("polygonCentroid", () => {
  it("finds the center of a symmetric square", () => {
    const c = polygonCentroid(square(3, v2(5, -2)));
    expect(c.x).toBeCloseTo(5, 6);
    expect(c.y).toBeCloseTo(-2, 6);
  });
});

describe("polygonSecondMomentOfArea", () => {
  it("matches the closed-form polar second moment of a square about its own centroid", () => {
    // For a side-s square about its own centroid: Ix = Iy = s^4/12, so the polar
    // moment this function returns (Ix + Iy) is s^4/6.
    const s = 2;
    expect(polygonSecondMomentOfArea(square(s / 2))).toBeCloseTo(s ** 4 / 6, 4);
  });

  it("is invariant to the polygon's position in the world", () => {
    const atOrigin = polygonSecondMomentOfArea(square(1));
    const farAway = polygonSecondMomentOfArea(square(1, v2(500, -300)));
    expect(farAway).toBeCloseTo(atOrigin, 4);
  });
});

describe("pointInPolygon", () => {
  const poly = square(1);
  it("reports points inside as inside", () => {
    expect(pointInPolygon(v2(0, 0), poly)).toBe(true);
  });
  it("reports points outside as outside", () => {
    expect(pointInPolygon(v2(5, 5), poly)).toBe(false);
  });
});

describe("closestBoundaryPoint", () => {
  it("finds the nearest edge point and an outward-facing normal", () => {
    const hit = closestBoundaryPoint(square(1), v2(5, 0));
    expect(hit).not.toBeNull();
    expect(hit!.point.x).toBeCloseTo(1, 6);
    expect(hit!.point.y).toBeCloseTo(0, 6);
    expect(hit!.normal.x).toBeCloseTo(1, 6);
    expect(hit!.normal.y).toBeCloseTo(0, 6);
  });

  // Regression test: this used to flip discontinuously between each edge's own normal
  // depending on which edge happened to win the tie, which read as snagging on nothing.
  it("blends both adjacent edges' normals at a corner instead of picking one arbitrarily", () => {
    const hit = closestBoundaryPoint(square(1), v2(3, 3));
    expect(hit).not.toBeNull();
    expect(hit!.normal.x).toBeCloseTo(hit!.normal.y, 6);
    expect(hit!.normal.x).toBeCloseTo(Math.SQRT1_2, 6);
  });
});

describe("polygonMinDistance", () => {
  it("is zero for touching polygons", () => {
    const a = square(1, v2(0, 0));
    const b = square(1, v2(2, 0)); // shares the edge at x=1
    expect(polygonMinDistance(a, b)).toBeCloseTo(0, 6);
  });

  it("returns the true gap for separated polygons", () => {
    const a = square(1, v2(0, 0));
    const b = square(1, v2(5, 0));
    expect(polygonMinDistance(a, b)).toBeCloseTo(3, 6);
  });
});

describe("clampInsidePolygon", () => {
  it("passes through points already inside unchanged", () => {
    const poly = square(1);
    const target = v2(0.2, 0.2);
    expect(clampInsidePolygon(poly, v2(0, 0), target)).toEqual(target);
  });

  // Regression test: fracture generation used to send points straight out of a cell's own
  // polygon into neighboring cells or open space — this is the fix.
  it("pulls an out-of-bounds target back to just inside the polygon", () => {
    const poly = square(1);
    const clamped = clampInsidePolygon(poly, v2(0, 0), v2(10, 0));
    expect(pointInPolygon(clamped, poly)).toBe(true);
    expect(clamped.x).toBeGreaterThan(0.5);
    expect(clamped.x).toBeLessThan(1);
  });
});
