import { describe, expect, it } from "vitest";
import { Material, RigidRef, applyFriction, applyPointImpulse, combineMaterials, resolveContact } from "./physics";
import { v2 } from "./vec2";

const body = (overrides: Partial<RigidRef> = {}): RigidRef => ({
  pos: v2(0, 0),
  vel: v2(0, 0),
  angVel: 0,
  invMass: 1,
  invInertia: 1,
  ...overrides,
});

describe("resolveContact", () => {
  it("swaps velocities in a head-on, equal-mass, perfectly elastic collision", () => {
    const a = body({ pos: v2(-1, 0), vel: v2(5, 0), invInertia: 0 });
    const b = body({ pos: v2(1, 0), vel: v2(-5, 0), invInertia: 0 });
    const result = resolveContact(a, b, v2(0, 0), v2(-1, 0), 1);

    expect(result.velA.x).toBeCloseTo(-5, 6);
    expect(result.velB.x).toBeCloseTo(5, 6);
    expect(result.angVelA).toBeCloseTo(0, 6);
    expect(result.angVelB).toBeCloseTo(0, 6);
  });

  it("conserves total linear momentum regardless of the mass ratio", () => {
    const a = body({ pos: v2(-1, 0), vel: v2(4, 0), invMass: 1 / 3, invInertia: 0 });
    const b = body({ pos: v2(1, 0), vel: v2(-1, 0), invMass: 1, invInertia: 0 });
    const massA = 1 / a.invMass;
    const massB = 1 / b.invMass;
    const momentumBefore = massA * a.vel.x + massB * b.vel.x;

    const result = resolveContact(a, b, v2(0, 0), v2(-1, 0), 0.4);
    const momentumAfter = massA * result.velA.x + massB * result.velB.x;

    expect(momentumAfter).toBeCloseTo(momentumBefore, 6);
  });

  it("does nothing when the bodies are already separating", () => {
    const a = body({ pos: v2(-1, 0), vel: v2(-5, 0) });
    const b = body({ pos: v2(1, 0), vel: v2(5, 0) });
    const result = resolveContact(a, b, v2(0, 0), v2(-1, 0), 1);

    expect(result.velA).toEqual(a.vel);
    expect(result.velB).toEqual(b.vel);
    expect(result.impulseMag).toBe(0);
  });

  // Regression test: a lone/small drift-group cell used to have ~0 rotational inertia
  // (point-mass approximation only), so even a light off-center hit produced wildly
  // excessive spin. This just checks the resolver's own r-cross-impulse torque math.
  it("induces spin from an off-center contact", () => {
    const a = body({ pos: v2(0, 0), vel: v2(0, 0), angVel: 0, invMass: 1, invInertia: 1 });
    const b = body({ pos: v2(0, 0), vel: v2(0, 10), angVel: 0, invMass: 0, invInertia: 0 });
    const result = resolveContact(a, b, v2(1, 0), v2(0, 1), 0);

    expect(result.angVelA).toBeCloseTo(5, 6);
    expect(result.velA).toEqual(v2(0, 5));
  });
});

describe("applyPointImpulse", () => {
  it("only changes linear velocity for an impulse through the center of mass", () => {
    const b = body({ pos: v2(0, 0) });
    const result = applyPointImpulse(b, v2(0, 0), v2(10, 0));
    expect(result.vel.x).toBeCloseTo(10, 6);
    expect(result.angVel).toBeCloseTo(0, 6);
  });

  it("induces angular velocity for an off-center impulse", () => {
    const b = body({ pos: v2(0, 0), invInertia: 1 });
    const result = applyPointImpulse(b, v2(0, 1), v2(10, 0));
    // r = (0,1), impulse = (10,0): cross2(r, impulse) = 0*0 - 1*10 = -10
    expect(result.angVel).toBeCloseTo(-10, 6);
  });
});

describe("combineMaterials", () => {
  const material = (restitution: number, friction: number): Material => ({ restitution, friction });

  it("averages restitution", () => {
    const combined = combineMaterials(material(0.2, 1), material(0.8, 1));
    expect(combined.restitution).toBeCloseTo(0.5, 6);
  });

  it("self-combines to its own value, so a pair of identical materials reproduces the base constant exactly", () => {
    const combined = combineMaterials(material(0.35, 1), material(0.35, 1));
    expect(combined.restitution).toBeCloseTo(0.35, 6);
  });

  it("multiplies friction, so a frictionless material never adds drag to a pairing", () => {
    const combined = combineMaterials(material(0, 1), material(0, 0.9));
    expect(combined.friction).toBeCloseTo(0.9, 6);
  });

  it("multiplies friction, so two grippy materials together end up grippier than either alone", () => {
    const combined = combineMaterials(material(0, 0.9), material(0, 0.9));
    expect(combined.friction).toBeCloseTo(0.81, 6);
    expect(combined.friction).toBeLessThan(0.9);
  });
});

describe("applyFriction", () => {
  it("leaves velocity unchanged at friction 1 (frictionless)", () => {
    const vel = v2(3, 4);
    const result = applyFriction(vel, v2(0, 1), 1);
    expect(result).toEqual(vel);
  });

  it("only scrubs the tangential component, leaving the normal component untouched", () => {
    // normal (0,1): normal component is (0,4), tangential is (3,0)
    const result = applyFriction(v2(3, 4), v2(0, 1), 0.5);
    expect(result.x).toBeCloseTo(1.5, 6); // tangential half-scrubbed
    expect(result.y).toBeCloseTo(4, 6); // normal component untouched
  });

  it("zeroes the tangential component entirely at friction 0", () => {
    const result = applyFriction(v2(3, 4), v2(0, 1), 0);
    expect(result.x).toBeCloseTo(0, 6);
    expect(result.y).toBeCloseTo(4, 6);
  });
});
