import { Vec2 } from "./vec2";

/**
 * Anything the ping/radar system can detect. Rock, the home hub, and the home star are the
 * only kinds that exist today, but this is deliberately generic — other asteroids, planets,
 * satellites, drones, enemies, and other ships should all be able to show up here later
 * without changing how ping/radar work.
 */
export type ContactKind = "rock" | "hub" | "star";

export interface Contact {
  id: string; // stable across frames for a given physical thing, so "discovered" persists
  kind: ContactKind;
  pos: Vec2;
  radius: number; // approx size — used for ping-sweep detection and radar blip range
  label: string; // flavor only; ping gives you a blip and a rough type, not full scan data
}

/**
 * What the player actually knows about a contact — a snapshot frozen at the moment it was
 * last refreshed (by ping or passive proximity), not a live link to the real thing. It goes
 * stale the longer it's been since a refresh, and is eventually forgotten entirely.
 */
export interface ContactMemory {
  contact: Contact; // last-known snapshot; does not move on its own
  age: number; // seconds since last refresh
}
