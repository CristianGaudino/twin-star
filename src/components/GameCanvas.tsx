"use client";

import { useEffect, useRef, useState } from "react";
import { Engine } from "@/game/engine";
import { Renderer } from "@/game/renderer";
import { CargoHold } from "@/game/ship";
import { UpgradeId } from "@/game/upgrades";
import HubOverlay from "./HubOverlay";

interface HubUiState {
  materials: CargoHold;
  cargoCapacity: number;
  purchased: UpgradeId[];
  message: { text: string; color: string } | null;
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
        lastScene = engine.scene;
        setScene(engine.scene);
      }
      if (engine.scene === "hub") {
        const snapshot: HubUiState = {
          materials: { ...engine.hub.materials },
          cargoCapacity: engine.ship.cargoCapacity,
          purchased: Array.from(engine.hub.purchasedUpgrades),
          message: engine.message ? { text: engine.message.text, color: engine.message.color } : null,
        };
        const serialized = JSON.stringify(snapshot);
        if (serialized !== lastHubSnapshot) {
          lastHubSnapshot = serialized;
          setHubUi(snapshot);
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
          onBuy={(id) => engineRef.current?.purchaseUpgrade(id)}
          onLaunch={() => engineRef.current?.launchFromHub()}
        />
      )}
    </div>
  );
}
