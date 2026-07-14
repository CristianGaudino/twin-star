"use client";

import { useEffect, useRef, useState } from "react";
import { AsteroidType, Composition } from "@/game/asteroid";
import { Engine } from "@/game/engine";
import { ActiveResearch } from "@/game/hub";
import { Renderer } from "@/game/renderer";
import { ResearchId } from "@/game/research";
import { CargoHold } from "@/game/ship";
import { UpgradeId } from "@/game/upgrades";
import HubOverlay from "./HubOverlay";
import { MapContactSnapshot } from "./MapView";

interface HubUiState {
  materials: CargoHold;
  cargoCapacity: number;
  purchased: UpgradeId[];
  message: { text: string; color: string } | null;
  completedResearch: ResearchId[];
  activeResearch: ActiveResearch | null;
  everDeposited: Composition[];
  scannedTypes: AsteroidType[];
  refineryBuilt: boolean;
  observatoryBuilt: boolean;
  hubPos: { x: number; y: number };
  satelliteCap: number;
  satelliteCount: number;
  exploredSectors: string[];
  mapContacts: MapContactSnapshot[];
}

export default function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const [scene, setScene] = useState<"field" | "hub">("field");
  const [hubUi, setHubUi] = useState<HubUiState | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const engine = new Engine(canvas);
    engineRef.current = engine;
    const renderer = new Renderer();
    let raf = 0;
    let last = performance.now();

    // The game loop is otherwise fully imperative (Engine mutates itself, Renderer draws
    // straight to canvas, nothing re-renders React) — this is the one bridge into React state,
    // and only for the hub screen's DOM overlay. Diffed by hand rather than calling setState
    // every frame, so docking doesn't turn into 60 re-renders/sec of a screen that's otherwise
    // sitting still.
    let lastScene: "field" | "hub" = "field";
    let lastHubSnapshot = "";
    // exploredSectors/mapContacts never change while docked — nothing in Engine.updateHub
    // touches discoveredContacts or exploredSectors, both are purely a field-side concern. Was
    // previously rebuilt (a fresh array + object per contact) and JSON.stringify'd every single
    // frame regardless, real wasted work once a session has accumulated more than a handful of
    // contacts/sectors. Computed once on the field->hub transition instead, reused for the rest
    // of the visit — the same "only pay for what actually changed" reasoning the hand-diffed
    // snapshot below already applies to everything else.
    let mapSnapshot: { exploredSectors: string[]; mapContacts: MapContactSnapshot[] } | null = null;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      engine.resize(w, h);
    };
    resize();
    window.addEventListener("resize", resize);

    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      engine.update(dt);
      renderer.render(engine, ctx, window.innerWidth, window.innerHeight);

      if (engine.scene !== lastScene) {
        if (engine.scene === "hub") {
          mapSnapshot = {
            exploredSectors: Array.from(engine.exploredSectors),
            mapContacts: Array.from(engine.discoveredContacts.values()).map((m) => ({
              id: m.contact.id,
              kind: m.contact.kind,
              label: m.contact.label,
              x: m.contact.pos.x,
              y: m.contact.pos.y,
              age: m.age,
              identified:
                m.contact.kind === "hub" || m.contact.kind === "satellite" || engine.identifiedContacts.has(m.contact.id),
            })),
          };
        }
        lastScene = engine.scene;
        setScene(engine.scene);
      }
      if (engine.scene === "hub" && mapSnapshot) {
        // Only the genuinely per-frame-variable fields (purchases, materials, research, an
        // in-flight message) are rebuilt/diffed here — the map fields above are a stable
        // reference from the scene-transition snapshot, never re-stringified on a steady-state
        // frame where nothing in the hub actually changed.
        const smallSnapshot = {
          materials: { ...engine.hub.materials },
          cargoCapacity: engine.ship.cargoCapacity,
          purchased: Array.from(engine.hub.purchasedUpgrades),
          message: engine.message ? { text: engine.message.text, color: engine.message.color } : null,
          completedResearch: Array.from(engine.hub.completedResearch),
          activeResearch: engine.hub.activeResearch ? { ...engine.hub.activeResearch } : null,
          everDeposited: Array.from(engine.hub.everDeposited),
          scannedTypes: Array.from(engine.scannedTypes),
          refineryBuilt: engine.hub.refineryBuilt,
          observatoryBuilt: engine.hub.observatoryBuilt,
          hubPos: { x: engine.hub.pos.x, y: engine.hub.pos.y },
          satelliteCap: engine.hub.satelliteCap,
          satelliteCount: engine.satellites.length,
        };
        const serialized = JSON.stringify(smallSnapshot);
        if (serialized !== lastHubSnapshot) {
          lastHubSnapshot = serialized;
          setHubUi({ ...smallSnapshot, ...mapSnapshot });
        }
      }

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  return (
    <div className="relative h-screen w-screen">
      <canvas ref={canvasRef} className="block h-screen w-screen bg-black" />
      {scene === "hub" && hubUi && (
        <HubOverlay
          materials={hubUi.materials}
          cargoCapacity={hubUi.cargoCapacity}
          purchased={hubUi.purchased}
          message={hubUi.message}
          completedResearch={hubUi.completedResearch}
          activeResearch={hubUi.activeResearch}
          everDeposited={hubUi.everDeposited}
          scannedTypes={hubUi.scannedTypes}
          refineryBuilt={hubUi.refineryBuilt}
          observatoryBuilt={hubUi.observatoryBuilt}
          hubPos={hubUi.hubPos}
          satelliteCap={hubUi.satelliteCap}
          satelliteCount={hubUi.satelliteCount}
          exploredSectors={hubUi.exploredSectors}
          mapContacts={hubUi.mapContacts}
          onBuy={(id) => engineRef.current?.purchaseUpgrade(id)}
          onResearch={(id) => engineRef.current?.startResearch(id)}
          onRefine={(id) => engineRef.current?.refineMaterial(id)}
          onLaunch={() => engineRef.current?.launchFromHub()}
        />
      )}
    </div>
  );
}
