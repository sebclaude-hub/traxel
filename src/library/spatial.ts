// ---------------------------------------------------------------------------
// Raeumliche Hilfsfunktionen fuer die Bibliothek: Bounding-Box-Tests und die
// Huelle ueber vier Eckkoordinaten. Reine Geometrie → unit-testbar, keine
// Browser-APIs.
//
// Genutzt fuer die Auto-Wiederverwendung gespeicherter Elemente (Charts, spaeter
// DEMs/Tracks): liegt das gespeicherte bbox im Track-Bereich, wird das Element
// automatisch geladen — dieselbe Logik wie beim DEM-Cache.
// ---------------------------------------------------------------------------

import type { ChartCorners } from "../viewer/chartPlacement";
import type { TrackBounds } from "../types";

/**
 * True, wenn sich die beiden achsenparallelen Bounding-Boxen ueberlappen
 * (Beruehrung an einer Kante/Ecke zaehlt als Ueberlappung).
 */
export function bboxIntersects(a: TrackBounds, b: TrackBounds): boolean {
  return (
    a.lon_min <= b.lon_max &&
    a.lon_max >= b.lon_min &&
    a.lat_min <= b.lat_max &&
    a.lat_max >= b.lat_min
  );
}

/** Achsenparallele Huelle (lon/lat min/max) ueber die vier Eckkoordinaten. */
export function cornersToBounds(c: ChartCorners): TrackBounds {
  const lons = [c.corner_tl[0], c.corner_tr[0], c.corner_bl[0], c.corner_br[0]];
  const lats = [c.corner_tl[1], c.corner_tr[1], c.corner_bl[1], c.corner_br[1]];
  return {
    lon_min: Math.min(...lons),
    lon_max: Math.max(...lons),
    lat_min: Math.min(...lats),
    lat_max: Math.max(...lats),
  };
}
