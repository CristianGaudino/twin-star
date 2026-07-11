import { Vec2 } from "./vec2";

/**
 * Anything the ping/radar system can detect. Rock pieces are the only kind that exist today,
 * but this is deliberately generic — other asteroids, satellites, drones, enemies, and other
 * ships should all be able to show up here later without changing how ping/radar work.
 */
export type ContactKind = "rock";

export interface Contact {
  id: string; // stable across frames for a given physical thing, so "discovered" persists
  kind: ContactKind;
  pos: Vec2;
  radius: number; // approx size — used for ping-sweep detection and radar blip range
  label: string; // flavor only; ping gives you a blip and a rough type, not full scan data
}
