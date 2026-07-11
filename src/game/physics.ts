import { Vec2, add, cross2, dot, scale, sub, velocityAtPoint } from "./vec2";

/** A body's dynamic state as seen by the collision resolver. `invMass`/`invInertia` of 0
 *  means infinitely heavy along that axis (e.g. the ship never spins from being hit). */
export interface RigidRef {
  pos: Vec2; // center of mass
  vel: Vec2;
  angVel: number;
  invMass: number;
  invInertia: number;
}

export interface ContactResult {
  velA: Vec2;
  angVelA: number;
  velB: Vec2;
  angVelB: number;
  impulseMag: number;
}

const noop = (a: RigidRef, b: RigidRef): ContactResult => ({
  velA: a.vel,
  angVelA: a.angVel,
  velB: b.vel,
  angVelB: b.angVel,
  impulseMag: 0,
});

/**
 * Resolves a single-point contact between two rigid bodies (standard 2D impulse method,
 * linear + angular). `normal` points from B toward A. Off-center contacts naturally produce
 * torque via r × impulse — that's what makes an asymmetric hit induce spin.
 */
export function resolveContact(a: RigidRef, b: RigidRef, contact: Vec2, normal: Vec2, restitution: number): ContactResult {
  const rA = sub(contact, a.pos);
  const rB = sub(contact, b.pos);
  const velAtA = velocityAtPoint(a.vel, a.angVel, rA);
  const velAtB = velocityAtPoint(b.vel, b.angVel, rB);
  const relVel = sub(velAtA, velAtB);
  const vn = normal.x * relVel.x + normal.y * relVel.y;
  if (vn >= 0) return noop(a, b); // separating already

  const rACrossN = cross2(rA, normal);
  const rBCrossN = cross2(rB, normal);
  const denom = a.invMass + b.invMass + a.invInertia * rACrossN * rACrossN + b.invInertia * rBCrossN * rBCrossN;
  if (denom <= 1e-9) return noop(a, b);

  const j = (-(1 + restitution) * vn) / denom;
  const impulse = scale(normal, j);

  return {
    velA: add(a.vel, scale(impulse, a.invMass)),
    angVelA: a.angVel + a.invInertia * cross2(rA, impulse),
    velB: sub(b.vel, scale(impulse, b.invMass)),
    angVelB: b.angVel - b.invInertia * cross2(rB, impulse),
    impulseMag: j,
  };
}

/** Applies an external impulse (e.g. a blast) acting at a specific world point on a body. */
export function applyPointImpulse(body: RigidRef, point: Vec2, impulse: Vec2): { vel: Vec2; angVel: number } {
  const r = sub(point, body.pos);
  return {
    vel: add(body.vel, scale(impulse, body.invMass)),
    angVel: body.angVel + body.invInertia * cross2(r, impulse),
  };
}

/**
 * A body's own surface properties for collision response — how bouncy and how "grippy" it
 * is. Every kind of thing that collides (ship, rock, a chunk, eventually a drone or an enemy)
 * defines its own Material once; `combineMaterials` derives the behavior for *any* pairing
 * from those two values, so a new kind never needs a hand-tuned constant for every existing
 * kind it might touch — that's the whole point of this over the old per-pair constants.
 */
export interface Material {
  restitution: number; // 0 = no bounce, 1 = perfectly elastic
  friction: number; // fraction of tangential velocity retained per contact (1 = frictionless)
}

/** Simple, predictable combine rules — not physically exact (real engines vary), but standard
 *  and easy to reason about: restitution averages, friction multiplies (so a grippy surface
 *  makes a pair grippier no matter what it touches, while a frictionless one never adds drag). */
export function combineMaterials(a: Material, b: Material): Material {
  return { restitution: (a.restitution + b.restitution) / 2, friction: a.friction * b.friction };
}

/** Scrubs a fraction of `vel`'s component tangential to `normal` — a simplified stand-in for
 *  surface friction (not a physically exact friction cone), applied after the normal impulse
 *  so sliding along a surface bleeds off over time instead of continuing frictionlessly
 *  forever. `friction` of 1 leaves `vel` unchanged. */
export function applyFriction(vel: Vec2, normal: Vec2, friction: number): Vec2 {
  const normalComponent = scale(normal, dot(vel, normal));
  const tangent = sub(vel, normalComponent);
  return add(normalComponent, scale(tangent, friction));
}
