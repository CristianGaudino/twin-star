import { Cell } from "./asteroid";
import { Chunk } from "./chunk";

/**
 * Whatever the cursor is currently over — a purely informational "what am I looking at"
 * concept. Deliberately separate from a tool's own targeting (`Engine.currentTarget`, which is
 * range/mode/tool-gated and drives actual mining behavior): hovering works regardless of the
 * selected tool, works in both Cruise and RCS mode, and covers anything on-screen worth
 * naming, not just asteroid cells. Extend this union as more things become highlightable
 * (enemies, wrecks, drones, other hubs) rather than special-casing each one into the mining code.
 */
export type HoverTarget = { kind: "cell"; cell: Cell } | { kind: "chunk"; chunk: Chunk };
