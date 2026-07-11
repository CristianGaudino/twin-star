"use client";

import { COMPOSITION_INFO } from "@/game/asteroid";
import { CargoHold } from "@/game/ship";
import { UPGRADES, UpgradeId, canAfford } from "@/game/upgrades";

interface HubOverlayProps {
  materials: CargoHold;
  cargoCapacity: number;
  purchased: UpgradeId[];
  message: { text: string; color: string } | null;
  onBuy: (id: UpgradeId) => void;
  onLaunch: () => void;
}

const MATERIAL_KEYS: (keyof CargoHold)[] = ["ore", "crystal", "unstable"];

/**
 * The hub's actual UI — a DOM overlay rather than hand-drawn canvas text, since it's a real
 * shop with buttons/choices, not just status bars. Canvas keeps the in-field HUD; this only
 * exists while `Engine.scene === "hub"` (see GameCanvas.tsx). Purely presentational — every
 * button here calls straight back into the Engine instance, which stays the single source of
 * truth for game state.
 */
export default function HubOverlay({ materials, cargoCapacity, purchased, message, onBuy, onLaunch }: HubOverlayProps) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {/* InputState listens for mousedown on `window` for field/mining input — without this,
          a click on a button here would also register as a click "through" to the field,
          right as LAUNCH switches the scene back. */}
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="pointer-events-auto w-105 rounded-lg border border-emerald-400/30 bg-[#050a12]/95 p-6 font-mono text-slate-200 shadow-2xl"
      >
        <h1 className="text-center text-xl font-bold text-emerald-300">HOME HUB</h1>

        <p className="mt-2 h-5 text-center text-sm" style={{ color: message?.color ?? "transparent" }}>
          {message?.text ?? "—"}
        </p>

        <h2 className="mt-4 mb-2 text-xs tracking-wide text-slate-400">MATERIALS IN STORAGE</h2>
        <ul className="mb-6 space-y-1 text-sm">
          {MATERIAL_KEYS.map((key) => (
            <li key={key} style={{ color: COMPOSITION_INFO[key].color }}>
              {COMPOSITION_INFO[key].label}: {materials[key]}
            </li>
          ))}
        </ul>

        <h2 className="mb-2 text-xs tracking-wide text-slate-400">UPGRADES</h2>
        <ul className="mb-6 space-y-2">
          {Object.values(UPGRADES).map((upgrade) => {
            const owned = purchased.includes(upgrade.id);
            const affordable = canAfford(materials, upgrade.cost);
            return (
              <li key={upgrade.id} className="rounded border border-slate-700/60 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="font-semibold">{upgrade.label}</span>
                  {owned ? (
                    <span className="text-xs font-bold text-emerald-400">OWNED</span>
                  ) : (
                    <button
                      onClick={() => onBuy(upgrade.id)}
                      disabled={!affordable}
                      className="rounded bg-emerald-500/80 px-2 py-1 text-xs font-bold text-black disabled:cursor-not-allowed disabled:bg-slate-600/60 disabled:text-slate-400"
                    >
                      BUY
                    </button>
                  )}
                </div>
                <p className="mt-1 text-slate-400">{upgrade.description}</p>
                <p className="mt-1 text-xs text-slate-500">
                  Cost: {upgrade.cost.ore} ore · {upgrade.cost.crystal} crystal · {upgrade.cost.unstable} unstable
                </p>
              </li>
            );
          })}
        </ul>

        <div className="mb-4 text-center text-xs text-slate-400">CARGO CAPACITY: {cargoCapacity}</div>

        <button
          onClick={onLaunch}
          className="w-full rounded bg-sky-500/80 py-2 text-sm font-bold text-black hover:bg-sky-400"
        >
          [F] LAUNCH
        </button>
      </div>
    </div>
  );
}
