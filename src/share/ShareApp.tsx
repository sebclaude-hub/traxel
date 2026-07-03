// ---------------------------------------------------------------------------
// Read-only Share-Viewer: dekodiert die eingebettete Payload und rendert den
// Track in 3D auf Terrain — ohne Bibliothek, Import, OPFS oder Worker.
//
// Bewusst eigenstaendig (nicht die volle App): ein Empfaenger soll den Track
// frei untersuchen (Kamera, Farbmodus, Vorhang, Hoehen-Offset), aber nichts
// importieren/verwalten. Der Auto-Hoehen-Offset wird hier neu berechnet und
// per Default angewandt — sonst schwebt ein SkyDemon-Track (ellipsoidisch,
// ~+47 m) ueber dem Gelaende, und genau der nicht-technische Empfaenger wuesste
// nicht, dass er nachjustieren muss.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";

import { base64ToBytes } from "../pipeline/export/base64";
import { decodePayload, type DecodedPayload } from "../pipeline/export/payload";
import { ensureKinematics } from "../pipeline/processing/track-model";
import { enrichTrackWithTerrain, suggestDemOffset } from "../pipeline/terrain";
import type { ColorMode } from "../types";
import { ColorLegend } from "../ui/ColorLegend";
import { placementToCorners } from "../viewer/chartPlacement";
import { TrackViewer, type PlacedChart } from "../viewer/TrackViewer";

const Z_SCALE = 3;

const centeredStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#888",
  fontSize: 14,
};

const overlayStyle: React.CSSProperties = {
  position: "absolute",
  left: 12,
  bottom: 12,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  background: "rgba(15,15,20,0.82)",
  border: "1px solid #2a2a2a",
  borderRadius: 8,
  padding: 10,
  fontSize: 12,
  color: "#ddd",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};

// PNG dekodieren mit 1px transparentem Rand: bei gedrehten Karten liegen
// Mesh-Vertices auch ausserhalb des Rechtecks; clamp-to-edge gibt transparent.
async function decodePaddedImage(src: Blob): Promise<ImageBitmap> {
  const original = await createImageBitmap(src);
  const pad = 1;
  const cv = document.createElement("canvas");
  cv.width = original.width + pad * 2;
  cv.height = original.height + pad * 2;
  cv.getContext("2d")!.drawImage(original, pad, pad);
  const image = await createImageBitmap(cv);
  original.close();
  return image;
}

