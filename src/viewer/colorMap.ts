// ---------------------------------------------------------------------------
// Kontinuierlicher Plasma-Farbverlauf basierend auf Rang-Normalisierung.
//
// Port aus gps_viewer/src/utils/colorMap.ts (generisch, unveraendert).
//
// Statt diskrete Quantil-Klassen zu faerben, bekommt jeder Punkt eine
// individuelle Farbe nach seinem Rang in der Werteverteilung:
//   t = rank(value) / (N - 1) ; color = interpolatePlasma(t)
// Das ergibt einen gleichmaessigen Verlauf und ist robust gegen Ausreisser.
// ---------------------------------------------------------------------------

import {
  interpolatePlasma,
  interpolateYlGnBu,
  interpolateYlOrRd,
} from "d3-scale-chromatic";

export type Rgba = [number, number, number, number];

function parseRgb(s: string): [number, number, number] {
  if (s.startsWith("#")) {
    const hex = s.slice(1);
    if (hex.length === 3) {
      return [
        parseInt(hex[0] + hex[0], 16),
        parseInt(hex[1] + hex[1], 16),
        parseInt(hex[2] + hex[2], 16),
      ];
    }
    if (hex.length === 6) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ];
    }
  }
  const m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
  return [128, 128, 128];
}

/** Plasma-Farbe fuer t ∈ [0,1]. */
export function plasmaColor(t: number, alpha = 220): Rgba {
  const clamped = Math.max(0, Math.min(1, t));
  const [r, g, b] = parseRgb(interpolatePlasma(clamped));
  return [r, g, b, alpha];
}

/**
 * Normalisierte Rang-Position [0,1] pro Index. Gleiche Werte → gleicher Rang
 * (average rank). null/NaN → NaN im Ergebnis.
 */
export function computeRankPositions(values: (number | null)[]): number[] {
  const n = values.length;
  const result = new Array<number>(n);

  const indexed: { idx: number; v: number }[] = [];
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (v === null || v === undefined || Number.isNaN(v)) {
      result[i] = NaN;
    } else {
      indexed.push({ idx: i, v });
    }
  }

  indexed.sort((a, b) => a.v - b.v);
  const m = indexed.length;
  if (m <= 1) {
    for (const e of indexed) result[e.idx] = 0.5;
    return result;
  }

  let i = 0;
  while (i < m) {
    let j = i;
    while (j < m && indexed[j].v === indexed[i].v) j++;
    const avgRank = (i + j - 1) / 2;
    const t = avgRank / (m - 1);
    for (let k = i; k < j; k++) result[indexed[k].idx] = t;
    i = j;
  }
  return result;
}

/**
 * Quantil-entzerrte Farb-Position [0,1] eines Einzelwerts.
 *
 * WARUM (nicht reiner Rang, nicht linear): Bei Autofahrten o.ae. liegen sehr
 * viele Punkte in einem schmalen Wertefenster (z.B. ~120 km/h). Linear wuerden
 * sie zu einem ununterscheidbaren Farbfleck; reiner Rang spreizt zwar, kennt
 * aber keine sinnvollen Klassengrenzen fuer die Legende. Hier: jedes der k
 * Quantile bekommt einen GLEICH langen Farb-Abschnitt (1/k), und INNERHALB
 * eines Quantils werden die Werte LINEAR (auf die Abschnittslaenge normiert)
 * verteilt. So bleibt der Cluster entzerrt sichtbar, gleiche Werte bekommen
 * gleiche Farbe, und die Legende kann die echten Quantilgrenzen zeigen.
 *
 * `breaks` sind die k+1 Quantilgrenzen (inkl. min/max), wie sie die Pipeline
 * liefert (koennen aufgefuellte Duplikate enthalten → degenerierte Bins → 0.5).
 */
export function quantileLinearPosition(v: number, breaks: number[]): number {
  const k = breaks.length - 1;
  if (k < 1) return 0.5;
  if (v <= breaks[0]) return 0;
  if (v >= breaks[k]) return 1;
  // Erstes Bin i (0..k-1) mit v <= breaks[i+1] (unterste Klasse links-inklusiv).
  let i = 0;
  while (i < k - 1 && v > breaks[i + 1]) i++;
  const lo = breaks[i];
  const hi = breaks[i + 1];
  const within = hi > lo ? Math.max(0, Math.min(1, (v - lo) / (hi - lo))) : 0.5;
  return (i + within) / k;
}

