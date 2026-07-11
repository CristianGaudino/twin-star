import {
  CHARGE_MAX_CARRIED,
  CHARGE_RANGE,
  CHARGE_SIG_PER_USE,
  DRILL_RANGE,
  DRILL_SIG_PER_SEC,
  LASER_RANGE,
  LASER_SIG_PER_SEC,
} from "./constants";

export type ToolId = "laser" | "drill" | "charges";

export interface ToolDef {
  id: ToolId;
  key: string;
  label: string;
  range: number;
  maxCarried?: number;
  // Signature cost lives on the tool, not on whichever code path happens to use it — a new
  // tool just declares one of these rather than needing a hand-matched addSignature call
  // wired up separately in the mining code.
  sigPerSecond?: number; // continuous-use tools (laser, drill) — cost accrues while active
  sigPerUse?: number; // one-shot tools (charges) — cost is per unit consumed, not time
}

export const TOOLS: Record<ToolId, ToolDef> = {
  laser: {
    id: "laser",
    key: "1",
    label: "Laser",
    range: LASER_RANGE,
    sigPerSecond: LASER_SIG_PER_SEC,
  },
  drill: {
    id: "drill",
    key: "2",
    label: "Drill",
    range: DRILL_RANGE,
    sigPerSecond: DRILL_SIG_PER_SEC,
  },
  charges: {
    id: "charges",
    key: "3",
    label: "Charges",
    range: CHARGE_RANGE,
    maxCarried: CHARGE_MAX_CARRIED,
    sigPerUse: CHARGE_SIG_PER_USE,
  },
};