export function ShareApp({ payloadB64 }: { payloadB64: string }) {
  const [decoded, setDecoded] = useState<DecodedPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>("speed");
  const [showCurtain, setShowCurtain] = useState(true);
  const [zOffset, setZOffset] = useState(0);
  const autoApplied = useRef(false);

  useEffect(() => {
    let cancelled = false;
    decodePayload(base64ToBytes(payloadB64))
      .then((d) => !cancelled && setDecoded(d))
      .catch((e) => !cancelled && setError(String(e?.message ?? e)));
    return () => {
      cancelled = true;
    };
  }, [payloadB64]);

  const track = decoded?.track ?? null;
  const dem = decoded?.dem ?? null;
  const derivation = decoded?.derivation ?? null;

  // Auto-Hoehen-Offset (Boden des Tracks so tief wie moeglich) — reproduziert
  // aus dem eingebetteten DEM+Track, einmal pro Laden angewandt.
  const suggested = useMemo(
    () => (track && dem ? suggestDemOffset(track, dem) : 0),
    [track, dem],
  );
  useEffect(() => {
    if (track && dem && !autoApplied.current) {
      autoApplied.current = true;
      setZOffset(suggested);
    }
  }, [track, dem, suggested]);

  const displayTrack = useMemo(() => {
    if (!track) return track;
    // Kinematik im Payload gestrippt → hier nachrechnen, bevor der Viewer liest.
    const withKin = ensureKinematics(track);
    return dem ? enrichTrackWithTerrain(withKin, dem, zOffset) : withKin;
  }, [track, dem, zOffset]);

  // Chart-PNG-Bytes → ImageBitmap (mit 1px Rand).
  const [chartImages, setChartImages] = useState<ImageBitmap[]>([]);
  // Beim Payload-Wechsel die alten Bitmaps waehrend des Renders verwerfen (statt
  // synchron im Effekt) — deckt auch den "keine Karten"-Fall ab. Der Effekt
  // dekodiert dann nur noch asynchron.
  const [prevDecoded, setPrevDecoded] = useState(decoded);
  if (prevDecoded !== decoded) {
    setPrevDecoded(decoded);
    setChartImages([]);
  }
  useEffect(() => {
    const charts = decoded?.charts;
    if (!charts || charts.length === 0) {
      return;
    }
    let cancelled = false;
    Promise.all(
      charts.map((c) => decodePaddedImage(new Blob([c.pngBytes as Uint8Array<ArrayBuffer>], { type: "image/png" }))),
    ).then((imgs) => {
      if (!cancelled) setChartImages(imgs);
    });
    return () => {
      cancelled = true;
    };
  }, [decoded]);

  const placedCharts = useMemo<PlacedChart[]>(() => {
    const charts = decoded?.charts;
    if (!charts || charts.length === 0 || chartImages.length === 0) return [];
    return charts
      .map((c, i): PlacedChart | null =>
        chartImages[i]
          ? {
              overlay: {
                name: c.name,
                ...placementToCorners(c.placement),
                elevation_m: c.elevationM,
              },
              image: chartImages[i] as ImageBitmap,
            }
          : null,
      )
      .filter((x): x is PlacedChart => x !== null);
  }, [decoded, chartImages]);

  if (error) return <div style={centeredStyle}>Fehler beim Laden: {error}</div>;
  if (!decoded || !displayTrack) return <div style={centeredStyle}>Lädt…</div>;

  // Flug/Drohne und "Höhe GND" brauchen Terrain; ohne DEM zurueckfallen.
  const effColorMode: ColorMode = dem
    ? colorMode
    : colorMode === "flight" || colorMode === "drone"
      ? "speed"
      : colorMode === "altitude_gnd"
        ? "altitude"
        : colorMode;
  const colorOptions: [ColorMode, string][] = [
    ["speed", dem ? "Tempo" : "Geschwindigkeit"],
    ["altitude", "Höhe MSL"],
    ...(dem
      ? ([
          ["altitude_gnd", "Höhe GND"],
          ["flight", "Flug"],
          ["drone", "Drohne"],
        ] as [ColorMode, string][])
      : []),
    ["speed3d", "v₃D"],
    ["accel", "Beschl."],
    ["energy", "Spez. Energie"],
    ["energy_rate", "Energierate"],
    ...(displayTrack.meta.has_satellites
      ? ([["accuracy", "HDOP"]] as [ColorMode, string][])
      : []),
  ];

  const m = displayTrack.meta;
  const km = (m.total_distance_m / 1000).toFixed(1);
  const mins = Math.floor(m.duration_s / 60);
  const secs = Math.round(m.duration_s % 60);

  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <TrackViewer
        tracks={[displayTrack]}
        dem={dem}
        colorMode={effColorMode}
        showCurtain={showCurtain}
        zScale={Z_SCALE}
        zOffset={zOffset}
        showTerrain={!!dem}
        charts={placedCharts}
      />

      {/* Kopfzeile */}
      <div
        style={{
          position: "absolute",
          top: 10,
          left: 12,
          right: 12,
          display: "flex",
          gap: 10,
          alignItems: "baseline",
          color: "#eee",
          textShadow: "0 1px 3px #000",
          pointerEvents: "none",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 15 }}>{m.name}</span>
        <span style={{ color: "#aaa", fontSize: 12 }}>
          {m.source_type.toUpperCase()} · {km} km · {mins}:{String(secs).padStart(2, "0")} min ·{" "}
          {m.n_points} Punkte
        </span>
      </div>

      {/* Transparenz-Hinweis (bridge-Cut) reist mit der Datei. */}
      {derivation && (
        <div
          style={{
            position: "absolute",
            top: 38,
            left: 12,
            right: 12,
            padding: "6px 12px",
            fontSize: 12,
            borderRadius: 6,
            background: derivation.severity === "warn" ? "#3a1f1f" : "#1f2a3a",
            color: derivation.severity === "warn" ? "#f4c0c0" : "#bcd",
          }}
        >
          {derivation.severity === "warn" ? "⚠ " : "ℹ "}
          {derivation.message} ({derivation.n_points_removed} Punkte entfernt
          {derivation.total_time_shift_s !== undefined &&
            `, Zeit ${derivation.total_time_shift_s >= 0 ? "−" : "+"}${Math.abs(
              derivation.total_time_shift_s,
            ).toFixed(0)} s`}
          )
        </div>
      )}

      {/* Steuerung */}
      <div style={overlayStyle}>
        <div style={rowStyle}>
          <span style={{ color: "#999" }}>Farbe</span>
          <select
            value={effColorMode}
            onChange={(e) => setColorMode(e.target.value as ColorMode)}
            style={{
              background: "#1a1a22",
              color: "#ddd",
              border: "1px solid #333",
              borderRadius: 4,
              padding: "2px 6px",
            }}
          >
            {colorOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <label style={{ ...rowStyle, gap: 4, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={showCurtain}
              onChange={(e) => setShowCurtain(e.target.checked)}
            />
            Vorhang
          </label>
        </div>

        <ColorLegend mode={effColorMode} track={displayTrack} />

        {dem && (
          <div style={rowStyle}>
            <span style={{ color: "#999" }}>Höhe</span>
            <input
              type="range"
              min={-60}
              max={60}
              step={0.5}
              value={zOffset}
              onChange={(e) => setZOffset(Number(e.target.value))}
              style={{ width: 130 }}
            />
            <span style={{ width: 56, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {zOffset.toFixed(1)} m
            </span>
            <button
              onClick={() => setZOffset(suggested)}
              title={`Auto-Offset (${suggested.toFixed(1)} m)`}
              style={{
                background: "#1a1a22",
                color: "#bbb",
                border: "1px solid #333",
                borderRadius: 4,
                padding: "1px 6px",
                cursor: "pointer",
              }}
            >
              Auto
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
