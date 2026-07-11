import { Vec2, add, cross2, scale, sub, velocityAtPoint } from "./vec2";

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
