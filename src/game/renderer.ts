import type { Engine } from "./engine";
import { Asteroid, Cell, COMPOSITION_INFO, cellLocalToWorld } from "./asteroid";
import { Chunk } from "./chunk";
import { ContactMemory } from "./contacts";
import { starsInView } from "./starfield";
import { TOOLS, ToolId } from "./tools";
import {
  BELT_OUTER_RADIUS,
  BLAST_VISUAL_DURATION,
  CHARGE_BLAST_RADIUS,
  CONTACT_FADE_DURATION,
  CONTACT_FORGET_AFTER,
  DRILL_ANCHOR_RANGE,
  DRILL_FRACTURE_GENERATIONS,
  HOME_STAR_POS,
  HOME_STAR_RADIUS,
  HUB_DOCK_RANGE,
  HUB_RADIUS,
  PING_MAX_RADIUS,
  SCAN_DATA_DISPLAY_RANGE,
  SCAN_RANGE,
  SHIP_RADIUS,
} from "./constants";
import { Vec2, add, distance, normalize, scale, sub, v2 } from "./vec2";

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
    this.renderBeltBoundary(engine, ctx, toScreen);
    this.renderHomeStar(ctx, toScreen);
    this.renderHubMarker(engine, ctx, toScreen);

    if (engine.pingActive) {
      const p = toScreen(ship.pos);
      const alpha = Math.max(0, 1 - engine.pingRadius / PING_MAX_RADIUS);
      ctx.strokeStyle = `rgba(120,220,255,${alpha * 0.6})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, engine.pingRadius, 0, Math.PI * 2);
      ctx.stroke();
    }

    this.renderAsteroids(engine, ctx, toScreen);
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

  /** The home star — a fixed landmark, visual only (no collision yet). Loosely Sirius-A-ish:
   *  bright, warm, ordinary — the far star (not built yet) is meant to read as its opposite. */
  private renderHomeStar(ctx: CanvasRenderingContext2D, toScreen: (p: Vec2) => Vec2) {
    const p = toScreen(HOME_STAR_POS);
    const r = HOME_STAR_RADIUS;

    const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    gradient.addColorStop(0, "rgba(255,244,214,1)");
    gradient.addColorStop(0.15, "rgba(255,224,150,0.9)");
    gradient.addColorStop(0.4, "rgba(255,190,90,0.35)");
    gradient.addColorStop(1, "rgba(255,170,60,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#fff7e0";
    ctx.beginPath();
    ctx.arc(p.x, p.y, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }

  /** The belt's outer edge — "edge of normal operating range," visible but not a wall (nothing
   *  physically stops travel past it). Dashed and faint since it's a huge unobtrusive backdrop
   *  element most of the time, not a HUD-grade indicator. */
  private renderBeltBoundary(engine: Engine, ctx: CanvasRenderingContext2D, toScreen: (p: Vec2) => Vec2) {
    const p = toScreen(engine.hub.pos);
    ctx.strokeStyle = "rgba(130,165,220,0.12)";
    ctx.lineWidth = 2;
    ctx.setLineDash([26, 20]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, BELT_OUTER_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  /** The home hub as it appears out in the field — a plain placeholder ring for now (spec's
   *  visual direction isn't decided yet, and there's nothing to visually grow into until
   *  upgrades exist). Shows a dock prompt only once actually in range. */
  private renderHubMarker(engine: Engine, ctx: CanvasRenderingContext2D, toScreen: (p: Vec2) => Vec2) {
    const p = toScreen(engine.hub.pos);

    ctx.strokeStyle = "rgba(127,224,141,0.7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, HUB_RADIUS, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "rgba(127,224,141,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.x, p.y, HUB_RADIUS * 0.6, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = "rgba(127,224,141,0.9)";
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();

    if (engine.nearHub) {
      ctx.strokeStyle = "rgba(127,224,141,0.6)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, HUB_DOCK_RANGE, 0, Math.PI * 2);
      ctx.stroke();

      ctx.font = "bold 13px monospace";
      ctx.fillStyle = "#7de08d";
      ctx.textAlign = "center";
      ctx.fillText("[F] DOCK", p.x, p.y - HUB_RADIUS - 16);
      ctx.textAlign = "left";
    }
  }

  private renderAsteroids(engine: Engine, ctx: CanvasRenderingContext2D, toScreen: (p: Vec2) => Vec2) {
    for (const asteroid of engine.asteroids) {
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
    if (hover.kind === "cell") {
      this.strokePolygon(ctx, toScreen, hover.cell.polygon, "#ffffff", 2);
      const owner = engine.asteroids.find((a) => a.cells.includes(hover.cell));
      label = owner?.scanned ? COMPOSITION_INFO[hover.cell.composition].label : "unidentified";
    } else {
      // Chunks are small and already visually distinct (loose debris drifting on its own) —
      // an outline circle around them just added clutter. Tooltip only.
      label = COMPOSITION_INFO[hover.chunk.composition].label;
    }

    const cursor = toScreen(engine.screenToWorld(engine.input.mouseScreen));
    ctx.font = "11px monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(230,232,238,0.85)";
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

    const center = v2(width / 2, height / 2);
    const dir = normalize(sub(screenPos, center));
    const maxX = width / 2 - margin;
    const maxY = height / 2 - margin;
    const tX = dir.x !== 0 ? maxX / Math.abs(dir.x) : Infinity;
    const tY = dir.y !== 0 ? maxY / Math.abs(dir.y) : Infinity;
    const t = Math.min(tX, tY);
    const pos = add(center, scale(dir, t));

    // Home reads as a distinct color from everything else on radar — it's not a discovery,
    // it's always there.
    const rgb = contact.kind === "hub" ? "127,224,141" : "127,224,255";

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

    // Rounded, not exact — a ping gives a bearing and a rough range, not a precise fix.
    const dist = Math.round(distance(ship.pos, contact.pos) / 10) * 10;
    ctx.fillStyle = `rgba(${rgb},${alpha})`;
    ctx.font = "11px monospace";
    ctx.textAlign = "center";
    ctx.fillText(`${dist}m`, pos.x, pos.y + (dir.y > 0 ? 18 : -12));
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

    bar("HULL", ship.hull / 100, ship.hull > 30 ? "#7de08d" : "#ff6b6b", ` ${ship.hull.toFixed(0)}/100`);
    bar("CARGO", ship.cargoUsed / ship.cargoCapacity, "#7fe0ff", ` ${ship.cargoUsed}/${ship.cargoCapacity}`);
    bar("SIGNATURE", ship.signature / 100, "#ffa25c", ` ${ship.signature.toFixed(0)}%`);

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
      const targetScanned = engine.asteroids.some((a) => a.scanned && a.cells.includes(target));
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
      ctx.fillText("SCAN DATA — composition remaining in the nearest body", panelX, y);
      y += 15;
      const compositions: Cell["composition"][] = ["ore", "crystal", "unstable"];
      for (const comp of compositions) {
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
