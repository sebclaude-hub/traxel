// ---------------------------------------------------------------------------
// App-Shell fuer den Phase-3-Durchstich: GPX per Drag & Drop oder Dateiwahl
// laden → Pipeline im Worker → 3D-Track im Viewer.
//
// Bewusst minimal: nur GPX, nur Geschwindigkeits-/Hoehenfarbe, Vorhang an/aus,
// Z-Ueberhoehung. Bibliothek, Terrain, Karten, NMEA etc. folgen spaeter.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ColorMode, DemGrid, TrackData } from "../types";
import { enrichTrackWithTerrain } from "../pipeline/terrain";
import { TrackViewer } from "../viewer/TrackViewer";
import { formatDistance, formatDuration } from "../viewer/formatters";
import { usePipeline } from "./usePipeline";

const Z_OPTIONS = [1, 2, 3, 5, 7.5, 10];

type TerrainState = "idle" | "loading" | "ok" | "error";

export default function App() {
  const { loadGpxFile, loadTerrain } = usePipeline();
  const [track, setTrack] = useState<TrackData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [colorMode, setColorMode] = useState<ColorMode>("speed");
  const [showCurtain, setShowCurtain] = useState(true);
  const [zScale, setZScale] = useState(3);

  const [dem, setDem] = useState<DemGrid | null>(null);
  const [terrainState, setTerrainState] = useState<TerrainState>("idle");
  const [showTerrain, setShowTerrain] = useState(true);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Terrain laden, sobald ein Track vorliegt (im Worker). Bei Trackwechsel
  // wird der vorherige Lauf per cancelled-Flag verworfen.
  useEffect(() => {
    if (!track) {
      setDem(null);
      setTerrainState("idle");
      return;
    }
    let cancelled = false;
    setDem(null);
    setTerrainState("loading");
    loadTerrain(track.meta.bounds)
      .then((grid) => {
        if (!cancelled) {
          setDem(grid);
          setTerrainState("ok");
        }
      })
      .catch(() => {
        if (!cancelled) setTerrainState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [track, loadTerrain]);

  const handleFile = useCallback(
    async (file: File) => {
      setLoading(true);
      setError(null);
      try {
        const td = await loadGpxFile(file);
        if (td.meta.n_points === 0) {
          setError("Keine gueltigen Trackpunkte in der Datei.");
          setTrack(null);
        } else {
          setTrack(td);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setTrack(null);
      } finally {
        setLoading(false);
      }
    },
    [loadGpxFile],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void handleFile(file);
      e.target.value = ""; // erneutes Laden derselben Datei erlauben
    },
    [handleFile],
  );

  // Nur wenn Terrain sichtbar ist, gibt es einen Boden fuer above_terrain/AGL.
  const activeDem = showTerrain ? dem : null;

  // Track mit Terrain anreichern (above_terrain, track_mode) — fuer Tooltip
  // und Flug/Boden-Anzeige. Ohne Terrain bleibt der Originaltrack.
  const viewTrack = useMemo(
    () => (track && activeDem ? enrichTrackWithTerrain(track, activeDem) : track),
    [track, activeDem],
  );

  // Flug-/Drohnen-Farbmodi nur mit Terrain. Ist Terrain aus, faellt ein
  // aktiver flight/drone-Modus auf Speed zurueck.
  const effColorMode: ColorMode =
    !activeDem && (colorMode === "flight" || colorMode === "drone")
      ? "speed"
      : colorMode;
  const colorOptions: [ColorMode, string][] = activeDem
    ? [
        ["speed", "Tempo"],
        ["altitude", "Höhe"],
        ["flight", "Flug"],
        ["drone", "Drohne"],
      ]
    : [
        ["speed", "Geschwindigkeit"],
        ["altitude", "Höhe"],
      ];

  return (
    <div
      style={rootStyle}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".gpx,application/gpx+xml,text/xml"
        style={{ display: "none" }}
        onChange={onInputChange}
      />

      {viewTrack && (
        <div style={headerStyle}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>{viewTrack.meta.name}</span>
          <span style={{ color: "#888", fontSize: 12 }}>
            {viewTrack.meta.source_type.toUpperCase()} ·{" "}
            {formatDistance(viewTrack.meta.total_distance_m)} ·{" "}
            {formatDuration(viewTrack.meta.duration_s)} · {viewTrack.meta.n_points} Punkte
            {terrainState === "loading" && " · Terrain lädt…"}
            {terrainState === "ok" &&
              ` · ${viewTrack.meta.track_mode === "flight" ? "✈ Flug" : "🚗 Boden"}`}
            {terrainState === "error" && " · Terrain nicht verfügbar"}
          </span>
          <button style={btnStyle} onClick={() => fileInputRef.current?.click()}>
            Andere Datei…
          </button>
        </div>
      )}

      <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
        {viewTrack ? (
          <>
            <TrackViewer
              track={viewTrack}
              dem={activeDem}
              colorMode={effColorMode}
              showCurtain={showCurtain}
              zScale={zScale}
            />
            <div style={togglesStyle}>
              <Segmented<ColorMode>
                value={effColorMode}
                options={colorOptions}
                onChange={setColorMode}
              />
              <Segmented<boolean>
                value={showCurtain}
                options={[
                  [true, "Vorhang"],
                  [false, "aus"],
                ]}
                onChange={setShowCurtain}
              />
              {dem && (
                <Segmented<boolean>
                  value={showTerrain}
                  options={[
                    [true, "Terrain"],
                    [false, "aus"],
                  ]}
                  onChange={setShowTerrain}
                />
              )}
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {Z_OPTIONS.map((z) => (
                  <button
                    key={z}
                    style={z === zScale ? btnActiveStyle : btnStyle}
                    onClick={() => setZScale(z)}
                  >
                    {z}×
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : (
          <DropPrompt
            dragOver={dragOver}
            loading={loading}
            error={error}
            onPick={() => fileInputRef.current?.click()}
          />
        )}
      </div>
    </div>
  );
}

function DropPrompt({
  dragOver,
  loading,
  error,
  onPick,
}: {
  dragOver: boolean;
  loading: boolean;
  error: string | null;
  onPick: () => void;
}) {
  return (
    <div style={{ ...centerStyle, ...(dragOver ? dropActiveStyle : null) }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>Traxel</div>
        <div style={{ color: "#aaa", fontSize: 14, marginBottom: 20 }}>
          GPX-Datei hierher ziehen
        </div>
        <button style={btnPrimaryStyle} onClick={onPick}>
          Datei auswählen
        </button>
        {loading && (
          <div style={{ color: "#888", fontSize: 13, marginTop: 16 }}>
            Track wird verarbeitet…
          </div>
        )}
        {error && (
          <div style={{ color: "#f88", fontSize: 13, marginTop: 16 }}>{error}</div>
        )}
      </div>
    </div>
  );
}

function Segmented<T extends string | boolean>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {options.map(([v, label]) => (
        <button
          key={String(v)}
          style={v === value ? btnActiveStyle : btnStyle}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

const rootStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: "100vw",
  height: "100vh",
  background: "#0d0d0d",
  color: "#eee",
  fontFamily: "system-ui, sans-serif",
  overflow: "hidden",
};
const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 16,
  padding: "6px 16px",
  background: "#181818",
  borderBottom: "1px solid #2a2a2a",
  flexShrink: 0,
};
const togglesStyle: React.CSSProperties = {
  position: "absolute",
  top: 12,
  right: 12,
  display: "flex",
  flexDirection: "column",
  gap: 8,
  zIndex: 10,
};
const centerStyle: React.CSSProperties = {
  display: "flex",
  width: "100%",
  height: "100%",
  alignItems: "center",
  justifyContent: "center",
  background: "#0d0d0d",
};
const dropActiveStyle: React.CSSProperties = {
  outline: "2px dashed #5a7",
  outlineOffset: -12,
  background: "#10160f",
};
const btnStyle: React.CSSProperties = {
  background: "#222",
  color: "#ccc",
  border: "1px solid #333",
  borderRadius: 4,
  padding: "4px 8px",
  fontSize: 12,
  cursor: "pointer",
};
const btnActiveStyle: React.CSSProperties = {
  ...btnStyle,
  background: "#3a5",
  color: "#031",
  border: "1px solid #3a5",
  fontWeight: 600,
};
const btnPrimaryStyle: React.CSSProperties = {
  ...btnStyle,
  background: "#2a6",
  color: "#021",
  fontSize: 14,
  padding: "8px 18px",
  fontWeight: 600,
};
