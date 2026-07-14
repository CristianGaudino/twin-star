import { AsteroidType, Composition } from "./asteroid";
import { CargoHold } from "./ship";
import { UpgradeId } from "./upgrades";

/**
 * The Research tier (upgrades-spec.md Section 4) — materials + time, gated by having actually
 * found something first, not just having the materials to spend. Deliberately doesn't apply its
 * own numeric effect except for the self-improving case (Research Methodology): completing a
 * project's real payoff is making one or more entries in `UPGRADES` (upgrades.ts) purchasable
 * for the first time, via `requiresResearch` on those entries.
 *
 * Four gate shapes, independently combinable rather than a single `gateType` enum — a project
 * can require any subset of `requiresSample`/`requiresScannedType`/`requiresFacility` (all unset
 * means no gate beyond materials+time, the Research Methodology case):
 * - `requiresSample` — must have ever deposited at least one unit of this resource at the hub
 *   (Hub.everDeposited), not "currently holding it" — a discovery flag, not a stockpile check.
 * - `requiresScannedType` — must have scanned (not necessarily mined) at least one asteroid of
 *   this AsteroidType (Engine.scannedTypes).
 * - `requiresFacility` — must already own this Hub Facility upgrade.
 */
export type ResearchId =
  | "platinumAlloyPlating"
  | "radiationShielding"
  | "reinforcedAlloyFrames"
  | "metallicBodyCartography"
  | "cryoFuelProcessing"
  | "refinedMaterialsHandling"
  | "researchMethodology"
  | "solarCollectionTheory"
  | "powerGridEfficiency"
  | "autonomousSensorNetworks"
  | "reactorEngineering"
  | "orbitalLogistics";

export interface ResearchDef {
  id: ResearchId;
  label: string;
  description: string;
  cost: CargoHold;
  researchSeconds: number;
  requiresSample?: Composition;
  requiresScannedType?: AsteroidType;
  requiresFacility?: UpgradeId;
  unlocks: UpgradeId[];
  // Only Research Methodology uses this — most projects unlock a purchase rather than applying
  // a number themselves (see the module doc comment above).
  researchSpeedMultBonus?: number;
}

const noCost = (overrides: Partial<CargoHold>): CargoHold => ({
  rock: 0,
  nickelIron: 0,
  crystal: 0,
  platinum: 0,
  ice: 0,
  radioactive: 0,
  ...overrides,
});

