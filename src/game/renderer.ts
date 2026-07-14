import type { Engine } from "./engine";
import {
  ASTEROID_TYPE_INFO,
  Asteroid,
  COMPOSITIONS,
  COMPOSITION_INFO,
  Cell,
  RESOURCE_WEIGHTS_BY_TYPE,
  cellLocalToWorld,
  weightKgFor,
} from "./asteroid";
import { Chunk } from "./chunk";
import { ContactMemory } from "./contacts";
import { coordinateOf, formatCoordinate } from "./coords";
import { dustInView } from "./dustfield";
import { Hub } from "./hub";
import { starsInView } from "./starfield";
import { TOOLS, ToolId } from "./tools";
import { UpgradeId } from "./upgrades";
import {
  BELT_INNER_RADIUS,
  BELT_OUTER_RADIUS,
  BLAST_VISUAL_DURATION,
  CHARGE_BLAST_RADIUS,
  CONTACT_FADE_DURATION,
  CONTACT_FORGET_AFTER,
  CONTACT_MAX_RANGE,
  CRUISE_TERMINAL_SPEED,
  DEATH_SCREEN_DURATION,
  DRILL_ANCHOR_RANGE,
  DRILL_FRACTURE_GENERATIONS,
  HOME_STAR_POS,
  HOME_STAR_RADIUS,
  HOME_STAR_SOLAR_RADIUS,
  HUB_MODULE_OFFSET,
  HUB_RADIUS,
  PING_MAX_RADIUS,
  SATELLITE_VISION_RADIUS,
  SCAN_DATA_DISPLAY_RANGE,
  SCAN_RANGE,
  SHIP_RADIUS,
  TEMPERATURE_DAMAGE_THRESHOLD,
} from "./constants";
import { Vec2, add, distance, fromAngle, length, lerp, normalize, scale, sub, v2 } from "./vec2";

type HubModuleKind = "researchLab" | "observatory" | "satelliteBay" | "reactor" | "refinery";

interface HubModuleSlot {
  id: UpgradeId; // must be a Hub Facility upgrade (category "hubFacility")
  angleDeg: number;
  kind: HubModuleKind;
  rgb: string; // "r,g,b" — not hex, so alpha can be layered on directly per-draw
}

/** hub-growth-spec.md Section 2 — a fixed, permanent angle per Hub Facility, so a returning
 *  player's mental map of "where's the Refinery" never shifts between sessions. Satellite Bay's
 *  color deliberately matches Renderer.renderSatellites' own violet — the module and the thing
 *  it produces should read as the same color family. Not built yet: Scrapyard/Mining
 *  Facility/Shipyard/Foundry (upgrades-spec.md Section 3b) — when one of those exists, it's one
 *  more entry here, at whatever angle keeps the ring evenly spaced, not a restructure. */
const HUB_FACILITY_SLOTS: HubModuleSlot[] = [
  { id: "researchLabExpansion", angleDeg: 0, kind: "researchLab", rgb: "159,208,255" },
  { id: "observatory", angleDeg: 72, kind: "observatory", rgb: "191,224,255" },
  { id: "satelliteBay", angleDeg: 144, kind: "satelliteBay", rgb: "200,160,255" },
  { id: "reactor", angleDeg: 216, kind: "reactor", rgb: "255,220,160" },
  { id: "refinery", angleDeg: 288, kind: "refinery", rgb: "224,162,98" },
];

// Standard-upgrade ring tells (hub-growth-spec.md Section 4) — point markers placed at the
// midpoints between facility slots so they never visually collide with a Facility Module.
const HUB_BEACON_ANGLE_DEG = 36;
const HUB_REPAIR_BAY_ANGLE_DEG = 108;

/**
 * Draws one frame from Engine's current state. Deliberately stateless and separate from Engine
 * itself — Engine owns simulation (physics, mining, input), Renderer only reads it and draws.
 * Split out ahead of enemies/combat landing so world-object rendering (ship, asteroid, chunks,
 * and soon enemies) has one obvious place to grow instead of piling onto the simulation class.
 */
