import { Composition } from "./asteroid";
import { CargoHold } from "./ship";
import { UpgradeId } from "./upgrades";
import { Vec2 } from "./vec2";

/**
 * The player's home base — right now just a fixed point in the field you can dock at and a
 * running tally of deposited materials. The spec's eventual vision (visible growth as
 * upgrades are bought, an actual shop, offline passive generation) is deliberately not built
 * yet; this establishes the field/hub round-trip and gives those future systems something to
 * attach to.
 */
export class Hub {
  pos: Vec2;
  materials: CargoHold = { ore: 0, crystal: 0, unstable: 0 };
  purchasedUpgrades = new Set<UpgradeId>();

  constructor(pos: Vec2) {
    this.pos = pos;
  }

  deposit(cargo: CargoHold) {
    for (const key of Object.keys(cargo) as Composition[]) {
      this.materials[key] += cargo[key];
    }
  }
}
