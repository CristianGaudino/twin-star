import { Vec2 } from "./vec2";

/** What triggered this explosion. Extend as more sources exist — an enemy self-destruct,
 *  an environmental hazard, a different weapon — rather than duplicating blast handling
 *  per source the way charges used to have it baked in directly. */
export type ExplosionSource = "charge";

/**
 * A generic explosive event at a point in the world. Everything nearby reacts the same way
 * regardless of what caused it: the ship takes falloff damage and knockback, loose chunks get
 * flung outward, and whichever rock body is closest to the blast point recoils (mass-scaled,
 * off-center blasts induce spin). Charges are the only thing that raises one today, but
 * nothing here is charge-specific — a future source just builds one of these and hands it to
 * `Engine.applyExplosion`.
 */
export interface Explosion {
  pos: Vec2;
  radius: number; // px — every effect below falls off linearly to 0 at this range
  shipDamage: number; // max hull damage at point-blank
  shipPushSpeed: number; // max ship knockback, px/s, at point-blank
  chunkPushSpeed: number; // max chunk knockback, px/s, at point-blank
  rockImpulse: number; // momentum applied to the nearest rock body, divided by its mass
  source: ExplosionSource;
}
