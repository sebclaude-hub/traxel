// ---------------------------------------------------------------------------
// Quantil-Klassen fuer die Farbgebung (Port von _compute_quantile_breaks
// aus gps_pipeline/export/json_export.py, dort via pandas.qcut).
//
// Gleich besetzte Klassen (equal-frequency): die Klassengrenzen sind die
// Quantile der Werteverteilung. Pro Punkt wird ein Klassenindex 0..k-1
// vergeben; fehlende Werte erhalten -1.
// ---------------------------------------------------------------------------

import { DEFAULT_QUANTILES } from "../constants";

export interface QuantileResult {
  /** k+1 Klassengrenzen, gerundet; auf nQuantiles+1 aufgefuellt. */
  breaks: number[];
  /** Klassenindex pro Eingabewert (0..k-1), -1 fuer fehlende Werte. */
  qIdx: number[];
}

/** Quantil bei Wahrscheinlichkeit p (numpy-Default "linear" / Typ 7). */
function quantileSorted(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 1) return sorted[0];
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/**
 * Ordnet einen Wert einer Klasse zu. Intervalle sind rechts-geschlossen,
 * die unterste Klasse schliesst die linke Grenze ein (wie qcut/include_lowest).
 */
function assignBin(v: number, edges: number[]): number {
  if (v <= edges[0]) return 0;
  for (let k = 1; k < edges.length; k++) {
    if (v <= edges[k]) return k - 1;
  }
  return edges.length - 2; // ueber dem Maximum → letzte Klasse
}

export function computeQuantileBreaks(
  values: (number | null)[],
  nQuantiles: number = DEFAULT_QUANTILES,
): QuantileResult {
  const clean = values.filter(
    (v): v is number => v !== null && Number.isFinite(v),
  );

  // Entartet: keine oder nur ein eindeutiger Wert → alle Punkte in Klasse 0,
  // Grenzen alle 0 (wie der Python-Sonderfall).
  if (clean.length === 0 || new Set(clean).size < 2) {
    return {
      breaks: new Array(nQuantiles + 1).fill(0),
      qIdx: values.map(() => 0),
    };
  }

  const sorted = clean.slice().sort((a, b) => a - b);

  // Klassengrenzen an p = 0, 1/n, ..., 1.
  const edges: number[] = [];
  for (let i = 0; i <= nQuantiles; i++) {
    edges.push(quantileSorted(sorted, i / nQuantiles));
  }

  // Duplikate verwerfen (entspricht qcut duplicates="drop").
  const uniqueEdges: number[] = [];
  for (const e of edges) {
    if (uniqueEdges.length === 0 || e !== uniqueEdges[uniqueEdges.length - 1]) {
      uniqueEdges.push(e);
    }
  }

  // Grenzen gerundet; auf nQuantiles+1 auffuellen (falls Duplikate wegfielen).
  const breaks = uniqueEdges.map(round3);
  while (breaks.length < nQuantiles + 1) {
    breaks.push(breaks[breaks.length - 1]);
  }

  const qIdx = values.map((v) =>
    v !== null && Number.isFinite(v) ? assignBin(v, uniqueEdges) : -1,
  );

  return { breaks, qIdx };
}
