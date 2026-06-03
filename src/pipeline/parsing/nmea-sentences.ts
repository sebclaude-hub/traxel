// ---------------------------------------------------------------------------
// NMEA-Satz-Parser (ersetzt pynmea2 fuer die Saetze, die wir brauchen).
//
// Eine Zeile → eine getypte Nachricht (RMC/GGA/GSA/VTG/GSV) oder null
// (kaputte/unbekannte/proprietaere Zeilen werden toleriert und uebersprungen).
//
// Reine Funktionen → unit-testbar. Zeit-/Datums-Zusammenfuehrung passiert
// spaeter im Orchestrator (nmea.ts), der den Stream-State (letztes RMC-Datum)
// fuehrt — wie build_dataframe im Python-Port.
// ---------------------------------------------------------------------------

export interface RmcMsg {
  type: "RMC";
  talker: string;
  time: string | null; // hhmmss(.sss)
  date: string | null; // ddmmyy
  status: string | null; // "A" = gueltig, "V" = Warnung
  lat: number | null;
  lon: number | null;
  speedKnots: number | null;
}

export interface GgaMsg {
  type: "GGA";
  talker: string;
  time: string | null;
  lat: number | null;
  lon: number | null;
  gpsQuality: number | null;
  numSats: number | null;
  hdop: number | null;
  altitude: number | null;
}

export interface GsaMsg {
  type: "GSA";
  talker: string;
  fixType: number | null; // 1=kein Fix, 2=2D, 3=3D
  pdop: number | null;
  hdop: number | null;
  vdop: number | null;
}

export interface VtgMsg {
  type: "VTG";
  talker: string;
  speedKnots: number | null;
  speedKmph: number | null;
}

export interface GsvSat {
  prn: number | null;
  elevation: number | null;
  azimuth: number | null;
  snr: number | null;
}

export interface GsvMsg {
  type: "GSV";
  talker: string;
  numMessages: number | null;
  msgNum: number | null;
  numSvInView: number | null;
  sats: GsvSat[];
}

export type NmeaMessage = RmcMsg | GgaMsg | GsaMsg | VtgMsg | GsvMsg;

function intOrNull(s: string | undefined): number | null {
  if (s === undefined || s === "") return null;
  const v = parseInt(s, 10);
  return Number.isNaN(v) ? null : v;
}

function floatOrNull(s: string | undefined): number | null {
  if (s === undefined || s === "") return null;
  const v = parseFloat(s);
  return Number.isNaN(v) ? null : v;
}

/**
 * NMEA-Koordinate (ddmm.mmmm / dddmm.mmmm) + Richtung → Dezimalgrad.
 * S und W sind negativ. null bei fehlenden Werten.
 */
function parseLatLon(
  raw: string | undefined,
  dir: string | undefined,
  degDigits: number,
): number | null {
  if (!raw || !dir) return null;
  const val = parseFloat(raw);
  if (Number.isNaN(val)) return null;
  const deg = Math.floor(val / 100); // erste 2 (lat) bzw. 3 (lon) Ziffern
  const min = val - deg * 100;
  let dec = deg + min / 60;
  if (dir === "S" || dir === "W") dec = -dec;
  // degDigits dient nur der Doku/Lesbarkeit; floor(val/100) liefert bereits
  // 2 bzw. 3 Grad-Ziffern, je nach Groessenordnung des Rohwerts.
  void degDigits;
  return dec;
}

/** XOR-Checksumme zwischen '$' und '*' pruefen. Ohne '*' gilt sie als ok. */
export function checksumValid(line: string): boolean {
  const star = line.lastIndexOf("*");
  if (star < 0) return true; // keine Checksumme angegeben
  const body = line.slice(line.indexOf("$") + 1, star);
  const given = line.slice(star + 1).trim().toUpperCase();
  let cs = 0;
  for (let i = 0; i < body.length; i++) cs ^= body.charCodeAt(i);
  return cs.toString(16).toUpperCase().padStart(2, "0") === given;
}

/**
 * Parst eine NMEA-Zeile. Liefert null bei ungueltiger Checksumme,
 * unbekanntem/proprietaerem Satz oder Schrott.
 */
export function parseNmeaLine(line: string): NmeaMessage | null {
  const dollar = line.indexOf("$");
  if (dollar < 0) return null;
  const trimmed = line.slice(dollar).trim();
  if (!checksumValid(trimmed)) return null;

  const star = trimmed.lastIndexOf("*");
  const body = star >= 0 ? trimmed.slice(1, star) : trimmed.slice(1);
  const f = body.split(",");
  const head = f[0];
  if (head.length !== 5) return null; // nur 5-stellige Standard-Header (GxXXX)
  const talker = head.slice(0, 2);
  const type = head.slice(2);

  switch (type) {
    case "RMC":
      return {
        type: "RMC",
        talker,
        time: f[1] || null,
        status: f[2] || null,
        lat: parseLatLon(f[3], f[4], 2),
        lon: parseLatLon(f[5], f[6], 3),
        speedKnots: floatOrNull(f[7]),
        date: f[9] || null,
      };
    case "GGA":
      return {
        type: "GGA",
        talker,
        time: f[1] || null,
        lat: parseLatLon(f[2], f[3], 2),
        lon: parseLatLon(f[4], f[5], 3),
        gpsQuality: intOrNull(f[6]),
        numSats: intOrNull(f[7]),
        hdop: floatOrNull(f[8]),
        altitude: floatOrNull(f[9]),
      };
    case "GSA":
      return {
        type: "GSA",
        talker,
        fixType: intOrNull(f[2]),
        pdop: floatOrNull(f[15]),
        hdop: floatOrNull(f[16]),
        vdop: floatOrNull(f[17]),
      };
    case "VTG":
      return {
        type: "VTG",
        talker,
        speedKnots: floatOrNull(f[5]),
        speedKmph: floatOrNull(f[7]),
      };
    case "GSV": {
      const sats: GsvSat[] = [];
      // Ab Feld 4 in Vierergruppen: prn, elevation, azimuth, snr.
      for (let i = 4; i + 0 < f.length; i += 4) {
        const prn = intOrNull(f[i]);
        if (prn === null) continue;
        sats.push({
          prn,
          elevation: intOrNull(f[i + 1]),
          azimuth: intOrNull(f[i + 2]),
          snr: intOrNull(f[i + 3]),
        });
      }
      return {
        type: "GSV",
        talker,
        numMessages: intOrNull(f[1]),
        msgNum: intOrNull(f[2]),
        numSvInView: intOrNull(f[3]),
        sats,
      };
    }
    default:
      return null; // unbekannter/proprietaerer Satz
  }
}
