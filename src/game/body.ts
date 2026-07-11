import { Material } from "./physics";
import { Vec2 } from "./vec2";

/**
 * Any circle-shaped, independently-moving thing that should collide like a physical object —
 * the ship and loose chunks today; a drone or a simple enemy tomorrow. Rock is deliberately
 * NOT a Body: it's irregular polygon geometry via drift groups, a genuinely different shape
 * problem, so it keeps its own narrow-phase (see Engine.resolveBodyVsRock) rather than being
 * forced into a circle approximation. But every *circle* body, present or future, collides
 * with every other circle body and with rock through the exact same generic code — driven by
 * `mass`/`material` rather than a hand-written resolver per pair of kinds. Adding a new kind
 * of circular entity is "list it in Engine.circleBodies()", not "write a new collision method."
 */
export interface Body {
  kind: string;
  pos: Vec2;
  vel: Vec2;
  radius: number;
  mass: number;
  material: Material;
}

/** Pairs a snapshot of a Body's physical state with a way to commit the resolver's results
 *  back onto whatever concrete object it came from (Ship, Chunk, ...) — plain data in, plain
 *  write-back out, rather than Body itself trying to be a live mutable view. */
export interface BodyHandle {
  body: Body;
  write: (pos: Vec2, vel: Vec2) => void;
}
