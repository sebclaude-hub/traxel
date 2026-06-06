// ---------------------------------------------------------------------------
// Track mit Terrain-Daten anreichern (Port der Idee aus
// gps_pipeline/processing/enrich_terrain.py + _detect_track_mode).
//
// Fuellt pro Punkt terrain_elev und above_terrain und leitet den track_mode
// (Flug/Boden) aus der Median-Hoehe ueber Grund ab. Reine Funktion → testbar.
//
// Laeuft im Main-Thread, sobald das DemGrid vorliegt (das Terrain wird separat
// und asynchron geladen, nachdem der Track schon da ist).
// ---------------------------------------------------------------------------

import type { DemGrid, TrackData } from "../../types";
import { FLIGHT_MEDIAN_AGL_M } from "../constants";
import { sampleDem } from "./sample";

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * Lineares Perzentil (0..100) ueber ein bereits AUFSTEIGEND sortiertes Array.
 * p=0 liefert das Minimum, p=100 das Maximum, dazwischen linear interpoliert.
 */
function percentileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// Perzentil fuer den Boden-Offset. Idealfall waere das strikte Minimum von
// (alt − terrain) — dann sitzt der Track so tief wie moeglich, ohne irgendwo
// unter das Terrain zu rutschen. In der Praxis ist das Minimum aber fragil:
// das 30-m-DEM-Raster (gröber bei niedriger Detailstufe) und einzelne
// GPS-Hoehen-Aussetzer erzeugen Ausreisser, die den ganzen Track unnoetig
// anheben wuerden. Ein kleines Perzentil ignoriert die paar schlimmsten
// Ausreisser — genau das, was man manuell per Auge macht. Auf 0 setzen fuer
// striktes Minimum.
const GROUND_FLOOR_PERCENTILE = 1;

/**
 * Schlaegt einen DEM-Z-Offset (m) vor.
 *
 * Semantik: zOffset hebt/senkt das DEM, der Track ist Ground Truth
 * (AGL = alt − (terrain + zOffset)).
 *
 * BODEN-Track: das DEM wird so weit angehoben, dass der Track moeglichst tief —
 * aber (fast) nirgends unter dem Boden — sitzt. Das ist die Geoid-/Ellipsoid-
 * Korrektur (z.B. ellipsoidische SkyDemon-GPX vs. NN-bezogenes DEM). Offset =
 * kleines Perzentil von (alt − terrain), siehe GROUND_FLOOR_PERCENTILE.
 *
 * FLUG-Track: es gibt keinen verlaesslichen Bodenbezug (Start/Landung evtl.
 * ausserhalb des DEM, oder der Track beginnt/endet in der Luft) → Vorschlag 0.
 * Die MSL-GPS-Hoehe passt bereits zum MSL-DEM, ein Offset wuerde das DEM in
 * den Flugweg schieben. Boden/Flug-Unterscheidung wie track_mode: Median-AGL
 * > FLIGHT_MEDIAN_AGL_M ⇒ Flug.
 *
 * Reine Funktion → testbar. Liefert 0, wenn kein Punkt DEM-Daten hat.
 */
export function suggestDemOffset(track: TrackData, dem: DemGrid): number {
  const { lat, lon, alt } = track.points;
  const diffs: number[] = [];
  for (let i = 0; i < lat.length; i++) {
    const a = alt[i];
    if (a === null) continue;
    const terr = sampleDem(dem, lon[i], lat[i]);
    if (terr === null) continue;
    diffs.push(a - terr);
  }
  if (diffs.length === 0) return 0;
  if (median(diffs) > FLIGHT_MEDIAN_AGL_M) return 0; // Flug → kein Offset
  diffs.sort((a, b) => a - b);
  return percentileSorted(diffs, GROUND_FLOOR_PERCENTILE);
}

/**
 * Liefert eine neue TrackData mit gefuelltem terrain_elev/above_terrain,
 * gesetztem track_mode und has_terrain. Der Originaltrack bleibt unveraendert.
 *
 * demOffset (m): wird zum DEM-Sample addiert, bevor AGL berechnet wird —
 * korrigiert den Geoid-/Ellipsoid-Versatz zwischen GPS-Track und DEM.
 * terrain_elev bleibt der rohe DEM-Wert (fuer spaeteren Vergleich nutzbar).
 */
export function enrichTrackWithTerrain(track: TrackData, dem: DemGrid, demOffset = 0): TrackData {
  const { lat, lon, alt } = track.points;
  const n = lat.length;

  const terrainElev: (number | null)[] = new Array(n);
  const aboveTerrain: (number | null)[] = new Array(n);
  const aglForMedian: number[] = [];
  let anySampled = false;

  for (let i = 0; i < n; i++) {
    const terr = sampleDem(dem, lon[i], lat[i]);
    terrainElev[i] = terr;
    if (terr !== null) anySampled = true;

    const a = alt[i];
    if (a !== null && terr !== null) {
      const agl = a - (terr + demOffset);
      aboveTerrain[i] = agl;
      aglForMedian.push(agl);
    } else {
      aboveTerrain[i] = null;
    }
  }

  const trackMode =
    aglForMedian.length > 0 && median(aglForMedian) > FLIGHT_MEDIAN_AGL_M
      ? "flight"
      : "ground";

  return {
    ...track,
    meta: {
      ...track.meta,
      has_terrain: anySampled,
      track_mode: trackMode,
    },
    points: {
      ...track.points,
      terrain_elev: terrainElev,
      above_terrain: aboveTerrain,
    },
  };
}
