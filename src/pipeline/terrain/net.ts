// ---------------------------------------------------------------------------
// Timeout-Signal fuer Kachel-Downloads.
//
// Kombiniert ein optionales Aufrufer-Abbruchsignal mit einem harten Timeout,
// damit eine HAENGENDE (nicht fehlschlagende) Verbindung den Terrain-/Satelliten-
// Aufbau nicht ewig blockiert. Ohne Timeout bliebe die UI in "loading" haengen,
// weil ein nie aufloesendes fetch() den ganzen buildTerrain-Promise offen haelt.
// ---------------------------------------------------------------------------

/** Harte Obergrenze pro Kachel-Download. */
export const TILE_FETCH_TIMEOUT_MS = 15000;

/**
 * Signal fuer einen einzelnen Kachel-`fetch`: der Timeout greift immer, ein
 * evtl. vom Aufrufer uebergebenes Signal wird zusaetzlich kombiniert (das
 * zuerst feuernde Signal gewinnt).
 */
export function fetchSignal(
  signal?: AbortSignal,
  ms = TILE_FETCH_TIMEOUT_MS,
): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
