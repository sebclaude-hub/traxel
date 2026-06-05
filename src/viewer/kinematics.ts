// ---------------------------------------------------------------------------
// Abgeleitete Kinematik fuer die Farbgebung: 3D-Geschwindigkeit und
// (vorzeichenbehaftete) Tangential-Beschleunigung.
//
// WICHTIG — 3D, nicht 2D: Die Datenquellen liefern nur HORIZONTALE Geschwindig-
// keit (speed_kmh = NMEA-Grundgeschwindigkeit bzw. geodaetische 2D-Distanz/dt).
// Die vertikale Rate d(alt)/dt kommt hier dazu:
//     v3D = sqrt(v_h^2 + v_z^2)
//     a   = d(v3D)/dt           (tangential, + = schneller, − = langsamer)
//
// Rein und unit-testbar (keine Browser-APIs). Bewusst OHNE Glaettung — die
// Farbskala wird stattdessen robust (Perzentil) gegen Ausreisser skaliert.
// Da v3D aus alt+speed+Zeit des (ggf. geschnittenen) Tracks gerechnet wird,
// folgt die Beschleunigung automatisch den Cuts inkl. synthetischer Zeitshift.
// ---------------------------------------------------------------------------

export interface KinematicPoints {
  alt: (number | null)[];
  speed_kmh: (number | null)[];
  timestamp_ms: number[];
}

const MPS_PER_KMH = 1 / 3.6;

/** dt in Sekunden zwischen zwei Indizes; <=0 (Duplikat/nicht-monoton) → null. */
function dtSeconds(timestampMs: number[], i: number, j: number): number | null {
  const dt = (timestampMs[j] - timestampMs[i]) / 1000;
  return Number.isFinite(dt) && dt > 0 ? dt : null;
}

/**
 * Vertikale Geschwindigkeit (m/s) aus d(alt)/dt: zentrale Differenz im Inneren,
 * einseitig an den Raendern. Fehlt eine benoetigte Hoehe oder ist dt<=0, faellt
 * die Stelle auf 0 zurueck (→ 2D-Verhalten dort), statt das ganze v3D zu killen.
 */
function verticalSpeed(points: KinematicPoints): number[] {
  const { alt, timestamp_ms } = points;
  const n = alt.length;
  const vz = new Array<number>(n).fill(0);
  if (n < 2) return vz;

  const finite = (i: number): boolean =>
    alt[i] !== null && Number.isFinite(alt[i] as number);

  for (let i = 0; i < n; i++) {
    const lo = i === 0 ? 0 : i - 1;
    const hi = i === n - 1 ? n - 1 : i + 1;
    if (lo === hi || !finite(lo) || !finite(hi)) continue; // bleibt 0
    const dt = dtSeconds(timestamp_ms, lo, hi);
    if (dt === null) continue; // bleibt 0
    vz[i] = ((alt[hi] as number) - (alt[lo] as number)) / dt;
  }
  return vz;
}

/** 3D-Geschwindigkeit (m/s) pro Punkt; null wenn keine Horizontalgeschwindigkeit. */
export function speed3D(points: KinematicPoints): (number | null)[] {
  const { speed_kmh } = points;
  const vz = verticalSpeed(points);
  return speed_kmh.map((s, i) => {
    if (s === null || !Number.isFinite(s)) return null;
    const vh = s * MPS_PER_KMH;
    return Math.sqrt(vh * vh + vz[i] * vz[i]);
  });
}

const G = 9.80665; // Normfallbeschleunigung (m/s²)

/**
 * Zeitliche Ableitung d(value)/dt: zentrale Differenz im Inneren, einseitig an
 * den Raendern. null, wenn ein benoetigter Nachbar fehlt oder dt<=0.
 * Vorzeichenbehaftet. Gemeinsame Basis fuer Beschleunigung und Energieaenderung.
 */
export function centralTimeDerivative(
  values: (number | null)[],
  timestampMs: number[],
): (number | null)[] {
  const n = values.length;
  const out = new Array<number | null>(n).fill(null);
  if (n < 2) return out;
  for (let i = 0; i < n; i++) {
    const lo = i === 0 ? 0 : i - 1;
    const hi = i === n - 1 ? n - 1 : i + 1;
    if (lo === hi) continue;
    const a = values[lo];
    const b = values[hi];
    if (a === null || b === null) continue;
    const dt = dtSeconds(timestampMs, lo, hi);
    if (dt === null) continue;
    out[i] = (b - a) / dt;
  }
  return out;
}

/**
 * Tangential-Beschleunigung (m/s²) = d(v3D)/dt. Vorzeichenbehaftet
 * (+ beschleunigen, − bremsen).
 */
export function computeAcceleration3D(points: KinematicPoints): (number | null)[] {
  return centralTimeDerivative(speed3D(points), points.timestamp_ms);
}

/**
 * Spezifische Energiehoehe H = h + v3D²/(2g) (m) — "Energiealtitude": die Hoehe,
 * auf die der Flugkoerper stiege, wuerde er seine kinetische Energie vollstaendig
 * in Hoehe umsetzen. Massenunabhaengig. h = MSL-Hoehe, v3D = 3D-Geschwindigkeit.
 * null, wo Hoehe ODER Geschwindigkeit fehlt (sonst waere die Gesamtenergie
 * unvollstaendig).
 */
export function energyHeight(points: KinematicPoints): (number | null)[] {
  const v3 = speed3D(points);
  return points.alt.map((h, i) => {
    if (h === null || !Number.isFinite(h)) return null;
    const v = v3[i];
    if (v === null) return null;
    return h + (v * v) / (2 * G);
  });
}

/**
 * Energieaenderungsrate dH/dt (m/s) — in der Luftfahrt die "spezifische
 * Ueberschussleistung" Ps. Vorzeichenbehaftet (+ Energie gewinnen, − verlieren).
 * Kunstflug-Kennzahl.
 */
export function computeEnergyRate(points: KinematicPoints): (number | null)[] {
  return centralTimeDerivative(energyHeight(points), points.timestamp_ms);
}

/**
 * Robuste, symmetrische Skala: p-Perzentil der Betraege (Default 98 %), damit
 * ein einzelner GPS-Spike die Farbskala nicht zusammendrueckt. Immer > 0
 * (Fallback 1), damit Division sicher ist.
 */
export function robustSymmetricScale(
  values: (number | null)[],
  p = 0.98,
): number {
  const mags = values
    .filter((v): v is number => v !== null && Number.isFinite(v))
    .map(Math.abs)
    .sort((x, y) => x - y);
  if (mags.length === 0) return 1;

  const h = (mags.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  const perc =
    lo === hi ? mags[lo] : mags[lo] + (h - lo) * (mags[hi] - mags[lo]);
  return perc > 0 ? perc : mags[mags.length - 1] || 1;
}
