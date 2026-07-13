import { Vec2, length, sub } from "./vec2";
import { AU_IN_METERS, HOME_STAR_POS } from "./constants";

/**
 * The "galactic standard" coordinate system — distance + angle from the home star, the one
 * genuinely fixed point in the system. The hub is just where the player happens to live; a map
 * would be built around the star, the same way real astronomical coordinates are. Angle is
 * fixed to the system itself (a stated reference direction), not to the ship's current heading,
 * so a coordinate stays meaningful for plotting on a static map rather than only describing
 * "which way to point right now." Deliberately separate from ping/radar (still plain
 * distance-from-the-ship, see Renderer.renderRadarIndicator) — ping is a targeting readout,
 * this is a location, and the two don't need to agree on a reference frame.
 *
 * Units are AU-style, not raw meters: 1 AU is defined as the hub's own distance from the home
 * star (AU_IN_METERS) — the same logic real astronomy uses to define an AU (Earth's distance
 * from the Sun), just scaled to this system's deliberately compressed distances instead of the
 * literal ~150-million-km real-world value.
 */
export interface Coordinate {
  angleDeg: number; // 0-359, fixed reference direction: 0 = "up" in world space, clockwise
  rangeAU: number; // distance from the home star, in AU (see AU_IN_METERS)
}

/** Coordinate of `pos` in the galactic standard frame — always relative to the home star. */
export function coordinateOf(pos: Vec2): Coordinate {
  const d = sub(pos, HOME_STAR_POS);
  const angleDeg = (Math.atan2(d.x, -d.y) * 180) / Math.PI;
  return { angleDeg: (angleDeg + 360) % 360, rangeAU: length(d) / AU_IN_METERS };
}

/** Human-readable form, e.g. "5.77 AU @ 042°". */
export function formatCoordinate(c: Coordinate): string {
  const angle = Math.round(c.angleDeg % 360)
    .toString()
    .padStart(3, "0");
  return `${c.rangeAU.toFixed(2)} AU @ ${angle}°`;
}
