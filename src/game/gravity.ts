import { Vec2, distance, scale, sub, v2 } from "./vec2";

/**
 * A massive body that pulls nearby movers toward it and can destroy anything that touches its
 * surface. The home star is the first of these; a future planet, moon, or the far star is
 * another entry in `Engine.gravitySources`, not a new mechanic — everything here is generic
 * over "kind" on purpose. Deliberately not simulating real orbital mechanics for the whole
 * belt (see ARCHITECTURE.md) — this is a localized hazard/feature near specific big bodies,
 * not an ambient force that changes how normal cruising feels everywhere.
 */
export interface GravitySource {
  id: string; // stable — used as the radar Contact id (see Engine), not just a label
  kind: string; // "star" | "planet" | ... — labeling only, not load-bearing yet
  pos: Vec2;
  radius: number; // physical surface — crossing this is a collision, not just "close"
  pullRadius: number; // gravity is felt out to this distance, falls off to 0 at the edge
  pullStrength: number; // px/s^2 at the center (dist=0) — actual felt pull is scaled by falloff
  lethal: boolean; // whether touching the surface destroys whatever touched it
  // Radiant heat is independent of the pull — a future body could have one without the other
  // (a cold rogue planet with gravity but no heat; a heat hazard with no real pull). Omitted
  // (undefined) means the source radiates no heat at all, not "zero range." This is *exposure*,
  // not direct hull damage — see Ship.temperature/Engine's heat handling for the two-stage
  // warning-then-damage model built on top of it.
  heatRadius?: number; // beyond this, no thermal exposure at all
  heatIntensity?: number; // exposure at dist=0 — same falloff convention as pullStrength
  // Solar power — a third, independent exposure value (fuel-power-spec.md), same optional-means-
  // "radiates none" convention as heat. Deliberately NOT the same radius as heatRadius/pullRadius:
  // those are short-range hazards (you have to be diving at the star to feel them), but real
  // sunlight is useful at real interplanetary distances well past any hazard the star itself
  // poses — solarRadius should reach out past the whole belt, while pullRadius/heatRadius stay
  // tight and dangerous. A source can radiate light without heat/gravity or vice versa.
  solarRadius?: number;
  solarIntensity?: number; // exposure at dist=0 — same falloff convention as pullStrength
}

/** Acceleration `source` exerts on something at `pos` — zero once outside `pullRadius`. Linear
 *  falloff (same shape `Explosion` already uses for its own falloff-by-distance) rather than
 *  true inverse-square: avoids a singularity near the surface, and keeps the well easy to
 *  reason about/tune without a physics degree. Pull is strongest right at the surface (where
 *  you're about to die if you don't counter it) and fades to nothing at `pullRadius`. */
export function gravityAccel(source: GravitySource, pos: Vec2): Vec2 {
  const d = distance(source.pos, pos);
  if (d >= source.pullRadius || d < 1e-6) return v2(0, 0);
  const falloff = 1 - d / source.pullRadius;
  return scale(sub(source.pos, pos), (source.pullStrength * falloff) / d);
}

/** Thermal exposure `source` radiates onto something at `pos` — 0 if the source doesn't radiate
 *  heat (`heatRadius`/`heatIntensity` unset) or `pos` is beyond `heatRadius`. Same linear
 *  falloff convention as `gravityAccel`: nominally strongest at dist=0, so what's actually felt
 *  right at the physical surface (the closest you can be before instant death from touching it)
 *  is high but not the full nominal value. This is exposure, not hull damage directly — see
 *  Ship.temperature for how exposure turns into an actual threat. */
export function radiantHeatExposure(source: GravitySource, pos: Vec2): number {
  if (!source.heatRadius || !source.heatIntensity) return 0;
  const d = distance(source.pos, pos);
  if (d >= source.heatRadius) return 0;
  const falloff = 1 - d / source.heatRadius;
  return source.heatIntensity * falloff;
}

/** Solar exposure `source` provides at `pos` — same shape/falloff as `radiantHeatExposure`, but
 *  a wholly independent field/radius (see `GravitySource.solarRadius` doc comment): this is meant
 *  to reach out much further than the heat/pull radii, so most of the system gets *some* solar
 *  charge, with a real gradient toward the star, not just an all-or-nothing zone. Feeds
 *  `Ship.battery` regen (see Engine's power handling) — not hull/temperature at all. */
export function solarExposure(source: GravitySource, pos: Vec2): number {
  if (!source.solarRadius || !source.solarIntensity) return 0;
  const d = distance(source.pos, pos);
  if (d >= source.solarRadius) return 0;
  const falloff = 1 - d / source.solarRadius;
  return source.solarIntensity * falloff;
}
