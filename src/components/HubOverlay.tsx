"use client";

import { useState } from "react";
import { AsteroidType, COMPOSITIONS, COMPOSITION_INFO, Composition } from "@/game/asteroid";
import { RESEARCH, ResearchId } from "@/game/research";
import { CargoHold } from "@/game/ship";
import { REFINE_RECIPES, UPGRADES, UpgradeDef, UpgradeId, RefineRecipeId, canAfford } from "@/game/upgrades";
import MapView, { MapContactSnapshot } from "./MapView";

interface HubOverlayProps {
  materials: CargoHold;
  cargoCapacity: number;
  purchased: UpgradeId[];
  message: { text: string; color: string } | null;
  completedResearch: ResearchId[];
  activeResearch: { id: ResearchId; remainingSeconds: number } | null;
  everDeposited: Composition[];
  scannedTypes: AsteroidType[];
  refineryBuilt: boolean;
  observatoryBuilt: boolean;
  hubPos: { x: number; y: number };
  satelliteCap: number;
  satelliteCount: number;
  exploredSectors: string[];
  mapContacts: MapContactSnapshot[];
  onBuy: (id: UpgradeId) => void;
  onResearch: (id: ResearchId) => void;
  onRefine: (id: RefineRecipeId) => void;
  onLaunch: () => void;
}

type Tab = "ship" | "hub" | "research" | "map";

/**
 * The hub's actual UI — a DOM overlay rather than hand-drawn canvas text, since it's a real
 * shop with buttons/choices, not just status bars. Canvas keeps the in-field HUD; this only
 * exists while `Engine.scene === "hub"` (see GameCanvas.tsx). Purely presentational — every
 * button here calls straight back into the Engine instance, which stays the single source of
 * truth for game state. Three tabs mirror the upgrade system's three tiers (upgrades-spec.md
 * Section 1): Ship, Hub (Standard + Facility), and Research.
 */
