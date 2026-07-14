import { Composition } from "./asteroid";
import { HUB_DOCK_RANGE, HUB_DOCK_RANGE_GROWTH_PER_FACILITY, HUB_RADIUS, HUB_RADIUS_GROWTH_PER_FACILITY } from "./constants";
import { ResearchId } from "./research";
import { CargoHold, emptyCargo } from "./ship";
import { UPGRADES, UpgradeId } from "./upgrades";
import { Vec2 } from "./vec2";

/** One active research project at a time (upgrades-spec.md Section 3b/4) — the Research Lab
 *  starts minimal (research is possible from the very start, just this one slot), Research Lab
 *  Expansion only speeds it up, it doesn't add a second parallel slot yet. */
export interface ActiveResearch {
  id: ResearchId;
  remainingSeconds: number;
}

/**
 * The player's home base — a fixed point you dock at, a running tally of deposited materials,
 * and (see upgrades.ts/research.ts) the owner of every Hub-tier upgrade and the Research queue.
 * The spec's eventual visible-growth vision (new buildings actually rendered as the hub, an
 * offline passive layer) is still not built — this is the data side of that, not the visuals.
 */
export class Hub {
  pos: Vec2;
  materials: CargoHold = emptyCargo();
  purchasedUpgrades = new Set<UpgradeId>();

  // --- Research (research.ts) ---
  activeResearch: ActiveResearch | null = null;
  completedResearch = new Set<ResearchId>();
  // Discovery gate for ResearchDef.requiresSample — "have you ever found this," not "are you
  // currently holding it," so starting a research project doesn't require hostage-holding a
  // resource you'd otherwise want to spend on something else in the meantime.
  everDeposited = new Set<Composition>();

  // --- Upgradable hub stats (upgrades.ts) — same pattern as Ship's: absolute effective values,
  // initialized from the same constants/defaults everything started as, mutated directly by
  // Engine.purchaseUpgrade. dockRange is the one exception — see the getter below, it's derived,
  // not a purchasable stat of its own anymore.
  beaconRange = 0; // 0 = no passive hub-side detection until Beacon Range is bought
  structuralIntegrity = 0; // unused elsewhere today — see Structural Reinforcement's own doc comment
  researchSpeedMult = 1; // multiplies ActiveResearch's countdown rate; <1 from Research Lab Expansion/Research Methodology
  repairOnDock = false; // Repair Bay
  refineryBuilt = false; // Refinery
  observatoryBuilt = false; // Observatory — unlocks the Map tab and satellite deployment
  reactorBuilt = false; // Reactor — dock-radius solar boost, see Engine's power handling
  satelliteCap = 0; // 0 until Observatory (+1 more from Satellite Bay) — see Engine.deploySatellite

  constructor(pos: Vec2) {
    this.pos = pos;
  }

  /** How many Hub Facility upgrades (upgrades.ts's "hubFacility" category) are actually owned —
   *  the input to both visual growth (hub-growth-spec.md) and the physical radius below. Derived
   *  from `purchasedUpgrades` + `UPGRADES` rather than tracked separately, so it can never drift
   *  out of sync with what's actually been bought. */
  get facilitiesBuilt(): number {
    let count = 0;
    for (const id of this.purchasedUpgrades) {
      if (UPGRADES[id].category === "hubFacility") count++;
    }
    return count;
  }

  /** The hub's actual footprint — grows with facilitiesBuilt (hub-growth-spec.md), not just a
   *  fixed constant. Read by Renderer for the drawn ring *and* by Engine.hubContact() for the
   *  ping/vision detection radius — a more built-up hub is a bigger, easier-to-spot target on
   *  radar, a deliberate mechanical consequence of visual growth, not purely cosmetic. */
  get radius(): number {
    return HUB_RADIUS + this.facilitiesBuilt * HUB_RADIUS_GROWTH_PER_FACILITY;
  }

  /** Passive, not purchasable — Dock Range Extension (an isolated flat-stat upgrade with no other
   *  connection to anything) was cut in favor of this: a bigger, more built-up station is
   *  naturally easier to approach and dock at, the same "size matters" idea `radius` above
   *  already expresses for detection range. Scales with the same facilitiesBuilt count. */
  get dockRange(): number {
    return HUB_DOCK_RANGE + this.facilitiesBuilt * HUB_DOCK_RANGE_GROWTH_PER_FACILITY;
  }

  deposit(cargo: CargoHold) {
    for (const key of Object.keys(cargo) as Composition[]) {
      this.materials[key] += cargo[key];
      if (cargo[key] > 0) this.everDeposited.add(key);
    }
  }
}
