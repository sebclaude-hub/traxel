// ---------------------------------------------------------------------------
// Karten-Platzierung: Zentrum + Groesse (Meter) + Rotation → vier
// Eckkoordinaten (lon/lat). Reine Geometrie → unit-testbar.
//
// Equirektangulare Naeherung um die Zentrumsbreite (wie chartMesh/demMesh).
// Rotation im Uhrzeigersinn (0° = Nord oben, achsenparallel).
// ---------------------------------------------------------------------------

export interface ChartPlacement {
  centerLon: number;
  centerLat: number;
  widthM: number;
  heightM: number;
  rotationDeg: number;
}

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
