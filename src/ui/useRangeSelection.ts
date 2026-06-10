/**
 * useRangeSelection — State-Management fuer Cut-Ranges (auszuschneidende
 * Index-Bereiche) mit Modus pro Cut. Port aus
 * gps_viewer/src/hooks/useRangeSelection.ts.
 *
 * Modell
 * ------
 * Standardmaessig wird der ganze Track behalten. Cut-Ranges sind
 * Index-Intervalle ``[start, end]`` (inklusive) mit einem Modus:
 *
 *   * ``trim``   — Punkte entfernen. Erzwungen fuer Edge-Cuts
 *                   (start=0 oder end=N-1), weil dort nichts zu ueberbruecken ist.
 *   * ``gap``    — Punkte entfernen, Luecke im Track sichtbar lassen.
 *   * ``bridge`` — Punkte entfernen UND nachfolgende Zeitstempel nach vorne
 *                   schieben (frueher „synthetic" genannt).
 *
 * Die UI bietet einen globalen Toggle ("Middle-Mode") fuer ALLE Middle-Cuts
 * gemeinsam. Cuts duerfen sich NICHT ueberlappen — beim Anlegen sucht der Hook
 * eine freie Luecke, beim Drag werden Handles gegen Nachbar-Cuts geclamped.
 */

import { useCallback, useState } from "react";

import type { CutMode } from "../pipeline";

export type MiddleMode = "gap" | "bridge";

export interface CutRange {
  /** Stabiler Schluessel fuer React-Listen. */
  id: string;
  /** Erster zu entfernender Index (inklusive). */
  start: number;
  /** Letzter zu entfernender Index (inklusive). */
  end: number;
  /** Modus dieses Cuts. Edge-Cuts (start=0 / end=N-1) sind immer ``trim``. */
  mode: CutMode;
}

let _idCounter = 0;
function nextId(): string {
  _idCounter += 1;
  return `cut-${_idCounter}`;
}

function isEdge(r: { start: number; end: number }, totalPoints: number): boolean {
  return r.start <= 0 || r.end >= totalPoints - 1;
}