export const RESEARCH: Record<ResearchId, ResearchDef> = {
  // 4a — material-gated. Platinum's real use is precision alloys/instruments; hull plating is
  // the straightforward structural read of that.
  platinumAlloyPlating: {
    id: "platinumAlloyPlating",
    label: "Platinum Alloy Plating",
    description: "Unlocks Reinforced Hull Plating.",
    cost: noCost({ nickelIron: 10, platinum: 5 }),
    researchSeconds: 60,
    requiresSample: "platinum",
    unlocks: ["reinforcedHullPlating"],
  },
  // 4a — radioactive ore is handled with charges specifically for safety (see COMPOSITION_INFO);
  // shielding research naturally extends into carrying more charges safely.
  radiationShielding: {
    id: "radiationShielding",
    label: "Radiation Shielding",
    description: "Unlocks the Charge Payload Upgrade.",
    cost: noCost({ nickelIron: 10, radioactive: 5 }),
    researchSeconds: 50,
    requiresSample: "radioactive",
    unlocks: ["chargePayloadUpgrade"],
  },
  // 4a — Nickel-Iron is real structural metal; frame reinforcement is the direct application.
  reinforcedAlloyFrames: {
    id: "reinforcedAlloyFrames",
    label: "Reinforced Alloy Frames",
    description: "Unlocks Cargo Stabilizers.",
    cost: noCost({ rock: 10, nickelIron: 15 }),
    researchSeconds: 45,
    requiresSample: "nickelIron",
    unlocks: ["cargoStabilizers"],
  },
  // 4b — discovery-gated, not material-gated: scanning an M-type is enough, you don't need to
  // have mined one to know better sensors are worth building.
  metallicBodyCartography: {
    id: "metallicBodyCartography",
    label: "Metallic Body Cartography",
    description: "Unlocks Long-Range Ping.",
    cost: noCost({ rock: 5, nickelIron: 5, crystal: 5 }),
    researchSeconds: 40,
    requiresScannedType: "M",
    unlocks: ["longRangePing"],
  },
  // 4a — Water Ice's long-flagged "nothing to spend it on yet" (main spec Section 17) —
  // processing technique that unlocks the Refinery facility itself.
  cryoFuelProcessing: {
    id: "cryoFuelProcessing",
    label: "Cryo Fuel Processing",
    description: "Unlocks the Refinery facility.",
    cost: noCost({ rock: 10, nickelIron: 5, ice: 8 }),
    researchSeconds: 70,
    requiresSample: "ice",
    unlocks: ["refinery"],
  },
  // 4c — cross-gated: needs the Refinery actually built *and* a sample, not just one or the
  // other. Refined/cryo-handled materials → better inertial compensation.
  refinedMaterialsHandling: {
    id: "refinedMaterialsHandling",
    label: "Refined Materials Handling",
    description: "Unlocks Inertial Dampeners.",
    cost: noCost({ crystal: 5, ice: 5 }),
    researchSeconds: 55,
    requiresFacility: "refinery",
    requiresSample: "ice",
    unlocks: ["inertialDampeners"],
  },
  // 4d — self-improving, no sample/facility gate at all: a project about research itself.
  researchMethodology: {
    id: "researchMethodology",
    label: "Research Methodology",
    description: "Reduces the time every future research project takes.",
    cost: noCost({ rock: 15, crystal: 5 }),
    researchSeconds: 90,
    unlocks: [],
    researchSpeedMultBonus: -0.25,
  },
  // fuel-power-spec.md — 4a: solar panels are real-world crystalline silicon, the direct read of
  // that is Silicate Crystal.
  solarCollectionTheory: {
    id: "solarCollectionTheory",
    label: "Solar Collection Theory",
    description: "Unlocks the Solar Collector Array.",
    cost: noCost({ crystal: 10 }),
    researchSeconds: 55,
    requiresSample: "crystal",
    unlocks: ["solarCollectorArray"],
  },
  // 4c — facility-gated: designing an efficient power grid is lab work, not a field discovery.
  powerGridEfficiency: {
    id: "powerGridEfficiency",
    label: "Power Grid Efficiency",
    description: "Unlocks Power Efficiency Systems.",
    cost: noCost({ rock: 10, nickelIron: 10 }),
    researchSeconds: 50,
    requiresFacility: "researchLabExpansion",
    unlocks: ["powerEfficiencySystems"],
  },
  // 4a — real-world precedent: deep-space probes are RTG-powered (radioisotope thermoelectric
  // generators) — an autonomous sensor network needs the same kind of self-contained power.
  autonomousSensorNetworks: {
    id: "autonomousSensorNetworks",
    label: "Autonomous Sensor Networks",
    description: "Unlocks the Passive Ping Array.",
    cost: noCost({ crystal: 10, radioactive: 5 }),
    researchSeconds: 60,
    requiresSample: "radioactive",
    unlocks: ["passivePingArray"],
  },
  // 4c — cross-gated like refinedMaterialsHandling: needs both an actual ice sample (cryogenic
  // fuel handling is exactly what Water Ice has been earmarked for, twin-star-spec.md Section 17)
  // and the expanded lab, not just one or the other.
  reactorEngineering: {
    id: "reactorEngineering",
    label: "Reactor Engineering",
    description: "Unlocks the Reactor facility.",
    cost: noCost({ nickelIron: 15, radioactive: 10, ice: 10 }),
    researchSeconds: 80,
    requiresSample: "ice",
    requiresFacility: "researchLabExpansion",
    unlocks: ["reactor"],
  },
  // 4c — facility-gated on Observatory itself: satellite logistics obviously can't be researched
  // before there's an observatory to operate them from.
  orbitalLogistics: {
    id: "orbitalLogistics",
    label: "Orbital Logistics",
    description: "Unlocks the Satellite Bay.",
    cost: noCost({ rock: 10, nickelIron: 10 }),
    researchSeconds: 65,
    requiresFacility: "observatory",
    unlocks: ["satelliteBay"],
  },
};
