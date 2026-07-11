import { CHARGE_MAX_CARRIED, CHARGE_RANGE, DRILL_RANGE, LASER_RANGE } from "./constants";

export type ToolId = "laser" | "drill" | "charges";

export interface ToolDef {
  id: ToolId;
  key: string;
  label: string;
  range: number;
  maxCarried?: number;
}

export const TOOLS: Record<ToolId, ToolDef> = {
  laser: {
    id: "laser",
    key: "1",
    label: "Laser",
    range: LASER_RANGE,
  },
  drill: {
    id: "drill",
    key: "2",
    label: "Drill",
    range: DRILL_RANGE,
  },
  charges: {
    id: "charges",
    key: "3",
    label: "Charges",
    range: CHARGE_RANGE,
    maxCarried: CHARGE_MAX_CARRIED,
  },
};
