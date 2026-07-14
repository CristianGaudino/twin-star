"use client";

import {
  BELT_INNER_RADIUS,
  BELT_OUTER_RADIUS,
  CONTACT_FORGET_AFTER,
  HOME_STAR_POS,
  MAP_SECTOR_SIZE,
  NORMAL_AREA_INNER_RADIUS,
} from "@/game/constants";

export interface MapContactSnapshot {
  id: string;
  kind: string;
  label: string;
  x: number;
  y: number;
  age: number;
  identified: boolean;
}

interface MapViewProps {
  hubPos: { x: number; y: number };
  exploredSectors: string[];
  contacts: MapContactSnapshot[];
  satelliteCap: number;
  satelliteCount: number;
}

const VIEW_RADIUS = BELT_OUTER_RADIUS * 1.15;
const SVG_SIZE = 480;
const SCALE = SVG_SIZE / 2 / VIEW_RADIUS;

function toSvg(x: number, y: number) {
  return { sx: SVG_SIZE / 2 + (x - HOME_STAR_POS.x) * SCALE, sy: SVG_SIZE / 2 + (y - HOME_STAR_POS.y) * SCALE };
}

const KIND_COLOR: Record<string, string> = {
  hub: "#7fe08d",
  star: "#ffbe6e",
  satellite: "#c8a0ff",
  rock: "#7fe0ff",
};

/**
 * The hub-only star chart (map-radar-spec.md) — reads the exact same `discoveredContacts`
 * memory as tactical radar, just with no ship-distance cutoff and a much longer staleness
 * window (see Engine's MAP_CONTACT_FORGET_AFTER-based forgetting), so this is a genuine
 * "last known" chart rather than a live feed. Terrain (the belt/normal-area rings) only
 * renders once fog of war has actually revealed that band — a landmark being fixed in place
 * doesn't automatically mean you know it's there, the same rule the star Contact itself has
 * always followed.
 */
export default function MapView({ hubPos, exploredSectors, contacts, satelliteCap, satelliteCount }: MapViewProps) {
  const exploredNear = (radius: number) =>
    exploredSectors.some((key) => {
      const [sx, sy] = key.split(",").map(Number);
      const cx = (sx + 0.5) * MAP_SECTOR_SIZE;
      const cy = (sy + 0.5) * MAP_SECTOR_SIZE;
      const d = Math.hypot(cx - HOME_STAR_POS.x, cy - HOME_STAR_POS.y);
      return Math.abs(d - radius) < MAP_SECTOR_SIZE * 1.5;
    });

  const beltExplored = exploredNear((BELT_INNER_RADIUS + BELT_OUTER_RADIUS) / 2);
  const normalAreaExplored = exploredNear(NORMAL_AREA_INNER_RADIUS);

  const center = toSvg(HOME_STAR_POS.x, HOME_STAR_POS.y);
  const hubSvg = toSvg(hubPos.x, hubPos.y);
  const sectorPx = MAP_SECTOR_SIZE * SCALE;

  return (
    <div className="rounded border border-slate-700/60 p-3">
      <svg viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`} className="w-full rounded bg-black/40">
        {exploredSectors.map((key) => {
          const [sx, sy] = key.split(",").map(Number);
          const wx = (sx + 0.5) * MAP_SECTOR_SIZE;
          const wy = (sy + 0.5) * MAP_SECTOR_SIZE;
          const { sx: x, sy: y } = toSvg(wx, wy);
          return (
            <rect
              key={key}
              x={x - sectorPx / 2}
              y={y - sectorPx / 2}
              width={sectorPx}
              height={sectorPx}
              fill="rgba(120,150,190,0.08)"
            />
          );
        })}

        {/* Hub is always known — no discovery gate, matches the field's own "always know where
            home is" rule. */}
        <circle cx={hubSvg.sx} cy={hubSvg.sy} r={4} fill={KIND_COLOR.hub} />
        <text x={hubSvg.sx} y={hubSvg.sy - 8} fontSize={9} fill={KIND_COLOR.hub} textAnchor="middle">
          HOME HUB
        </text>

        {beltExplored && (
          <>
            <circle
              cx={center.sx}
              cy={center.sy}
              r={BELT_INNER_RADIUS * SCALE}
              fill="none"
              stroke="rgba(255,190,110,0.3)"
              strokeDasharray="3 3"
            />
            <circle
              cx={center.sx}
              cy={center.sy}
              r={BELT_OUTER_RADIUS * SCALE}
              fill="none"
              stroke="rgba(255,190,110,0.3)"
              strokeDasharray="3 3"
            />
          </>
        )}
        {normalAreaExplored && (
          <circle
            cx={center.sx}
            cy={center.sy}
            r={NORMAL_AREA_INNER_RADIUS * SCALE}
            fill="none"
            stroke="rgba(255,190,110,0.15)"
            strokeDasharray="2 4"
          />
        )}

        {contacts
          .filter((c) => c.kind !== "hub")
          .map((c) => {
            const { sx, sy } = toSvg(c.x, c.y);
            const live = c.age <= CONTACT_FORGET_AFTER;
            const color = c.identified ? (KIND_COLOR[c.kind] ?? KIND_COLOR.rock) : "#aab4be";
            return (
              <g key={c.id} opacity={live ? 1 : 0.4}>
                <circle
                  cx={sx}
                  cy={sy}
                  r={3}
                  fill={live ? color : "none"}
                  stroke={color}
                  strokeDasharray={live ? undefined : "2 2"}
                >
                  <title>{`${c.identified ? c.label : "Unidentified"} — ${live ? "current" : `last seen ${Math.round(c.age)}s ago`}`}</title>
                </circle>
              </g>
            );
          })}
      </svg>
      <p className="mt-2 text-center text-xs text-slate-500">
        Satellites: {satelliteCount}/{satelliteCap} deployed [G to deploy in the field] — bright markers are current,
        dim/dashed ones are last-known positions.
      </p>
    </div>
  );
}
