import { COMPOSITIONS, Composition } from "./asteroid";
import { PASSIVE_PING_INTERVAL } from "./constants";
import { CargoHold } from "./ship";
import { ResearchId } from "./research";

/**
 * The upgrade system — upgrades-spec.md is the design doc this implements, section numbers
 * below refer to it. Three categories (Section 1):
 * - `ship` — stat/capability improvements to the ship, materials only, no gate (Section 2, Basic
 *   tier) except where `requiresResearch` is set (Section 2, Advanced tier).
 * - `hubStandard` — small, cheap, immediate hub improvements (Section 3a).
 * - `hubFacility` — large, one-time hub construction (Section 3b). Only Research Lab Expansion
 *   and Refinery exist so far — Scrapyard/Mining Facility/Shipyard/Foundry/Observatory/Reactor
 *   are deliberately not built yet, each needs real new content decisions (what generates
 *   salvage? what are the ship classes? what do new tools do?) the spec explicitly left open,
 *   not just more upgrade entries.
 */
export type UpgradeCategory = "ship" | "hubStandard" | "hubFacility";

export type ShipStatKey =
  | "thrustForce"
  | "rcsDrag"
  | "visionRadius"
  | "pingMaxRadius"
  | "pingSpeed"
  | "temperatureDamageThreshold"
  | "temperatureDecayPerSec"
  | "signatureDecayPerSec"
  | "maxHull"
  | "chargeMaxCarried"
  | "cargoCapacity"
  | "laserRangeBonus"
  | "drillAnchorRangeBonus"
  | "scanSpeedMult"
  | "signatureGainMult"
  | "gravityResistMult"
  | "cargoMassFactor"
  | "fuelCapacity"
  | "batteryCapacity"
  | "solarRegenMult"
  | "powerDrawMult"
  | "passivePingInterval";

export type HubStatKey = "beaconRange" | "structuralIntegrity" | "researchSpeedMult" | "satelliteCap";

export type HubFlagKey = "repairOnDock" | "refineryBuilt" | "observatoryBuilt" | "reactorBuilt";

export type UpgradeId =
  // ship — basic (Section 2, no gate)
  | "cargoExpansion"
  | "thrusterUpgrade"
  | "maneuveringThrusters"
  | "laserFocusingLens"
  | "reinforcedDrillHead"
  | "proximitySensors"
  | "rapidScanModule"
  | "heatShield"
  | "radiatorVanes"
  | "signatureDampener"
  | "emissionBaffling"
  | "auxiliaryFuelTank"
  | "batteryBank"
  // ship — advanced (Section 2, requiresResearch)
  | "reinforcedHullPlating"
  | "chargePayloadUpgrade"
  | "longRangePing"
  | "inertialDampeners"
  | "cargoStabilizers"
  | "solarCollectorArray"
  | "powerEfficiencySystems"
  | "passivePingArray"
  // hub — standard (Section 3a)
  | "repairBay"
  | "beaconRangeUpgrade"
  | "structuralReinforcement"
  // hub — facility (Section 3b)
  | "researchLabExpansion"
  | "refinery"
  | "observatory"
  | "satelliteBay"
  | "reactor";