/** Array-Variante; null/NaN → NaN. */
export function quantileLinearPositions(
  values: (number | null)[],
  breaks: number[],
): number[] {
  return values.map((v) =>
    v === null || !Number.isFinite(v)
      ? NaN
      : quantileLinearPosition(v as number, breaks),
  );
}

/**
 * Verteilt Tick-Positionen proportional zu den numerischen Bereichen (lineare
 * Werteachse), erzwingt aber einen Mindestabstand `minGap` ∈ (0,1) zwischen
 * aufeinanderfolgenden Ticks, damit die Labels lesbar bleiben. Liefert pro
 * Eingabe-Grenze eine normalisierte Position [0,1]. Port aus gps_viewer.
 *
 * Noetig, weil bei der gestauchten Legende (Werteachse) die Quantilgrenzen sich
 * in dichten Bereichen draengen und sonst uebereinanderschreiben.
 */
export function distributeTicks(breaks: number[], minGap: number): number[] {
  const n = breaks.length;
  if (n < 2) return breaks.map(() => 0);

  const min = breaks[0];
  const max = breaks[n - 1];
  const span = max - min;
  if (span <= 0) return breaks.map((_, i) => i / (n - 1));

  const raw = breaks.map((b) => (b - min) / span);
  const gaps = new Array(n - 1).fill(0).map((_, i) => raw[i + 1] - raw[i]);

  const minG = Math.min(minGap, 1 / (n - 1));
  for (let iter = 0; iter < 20; iter++) {
    const small: number[] = [];
    const big: number[] = [];
    let deficit = 0;
    let bigSum = 0;
    for (let i = 0; i < gaps.length; i++) {
      if (gaps[i] < minG) {
        deficit += minG - gaps[i];
        small.push(i);
      } else {
        big.push(i);
        bigSum += gaps[i] - minG;
      }
    }
    if (deficit < 1e-6 || bigSum < 1e-6) break;
    const factor = Math.min(1, bigSum > 0 ? deficit / bigSum : 0);
    for (const i of small) gaps[i] = minG;
    for (const i of big) gaps[i] = gaps[i] - (gaps[i] - minG) * factor;
  }

  const positions = [0];
  for (let i = 0; i < gaps.length; i++) positions.push(positions[i] + gaps[i]);
  const total = positions[positions.length - 1] || 1;
  return positions.map((p) => p / total);
}

/**
 * Farbe fuer vorzeichenbehaftete, normalisierte Beschleunigung aNorm ∈ [−1, 1]:
 *   aNorm ≥ 0 (beschleunigen) → YlGnBu nach Betrag (Gelb → Blau),
 *   aNorm <  0 (bremsen)      → YlOrRd nach Betrag (Gelb → Rot).
 * Beide Skalen starten bei 0 in blassem Gelb → ruhiges Fahren bleibt neutral
 * gelb, Bremsen schiebt nach Rot, Beschleunigen nach Blau (gut gegen das
 * gelbe "Cruising" ablesbar). NaN/Nicht-endlich → Grau.
 */
export function accelerationColor(aNorm: number, alpha = 255): Rgba {
  if (!Number.isFinite(aNorm)) return [150, 150, 150, alpha];
  const mag = Math.min(1, Math.abs(aNorm));
  const css = aNorm >= 0 ? interpolateYlGnBu(mag) : interpolateYlOrRd(mag);
  const [r, g, b] = parseRgb(css);
  return [r, g, b, alpha];
}

/** CSS linear-gradient fuer die Beschleunigungs-Legende: magma (links, Bremsen)
 *  ↔ neutral (Mitte) ↔ viridis (rechts, Beschleunigen). */
export function accelGradientCss(steps = 24, alpha = 255): string {
  const stops: string[] = [];
  for (let i = 0; i < steps; i++) {
    const x = i / (steps - 1); // 0..1
    const aNorm = x * 2 - 1; // −1..+1
    stops.push(`${rgbaCss(accelerationColor(aNorm, alpha))} ${(x * 100).toFixed(1)}%`);
  }
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

/** rgba-CSS-String aus einem Rgba-Tupel. */
export function rgbaCss(c: Rgba): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${c[3] / 255})`;
}

/** CSS linear-gradient (Plasma, von t=0 unten bis t=1 oben). */
export function plasmaGradientCss(steps = 16, alpha = 220): string {
  const stops: string[] = [];
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    stops.push(`${rgbaCss(plasmaColor(t, alpha))} ${(t * 100).toFixed(1)}%`);
  }
  return `linear-gradient(to top, ${stops.join(", ")})`;
}
