import { Vec2, add, scale, v2 } from "./vec2";
import { CHUNK_DRAG } from "./constants";
import { Composition, massForArea } from "./asteroid";

let nextChunkId = 1;

function generateChunkShape(radius: number): Vec2[] {
  const points = 6 + Math.floor(Math.random() * 3); // 6-8, an irregular little rock
  const shape: Vec2[] = [];
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2;
    const r = radius * (0.7 + Math.random() * 0.5);
    shape.push(v2(Math.cos(angle) * r, Math.sin(angle) * r));
  }
  return shape;
}

export class Chunk {
  id: number;
  pos: Vec2;
  vel: Vec2;
  composition: Composition;
  value: number;
  radius: number;
  shape: Vec2[]; // local-space outline, rotated/translated at render time
  spin = (Math.random() - 0.5) * 3;
  angle = Math.random() * Math.PI * 2;

  constructor(pos: Vec2, vel: Vec2, composition: Composition, value: number) {
    this.id = nextChunkId++;
    this.pos = pos;
    this.vel = vel;
    this.composition = composition;
    this.value = value;
    this.radius = 7 + value * 2.5;
    this.shape = generateChunkShape(this.radius);
  }

  update(dt: number) {
    this.pos = add(this.pos, scale(this.vel, dt));
    this.vel = scale(this.vel, Math.max(0, 1 - CHUNK_DRAG * dt));
    this.angle += this.spin * dt;
  }

  /** A chunk is the same material it broke off from, just no longer part of a larger body — so
   *  it goes through the exact same `massForArea` every cell/group in the asteroid it came from
   *  uses (asteroid.ts), rather than a second, disconnected mass convention. A Nickel-Iron chunk
   *  is exactly as heavy after extraction as the cell it was cut from, and genuinely harder to
   *  shove around than a Water Ice chunk of the same size — same as its cargo weight is.
   *  Approximated as a circle of `radius` since chunk shape is cosmetic (an irregular outline
   *  generated only for rendering). */
  get mass(): number {
    return Math.max(1, massForArea(this.composition, Math.PI * this.radius * this.radius));
  }
}
