import { CargoHold } from "./ship";

/**
 * Hub upgrades — purchased once with raw materials from storage, no currency involved. Kept
 * as a data table (like `COMPOSITION_INFO`/`TOOLS`) so adding the next upgrade is a new entry
 * here, not a new bespoke purchase method. Effects are still applied by hand in
 * `Engine.purchaseUpgrade` — with only one upgrade today there's nothing to generalize about
 * *how* an effect applies yet; that's worth revisiting once a second one exists.
 */
export type UpgradeId = "cargoExpansion";

export interface UpgradeDef {
  id: UpgradeId;
  label: string;
  description: string;
  cost: CargoHold; // materials spent exactly on purchase
  cargoCapacityBonus: number;
}

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  cargoExpansion: {
    id: "cargoExpansion",
    label: "Cargo Expansion",
    description: "Reinforced hold — +8 cargo capacity.",
    cost: { ore: 20, crystal: 8, unstable: 4 },
    cargoCapacityBonus: 8,
  },
};

export function canAfford(materials: CargoHold, cost: CargoHold): boolean {
  return materials.ore >= cost.ore && materials.crystal >= cost.crystal && materials.unstable >= cost.unstable;
}
