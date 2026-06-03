// ---------------------------------------------------------------------------
// Vorhang-Layer: senkrechte Wand vom GPS-Track bis zum Boden.
//
// Port aus gps_viewer/src/layers/curtainLayer.ts.
//
// Implementierung: SolidPolygonLayer mit `extruded: true`. Das Polygon ist ein
// super-duenner XY-Streifen zwischen Punkt i und i+1 (Breite ~11 cm via
// perpendikularem Offset, damit earcut eine triangulierbare Flaeche hat).
// `getElevation` extrudiert den Streifen auf die mittlere Track-Hoehe.
//
// Boden: liegt ein DEM vor, folgt die Unterkante dem Terrain (sampleDem),
// sonst 0 m MSL.
//
// Faerbung: speed/altitude → kontinuierliches Plasma nach Rang; flight/drone →
// regelbasierte Klassen nach Hoehe ueber Grund (AGL) bzw. MSL.
// ---------------------------------------------------------------------------

import { SolidPolygonLayer } from "@deck.gl/layers";

import { sampleDem } from "../pipeline/terrain/sample";
import type { ColorMode, DemGrid, TrackData } from "../types";
import { plasmaColor, type Rgba } from "./colorMap";

export interface CurtainSegment {
  /** 4-Punkt-3D-Footprint (eps-Streifen perpendikular, z = Boden-Hoehe). */
  footprint: [number, number, number][];
  /** Hoehe der Wand in m (top - base, bereits Z-exaggeriert). */
  height: number;
  /** Mittlerer Rang [0,1] des Segments (Farbgebung speed/altitude). */
  t: number;
  /** Rohe mittlere Track-Hoehe MSL (m, ohne Z-Skalierung). */
  altMslRaw: number;
  /** Rohe mittlere Hoehe ueber Grund (m); null ohne Terrain. */
  altAglRaw: number | null;
}

// --- Klassifikations-Schwellen (Meter) -----------------------------------
const FT = 0.3048;
const FLIGHT_AGL_LOW = 500 * FT; // 152.4 m — rot darunter
const FLIGHT_AGL_MID = 1000 * FT; // 304.8 m — orange darunter
const FLIGHT_MSL_LOW = 5000 * FT; // 1524 m — tuerkis darunter
const DRONE_AGL_LIMIT = 100; // 100 m

const COL_RED: Rgba = [220, 60, 60, 200];
const COL_ORANGE: Rgba = [240, 150, 40, 200];
const COL_TURQUOISE: Rgba = [60, 190, 190, 200];
const COL_BLUE: Rgba = [70, 120, 220, 200];
const COL_GREY: Rgba = [150, 150, 150, 180];
const FALLBACK: Rgba = [150, 150, 150, 180];

function flightColor(altMsl: number | null, altAgl: number | null): Rgba {
  if (altAgl !== null) {
    if (altAgl < FLIGHT_AGL_LOW) return COL_RED;
    if (altAgl < FLIGHT_AGL_MID) return COL_ORANGE;
  }
  if (altMsl !== null && altMsl < FLIGHT_MSL_LOW) return COL_TURQUOISE;
  return COL_BLUE;
}

function droneColor(altAgl: number | null): Rgba {
  if (altAgl === null) return COL_GREY;
  return altAgl <= DRONE_AGL_LIMIT ? COL_BLUE : COL_RED;
}

const EPS = 1e-6; // grad ≈ 11 cm — gibt earcut eine triangulierbare XY-Flaeche

export function buildCurtainSegments(
  track: TrackData,
  dem: DemGrid | null,
  rankPositions: number[],
  altBase: number,
  zScale: number,
): CurtainSegment[] {
  const { lat, lon, alt } = track.points;
  const n = lat.length;
  const segments: CurtainSegment[] = [];

  const exag = (h: number) => altBase + (h - altBase) * zScale;

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

    const top = (exag(altA) + exag(altB)) / 2;

    // Boden + rohe Terrain-Hoehe (fuer AGL). dem ? Terrain : 0 m MSL.
    let bot = 0;
    let terrMeanRaw: number | null = null;
    if (dem) {
      const bA = sampleDem(dem, lonA, latA);
      const bB = sampleDem(dem, lonB, latB);
      if (bA !== null && bB !== null) {
        terrMeanRaw = (bA + bB) / 2;
        bot = exag(terrMeanRaw);
      }
    }
    const base = Math.min(top, bot);
    const height = Math.abs(top - bot);

    const altMslRaw = (altA + altB) / 2;
    const altAglRaw = terrMeanRaw !== null ? altMslRaw - terrMeanRaw : null;

    segments.push({
      footprint: [
        [lonA + px, latA + py, base],
        [lonB + px, latB + py, base],
        [lonB - px, latB - py, base],
        [lonA - px, latA - py, base],
      ],
      height,
      t,
      altMslRaw,
      altAglRaw,
    });
  }
  return segments;
}

export function makeCurtainLayer(segments: CurtainSegment[], colorMode: ColorMode) {
  const getColor = (d: CurtainSegment): Rgba => {
    if (colorMode === "flight") return flightColor(d.altMslRaw, d.altAglRaw);
    if (colorMode === "drone") return droneColor(d.altAglRaw);
    return Number.isNaN(d.t) ? FALLBACK : plasmaColor(d.t, 200);
  };

  return new SolidPolygonLayer<CurtainSegment>({
    id: "curtain",
    data: segments,
    getPolygon: (d) => d.footprint,
    extruded: true,
    getElevation: (d) => d.height,
    getFillColor: getColor,
    material: false,
    wireframe: false,
    pickable: false,
    updateTriggers: { getFillColor: [colorMode] },
  });
}