export class Renderer {
  render(engine: Engine, ctx: CanvasRenderingContext2D, width: number, height: number) {
    if (engine.scene === "hub") {
      // The hub screen itself is a DOM overlay (see HubOverlay.tsx) — canvas just goes to a
      // plain backdrop behind it.
      ctx.fillStyle = "#050a12";
      ctx.fillRect(0, 0, width, height);
      if (engine.paused) this.renderPauseOverlay(ctx, width, height);
      return;
    }

    const { ship } = engine;
    const offset = sub(ship.pos, v2(width / 2, height / 2));
    const toScreen = (p: Vec2): Vec2 => sub(p, offset);

    ctx.fillStyle = "#04050a";
    ctx.fillRect(0, 0, width, height);

    this.renderStars(engine, ctx, toScreen, width, height);
    this.renderDust(engine, ctx, toScreen, width, height);
    this.renderBeltBoundary(ctx, toScreen);
    this.renderHomeStar(ctx, toScreen);
    this.renderGravitySources(engine, ctx, toScreen);
    this.renderHubMarker(engine, ctx, toScreen);
    this.renderSatellites(engine, ctx, toScreen);

    if (engine.pingActive) {
      const p = toScreen(ship.pos);
      const alpha = Math.max(0, 1 - engine.pingRadius / PING_MAX_RADIUS);
      ctx.strokeStyle = `rgba(120,220,255,${alpha * 0.6})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, engine.pingRadius, 0, Math.PI * 2);
      ctx.stroke();
    }

    this.renderAsteroids(engine, ctx, toScreen, offset, width, height);
    for (const chunk of engine.chunks) this.renderChunk(ctx, toScreen, chunk);
    // Cursor highlighting is its own top-level pass — deliberately independent of tool/mode
    // (see hover.ts) and drawn after everything it might highlight, so it's never obscured
    // by e.g. a cell's own drill-fracture lines.
    this.renderHoverHighlight(engine, ctx, toScreen);
    this.renderBlastEffects(engine, ctx, toScreen);

    if (engine.activeBeam) {
      const from = toScreen(engine.activeBeam.from);
      const to = toScreen(engine.activeBeam.to);
      ctx.strokeStyle = engine.activeBeam.tool === "drill" ? "#ffb35c" : "#ff5c7a";
      ctx.lineWidth = engine.activeBeam.tool === "drill" ? 3 : 1.6;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }

    this.renderShip(engine, ctx, toScreen);

    if (ship.mode === "rcs") this.renderReticle(engine, ctx, toScreen);
    this.renderRadarIndicators(engine, ctx, offset, width, height);

    this.renderHud(engine, ctx, width, height);

    if (engine.deathScreen) this.renderDeathScreen(engine, ctx, width, height);
    if (engine.paused) this.renderPauseOverlay(ctx, width, height);
  }

  private renderStars(
    engine: Engine,
    ctx: CanvasRenderingContext2D,
    toScreen: (p: Vec2) => Vec2,
    width: number,
    height: number,
  ) {
    // Generated on the fly for whatever's currently visible (see starfield.ts) — a
    // solar-system-scale map needs stars everywhere a trip might go, not just near the origin.
    const margin = 60;
    const originX = engine.ship.pos.x - width / 2;
    const originY = engine.ship.pos.y - height / 2;
    const stars = starsInView(originX - margin, originY - margin, originX + width + margin, originY + height + margin);
    for (const star of stars) {
      const p = toScreen(star.pos);
      ctx.fillStyle = `rgba(255,255,255,${star.brightness})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, star.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Belt dust (dustfield.ts) — purely decorative, non-interactable, so the belt reads as a
   *  genuinely denser/hazier region even at a glance from outside it, not just a landmark once
   *  you're already among the asteroids. Warm, sandy-rock tone (distinct from the cool white
   *  starfield behind it) — same color family as the belt's own dominant resource, Chondrite
   *  Rock. Drawn right after the starfield, before anything else, so it reads as atmosphere
   *  rather than obscuring any actual gameplay element. */
  private renderDust(
    engine: Engine,
    ctx: CanvasRenderingContext2D,
    toScreen: (p: Vec2) => Vec2,
    width: number,
    height: number,
  ) {
    const margin = 100;
    const originX = engine.ship.pos.x - width / 2;
    const originY = engine.ship.pos.y - height / 2;
    const motes = dustInView(originX - margin, originY - margin, originX + width + margin, originY + height + margin);
    for (const mote of motes) {
      const p = toScreen(mote.pos);
      ctx.fillStyle = `rgba(200,185,160,${mote.alpha})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, mote.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** The home star's visual appearance — a fixed landmark. Loosely Sirius-A-ish: bright, warm,
   *  ordinary — the far star (not built yet) is meant to read as its opposite. Its gravity well
   *  and lethal surface (see gravity.ts) are drawn separately in `renderGravitySources`, since
   *  a future body might want this same hazard indicator with a completely different look.
   *
   *  The solid-reading core used to be tiny (r*0.22) with most of the radius spent on a fast,
   *  faint falloff — so a fully-opaque large asteroid could visually read as *bigger* than the
   *  star despite HOME_STAR_RADIUS (1100) dwarfing every asteroid's actual radius. Widened the
   *  near-opaque core and pushed the gradient's bright stops outward so the star reads as a big
   *  solid body with a modest corona, matching its real declared size. */
  private renderHomeStar(ctx: CanvasRenderingContext2D, toScreen: (p: Vec2) => Vec2) {
    const p = toScreen(HOME_STAR_POS);
    const r = HOME_STAR_RADIUS;

    const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    gradient.addColorStop(0, "rgba(255,244,214,1)");
    gradient.addColorStop(0.3, "rgba(255,230,160,0.95)");
    gradient.addColorStop(0.6, "rgba(255,195,100,0.55)");
    gradient.addColorStop(1, "rgba(255,170,60,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#fff7e0";
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Generic hazard indicator for every `Engine.gravitySources` entry — a future planet/moon
   *  gets this same warning ring automatically, with zero renderer changes, just by existing in
   *  that list. Pull radius is a soft dashed blue line (you can feel it before it's dangerous);
   *  a radiating source additionally gets a warm amber ring at its own `heatRadius` (a distinct
   *  dash pattern so the two still read separately even when the radii happen to coincide, as
   *  they do for the home star today); lethal sources get a tight red ring right at the actual
   *  kill radius so "this far and no closer without thrust" is an explicit line, not a guess. */
  private renderGravitySources(engine: Engine, ctx: CanvasRenderingContext2D, toScreen: (p: Vec2) => Vec2) {
    for (const source of engine.gravitySources) {
      const p = toScreen(source.pos);

      ctx.strokeStyle = "rgba(140,180,255,0.18)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([10, 10]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, source.pullRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      if (source.heatRadius) {
        ctx.strokeStyle = "rgba(255,170,90,0.22)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 14]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, source.heatRadius, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (source.lethal) {
        ctx.strokeStyle = "rgba(255,90,90,0.5)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, source.radius * 1.15, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  /** The belt ring itself — a real landmark around the star (not the hub), both its inner and
   *  outer edge, visible but not a wall (nothing physically stops travel through it). Dashed and
   *  faint since it's a large backdrop element most of the time, not a HUD-grade indicator. */
  private renderBeltBoundary(ctx: CanvasRenderingContext2D, toScreen: (p: Vec2) => Vec2) {
    const p = toScreen(HOME_STAR_POS);
    ctx.strokeStyle = "rgba(130,165,220,0.16)";
    ctx.lineWidth = 2;
    ctx.setLineDash([26, 20]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, BELT_INNER_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.x, p.y, BELT_OUTER_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** The home hub as it appears out in the field — a plain placeholder ring for now (spec's
   *  visual direction isn't decided yet, and there's nothing to visually grow into until
   *  upgrades exist). Shows a dock prompt only once actually in range. */
  /** Deployed satellites (map-radar-spec.md Section 6) — fixed points, no physics, so this is
   *  the whole visual: a small ring plus its own vision-radius ghost so it's obvious how much of
   *  the field it's actually covering right now. */
  private renderSatellites(engine: Engine, ctx: CanvasRenderingContext2D, toScreen: (p: Vec2) => Vec2) {
    for (const sat of engine.satellites) {
      const p = toScreen(sat.pos);
      ctx.strokeStyle = "rgba(200,160,255,0.4)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, SATELLITE_VISION_RADIUS, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = "rgba(200,160,255,0.9)";
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(200,160,255,0.7)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 11, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /** The hub as a modular outpost, not a lit-up ring (hub-growth-spec.md) — a Core Ring (this
   *  method) plus a Facility Module per owned Hub Facility (renderHubModule) and fixed solar
   *  arrays (renderHubSolarArrays), all keyed directly off `Hub`'s existing state — no new
   *  persisted data needed anywhere for this. `hub.radius` (not the flat HUB_RADIUS constant)
   *  is the hub's actual current footprint, grown by facilitiesBuilt — see hub.ts. */
  private renderHubMarker(engine: Engine, ctx: CanvasRenderingContext2D, toScreen: (p: Vec2) => Vec2) {
    const { hub } = engine;
    const p = toScreen(hub.pos);
    const radius = hub.radius;
    const time = performance.now() / 1000;

    this.renderHubSolarArrays(ctx, p);

    for (const slot of HUB_FACILITY_SLOTS) {
      if (hub.purchasedUpgrades.has(slot.id)) {
        this.renderHubModule(ctx, p, radius, slot, hub, engine.satellites.length, time);
      } else {
        this.renderHubModuleStub(ctx, p, radius, slot.angleDeg);
      }
    }

    // Core ring itself — color shifts toward a brighter cyan-white the more research is
    // completed (a "how developed is this outpost" tell with no facility footprint of its own),
    // and Structural Reinforcement thickens the stroke and adds girder ticks around it, a real
    // cosmetic payoff for a stat that otherwise "pays off once something can damage the hub."
    const researchTint = Math.min(1, hub.completedResearch.size / 7);
    const rgb = `${Math.round(lerp(127, 170, researchTint))},${Math.round(lerp(224, 230, researchTint))},${Math.round(lerp(141, 255, researchTint))}`;
    const reinforced = hub.purchasedUpgrades.has("structuralReinforcement");

    ctx.strokeStyle = `rgba(${rgb},0.75)`;
    ctx.lineWidth = reinforced ? 3.5 : 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = `rgba(${rgb},0.35)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius * 0.6, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = `rgba(${rgb},0.9)`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();

    if (reinforced) {
      ctx.strokeStyle = `rgba(${rgb},0.5)`;
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const inner = add(p, scale(fromAngle(a), radius - 5));
        const outer = add(p, scale(fromAngle(a), radius + 5));
        ctx.beginPath();
        ctx.moveTo(inner.x, inner.y);
        ctx.lineTo(outer.x, outer.y);
        ctx.stroke();
      }
    }

    // Beacon Range Upgrade — a pulsing light; a bigger beaconRange pulses a little slower/broader.
    if (hub.beaconRange > 0) {
      const beaconPos = add(p, scale(fromAngle((HUB_BEACON_ANGLE_DEG * Math.PI) / 180), radius));
      const speed = Math.max(0.6, 3 - hub.beaconRange / 800);
      const pulse = 0.5 + 0.5 * Math.sin(time * speed);
      ctx.fillStyle = `rgba(255,220,140,${0.4 + 0.5 * pulse})`;
      ctx.beginPath();
      ctx.arc(beaconPos.x, beaconPos.y, 3 + pulse * 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Repair Bay — a small lit cross panel. Nothing can damage the hub yet, but the med-bay
    // fiction reads fine as a pure "you're safe here" tell regardless.
    if (hub.repairOnDock) {
      const rp = add(p, scale(fromAngle((HUB_REPAIR_BAY_ANGLE_DEG * Math.PI) / 180), radius));
      ctx.fillStyle = "rgba(20,30,25,0.85)";
      ctx.fillRect(rp.x - 5, rp.y - 5, 10, 10);
      ctx.strokeStyle = "rgba(255,120,120,0.85)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(rp.x - 3, rp.y);
      ctx.lineTo(rp.x + 3, rp.y);
      ctx.moveTo(rp.x, rp.y - 3);
      ctx.lineTo(rp.x, rp.y + 3);
      ctx.stroke();
    }

    if (engine.nearHub) {
      // hub.dockRange is now a passive function of facilitiesBuilt (hub.ts), not a purchasable
      // stat — this ring already grows on its own as the hub does, no separate "upgrade bought"
      // visual needed alongside it.
      ctx.strokeStyle = "rgba(127,224,141,0.6)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, hub.dockRange, 0, Math.PI * 2);
      ctx.stroke();

      ctx.font = "bold 13px monospace";
      ctx.fillStyle = "#7de08d";
      ctx.textAlign = "center";
      ctx.fillText("[F] DOCK", p.x, p.y - radius - 16);
      ctx.textAlign = "left";
    }
  }

  /** Baseline, unlocked from the start — main spec Section 2 has always said the hub is
   *  solar-powered, but nothing ever drew it. Two panels flanking the hub, angled to face
   *  HOME_STAR_POS — since both are fixed points this angle never changes frame to frame, but
   *  it's still computed live rather than hardcoded so it stays correct if the hub ever moves. */
  private renderHubSolarArrays(ctx: CanvasRenderingContext2D, hubScreenPos: Vec2) {
    const starAngle = Math.atan2(HOME_STAR_POS.y - hubScreenPos.y, HOME_STAR_POS.x - hubScreenPos.x);
    const perp = starAngle + Math.PI / 2;
    const armLen = HUB_RADIUS * 0.55;
    for (const side of [1, -1]) {
      const base = add(hubScreenPos, scale(fromAngle(perp), side * HUB_RADIUS * 0.5));
      ctx.save();
      ctx.translate(base.x, base.y);
      ctx.rotate(starAngle);
      ctx.fillStyle = "rgba(90,140,220,0.5)";
      ctx.fillRect(0, -6, armLen, 12);
      ctx.strokeStyle = "rgba(150,190,255,0.5)";
      ctx.lineWidth = 1;
      ctx.strokeRect(0, -6, armLen, 12);
      ctx.restore();
    }
  }

  /** A dark, unfilled clamp stub at a not-yet-built facility's reserved slot — environmental
   *  storytelling that the hub was designed for more than currently exists, not just an absence. */
  private renderHubModuleStub(ctx: CanvasRenderingContext2D, center: Vec2, radius: number, angleDeg: number) {
    const angle = (angleDeg * Math.PI) / 180;
    const inner = add(center, scale(fromAngle(angle), radius));
    const outer = add(center, scale(fromAngle(angle), radius + HUB_MODULE_OFFSET * 0.5));
    ctx.strokeStyle = "rgba(120,130,145,0.25)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(inner.x, inner.y);
    ctx.lineTo(outer.x, outer.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(outer.x, outer.y, 5, 0, Math.PI * 2);
    ctx.stroke();
  }

  /** An owned Hub Facility's module — a strut back to the ring, then a kind-specific shape drawn
   *  in its own local frame (translated/rotated so "local up" points outward along the strut).
   *  Each kind's shape/animation says what the facility does (hub-growth-spec.md Section 3)
   *  rather than being a reskinned copy of the others. All animation is a fixed-period cosmetic
   *  read off `time` alone (deliberately not wired to real solar/detection state — see the
   *  spec's own scope-discipline note on why that coupling isn't worth it). */
  private renderHubModule(
    ctx: CanvasRenderingContext2D,
    center: Vec2,
    ringRadius: number,
    slot: HubModuleSlot,
    hub: Hub,
    satelliteCount: number,
    time: number,
  ) {
    const angle = (slot.angleDeg * Math.PI) / 180;
    const modulePos = add(center, scale(fromAngle(angle), ringRadius + HUB_MODULE_OFFSET));
    const strutInner = add(center, scale(fromAngle(angle), ringRadius));

    ctx.strokeStyle = "rgba(180,190,200,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(strutInner.x, strutInner.y);
    ctx.lineTo(modulePos.x, modulePos.y);
    ctx.stroke();

    ctx.save();
    ctx.translate(modulePos.x, modulePos.y);
    ctx.rotate(angle + Math.PI / 2);
    switch (slot.kind) {
      case "researchLab":
        this.renderResearchLabModule(ctx, slot.rgb, !!hub.activeResearch, time);
        break;
      case "observatory":
        this.renderObservatoryModule(ctx, slot.rgb, time);
        break;
      case "satelliteBay":
        this.renderSatelliteBayModule(ctx, slot.rgb, hub.satelliteCap, satelliteCount);
        break;
      case "reactor":
        this.renderReactorModule(ctx, slot.rgb, time);
        break;
      case "refinery":
        this.renderRefineryModule(ctx, slot.rgb, time);
        break;
    }
    ctx.restore();
  }

  private renderResearchLabModule(ctx: CanvasRenderingContext2D, rgb: string, sweeping: boolean, time: number) {
    ctx.strokeStyle = `rgba(${rgb},0.7)`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 9);
    ctx.lineTo(0, -4);
    ctx.stroke();

    ctx.save();
    ctx.rotate(sweeping ? Math.sin(time * 1.6) * 0.4 : 0);
    ctx.strokeStyle = `rgba(${rgb},0.85)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, -4, 8, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
    ctx.restore();
  }

  private renderObservatoryModule(ctx: CanvasRenderingContext2D, rgb: string, time: number) {
    ctx.fillStyle = `rgba(${rgb},0.25)`;
    ctx.strokeStyle = `rgba(${rgb},0.7)`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 4, 11, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const sweepAngle = Math.PI + (time * 0.6 - Math.floor(time * 0.6)) * Math.PI;
    ctx.strokeStyle = `rgba(${rgb},0.5)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 4);
    ctx.lineTo(Math.cos(sweepAngle) * 10, 4 + Math.sin(sweepAngle) * 10);
    ctx.stroke();
  }

  private renderSatelliteBayModule(ctx: CanvasRenderingContext2D, rgb: string, cap: number, count: number) {
    ctx.strokeStyle = `rgba(${rgb},0.6)`;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-10, -6, 20, 12);

    const n = Math.max(1, cap);
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? 0 : -8 + (i / (n - 1)) * 16;
      ctx.fillStyle = i < count ? `rgba(${rgb},0.95)` : `rgba(${rgb},0.25)`;
      ctx.beginPath();
      ctx.arc(x, 0, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private renderReactorModule(ctx: CanvasRenderingContext2D, rgb: string, time: number) {
    const pulse = 0.55 + 0.35 * Math.sin(time * 1.2);
    ctx.fillStyle = `rgba(${rgb},${pulse})`;
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `rgba(${rgb},0.55)`;
    ctx.lineWidth = 1.5;
    const finSpin = time * 0.5;
    for (let i = 0; i < 3; i++) {
      const a = finSpin + (i / 3) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 9, Math.sin(a) * 9);
      ctx.lineTo(Math.cos(a) * 16, Math.sin(a) * 16);
      ctx.stroke();
    }
  }

  private renderRefineryModule(ctx: CanvasRenderingContext2D, rgb: string, time: number) {
    ctx.fillStyle = "rgba(70,64,58,0.85)";
    ctx.strokeStyle = `rgba(${rgb},0.5)`;
    ctx.lineWidth = 1.5;
    ctx.fillRect(-9, -8, 18, 16);
    ctx.strokeRect(-9, -8, 18, 16);

    for (let i = 0; i < 3; i++) {
      const flicker = 0.3 + 0.35 * Math.abs(Math.sin(time * (2.2 + i * 0.7) + i));
      ctx.fillStyle = `rgba(${rgb},${flicker})`;
      ctx.beginPath();
      ctx.arc(-4 + i * 4, 2, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Skips any asteroid whose bounding circle doesn't reach the visible viewport at all — the
   *  system now spans a belt ring plus a normal-area band, both far larger than one screen, but
   *  every asteroid's every cell was still being path-constructed and filled/stroked
   *  unconditionally each frame regardless of whether any of it was ever going to be visible.
   *  Generous margin (outline noise can push a cell beyond `outerRadius`, and `asteroid.center`
   *  is a live but approximate centroid — see recomputeDriftGroups). */
  private renderAsteroids(
    engine: Engine,
    ctx: CanvasRenderingContext2D,
    toScreen: (p: Vec2) => Vec2,
    offset: Vec2,
    width: number,
    height: number,
  ) {
    const margin = 300;
    for (const asteroid of engine.asteroids) {
      const reach = asteroid.outerRadius + margin;
      if (
        asteroid.center.x + reach < offset.x ||
        asteroid.center.x - reach > offset.x + width ||
        asteroid.center.y + reach < offset.y ||
        asteroid.center.y - reach > offset.y + height
      ) {
        continue;
      }
      this.renderOneAsteroid(asteroid, ctx, toScreen);
    }
  }

  private renderOneAsteroid(asteroid: Asteroid, ctx: CanvasRenderingContext2D, toScreen: (p: Vec2) => Vec2) {
    const sweeping = !asteroid.scanned && asteroid.scanProgress > 0;
    const sweepRadius = asteroid.scanProgress * asteroid.outerRadius;

    for (const cell of asteroid.cells) {
      if (cell.fractured) continue;
      const poly = cell.polygon;
      if (poly.length < 3) continue;

      ctx.beginPath();
      const p0 = toScreen(poly[0]);
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < poly.length; i++) {
        const p = toScreen(poly[i]);
        ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();

      ctx.fillStyle = cell.shade;
      ctx.globalAlpha = 0.88;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(10,10,14,0.55)";
      ctx.lineWidth = 1;
      ctx.stroke();

      if (sweeping && distance(cell.centroid, asteroid.center) <= sweepRadius) {
        ctx.fillStyle = "rgba(120,220,255,0.32)";
        ctx.fill();
        ctx.strokeStyle = "rgba(160,230,255,0.85)";
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }

      const centroid = toScreen(cell.centroid);

      if (cell.hasCharge) {
        ctx.fillStyle = "#ff4444";
        ctx.beginPath();
        ctx.arc(centroid.x, centroid.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      if (cell.fractures && cell.boreProgress > 0) {
        this.renderCracks(ctx, toScreen, cell);
      }
    }

    if (sweeping) {
      const c = toScreen(asteroid.center);
      ctx.strokeStyle = "rgba(120,220,255,0.55)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, sweepRadius, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  /** Draws the drill fracture network for a cell mid-bore (see `Engine.generateFractures`).
   *  Every hairline segment carries its own generation-based `order`, so segments from every
   *  branch reveal together as `boreProgress` climbs — the whole network visibly spreads and
   *  forks outward at once rather than one arm completing before the next starts. Points are
   *  stored cell-local and converted to world space here so they stay glued to the rock as it
   *  drifts/spins (`cellLocalToWorld`). */
  private renderCracks(ctx: CanvasRenderingContext2D, toScreen: (p: Vec2) => Vec2, cell: Cell) {
    const segments = cell.fractures!;
    if (segments.length === 0) return;
    const band = 1 / DRILL_FRACTURE_GENERATIONS;
    ctx.strokeStyle = "rgba(12,10,9,0.75)";
    ctx.lineWidth = 1;
    for (const seg of segments) {
      const vis = Math.max(0, Math.min(1, (cell.boreProgress - seg.order) / band));
      if (vis <= 0) continue;
      const a = cellLocalToWorld(cell, seg.a);
      const b = cellLocalToWorld(cell, seg.b);
      const end = vis >= 1 ? b : add(a, scale(sub(b, a), vis));
      const pa = toScreen(a);
      const pb = toScreen(end);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
  }

  private renderChunk(ctx: CanvasRenderingContext2D, toScreen: (p: Vec2) => Vec2, chunk: Chunk) {
    const p = toScreen(chunk.pos);
    const info = COMPOSITION_INFO[chunk.composition];
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(chunk.angle);
    ctx.fillStyle = info.color;
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(chunk.shape[0].x, chunk.shape[0].y);
    for (let i = 1; i < chunk.shape.length; i++) ctx.lineTo(chunk.shape[i].x, chunk.shape[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /** Outlines + labels whatever `engine.hoverTarget` currently is (see hover.ts) — a cell or a
   *  chunk, entirely independent of the selected tool or ship mode. This is the *only* place
   *  a "you're looking at X" highlight is drawn; tool targeting (currentTarget) still gates
   *  actual mining behavior but no longer owns any of this visual. */
  private renderHoverHighlight(engine: Engine, ctx: CanvasRenderingContext2D, toScreen: (p: Vec2) => Vec2) {
    const hover = engine.hoverTarget;
    if (!hover) return;

    let label: string;
    let labelColor = "rgba(230,232,238,0.85)";
    if (hover.kind === "cell") {
      this.strokePolygon(ctx, toScreen, hover.cell.polygon, "#ffffff", 2);
      label = hover.cell.asteroid.scanned ? COMPOSITION_INFO[hover.cell.composition].label : "unidentified";
    } else {
      // Chunks are small and already visually distinct (loose debris drifting on its own) —
      // an outline circle around them just added clutter. Tooltip only.
      // Shows the chunk's actual weight (real kg, driven by size and material density — see
      // weightKgFor) plus whether it'll actually fit — flying over a chunk heavier than
      // remaining cargo room only collects the part that fits and wastes the rest (see the
      // chunk-pickup loop in Engine.update), so this is the one place that's visible before
      // committing to grab it.
      const { chunk } = hover;
      const info = COMPOSITION_INFO[chunk.composition];
      const chunkWeightKg = weightKgFor(chunk.composition, chunk.value);
      const roomKg = engine.ship.cargoCapacity - engine.ship.cargoUsed;
      if (roomKg <= 0) {
        label = `${info.label} (${Math.round(chunkWeightKg)}kg) — CARGO FULL, WON'T COLLECT`;
        labelColor = "rgba(255,107,107,0.9)";
      } else if (roomKg < chunkWeightKg) {
        label = `${info.label} (${Math.round(chunkWeightKg)}kg) — ONLY ${Math.round(roomKg)}kg WILL FIT`;
        labelColor = "rgba(255,207,92,0.9)";
      } else {
        label = `${info.label} (${Math.round(chunkWeightKg)}kg)`;
      }
    }

    const cursor = toScreen(engine.screenToWorld(engine.input.mouseScreen));
    ctx.font = "11px monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = labelColor;
    ctx.fillText(label, cursor.x + 14, cursor.y - 12);
  }

  private strokePolygon(
    ctx: CanvasRenderingContext2D,
    toScreen: (p: Vec2) => Vec2,
    poly: Vec2[],
    color: string,
    lineWidth: number,
  ) {
    if (poly.length < 3) return;
    ctx.beginPath();
    const p0 = toScreen(poly[0]);
    ctx.moveTo(p0.x, p0.y);
    for (let i = 1; i < poly.length; i++) {
      const p = toScreen(poly[i]);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }

  private renderBlastEffects(engine: Engine, ctx: CanvasRenderingContext2D, toScreen: (p: Vec2) => Vec2) {
    for (const blast of engine.blastEffects) {
      const progress = 1 - blast.timer / BLAST_VISUAL_DURATION;
      const p = toScreen(blast.pos);

      const ringRadius = progress * CHARGE_BLAST_RADIUS * 1.3;
      const ringAlpha = Math.max(0, 1 - progress) * 0.8;
      ctx.strokeStyle = `rgba(255,180,90,${ringAlpha})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(p.x, p.y, ringRadius, 0, Math.PI * 2);
      ctx.stroke();

      const flashAlpha = Math.max(0, 1 - progress * 4) * 0.9;
      if (flashAlpha > 0) {
        ctx.fillStyle = `rgba(255,230,180,${flashAlpha})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(2, 22 * (1 - progress * 3)), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private renderShip(engine: Engine, ctx: CanvasRenderingContext2D, toScreen: (p: Vec2) => Vec2) {
    const { ship, input } = engine;
    const p = toScreen(ship.pos);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(ship.angle);

    const thrusting =
      !ship.anchored &&
      (input.isDown("w") || input.isDown("a") || input.isDown("s") || input.isDown("d"));
    if (thrusting) {
      ctx.fillStyle = `rgba(255,${140 + Math.floor(Math.random() * 60)},60,0.9)`;
      ctx.beginPath();
      ctx.moveTo(-SHIP_RADIUS * 1.1, -3);
      ctx.lineTo(-SHIP_RADIUS * 1.1 - 6 - Math.random() * 6, 0);
      ctx.lineTo(-SHIP_RADIUS * 1.1, 3);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = ship.anchored ? "#ff9f4d" : ship.mode === "rcs" ? "#ffd166" : "#7fe0ff";
    ctx.beginPath();
    ctx.moveTo(SHIP_RADIUS * 1.4, 0);
    ctx.lineTo(-SHIP_RADIUS, SHIP_RADIUS * 0.9);
    ctx.lineTo(-SHIP_RADIUS * 0.5, 0);
    ctx.lineTo(-SHIP_RADIUS, -SHIP_RADIUS * 0.9);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    if (ship.anchored) {
      ctx.strokeStyle = "rgba(255,159,77,0.5)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, SHIP_RADIUS * 1.8, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private renderReticle(engine: Engine, ctx: CanvasRenderingContext2D, toScreen: (p: Vec2) => Vec2) {
    const { ship, input } = engine;
    const worldMouse = engine.screenToWorld(input.mouseScreen);
    const toolDef = TOOLS[ship.selectedTool];
    const valid = !!engine.currentTarget;

    const shipScreen = toScreen(ship.pos);

    // The drill no longer cares where the cursor points — it anchors to whatever the ship is
    // physically close to (the orange anchor-range circle below), so the generic aim-range
    // circle other tools use would be actively misleading here and is skipped.
    if (ship.selectedTool !== "drill") {
      ctx.strokeStyle = "rgba(255,255,255,0.15)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(shipScreen.x, shipScreen.y, toolDef.range, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (ship.selectedTool === "drill") {
      ctx.strokeStyle = "rgba(255,179,92,0.35)";
      ctx.beginPath();
      ctx.arc(shipScreen.x, shipScreen.y, DRILL_ANCHOR_RANGE, 0, Math.PI * 2);
      ctx.stroke();
    }

    const p = toScreen(worldMouse);
    const color = valid ? "#7de08d" : "#888";
    this.renderToolCursor(ctx, p, ship.selectedTool, color);
  }

  /** Each tool gets its own reticle shape, so what you're aiming with is obvious at a glance
   *  without reading the HUD — laser keeps the plain crosshair, drill gets a bullseye (you're
   *  boring straight into one spot), charges gets a diamond marker (you're placing an object). */
  private renderToolCursor(ctx: CanvasRenderingContext2D, p: Vec2, tool: ToolId, color: string) {
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1.5;

    if (tool === "laser") {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.moveTo(p.x - 11, p.y);
      ctx.lineTo(p.x + 11, p.y);
      ctx.moveTo(p.x, p.y - 11);
      ctx.lineTo(p.x, p.y + 11);
      ctx.stroke();
    } else if (tool === "drill") {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 10);
      ctx.lineTo(p.x + 10, p.y);
      ctx.lineTo(p.x, p.y + 10);
      ctx.lineTo(p.x - 10, p.y);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** One blip per discovered, currently off-screen contact — not just a single fixed point,
   *  so tracking a body doesn't fall apart the moment mining splits it into several pieces.
   *  Each blip sits at its *last known* position (frozen when discovered/refreshed), not a
   *  live position, and fades out as that memory goes stale. */
  private renderRadarIndicators(
    engine: Engine,
    ctx: CanvasRenderingContext2D,
    offset: Vec2,
    width: number,
    height: number,
  ) {
    for (const memory of engine.discoveredContacts.values()) {
      this.renderRadarIndicator(engine, ctx, offset, width, height, memory);
    }
  }

  private renderRadarIndicator(
    engine: Engine,
    ctx: CanvasRenderingContext2D,
    offset: Vec2,
    width: number,
    height: number,
    memory: ContactMemory,
  ) {
    const { ship } = engine;
    const contact = memory.contact;
    const screenPos = sub(contact.pos, offset);
    const margin = 28;
    const onScreen =
      screenPos.x >= 0 && screenPos.x <= width && screenPos.y >= 0 && screenPos.y <= height;
    if (onScreen) return;

    const staleFor = memory.age - (CONTACT_FORGET_AFTER - CONTACT_FADE_DURATION);
    const alpha = staleFor <= 0 ? 1 : Math.max(0, 1 - staleFor / CONTACT_FADE_DURATION);
    if (alpha <= 0) return;

    // Tactical-radar-only range cutoff — the underlying memory can now live much longer (see
    // MAP_CONTACT_FORGET_AFTER, read by the hub's Map tab), but the in-field HUD radar only ever
    // shows what's still plausibly nearby, same as before this split. Self-owned, always-known
    // assets (the hub, any deployed satellite) are exempt — you don't lose track of home, or of
    // something you placed yourself, just because you flew far away from it.
    const alwaysKnown = contact.kind === "hub" || contact.kind === "satellite";
    if (!alwaysKnown && distance(ship.pos, contact.pos) > CONTACT_MAX_RANGE) return;

    const center = v2(width / 2, height / 2);
    const dir = normalize(sub(screenPos, center));
    const maxX = width / 2 - margin;
    const maxY = height / 2 - margin;
    const tX = dir.x !== 0 ? maxX / Math.abs(dir.x) : Infinity;
    const tY = dir.y !== 0 ? maxY / Math.abs(dir.y) : Infinity;
    const t = Math.min(tX, tY);
    const pos = add(center, scale(dir, t));

    // A ping only tells you something's out there and roughly where — not what it is. Identity
    // only comes from actually having flown within vision range of it at some point (see
    // Engine.identifiedContacts); the hub is the one thing you start out already knowing.
    // Unidentified contacts read as a neutral, uninformative color on purpose — the color coding
    // itself (hub green, star amber) would otherwise leak what something is before it's earned.
    const identified =
      contact.kind === "hub" || contact.kind === "satellite" || engine.identifiedContacts.has(contact.id);
    const rgb = !identified
      ? "170,180,190"
      : contact.kind === "hub"
        ? "127,224,141"
        : contact.kind === "star"
          ? "255,190,110"
          : contact.kind === "satellite"
            ? "200,160,255"
            : "127,224,255";

    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(Math.atan2(dir.y, dir.x));
    ctx.fillStyle = `rgba(${rgb},${alpha})`;
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-6, -6);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Ping is a targeting readout, not a location — plain distance from the ship, rounded (not
    // exact, a ping tells you roughly where to point). The galactic coordinate system (coords.ts)
    // is a separate concept for the HUD/a future map, not this. Label is generic
    // ("Unidentified") until identified.
    const dist = Math.round(distance(ship.pos, contact.pos) / 10) * 10;
    const label = identified ? contact.label : "Unidentified";
    ctx.fillStyle = `rgba(${rgb},${alpha})`;
    ctx.font = "11px monospace";
    ctx.textAlign = "center";
    ctx.fillText(`${label} ${dist}m`, pos.x, pos.y + (dir.y > 0 ? 18 : -12));
  }

  private renderHud(engine: Engine, ctx: CanvasRenderingContext2D, width: number, height: number) {
    const { ship } = engine;
    const asteroid = engine.nearestAsteroid;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    const panelX = 16;
    let y = 16;
    const lineH = 18;

    const bar = (label: string, frac: number, color: string, extra = "") => {
      ctx.font = "12px monospace";
      ctx.fillStyle = "#cfd6e0";
      ctx.fillText(`${label}${extra}`, panelX, y);
      const barX = panelX + 92;
      const barW = 130;
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(barX, y + 2, barW, 10);
      ctx.fillStyle = color;
      ctx.fillRect(barX, y + 2, barW * Math.max(0, Math.min(1, frac)), 10);
      y += lineH;
    };

    ctx.font = "13px monospace";
    ctx.fillStyle = ship.anchored ? "#ff9f4d" : ship.mode === "rcs" ? "#ffd166" : "#7fe0ff";
    const modeSuffix = ship.anchored
      ? " (ANCHORED — drilling)"
      : ship.mode === "cruise"
        ? " (aim: mouse)"
        : " (mining-ready)";
    ctx.fillText(`MODE: ${ship.mode.toUpperCase()}${modeSuffix}`, panelX, y);
    y += lineH + 2;

    // m/s — 1 world unit is 1 meter (same convention the rest of the HUD/coords use). Bar is
    // normalized against cruise's own terminal speed, not a hard cap — gravity/collision/blast
    // knockback can genuinely exceed it, the bar just clamps visually past 100% when they do.
    const speed = length(ship.vel);
    bar("SPEED", speed / CRUISE_TERMINAL_SPEED, "#a0e0ff", ` ${speed.toFixed(0)}m/s`);

    bar("HULL", ship.hull / 100, ship.hull > 30 ? "#7de08d" : "#ff6b6b", ` ${ship.hull.toFixed(0)}/100`);
    // Only shown once it means something — no clutter when nowhere near a heat source.
    if (ship.temperature > 1) {
      const overheating = ship.temperature > TEMPERATURE_DAMAGE_THRESHOLD;
      bar(
        "TEMP",
        ship.temperature / 100,
        overheating ? "#ff6b6b" : "#ffcf5c",
        ` ${ship.temperature.toFixed(0)}%${overheating ? " — OVERHEATING" : ""}`,
      );
    }
    bar(
      "CARGO",
      ship.cargoUsed / ship.cargoCapacity,
      "#7fe0ff",
      ` ${Math.round(ship.cargoUsed)}/${ship.cargoCapacity}kg`,
    );
    bar("SIGNATURE", ship.signature / 100, "#ffa25c", ` ${ship.signature.toFixed(0)}%`);

    // Fuel: thrust-only, never regenerates passively — red once low, since running out means
    // real stranding (fuel-power-spec.md Section 4), not just an inconvenience.
    bar(
      "FUEL",
      ship.fuel / ship.fuelCapacity,
      ship.fuel > ship.fuelCapacity * 0.2 ? "#ffcf5c" : "#ff6b6b",
      ` ${ship.fuel.toFixed(0)}/${ship.fuelCapacity.toFixed(0)}`,
    );
    // Battery: everything except thrust. A distinct warm tint + marker while within the star's
    // (much larger than its hazard radii) solar range and actually gaining charge from it — the
    // one place the risk/reward of hugging the star pays off outside of pure heat-tolerance.
    const solarCharging = distance(ship.pos, HOME_STAR_POS) < HOME_STAR_SOLAR_RADIUS;
    bar(
      "BATTERY",
      ship.battery / ship.batteryCapacity,
      solarCharging ? "#ffe08a" : "#7fe0ff",
      ` ${ship.battery.toFixed(0)}/${ship.batteryCapacity.toFixed(0)}${solarCharging ? " (charging)" : ""}`,
    );

    y += 4;
    ctx.font = "12px monospace";
    ctx.fillStyle = "#cfd6e0";
    const toolDef = TOOLS[ship.selectedTool];
    const chargeInfo = ship.selectedTool === "charges" ? ` (${ship.chargesCarried} carried)` : "";
    ctx.fillText(`TOOL: ${toolDef.label}${chargeInfo}  [TAB cycle, or 1 Laser / 2 Drill / 3 Charges]`, panelX, y);
    y += lineH;

    const pingText = engine.pingCooldown > 0 ? `cooling ${engine.pingCooldown.toFixed(1)}s` : "READY";
    ctx.fillText(`PING [Q]: ${pingText}`, panelX, y);
    y += lineH;

    // Only shown once Observatory is built — no point advertising a key that does nothing yet.
    if (engine.hub.observatoryBuilt) {
      ctx.fillText(`SATELLITE [G]: ${engine.satellites.length}/${engine.hub.satelliteCap} deployed`, panelX, y);
      y += lineH;
    }

    // Galactic standard coordinate, not raw (x, y) — see coords.ts. Star-anchored, not
    // ship-relative, so it stays meaningful for a future map rather than just "which way to
    // point right now" (that's what the radar blips below are for).
    ctx.fillStyle = "#8f97a3";
    ctx.fillText(`POS: ${formatCoordinate(coordinateOf(ship.pos))}`, panelX, y);
    y += lineH;

    if (asteroid && !asteroid.scanned) {
      const surfaceDist = distance(ship.pos, asteroid.center) - asteroid.outerRadius;
      const inScanRange = surfaceDist <= SCAN_RANGE;
      if (asteroid.scanProgress > 0) {
        bar("SCANNING", asteroid.scanProgress, "#7fe0ff", ` ${Math.round(asteroid.scanProgress * 100)}%`);
      } else if (inScanRange) {
        ctx.fillStyle = "#7de08d";
        ctx.font = "12px monospace";
        ctx.fillText("[HOLD E] SCAN ASTEROID", panelX, y);
        y += lineH;
      }
    }

    const target = engine.currentTarget;
    if (ship.mode === "rcs" && target) {
      const info = COMPOSITION_INFO[target.composition];
      const targetScanned = target.asteroid.scanned;
      ctx.font = "12px monospace";
      if (targetScanned) {
        ctx.fillStyle = "#e8e8e8";
        ctx.fillText(`TARGET: ${info.label}   HARDNESS ${this.hardnessPips(info.hardness)}`, panelX, y);
      } else {
        ctx.fillStyle = "#9099a8";
        ctx.fillText("TARGET: unidentified — scan to reveal", panelX, y);
      }
      y += lineH;
    }

    if (asteroid && asteroid.scanned && distance(ship.pos, asteroid.center) <= SCAN_DATA_DISPLAY_RANGE) {
      y += 2;
      ctx.fillStyle = "#8f97a3";
      ctx.font = "11px monospace";
      ctx.fillText(`SCAN DATA — ${ASTEROID_TYPE_INFO[asteroid.type].label}`, panelX, y);
      y += 15;
      // Only resources this asteroid's type can actually contain (see RESOURCE_WEIGHTS_BY_TYPE)
      // — showing all six unconditionally would list e.g. Platinum-Group Ore as "0 intact" on a
      // body that could never have had any, which reads as a find that's been missed rather
      // than one that was never possible here.
      const possible = COMPOSITIONS.filter((c) => RESOURCE_WEIGHTS_BY_TYPE[asteroid.type][c] > 0);
      for (const comp of possible) {
        const info = COMPOSITION_INFO[comp];
        const remaining = asteroid.cells.filter((c) => !c.fractured && c.composition === comp).length;
        ctx.fillStyle = "#cfd6e0";
        ctx.font = "12px monospace";
        ctx.fillText(
          `${info.label}: ${remaining} intact   HARDNESS ${this.hardnessPips(info.hardness)}`,
          panelX,
          y,
        );
        y += lineH;
      }
    }

    if (engine.message) {
      ctx.font = "bold 15px monospace";
      ctx.fillStyle = engine.message.color;
      ctx.textAlign = "center";
      ctx.globalAlpha = Math.min(1, engine.message.timer);
      ctx.fillText(engine.message.text, width / 2, 20);
      ctx.globalAlpha = 1;
      ctx.textAlign = "left";
    }

    this.renderLegend(ctx, height);
  }

  private hardnessPips(hardness: number): string {
    return "●".repeat(hardness) + "○".repeat(5 - hardness);
  }

  private renderLegend(ctx: CanvasRenderingContext2D, height: number) {
    const lines = [
      "WASD  thrust    Mouse  aim (cruise) / free (RCS)      SPACE  toggle Cruise / RCS",
      "Q  ping      HOLD E  scan      TAB  cycle tool (1/2/3 select directly)      ESC/P  pause",
      "LMB  laser cut / hold-anchor drill / place charge      R  detonate charges      F  dock at hub",
    ];
    ctx.font = "11px monospace";
    ctx.fillStyle = "rgba(207,214,224,0.65)";
    ctx.textAlign = "left";
    let y = height - 16 - (lines.length - 1) * 14;
    for (const line of lines) {
      ctx.fillText(line, 16, y);
      y += 14;
    }
  }

  /** Auto-dismissing (see DEATH_SCREEN_DURATION) — death costs a run's haul, not the session,
   *  so this reads as a hit, not a hard stop. Ship has already respawned by the time this
   *  shows; the overlay is purely aftermath, not a blocking "press any key." */
  private renderDeathScreen(engine: Engine, ctx: CanvasRenderingContext2D, width: number, height: number) {
    const death = engine.deathScreen!;
    const alpha = Math.min(1, death.timer / (DEATH_SCREEN_DURATION * 0.4)); // hold, then fade over the last stretch

    ctx.fillStyle = `rgba(10,4,4,${0.7 * alpha})`;
    ctx.fillRect(0, 0, width, height);

    ctx.textAlign = "center";
    ctx.fillStyle = `rgba(255,107,107,${alpha})`;
    ctx.font = "bold 30px monospace";
    ctx.fillText(death.cause, width / 2, height / 2 - 20);

    if (death.cargoLost > 0) {
      ctx.font = "14px monospace";
      ctx.fillStyle = `rgba(207,214,224,${alpha})`;
      ctx.fillText(`${death.cargoLost} CARGO LOST`, width / 2, height / 2 + 16);
    }

    ctx.textAlign = "left";
  }

  private renderPauseOverlay(ctx: CanvasRenderingContext2D, width: number, height: number) {
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, width, height);
    ctx.textAlign = "center";
    ctx.fillStyle = "#e8e8e8";
    ctx.font = "bold 28px monospace";
    ctx.fillText("PAUSED", width / 2, height / 2 - 24);
    ctx.font = "13px monospace";
    ctx.fillStyle = "#9099a8";
    ctx.fillText("ESC or P to resume", width / 2, height / 2 + 10);
    ctx.textAlign = "left";
  }
}