export interface RangeSelectionApi {
  ranges: CutRange[];
  /** Globaler Middle-Mode-Toggle. Wirkt auf alle Nicht-Edge-Cuts. */
  middleMode: MiddleMode;
  setMiddleMode: (mode: MiddleMode, totalPoints: number) => void;
  /** Neuen Cut um die Position herum einfuegen (naechste freie Luecke). Gibt
   *  ``true`` zurueck, wenn ein Cut angelegt werden konnte. */
  addRange: (centerIdx: number, totalPoints: number) => boolean;
  /** True, wenn um centerIdx noch Platz fuer einen Cut ist (UI-Disabling). */
  canAddRange: (centerIdx: number, totalPoints: number) => boolean;
  /** Range mit gegebener ID loeschen. */
  removeRange: (id: string) => void;
  /** Start/End anpassen — clampt gegen [0,n-1] und Nachbar-Cuts (kein Overlap),
   *  setzt Mode auf ``trim``, wenn der Cut zur Edge wird. */
  updateRange: (
    id: string,
    patch: Partial<Pick<CutRange, "start" | "end">>,
    totalPoints: number,
  ) => void;
  /** Alle Ranges zuruecksetzen. */
  clearAll: () => void;
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen — Overlap-Freiheit garantieren
// ---------------------------------------------------------------------------

/**
 * Findet die zusammenhaengende freie Luecke (nicht-Cut-Bereich), die
 * ``centerIdx`` enthaelt; sonst die naechstgelegene. null, wenn keine existiert.
 */
function findGapAround(
  ranges: CutRange[],
  centerIdx: number,
  totalPoints: number,
): { lo: number; hi: number } | null {
  if (totalPoints < 2) return null;

  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const gaps: { lo: number; hi: number }[] = [];
  let cursor = 0;
  for (const r of sorted) {
    if (r.start > cursor) gaps.push({ lo: cursor, hi: r.start - 1 });
    cursor = Math.max(cursor, r.end + 1);
  }
  if (cursor <= totalPoints - 1) gaps.push({ lo: cursor, hi: totalPoints - 1 });

  if (gaps.length === 0) return null;

  for (const g of gaps) {
    if (centerIdx >= g.lo && centerIdx <= g.hi) return g;
  }
  let best = gaps[0];
  let bestDist = Math.abs((best.lo + best.hi) / 2 - centerIdx);
  for (const g of gaps.slice(1)) {
    const d = Math.abs((g.lo + g.hi) / 2 - centerIdx);
    if (d < bestDist) {
      best = g;
      bestDist = d;
    }
  }
  return best;
}

/** Naechster/vorheriger Cut relativ zur ID (fuer das Overlap-Clamping). */
function findNeighbors(
  ranges: CutRange[],
  id: string,
): { prev: CutRange | null; next: CutRange | null; me: CutRange | null } {
  const me = ranges.find((r) => r.id === id) ?? null;
  if (!me) return { prev: null, next: null, me: null };
  let prev: CutRange | null = null;
  let next: CutRange | null = null;
  for (const r of ranges) {
    if (r.id === id) continue;
    if (r.end < me.start) {
      if (!prev || r.end > prev.end) prev = r;
    } else if (r.start > me.end) {
      if (!next || r.start < next.start) next = r;
    }
  }
  return { prev, next, me };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useRangeSelection(): RangeSelectionApi {
  const [ranges, setRanges] = useState<CutRange[]>([]);
  // Default fuer neue Middle-Cuts: "gap" (sichtbare Luecke, harmloser Default).
  const [middleMode, setMiddleModeState] = useState<MiddleMode>("gap");

  const addRange = useCallback(
    (centerIdx: number, totalPoints: number): boolean => {
      let added = false;
      setRanges((prev) => {
        const gap = findGapAround(prev, centerIdx, totalPoints);
        if (!gap) return prev;

        // Zielbreite: 5% des Tracks oder min. 2 Punkte je Seite, max. halbe Luecke.
        const wishedHalf = Math.max(2, Math.floor(totalPoints * 0.025));
        const gapWidth = gap.hi - gap.lo + 1;
        const halfWidth = Math.max(1, Math.min(wishedHalf, Math.floor(gapWidth / 2)));

        const center = Math.max(gap.lo, Math.min(gap.hi, centerIdx));
        let start = center - halfWidth;
        let end = center + halfWidth;
        if (start < gap.lo) {
          end += gap.lo - start;
          start = gap.lo;
        }
        if (end > gap.hi) {
          start -= end - gap.hi;
          end = gap.hi;
        }
        start = Math.max(gap.lo, start);
        end = Math.min(gap.hi, end);

        added = true;
        const edge = isEdge({ start, end }, totalPoints);
        const mode: CutMode = edge ? "trim" : middleMode;
        return [...prev, { id: nextId(), start, end, mode }];
      });
      return added;
    },
    [middleMode],
  );

  const canAddRange = useCallback(
    (centerIdx: number, totalPoints: number) =>
      findGapAround(ranges, centerIdx, totalPoints) !== null,
    [ranges],
  );

  const removeRange = useCallback((id: string) => {
    setRanges((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const updateRange = useCallback(
    (
      id: string,
      patch: Partial<Pick<CutRange, "start" | "end">>,
      totalPoints: number,
    ) => {
      setRanges((prev) => {
        const { prev: leftN, next: rightN, me } = findNeighbors(prev, id);
        if (!me) return prev;

        let start = patch.start !== undefined ? patch.start : me.start;
        let end = patch.end !== undefined ? patch.end : me.end;

        // 1. global clampen
        start = Math.max(0, Math.min(totalPoints - 1, start));
        end = Math.max(0, Math.min(totalPoints - 1, end));

        // 2. gegen Nachbar-Cuts clampen (kein Overlap)
        if (leftN) start = Math.max(start, leftN.end + 1);
        if (rightN) end = Math.min(end, rightN.start - 1);

        // 3. start <= end sicherstellen
        if (start > end) {
          if (patch.start !== undefined) start = end;
          else end = start;
        }

        // 4. Edge-Auto-Detection: zur Edge → "trim"; raus aus Edge & war "trim"
        //    → globaler middleMode.
        const edge = isEdge({ start, end }, totalPoints);
        let mode: CutMode = me.mode;
        if (edge) mode = "trim";
        else if (me.mode === "trim") mode = middleMode;

        return prev.map((r) => (r.id === id ? { ...r, start, end, mode } : r));
      });
    },
    [middleMode],
  );

  const setMiddleMode = useCallback((mode: MiddleMode, totalPoints: number) => {
    setMiddleModeState(mode);
    setRanges((prev) =>
      prev.map((r) => (isEdge(r, totalPoints) ? r : { ...r, mode })),
    );
  }, []);

  const clearAll = useCallback(() => setRanges([]), []);

  return {
    ranges,
    middleMode,
    setMiddleMode,
    addRange,
    canAddRange,
    removeRange,
    updateRange,
    clearAll,
  };
}