export interface UpgradeDef {
  id: UpgradeId;
  category: UpgradeCategory;
  label: string;
  description: string;
  cost: CargoHold; // materials spent exactly on purchase, no currency conversion
  requiresResearch?: ResearchId; // must be in Hub.completedResearch first
  // A purchase can bump any number of ship/hub stats and/or flip any number of boolean flags —
  // most upgrades set exactly one of these, but nothing requires that (Reinforced Drill Head
  // bumps two ship stats at once).
  shipStats?: Partial<Record<ShipStatKey, number>>;
  hubStats?: Partial<Record<HubStatKey, number>>;
  hubFlags?: HubFlagKey[];
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

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  // --- Ship: Basic ---
  cargoExpansion: {
    id: "cargoExpansion",
    category: "ship",
    label: "Cargo Expansion",
    description: "Reinforced hold — +400kg cargo capacity.",
    cost: noCost({ rock: 30, nickelIron: 15, crystal: 6 }),
    shipStats: { cargoCapacity: 400 },
  },
  thrusterUpgrade: {
    id: "thrusterUpgrade",
    category: "ship",
    label: "Thruster Upgrade",
    description: "Higher-output thrusters — faster acceleration in both flight modes, more so when loaded.",
    cost: noCost({ rock: 20, nickelIron: 20 }),
    // +1800 force ≈ +60 accel at empty (base 30) mass — matches the old flat-accel upgrade's
    // felt effect exactly when the hold is empty; real force means the benefit is even more
    // pronounced once loaded, since a stronger engine fights the mass penalty better.
    shipStats: { thrustForce: 1800 },
  },
  maneuveringThrusters: {
    id: "maneuveringThrusters",
    category: "ship",
    label: "Maneuvering Thrusters",
    description: "Tighter RCS response for precision positioning — still well below Cruise speed.",
    cost: noCost({ rock: 15, nickelIron: 10, crystal: 5 }),
    shipStats: { rcsDrag: -0.25 },
  },
  laserFocusingLens: {
    id: "laserFocusingLens",
    category: "ship",
    label: "Laser Focusing Lens",
    description: "Extends effective laser range.",
    cost: noCost({ rock: 10, crystal: 10 }),
    shipStats: { laserRangeBonus: 40 },
  },
  reinforcedDrillHead: {
    id: "reinforcedDrillHead",
    category: "ship",
    label: "Reinforced Drill Head",
    description: "Extends drill anchor range — less finicky to line up.",
    cost: noCost({ rock: 15, nickelIron: 15 }),
    shipStats: { drillAnchorRangeBonus: 15 },
  },
  proximitySensors: {
    id: "proximitySensors",
    category: "ship",
    label: "Proximity Sensors",
    description: "Wider passive detection range — no ping needed.",
    cost: noCost({ rock: 10, crystal: 12 }),
    shipStats: { visionRadius: 400 },
  },
  rapidScanModule: {
    id: "rapidScanModule",
    category: "ship",
    label: "Rapid Scan Module",
    description: "Faster asteroid scans, especially on larger bodies.",
    cost: noCost({ crystal: 15 }),
    shipStats: { scanSpeedMult: -0.3 },
  },
  heatShield: {
    id: "heatShield",
    category: "ship",
    label: "Heat Shield",
    description: "Raises the hull-damage temperature threshold — a wider warning-only margin.",
    cost: noCost({ nickelIron: 15, crystal: 10 }),
    shipStats: { temperatureDamageThreshold: 15 },
  },
  radiatorVanes: {
    id: "radiatorVanes",
    category: "ship",
    label: "Radiator Vanes",
    description: "Faster passive cooling once clear of a heat source.",
    cost: noCost({ nickelIron: 12, crystal: 8 }),
    shipStats: { temperatureDecayPerSec: 8 },
  },
  signatureDampener: {
    id: "signatureDampener",
    category: "ship",
    label: "Signature Dampener",
    description: "Reduces signature gain from active tool use.",
    cost: noCost({ rock: 10, crystal: 10 }),
    shipStats: { signatureGainMult: -0.25 },
  },
  emissionBaffling: {
    id: "emissionBaffling",
    category: "ship",
    label: "Emission Baffling",
    description: "Faster passive signature decay.",
    cost: noCost({ rock: 8, nickelIron: 8 }),
    shipStats: { signatureDecayPerSec: 6 },
  },
  auxiliaryFuelTank: {
    id: "auxiliaryFuelTank",
    category: "ship",
    label: "Auxiliary Fuel Tank",
    description: "Larger fuel reserve for longer expeditions.",
    cost: noCost({ rock: 15, nickelIron: 10 }),
    shipStats: { fuelCapacity: 40 },
  },
  batteryBank: {
    id: "batteryBank",
    category: "ship",
    label: "Battery Bank",
    description: "Larger battery capacity for sensors and tools.",
    cost: noCost({ rock: 15, crystal: 10 }),
    shipStats: { batteryCapacity: 40 },
  },

  // --- Ship: Advanced (Research-gated) ---
  reinforcedHullPlating: {
    id: "reinforcedHullPlating",
    category: "ship",
    label: "Reinforced Hull Plating",
    description: "Platinum-alloy plating — +30 max hull.",
    cost: noCost({ nickelIron: 10, platinum: 8 }),
    requiresResearch: "platinumAlloyPlating",
    shipStats: { maxHull: 30 },
  },
  chargePayloadUpgrade: {
    id: "chargePayloadUpgrade",
    category: "ship",
    label: "Charge Payload Upgrade",
    description: "Carry more charges at once.",
    cost: noCost({ nickelIron: 8, radioactive: 6 }),
    requiresResearch: "radiationShielding",
    shipStats: { chargeMaxCarried: 4 },
  },
  longRangePing: {
    id: "longRangePing",
    category: "ship",
    label: "Long-Range Ping",
    description: "Extends ping radius and expansion speed.",
    cost: noCost({ crystal: 12, nickelIron: 10 }),
    requiresResearch: "metallicBodyCartography",
    shipStats: { pingMaxRadius: 2500, pingSpeed: 800 },
  },
  inertialDampeners: {
    id: "inertialDampeners",
    category: "ship",
    label: "Inertial Dampeners",
    description: "Reduces gravity's felt pull on the ship specifically.",
    cost: noCost({ crystal: 10, ice: 8 }),
    requiresResearch: "refinedMaterialsHandling",
    shipStats: { gravityResistMult: -0.3 },
  },
  cargoStabilizers: {
    id: "cargoStabilizers",
    category: "ship",
    label: "Cargo Stabilizers",
    description: "Offsets some of the collision-mass penalty from a loaded cargo hold.",
    cost: noCost({ nickelIron: 15, rock: 10 }),
    requiresResearch: "reinforcedAlloyFrames",
    shipStats: { cargoMassFactor: -0.02 },
  },
  solarCollectorArray: {
    id: "solarCollectorArray",
    category: "ship",
    label: "Solar Collector Array",
    description: "Multiplies battery regen gained from solar exposure specifically.",
    cost: noCost({ crystal: 15, nickelIron: 8 }),
    requiresResearch: "solarCollectionTheory",
    shipStats: { solarRegenMult: 0.75 },
  },
  powerEfficiencySystems: {
    id: "powerEfficiencySystems",
    category: "ship",
    label: "Power Efficiency Systems",
    description: "Reduces power draw across every system.",
    cost: noCost({ nickelIron: 10, crystal: 10 }),
    requiresResearch: "powerGridEfficiency",
    shipStats: { powerDrawMult: -0.25 },
  },
  passivePingArray: {
    id: "passivePingArray",
    category: "ship",
    label: "Passive Ping Array",
    description: "Automatically sweeps a weaker ping on its own timer — no input needed.",
    cost: noCost({ crystal: 12, radioactive: 4 }),
    requiresResearch: "autonomousSensorNetworks",
    shipStats: { passivePingInterval: PASSIVE_PING_INTERVAL },
  },

