/** Weighted category pick from a plain `Record<key, weight>` — shared by every "pick one of a
 *  handful of named things, biased by relative weight" need in the game (a resource within an
 *  asteroid type, an asteroid type within a zone, ...). Weights don't need to sum to 1, they're
 *  normalized here. `roll` is a caller-supplied 0..1 uniform value rather than this calling
 *  `Math.random()` itself, so callers stay in control of their own RNG (asteroid generation
 *  takes a seeded `rand` function, not the global `Math.random`). */
export function weightedPick<T extends string>(weights: Record<T, number>, roll: number): T {
  const entries = Object.entries(weights) as [T, number][];
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let r = roll * total;
  for (const [key, w] of entries) {
    if (r < w) return key;
    r -= w;
  }
  return entries[entries.length - 1][0];
}
