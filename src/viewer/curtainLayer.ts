// ---------------------------------------------------------------------------
// Vorhang-Layer: senkrechte Wand vom GPS-Track bis zum Boden.
//
// Vereinfachter Port aus gps_viewer/src/layers/curtainLayer.ts fuer den
// Phase-3-Durchstich: ohne DEM/Terrain und ohne Flug/Drohne-Klassifikation.
// Der Boden liegt bei 0 m MSL; die Faerbung folgt dem Rang (Plasma).
// Terrain-Boden und regelbasierte Faerbung kommen in spaeteren Phasen.
//
// Implementierung: SolidPolygonLayer mit `extruded: true`. Das Polygon ist ein
// super-duenner XY-Streifen zwischen Punkt i und i+1 (Breite ~11 cm via
// perpendikularem Offset, damit earcut eine triangulierbare Flaeche hat).
// `getElevation` extrudiert den Streifen auf die mittlere Track-Hoehe.
// ---------------------------------------------------------------------------

import { SolidPolygonLayer } from "@deck.gl/layers";

import type { TrackData } from "../types";
import { plasmaColor, type Rgba } from "./colorMap";

export interface CurtainSegment {
  /** 4-Punkt-3D-Footprint (eps-Streifen perpendikular, z = Boden-Hoehe). */
  footprint: [number, number, number][];
  /** Hoehe der Wand in m (top - base, bereits Z-exaggeriert). */
  height: number;
  /** Mittlerer Rang [0,1] des Segments (Farbgebung). */
  t: number;
}

const FALLBACK: Rgba = [150, 150, 150, 180];
const EPS = 1e-6; // grad ≈ 11 cm — gibt earcut eine triangulierbare XY-Flaeche

export function buildCurtainSegments(
  track: TrackData,
  rankPositions: number[],
  altBase: number,
  zScale: number,
): CurtainSegment[] {
  const { lat, lon, alt } = track.points;
  const n = lat.length;
  const segments: CurtainSegment[] = [];

  const exagTrack = (h: number) => altBase + (h - altBase) * zScale;

  for (let i = 0; i < n - 1; i++) {
    const lonA = lon[i];
    const latA = lat[i];
    const lonB = lon[i + 1];
    const latB = lat[i + 1];
    const altA = alt[i] ?? altBase;
    const altB = alt[i + 1] ?? altBase;

    const tI = rankPositions[i];
    const tI1 = rankPositions[i + 1];
    let t: number;
    if (Number.isNaN(tI) && Number.isNaN(tI1)) t = NaN;
    else if (Number.isNaN(tI)) t = tI1;
    else if (Number.isNaN(tI1)) t = tI;
    else t = (tI + tI1) / 2;

    const dx = lonB - lonA;
    const dy = latB - latA;
    const len = Math.hypot(dx, dy) || 1;
    const px = (-dy / len) * EPS;
    const py = (dx / len) * EPS;

    const top = (exagTrack(altA) + exagTrack(altB)) / 2;
    const bot = 0; // Boden = 0 m MSL (kein Terrain im Durchstich)
    const base = Math.min(top, bot);
    const height = Math.abs(top - bot);

    segments.push({
      footprint: [
        [lonA + px, latA + py, base],
        [lonB + px, latB + py, base],
        [lonB - px, latB - py, base],
        [lonA - px, latA - py, base],
      ],
      height,
      t,
    });
  }
  return segments;
}

export function makeCurtainLayer(segments: CurtainSegment[]) {
  return new SolidPolygonLayer<CurtainSegment>({
    id: "curtain",
    data: segments,
    getPolygon: (d) => d.footprint,
    extruded: true,
    getElevation: (d) => d.height,
    getFillColor: (d) => (Number.isNaN(d.t) ? FALLBACK : plasmaColor(d.t, 200)),
    material: false,
    wireframe: false,
    pickable: false,
  });
}