  // --- Hub: Standard ---
  // Dock Range Extension was cut — an isolated flat +dockRange purchase with no connection to
  // anything else, once Hub.dockRange became a passive function of facilitiesBuilt instead (see
  // hub.ts) rather than something you'd buy directly. hub-growth-spec.md/ARCHITECTURE.md cover
  // the reasoning.
  repairBay: {
    id: "repairBay",
    category: "hubStandard",
    label: "Repair Bay",
    description: "Docking now repairs the ship to full — no longer only reset by dying.",
    cost: noCost({ rock: 20, nickelIron: 15, crystal: 5 }),
    hubFlags: ["repairOnDock"],
  },
  beaconRangeUpgrade: {
    id: "beaconRangeUpgrade",
    category: "hubStandard",
    label: "Beacon Range",
    description: "The hub passively sweeps a radius around itself for contacts, same as the ship's own passive vision.",
    cost: noCost({ rock: 10, crystal: 15 }),
    hubStats: { beaconRange: 1200 },
  },
  structuralReinforcement: {
    id: "structuralReinforcement",
    category: "hubStandard",
    label: "Structural Reinforcement",
    description: "Reinforces the hub's own structure. Nothing can damage the hub yet — this pays off once something can.",
    cost: noCost({ rock: 25, nickelIron: 10 }),
    hubStats: { structuralIntegrity: 50 },
  },

  // --- Hub: Facility ---
  researchLabExpansion: {
    id: "researchLabExpansion",
    category: "hubFacility",
    label: "Research Lab Expansion",
    description: "Expands the outpost's research lab — faster research across every project.",
    cost: noCost({ rock: 40, nickelIron: 20, crystal: 15 }),
    hubStats: { researchSpeedMult: -0.2 },
  },
  refinery: {
    id: "refinery",
    category: "hubFacility",
    label: "Refinery",
    description: "Converts bulk low-value material into something worth having, at a real loss ratio.",
    cost: noCost({ rock: 50, nickelIron: 30, crystal: 10 }),
    requiresResearch: "cryoFuelProcessing",
    hubFlags: ["refineryBuilt"],
  },
  observatory: {
    id: "observatory",
    category: "hubFacility",
    label: "Observatory",
    description: "Unlocks the hub's Map tab and the ability to deploy satellites.",
    cost: noCost({ rock: 30, nickelIron: 20, crystal: 25 }),
    hubStats: { satelliteCap: 1 },
    hubFlags: ["observatoryBuilt"],
  },
  satelliteBay: {
    id: "satelliteBay",
    category: "hubFacility",
    label: "Satellite Bay",
    description: "Raises the deployed-satellite cap by one.",
    cost: noCost({ nickelIron: 25, crystal: 15 }),
    requiresResearch: "orbitalLogistics",
    hubStats: { satelliteCap: 1 },
  },
  reactor: {
    id: "reactor",
    category: "hubFacility",
    label: "Reactor",
    description: "Boosts battery regen while near the hub, before you've even docked.",
    cost: noCost({ nickelIron: 40, radioactive: 20, ice: 15 }),
    requiresResearch: "reactorEngineering",
    hubFlags: ["reactorBuilt"],
  },
};

export function canAfford(materials: CargoHold, cost: CargoHold): boolean {
  return COMPOSITIONS.every((key) => materials[key] >= cost[key]);
}

/** Refinery (Section 3b) recipes — a small fixed table, not an arbitrary N-by-N converter
 *  ("not a free converter, a genuine release valve" — upgrades-spec.md). Both grind down
 *  Chondrite Rock, the most common/least valuable resource, at a real loss ratio (5:1) rather
 *  than a 1:1 trade. */
export type RefineRecipeId = "rockToNickelIron" | "rockToCrystal";

export interface RefineRecipe {
  from: Composition;
  to: Composition;
  inputAmount: number;
  outputAmount: number;
}

export const REFINE_RECIPES: Record<RefineRecipeId, RefineRecipe> = {
  rockToNickelIron: { from: "rock", to: "nickelIron", inputAmount: 25, outputAmount: 5 },
  rockToCrystal: { from: "rock", to: "crystal", inputAmount: 25, outputAmount: 3 },
};