export default function HubOverlay({
  materials,
  cargoCapacity,
  purchased,
  message,
  completedResearch,
  activeResearch,
  everDeposited,
  scannedTypes,
  refineryBuilt,
  observatoryBuilt,
  hubPos,
  satelliteCap,
  satelliteCount,
  exploredSectors,
  mapContacts,
  onBuy,
  onResearch,
  onRefine,
  onLaunch,
}: HubOverlayProps) {
  const [tab, setTab] = useState<Tab>("ship");

  const renderUpgrade = (upgrade: UpgradeDef) => {
    const owned = purchased.includes(upgrade.id);
    const locked = !!upgrade.requiresResearch && !completedResearch.includes(upgrade.requiresResearch);
    const affordable = !locked && canAfford(materials, upgrade.cost);
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
          Cost:{" "}
          {COMPOSITIONS.filter((key) => upgrade.cost[key] > 0)
            .map((key) => `${upgrade.cost[key]} ${COMPOSITION_INFO[key].label}`)
            .join(" · ") || "free"}
        </p>
        {locked && !owned && upgrade.requiresResearch && (
          <p className="mt-1 text-xs text-amber-500">Requires research: {RESEARCH[upgrade.requiresResearch].label}</p>
        )}
      </li>
    );
  };

  const shipUpgrades = Object.values(UPGRADES).filter((u) => u.category === "ship");
  const shipBasic = shipUpgrades.filter((u) => !u.requiresResearch);
  const shipAdvanced = shipUpgrades.filter((u) => u.requiresResearch);
  const hubStandard = Object.values(UPGRADES).filter((u) => u.category === "hubStandard");
  const hubFacility = Object.values(UPGRADES).filter((u) => u.category === "hubFacility");

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {/* InputState listens for mousedown on `window` for field/mining input — without this,
          a click on a button here would also register as a click "through" to the field,
          right as LAUNCH switches the scene back. */}
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="pointer-events-auto flex max-h-[85vh] w-130 flex-col rounded-lg border border-emerald-400/30 bg-[#050a12]/95 p-6 font-mono text-slate-200 shadow-2xl"
      >
        <h1 className="text-center text-xl font-bold text-emerald-300">HOME HUB</h1>

        <p className="mt-2 h-5 text-center text-sm" style={{ color: message?.color ?? "transparent" }}>
          {message?.text ?? "—"}
        </p>

        <h2 className="mt-2 mb-2 text-xs tracking-wide text-slate-400">MATERIALS IN STORAGE</h2>
        <ul className="mb-4 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          {COMPOSITIONS.map((key) => (
            <li key={key} style={{ color: COMPOSITION_INFO[key].color }}>
              {COMPOSITION_INFO[key].label}: {materials[key]}
            </li>
          ))}
        </ul>

        <div className="mb-3 flex gap-1 border-b border-slate-700/60">
          {(["ship", "hub", "research", ...(observatoryBuilt ? (["map"] as Tab[]) : [])] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-3 py-1.5 text-xs font-bold tracking-wide ${
                tab === t ? "border-b-2 border-emerald-400 text-emerald-300" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              {t.toUpperCase()}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto pr-1">
          {tab === "ship" && (
            <>
              <h3 className="mb-2 text-xs tracking-wide text-slate-500">BASIC</h3>
              <ul className="mb-4 space-y-2">{shipBasic.map(renderUpgrade)}</ul>
              <h3 className="mb-2 text-xs tracking-wide text-slate-500">ADVANCED — REQUIRES RESEARCH</h3>
              <ul className="space-y-2">{shipAdvanced.map(renderUpgrade)}</ul>
            </>
          )}

          {tab === "hub" && (
            <>
              <h3 className="mb-2 text-xs tracking-wide text-slate-500">STANDARD</h3>
              <ul className="mb-4 space-y-2">{hubStandard.map(renderUpgrade)}</ul>
              <h3 className="mb-2 text-xs tracking-wide text-slate-500">FACILITIES</h3>
              <ul className="mb-4 space-y-2">{hubFacility.map(renderUpgrade)}</ul>

              {refineryBuilt && (
                <>
                  <h3 className="mb-2 text-xs tracking-wide text-slate-500">REFINE MATERIALS</h3>
                  <ul className="space-y-2">
                    {(Object.keys(REFINE_RECIPES) as RefineRecipeId[]).map((id) => {
                      const recipe = REFINE_RECIPES[id];
                      const canRefine = materials[recipe.from] >= recipe.inputAmount;
                      return (
                        <li key={id} className="rounded border border-slate-700/60 p-3 text-sm">
                          <div className="flex items-center justify-between">
                            <span>
                              {recipe.inputAmount} {COMPOSITION_INFO[recipe.from].label} → {recipe.outputAmount}{" "}
                              {COMPOSITION_INFO[recipe.to].label}
                            </span>
                            <button
                              onClick={() => onRefine(id)}
                              disabled={!canRefine}
                              className="rounded bg-emerald-500/80 px-2 py-1 text-xs font-bold text-black disabled:cursor-not-allowed disabled:bg-slate-600/60 disabled:text-slate-400"
                            >
                              REFINE
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </>
          )}

          {tab === "research" && (
            <>
              {activeResearch && (
                <div className="mb-4 rounded border border-sky-400/40 bg-sky-950/30 p-3 text-sm">
                  <div className="font-semibold text-sky-300">{RESEARCH[activeResearch.id].label}</div>
                  <div className="mt-1 text-xs text-slate-400">
                    {Math.ceil(activeResearch.remainingSeconds)}s remaining
                  </div>
                </div>
              )}
              <ul className="space-y-2">
                {Object.values(RESEARCH)
                  .filter((project) => !completedResearch.includes(project.id))
                  .map((project) => {
                    const sampleOk = !project.requiresSample || everDeposited.includes(project.requiresSample);
                    const scanOk = !project.requiresScannedType || scannedTypes.includes(project.requiresScannedType);
                    const facilityOk = !project.requiresFacility || purchased.includes(project.requiresFacility);
                    const gatesOk = sampleOk && scanOk && facilityOk;
                    const affordable = canAfford(materials, project.cost);
                    const busy = activeResearch !== null;
                    return (
                      <li key={project.id} className="rounded border border-slate-700/60 p-3 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold">{project.label}</span>
                          <button
                            onClick={() => onResearch(project.id)}
                            disabled={!gatesOk || !affordable || busy}
                            className="rounded bg-sky-500/80 px-2 py-1 text-xs font-bold text-black disabled:cursor-not-allowed disabled:bg-slate-600/60 disabled:text-slate-400"
                          >
                            RESEARCH
                          </button>
                        </div>
                        <p className="mt-1 text-slate-400">{project.description}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          Cost:{" "}
                          {COMPOSITIONS.filter((key) => project.cost[key] > 0)
                            .map((key) => `${project.cost[key]} ${COMPOSITION_INFO[key].label}`)
                            .join(" · ") || "free"}{" "}
                          · {project.researchSeconds}s
                        </p>
                        {!gatesOk && (
                          <p className="mt-1 text-xs text-amber-500">
                            {!sampleOk &&
                              project.requiresSample &&
                              `Needs a ${COMPOSITION_INFO[project.requiresSample].label} sample. `}
                            {!scanOk &&
                              project.requiresScannedType &&
                              `Needs a scanned ${project.requiresScannedType}-type body. `}
                            {!facilityOk && project.requiresFacility && `Needs ${UPGRADES[project.requiresFacility].label} built.`}
                          </p>
                        )}
                      </li>
                    );
                  })}
              </ul>
              {completedResearch.length > 0 && (
                <p className="mt-4 text-xs text-slate-500">
                  Completed: {completedResearch.map((id) => RESEARCH[id].label).join(", ")}
                </p>
              )}
            </>
          )}

          {tab === "map" && observatoryBuilt && (
            <MapView
              hubPos={hubPos}
              exploredSectors={exploredSectors}
              contacts={mapContacts}
              satelliteCap={satelliteCap}
              satelliteCount={satelliteCount}
            />
          )}
        </div>

        <div className="mt-4 mb-3 text-center text-xs text-slate-400">CARGO CAPACITY: {cargoCapacity}kg</div>

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
