import { describe, expect, it } from "vitest";
import { GravitySource, gravityAccel, radiantHeatExposure } from "./gravity";
import { v2 } from "./vec2";

const source = (overrides: Partial<GravitySource> = {}): GravitySource => ({
  id: "test-source",
  kind: "star",
  pos: v2(0, 0),
  radius: 100,
  pullRadius: 1000,
  pullStrength: 200,
  lethal: true,
  ...overrides,
});

describe("gravityAccel", () => {
  it("pulls straight toward the source", () => {
    // Source at the origin, mover out at +x — pull should point back toward -x.
    const accel = gravityAccel(source(), v2(500, 0));
    expect(accel.x).toBeLessThan(0);
    expect(accel.y).toBeCloseTo(0, 6);
  });

  it("is zero at or beyond the pull radius", () => {
    const atEdge = gravityAccel(source({ pullRadius: 1000 }), v2(1000, 0));
    const beyond = gravityAccel(source({ pullRadius: 1000 }), v2(1500, 0));
    expect(atEdge).toEqual(v2(0, 0));
    expect(beyond).toEqual(v2(0, 0));
  });

  it("gets stronger closer to the source (no singularity at the surface)", () => {
    const near = gravityAccel(source(), v2(150, 0)); // just outside the physical radius
    const far = gravityAccel(source(), v2(900, 0));
    const nearMag = Math.hypot(near.x, near.y);
    const farMag = Math.hypot(far.x, far.y);
    expect(nearMag).toBeGreaterThan(farMag);
    expect(Number.isFinite(nearMag)).toBe(true);
  });

  it("scales linearly with pullStrength", () => {
    const base = gravityAccel(source({ pullStrength: 100 }), v2(400, 0));
    const doubled = gravityAccel(source({ pullStrength: 200 }), v2(400, 0));
    expect(doubled.x).toBeCloseTo(base.x * 2, 6);
  });
});

describe("radiantHeatExposure", () => {
  it("is zero for a source that doesn't radiate heat", () => {
    const exposure = radiantHeatExposure(source(), v2(150, 0)); // no heatRadius/heatIntensity set
    expect(exposure).toBe(0);
  });

  it("is zero at or beyond heatRadius", () => {
    const radiant = source({ heatRadius: 1000, heatIntensity: 40 });
    expect(radiantHeatExposure(radiant, v2(1000, 0))).toBe(0);
    expect(radiantHeatExposure(radiant, v2(1500, 0))).toBe(0);
  });

  it("is greatest close to the surface and fades toward heatRadius", () => {
    const radiant = source({ radius: 100, heatRadius: 1000, heatIntensity: 40 });
    const near = radiantHeatExposure(radiant, v2(150, 0));
    const far = radiantHeatExposure(radiant, v2(900, 0));
    expect(near).toBeGreaterThan(far);
    expect(near).toBeGreaterThan(0);
    expect(far).toBeGreaterThan(0);
  });

  it("scales linearly with heatIntensity", () => {
    const base = radiantHeatExposure(source({ heatRadius: 1000, heatIntensity: 20 }), v2(400, 0));
    const doubled = radiantHeatExposure(source({ heatRadius: 1000, heatIntensity: 40 }), v2(400, 0));
    expect(doubled).toBeCloseTo(base * 2, 6);
  });
});
