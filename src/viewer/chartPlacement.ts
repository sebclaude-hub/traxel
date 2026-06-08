// ---------------------------------------------------------------------------
// Karten-Platzierung: Zentrum + Groesse (Meter) + Rotation → vier
// Eckkoordinaten (lon/lat). Reine Geometrie → unit-testbar.
//
// Equirektangulare Naeherung um die Zentrumsbreite (wie chartMesh/demMesh).
// Rotation im Uhrzeigersinn (0° = Nord oben, achsenparallel).
// ---------------------------------------------------------------------------

export type { ChartPlacement } from "../types";

export interface ChartCorners {
  corner_tl: [number, number];
  corner_tr: [number, number];
  corner_bl: [number, number];
  corner_br: [number, number];
}

const DEG2RAD = Math.PI / 180;

export function placementToCorners(p: ChartPlacement): ChartCorners {
  const mpLon = 111320 * Math.cos(p.centerLat * DEG2RAD);
  const mpLat = 110540;
  const hw = p.widthM / 2;
  const hh = p.heightM / 2;
  const rot = p.rotationDeg * DEG2RAD;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);

  // Lokale Meter-Offsets der Ecken (x=Ost, y=Nord) vor Rotation.
  const local: Record<keyof ChartCorners, [number, number]> = {
    corner_tl: [-hw, hh],
    corner_tr: [hw, hh],
    corner_bl: [-hw, -hh],
    corner_br: [hw, -hh],
  };

  const out = {} as ChartCorners;
  for (const key of Object.keys(local) as (keyof ChartCorners)[]) {
    const [dx, dy] = local[key];
    // Im Uhrzeigersinn drehen (Nord→Ost positiv).
    const rx = dx * cos + dy * sin;
    const ry = -dx * sin + dy * cos;
    out[key] = [p.centerLon + rx / mpLon, p.centerLat + ry / mpLat];
  }
  return out;
}

/**
 * Inverse zum Ziehen des oberen-rechten Eck-Griffs: aus der Cursor-Position
 * (lon/lat) ergeben sich neue Rotation und gleichmaessige Skalierung relativ
 * zur Basis-Platzierung. Zentrum und Seitenverhaeltnis bleiben.
 *
 * Mathematik: Der TR-Eck-Offset (meter) ist R(−θ)·(hw, hh) mit
 * α = atan2(hh, hw). Fuer den Cursor-Vektor (dxM, dyM) gilt
 *   θ = α − atan2(dyM, dxM),   s = |(dxM, dyM)| / hypot(hw, hh).
 */
export function cornerDragToPlacement(
  base: ChartPlacement,
  cursorLon: number,
  cursorLat: number,
): ChartPlacement {
  const mpLon = 111320 * Math.cos(base.centerLat * DEG2RAD);
  const mpLat = 110540;
  const dxM = (cursorLon - base.centerLon) * mpLon;
  const dyM = (cursorLat - base.centerLat) * mpLat;
  const dist = Math.hypot(dxM, dyM);
  if (dist < 1e-6) return base;

  const halfDiagBase = Math.hypot(base.widthM / 2, base.heightM / 2);
  const alpha = Math.atan2(base.heightM, base.widthM); // = atan2(hh, hw)
  const beta = Math.atan2(dyM, dxM);
  const thetaDeg = ((alpha - beta) * 180) / Math.PI;
  const s = dist / Math.max(halfDiagBase, 1e-6);

  return {
    centerLon: base.centerLon,
    centerLat: base.centerLat,
    widthM: base.widthM * s,
    heightM: base.heightM * s,
    rotationDeg: thetaDeg,
  };
}
