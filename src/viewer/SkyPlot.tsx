// ---------------------------------------------------------------------------
// Polar-SkyPlot: Satellitenpositionen (Azimut/Elevation) als SVG.
// Port aus gps_viewer/src/components/SkyPlot.tsx.
//
// Azimut 0° = Nord (oben), 90° = Ost (rechts).
// Elevation 0° = Horizont (aussen), 90° = Zenit (Mitte).
// Markergroesse ∝ SNR, Farbe nach Konstellation.
// ---------------------------------------------------------------------------

import { useMemo } from "react";

import type { GsvBurst, SatelliteData } from "../types";

const SIZE = 260;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = SIZE / 2 - 20;

const TALKER_COLORS: Record<string, string> = {
  GP: "#4fc3f7", // GPS → hellblau
  GL: "#81c784", // GLONASS → gruen
  GA: "#ffb74d", // Galileo → orange
  GB: "#f48fb1", // BeiDou → rosa
};
const DEFAULT_COLOR = "#ce93d8";

function talkerColor(talker: string): string {
  return TALKER_COLORS[talker] ?? DEFAULT_COLOR;
}

function polarToXY(azDeg: number, elDeg: number): [number, number] {
  const az = ((azDeg - 90) * Math.PI) / 180;
  const r = R * (1 - elDeg / 90);
  return [CX + r * Math.cos(az), CY + r * Math.sin(az)];
}

interface Props {
  satData: SatelliteData | null;
  trackIdx: number;
}

export function SkyPlot({ satData, trackIdx }: Props) {
  const allSats = useMemo(() => {
    if (!satData) return [];
    const result: { x: number; y: number; r: number; color: string }[] = [];
    for (const talker of satData.talkers) {
      const lookup = satData.burst_idx_by_track[talker];
      if (!lookup) continue;
      const burstIdx = lookup[trackIdx] ?? -1;
      if (burstIdx < 0) continue;
      const burst: GsvBurst | undefined = satData.bursts_by_talker[talker][burstIdx];
      if (!burst) continue;
      for (const [, el, az, snr] of burst.sats) {
        if (el === null || az === null) continue;
        const [x, y] = polarToXY(az, el);
        const radius = snr !== null ? Math.max(3, Math.min(10, snr / 6)) : 4;
        result.push({ x, y, r: radius, color: talkerColor(talker) });
      }
    }
    return result;
  }, [satData, trackIdx]);

  const azLabels = [
    { label: "N", az: 0 },
    { label: "E", az: 90 },
    { label: "S", az: 180 },
    { label: "W", az: 270 },
  ];
  const elRings = [0, 30, 60, 90];

  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      style={{ background: "#1a1a2e", borderRadius: 8 }}
    >
      {elRings.map((el) => (
        <circle
          key={el}
          cx={CX}
          cy={CY}
          r={R * (1 - el / 90)}
          fill="none"
          stroke="#334"
          strokeWidth={el === 0 ? 1.5 : 0.8}
        />
      ))}
      {[30, 60].map((el) => (
        <text key={el} x={CX + 4} y={CY - R * (1 - el / 90) + 4} fill="#556" fontSize={9}>
          {el}°
        </text>
      ))}
      {[0, 45, 90, 135].map((az) => {
        const rad = ((az - 90) * Math.PI) / 180;
        return (
          <line
            key={az}
            x1={CX + R * Math.cos(rad)}
            y1={CY + R * Math.sin(rad)}
            x2={CX - R * Math.cos(rad)}
            y2={CY - R * Math.sin(rad)}
            stroke="#334"
            strokeWidth={0.8}
          />
        );
      })}
      {azLabels.map(({ label, az }) => {
        const rad = ((az - 90) * Math.PI) / 180;
        return (
          <text
            key={label}
            x={CX + (R + 12) * Math.cos(rad) - 4}
            y={CY + (R + 12) * Math.sin(rad) + 4}
            fill="#889"
            fontSize={11}
            fontWeight="bold"
          >
            {label}
          </text>
        );
      })}
      {allSats.map((s, i) => (
        <circle
          key={i}
          cx={s.x}
          cy={s.y}
          r={s.r}
          fill={s.color}
          fillOpacity={0.85}
          stroke="#fff"
          strokeWidth={0.5}
        />
      ))}
      <circle cx={CX} cy={CY} r={2} fill="#556" />
      {allSats.length === 0 && (
        <text x={CX} y={CY + 4} textAnchor="middle" fill="#445" fontSize={11}>
          Keine GSV-Daten
        </text>
      )}
    </svg>
  );
}
