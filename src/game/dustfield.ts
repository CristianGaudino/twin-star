import { Vec2, distance, v2 } from "./vec2";
import { BELT_INNER_RADIUS, BELT_OUTER_RADIUS, HOME_STAR_POS } from "./constants";

const CELL_SIZE = 300; // px — grid cell for deterministic dust placement, same idea as starfield.ts
const MOTES_PER_CELL = 3;

const BELT_MID_RADIUS = (BELT_INNER_RADIUS + BELT_OUTER_RADIUS) / 2;
const BELT_HALF_WIDTH = (BELT_OUTER_RADIUS - BELT_INNER_RADIUS) / 2;
// How far past the ring's own half-width density tapers to zero — a soft edge, not a wall, so
// the dust doesn't read as a cloud pasted on top of a hard-edged circle.
const FALLOFF_SPAN = BELT_HALF_WIDTH * 1.6;

/** Deterministic float in [0,1) from integer inputs, same technique as starfield.ts's hash but
 *  a different constant set so dust and stars don't end up correlated (same cell coordinates
 *  producing suspiciously similar-looking noise for two unrelated decorative layers). */
function hash(x: number, y: number, salt: number): number {
  const h = Math.sin(x * 91.7 + y * 53.9 + salt * 17.3) * 27183.1459;
  return h - Math.floor(h);
}

export interface DustMote {
  pos: Vec2;
  r: number;
  alpha: number;
}

/**
 * Purely decorative belt "dust" — non-interactable texture that makes the belt read as a
 * genuinely denser, hazier region even from a distance, not just a landmark once you're already
 * inside it looking at individual asteroids. Generated on the fly for whatever's in view, same
 * deterministic-grid-hash approach as starfield.ts (a fixed spot in space always looks the same,
 * nothing is stored) — but density here is weighted by distance from the belt's own middle
 * radius, thick right in the ring and fading smoothly to nothing well before normal space,
 * rather than a flat field everywhere. Cheap: cells far from the belt reject on a single
 * distance check before generating anything to draw.
 */
export function dustInView(minX: number, minY: number, maxX: number, maxY: number): DustMote[] {
  const motes: DustMote[] = [];
  const cx0 = Math.floor(minX / CELL_SIZE);
  const cx1 = Math.floor(maxX / CELL_SIZE);
  const cy0 = Math.floor(minY / CELL_SIZE);
  const cy1 = Math.floor(maxY / CELL_SIZE);

  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let i = 0; i < MOTES_PER_CELL; i++) {
        const fx = hash(cx, cy, i * 4 + 1);
        const fy = hash(cx, cy, i * 4 + 2);
        const fr = hash(cx, cy, i * 4 + 3);
        const fa = hash(cx, cy, i * 4 + 4);
        const pos = v2(cx * CELL_SIZE + fx * CELL_SIZE, cy * CELL_SIZE + fy * CELL_SIZE);

        const distFromMid = Math.abs(distance(pos, HOME_STAR_POS) - BELT_MID_RADIUS);
        const density = Math.max(0, 1 - distFromMid / FALLOFF_SPAN);
        if (density <= 0) continue;
        // Thin out probabilistically rather than just dimming everything uniformly — reads as a
        // real patchy dust field tapering off, not a flat gray wash with a soft edge.
        if (fa > density) continue;

        motes.push({ pos, r: 0.6 + fr * 1.1, alpha: density * (0.15 + fr * 0.25) });
      }
    }
  }
  return motes;
}
