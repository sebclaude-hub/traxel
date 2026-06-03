// ---------------------------------------------------------------------------
// Geodaetische Distanz auf dem WGS84-Ellipsoid.
//
// Ersetzt geopy.distance.geodesic aus der Python-Pipeline. Vincentys inverse
// Formel rechnet auf dem Ellipsoid und stimmt mit geopy auf <1 mm ueberein.
// Fuer den (fuer GPS-Tracks praktisch unmoeglichen) Fall fast-antipodaler
// Punkte, in dem Vincenty nicht konvergiert, faellt die Funktion auf die
// sphaerische Haversine-Distanz zurueck.
// ---------------------------------------------------------------------------

// WGS84-Ellipsoid
const A = 6_378_137.0; // grosse Halbachse (m)
const F = 1 / 298.257223563; // Abplattung
const B = A * (1 - F); // kleine Halbachse (m)

const DEG2RAD = Math.PI / 180;

function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  // Mittlerer Erdradius (m), passend zum WGS84-Ellipsoid.
  const R = 6_371_008.8;
  const phi1 = lat1 * DEG2RAD;
  const phi2 = lat2 * DEG2RAD;
  const dPhi = (lat2 - lat1) * DEG2RAD;
  const dLambda = (lon2 - lon1) * DEG2RAD;
  const s =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Geodaetische Distanz in Metern zwischen zwei WGS84-Koordinaten.
 * Identische Punkte ergeben exakt 0.
 */
export function geodesicDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  if (lat1 === lat2 && lon1 === lon2) return 0;

  const L = (lon2 - lon1) * DEG2RAD;
  const U1 = Math.atan((1 - F) * Math.tan(lat1 * DEG2RAD));
  const U2 = Math.atan((1 - F) * Math.tan(lat2 * DEG2RAD));
  const sinU1 = Math.sin(U1);
  const cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2);
  const cosU2 = Math.cos(U2);

  let lambda = L;
  let lambdaPrev = 0;
  let iter = 0;
  let cosSqAlpha = 0;
  let sinSigma = 0;
  let cos2SigmaM = 0;
  let cosSigma = 0;
  let sigma = 0;

  do {
    const sinLambda = Math.sin(lambda);
    const cosLambda = Math.cos(lambda);
    sinSigma = Math.sqrt(
      (cosU2 * sinLambda) ** 2 +
        (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) ** 2,
    );
    if (sinSigma === 0) return 0; // koinzidente Punkte
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma;
    cosSqAlpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM =
      cosSqAlpha !== 0 ? cosSigma - (2 * sinU1 * sinU2) / cosSqAlpha : 0;
    const C = (F / 16) * cosSqAlpha * (4 + F * (4 - 3 * cosSqAlpha));
    lambdaPrev = lambda;
    lambda =
      L +
      (1 - C) *
        F *
        sinAlpha *
        (sigma +
          C *
            sinSigma *
            (cos2SigmaM +
              C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
  } while (Math.abs(lambda - lambdaPrev) > 1e-12 && ++iter < 200);

  if (iter >= 200) {
    // Keine Konvergenz (fast-antipodal) — spaerische Naeherung.
    return haversineMeters(lat1, lon1, lat2, lon2);
  }

  const uSq = (cosSqAlpha * (A * A - B * B)) / (B * B);
  const k1 = uSq / 16384;
  const Acoef = 1 + k1 * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const Bcoef = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const deltaSigma =
    Bcoef *
    sinSigma *
    (cos2SigmaM +
      (Bcoef / 4) *
        (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
          (Bcoef / 6) *
            cos2SigmaM *
            (-3 + 4 * sinSigma * sinSigma) *
            (-3 + 4 * cos2SigmaM * cos2SigmaM)));

  return B * Acoef * (sigma - deltaSigma);
}
