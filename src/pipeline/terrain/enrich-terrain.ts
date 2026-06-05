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
