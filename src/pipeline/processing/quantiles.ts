// ---------------------------------------------------------------------------
// Quantil-Klassen fuer die Farbgebung (Port von _compute_quantile_breaks
// aus gps_pipeline/export/json_export.py, dort via pandas.qcut).
//
// Gleich besetzte Klassen (equal-frequency): die Klassengrenzen sind die
// Quantile der Werteverteilung. Die Faerbung selbst laeuft ueber
// quantileLinearPosition (colorMap.ts) direkt auf diesen Grenzen — es gibt
// bewusst KEINE Klassenindizes pro Punkt mehr (fruehere speed_q_idx/alt_q_idx
// aus dem Python-Export waren im Viewer ungenutzt).
// ---------------------------------------------------------------------------

import { DEFAULT_QUANTILES } from "../constants";

export interface QuantileResult {
  /** k+1 Klassengrenzen, gerundet; auf nQuantiles+1 aufgefuellt. */
  breaks: number[];
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

export function computeQuantileBreaks(
  values: (number | null)[],
  nQuantiles: number = DEFAULT_QUANTILES,
): QuantileResult {
  const clean = values.filter(
    (v): v is number => v !== null && Number.isFinite(v),
  );

  // Entartet: keine oder nur ein eindeutiger Wert → Grenzen alle 0
  // (wie der Python-Sonderfall).
  if (clean.length === 0 || new Set(clean).size < 2) {
    return { breaks: new Array(nQuantiles + 1).fill(0) };
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

  return { breaks };
}
