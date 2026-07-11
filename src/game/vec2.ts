export type Vec2 = { x: number; y: number };

export const v2 = (x = 0, y = 0): Vec2 => ({ x, y });

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const length = (a: Vec2): number => Math.hypot(a.x, a.y);
export const distance = (a: Vec2, b: Vec2): number => length(sub(a, b));

export const normalize = (a: Vec2): Vec2 => {
  const len = length(a);
  return len > 1e-6 ? scale(a, 1 / len) : v2(0, 0);
};

export const fromAngle = (angle: number, mag = 1): Vec2 => ({
  x: Math.cos(angle) * mag,
  y: Math.sin(angle) * mag,
});

/** Rotates point `p` by `angle` radians around `center`. */
export const rotateAround = (p: Vec2, center: Vec2, angle: number): Vec2 => {
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return { x: center.x + dx * c - dy * s, y: center.y + dx * s + dy * c };
};

/** 2D cross product (scalar): the z-component of r × v. */
export const cross2 = (r: Vec2, v: Vec2): number => r.x * v.y - r.y * v.x;

/** Velocity of a point offset `r` from a body's center, given the body's linear and angular velocity. */
export const velocityAtPoint = (linVel: Vec2, angVel: number, r: Vec2): Vec2 =>
  add(linVel, v2(-angVel * r.y, angVel * r.x));

export const angleOf = (a: Vec2): number => Math.atan2(a.y, a.x);

export const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

/** Shortest signed distance from angle `from` to angle `to`, in (-PI, PI]. */
export const angleDelta = (from: number, to: number): number => {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

export const normalizeAngle = (a: number): number => {
  let r = a % (Math.PI * 2);
  if (r < 0) r += Math.PI * 2;
  return r;
};

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
