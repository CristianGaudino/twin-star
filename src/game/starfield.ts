import { Vec2, v2 } from "./vec2";

const CELL_SIZE = 500; // px — grid cell for deterministic star placement
const STARS_PER_CELL = 3;

/** Deterministic float in [0,1) from integer inputs — same inputs always produce the same
 *  output, so the same patch of sky always looks the same without storing anything. */
function hash(x: number, y: number, salt: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + salt * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

export interface FieldStar {
  pos: Vec2;
  r: number;
  brightness: number;
}

/**
 * Background decoration stars for whatever world-space region is currently visible, generated
 * on the fly instead of stored as a fixed list. A solar-system-scale map (see constants.ts's
 * belt geometry) needs stars everywhere a trip might go, not just near the origin — a fixed
 * list sized for the old few-hundred-px world would leave most of a real expedition flying
 * through empty black. Cheap: only cells overlapping the current view are touched, a few dozen
 * per frame regardless of how far from the origin the camera has traveled.
 */
export function starsInView(minX: number, minY: number, maxX: number, maxY: number): FieldStar[] {
  const stars: FieldStar[] = [];
  const cx0 = Math.floor(minX / CELL_SIZE);
  const cx1 = Math.floor(maxX / CELL_SIZE);
  const cy0 = Math.floor(minY / CELL_SIZE);
  const cy1 = Math.floor(maxY / CELL_SIZE);

  for (let cx = cx0; cx <= cx1; cx++) {
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let i = 0; i < STARS_PER_CELL; i++) {
        const fx = hash(cx, cy, i * 3 + 1);
        const fy = hash(cx, cy, i * 3 + 2);
        const fb = hash(cx, cy, i * 3 + 3);
        stars.push({
          pos: v2(cx * CELL_SIZE + fx * CELL_SIZE, cy * CELL_SIZE + fy * CELL_SIZE),
          r: fb < 0.85 ? 0.9 : 1.6,
          brightness: 0.35 + fb * 0.65,
        });
      }
    }
  }
  return stars;
}
