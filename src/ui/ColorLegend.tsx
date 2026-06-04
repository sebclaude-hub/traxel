// ---------------------------------------------------------------------------
// Farb-Legende fuer den aktiven Farbmodus. Macht die Einfaerbung lesbar —
// vorher gab es nur fuer "accel" eine Legende, sodass sie beim GPX-Import
// (Tempo-/Flug-Modus) unsichtbar war.
//
// - speed/altitude → Plasma-Gradient (links niedrig → rechts hoch) + min/max
//   aus den Quantil-Grenzen.
// - accel          → YlOrRd/YlGnBu-Gradient (− Bremsen … Beschl. +).
// - flight/drone   → diskrete Klassenfelder (Schwellen) aus curtainLayer.
//
// Strings inline gesammelt (i18n-freundlich, konsistent mit LibraryPanel).
// ---------------------------------------------------------------------------

import type { ColorMode, TrackData } from "../types";
import { accelGradientCss, plasmaColor, rgbaCss } from "../viewer/colorMap";
import { droneLegendItems, flightLegendItems } from "../viewer/curtainLayer";

const t = {
  brakeLeft: "− Bremsen",
  accelRight: "Beschl. +",
};

/** Horizontaler Plasma-Verlauf (links niedrig → rechts hoch). */
function plasmaBarCss(steps = 16): string {
  const stops: string[] = [];
  for (let i = 0; i < steps; i++) {
    const tt = i / (steps - 1);
    stops.push(`${rgbaCss(plasmaColor(tt, 255))} ${(tt * 100).toFixed(1)}%`);
  }
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

export function ColorLegend({ mode, track }: { mode: ColorMode; track: TrackData }) {
  // Diskrete Klassen (Flug/Drohne).
  if (mode === "flight" || mode === "drone") {
    const items = mode === "flight" ? flightLegendItems() : droneLegendItems();
    return (
      <div style={boxStyle}>
        {items.map((it, i) => (
          <div key={i} style={rowStyle}>
            <span style={{ ...swatchStyle, background: rgbaCss(it.color) }} />
            <span>{it.label}</span>
          </div>
        ))}
      </div>
    );
  }

  // Gradient-Modi (Tempo/Höhe/Beschl.).
  let css: string;
  let left: string;
  let right: string;
  if (mode === "accel") {
    css = accelGradientCss();
    left = t.brakeLeft;
    right = t.accelRight;
  } else if (mode === "altitude") {
    const b = track.quantile_breaks.altitude_m;
    css = plasmaBarCss();
    left = `${Math.round(b[0])} m`;
    right = `${Math.round(b[b.length - 1])} m`;
  } else {
    const b = track.quantile_breaks.speed_kmh;
    css = plasmaBarCss();
    left = `${Math.round(b[0])} km/h`;
    right = `${Math.round(b[b.length - 1])} km/h`;
  }

  return (
    <div style={boxStyle}>
      <div style={{ height: 9, borderRadius: 2, background: css }} />
      <div style={labelRowStyle}>
        <span>{left}</span>
        <span>{right}</span>
      </div>
    </div>
  );
}

const boxStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 3,
  width: 168,
  background: "rgba(20,20,20,0.7)",
  border: "1px solid #333",
  borderRadius: 4,
  padding: 5,
};
const labelRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: 10,
  color: "#aaa",
};
const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 10,
  color: "#bbb",
};
const swatchStyle: React.CSSProperties = {
  width: 14,
  height: 9,
  borderRadius: 2,
  flexShrink: 0,
};
