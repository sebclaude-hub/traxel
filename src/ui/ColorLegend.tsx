// ---------------------------------------------------------------------------
// Farb-Legende fuer den aktiven Farbmodus.
//
// - speed/altitude → VERTIKALE, auf die WERTEACHSE gestauchte Legende: der
//   Farbverlauf zeigt die echte Wert→Farb-Transferfunktion (quantil-entzerrt,
//   s. quantileLinearPosition). Dadurch ist er dort GESTAUCHT, wo viele Werte
//   dicht liegen (z.B. ~120 km/h → großer bunter Bereich auf kleinem Wert-
//   fenster), und GESTRECKT in dünn besetzten Bereichen. Beschriftet werden die
//   Quantil-OBERGRENZEN an ihrer Wert-Position, mit Mindestabstand
//   (distributeTicks), weil sie sich auf der linearen Achse häufen.
// - accel        → horizontaler YlOrRd/YlGnBu-Verlauf.
// - flight/drone → diskrete Klassenfelder.
//
// Strings inline (i18n-freundlich).
// ---------------------------------------------------------------------------

import type { ColorMode, TrackData } from "../types";
import {
  accelGradientCss,
  distributeTicks,
  plasmaColor,
  quantileLinearPosition,
  rgbaCss,
} from "../viewer/colorMap";
import { droneLegendItems, flightLegendItems } from "../viewer/curtainLayer";

const t = {
  speed: "Tempo",
  altitude: "Höhe (MSL)",
  brakeLeft: "− Bremsen",
  accelRight: "Beschl. +",
};

const BAR_H = 140; // Pixelhöhe des vertikalen Verlaufbalkens
const TICK_MIN_GAP = 0.1; // Mindestabstand der Labels (Anteil der Balkenhöhe)

/** Vertikaler CSS-Gradient (to top), entlang der LINEAREN Werteachse [min,max]
 *  mit der quantil-entzerrten Transferfunktion eingefärbt → gestaucht/gestreckt. */
function transferGradientCss(breaks: number[], steps = 28): string {
  const min = breaks[0];
  const max = breaks[breaks.length - 1];
  const span = max - min || 1;
  const stops: string[] = [];
  for (let i = 0; i < steps; i++) {
    const f = i / (steps - 1); // 0..1 entlang der Werteachse
    const v = min + f * span;
    const pos = quantileLinearPosition(v, breaks);
    stops.push(`${rgbaCss(plasmaColor(pos, 255))} ${(f * 100).toFixed(1)}%`);
  }
  return `linear-gradient(to top, ${stops.join(", ")})`;
}

function GradientLegend({
  title,
  unit,
  breaks,
}: {
  title: string;
  unit: string;
  breaks: number[];
}) {
  const k = breaks.length - 1;
  const min = breaks[0];
  const max = breaks[k];

  // Entartet (nur ein Wert): kompakter Hinweis statt leerer Balken.
  if (k < 1 || max <= min) {
    return (
      <div style={boxStyle}>
        <div style={titleStyle}>{title}</div>
        <div style={{ fontSize: 11, color: "#bbb" }}>
          {Math.round(min)} {unit}
        </div>
      </div>
    );
  }

  // Obergrenzen-Labels (breaks[1..k]) an ihrer Wert-Position, kollisionsfrei.
  const pos = distributeTicks(breaks, TICK_MIN_GAP);

  return (
    <div style={boxStyle}>
      <div style={titleStyle}>
        {title} <span style={{ color: "#777" }}>· {unit}</span>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <div
          style={{
            width: 14,
            height: BAR_H,
            borderRadius: 3,
            background: transferGradientCss(breaks),
            border: "1px solid rgba(255,255,255,0.12)",
            flexShrink: 0,
          }}
        />
        <div style={{ position: "relative", height: BAR_H, width: 52 }}>
          {breaks.slice(1).map((v, j) => {
            const i = j + 1; // Index in breaks (Obergrenzen ab 1)
            const top = (1 - pos[i]) * BAR_H;
            return (
              <div key={i} style={{ ...tickRowStyle, top: top - 6 }}>
                <span style={{ width: 6, height: 1, background: "#888" }} />
                <span style={{ fontVariantNumeric: "tabular-nums" }}>
                  {Math.round(v)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function ColorLegend({ mode, track }: { mode: ColorMode; track: TrackData }) {
  // Diskrete Klassen (Flug/Drohne).
  if (mode === "flight" || mode === "drone") {
    const items = mode === "flight" ? flightLegendItems() : droneLegendItems();
    return (
      <div style={boxStyle}>
        {items.map((it, i) => (
          <div key={i} style={classRowStyle}>
            <span style={{ ...swatchStyle, background: rgbaCss(it.color) }} />
            <span>{it.label}</span>
          </div>
        ))}
      </div>
    );
  }

  // Beschleunigung: horizontaler, vorzeichenbehafteter Verlauf.
  if (mode === "accel") {
    return (
      <div style={{ ...boxStyle, width: 168 }}>
        <div style={{ height: 9, borderRadius: 2, background: accelGradientCss() }} />
        <div style={accelLabelRowStyle}>
          <span>{t.brakeLeft}</span>
          <span>{t.accelRight}</span>
        </div>
      </div>
    );
  }

  // Tempo / Höhe: gestauchte Werteachsen-Legende.
  if (mode === "altitude") {
    return <GradientLegend title={t.altitude} unit="m" breaks={track.quantile_breaks.altitude_m} />;
  }
  return <GradientLegend title={t.speed} unit="km/h" breaks={track.quantile_breaks.speed_kmh} />;
}

// --- Styles ----------------------------------------------------------------

const boxStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  background: "rgba(20,20,20,0.7)",
  border: "1px solid #333",
  borderRadius: 4,
  padding: 6,
};
const titleStyle: React.CSSProperties = {
  fontSize: 10,
  color: "#aaa",
  fontWeight: 600,
};
const tickRowStyle: React.CSSProperties = {
  position: "absolute",
  left: 0,
  display: "flex",
  alignItems: "center",
  gap: 4,
  fontSize: 10,
  color: "#bbb",
  whiteSpace: "nowrap",
};
const accelLabelRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: 10,
  color: "#aaa",
};
const classRowStyle: React.CSSProperties = {
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
