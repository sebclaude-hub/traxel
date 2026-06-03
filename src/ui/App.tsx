// ---------------------------------------------------------------------------
// App-Shell: GPX/KML/NMEA per Drag & Drop laden → Pipeline im Worker →
// 3D-Track + Terrain + (NMEA) Satelliten-SkyPlot, mit Cuts.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ColorMode, DemGrid, SatelliteData, TrackData } from "../types";
import { applyCuts, type CutMode, type CutSpec } from "../pipeline";
import { enrichTrackWithTerrain } from "../pipeline/terrain";
import { TrackViewer, type PlacedChart } from "../viewer/TrackViewer";
import { placementToCorners, type ChartPlacement } from "../viewer/chartPlacement";
import { SkyPlot } from "../viewer/SkyPlot";
import { formatDistance, formatDuration, formatTimestamp } from "../viewer/formatters";
import { usePipeline } from "./usePipeline";

const Z_OPTIONS = [1, 2, 3, 5, 7.5, 10];

type TerrainState = "idle" | "loading" | "ok" | "error";

interface AppChart {
  id: string;
  name: string;
  image: ImageBitmap;
  placement: ChartPlacement;
  elevationM: number;
  visible: boolean;
}

const DEG2RAD = Math.PI / 180;
const isImageFile = (f: File) =>
  f.type.startsWith("image/") || /\.png$/i.test(f.name);

export default function App() {
  const { loadTrackFile, loadTerrain } = usePipeline();
  const [track, setTrack] = useState<TrackData | null>(null);
  const [satellites, setSatellites] = useState<SatelliteData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const [colorMode, setColorMode] = useState<ColorMode>("speed");
  const [showCurtain, setShowCurtain] = useState(true);
  const [zScale, setZScale] = useState(3);

  const [dem, setDem] = useState<DemGrid | null>(null);
  const [terrainState, setTerrainState] = useState<TerrainState>("idle");
  const [showTerrain, setShowTerrain] = useState(true);

  // Aktiver Trackpunkt (steuert den SkyPlot). Bei Trackwechsel zurueck auf 0.
  const [activeIdx, setActiveIdx] = useState(0);
  useEffect(() => {
    setActiveIdx(0);
  }, [track]);

  // Cuts (gegen die Original-Track-Indizes) + Formularzustand.
  const [cuts, setCuts] = useState<CutSpec[]>([]);
  const [cutStart, setCutStart] = useState(0);
  const [cutEnd, setCutEnd] = useState(0);
  const [cutMode, setCutMode] = useState<CutMode>("trim");

  // Karten-Overlays (Anflugkarten).
  const [charts, setCharts] = useState<AppChart[]>([]);
  const [editChartId, setEditChartId] = useState<string | null>(null);

  // Cuts auf den Basistrack anwenden (rein, schnell → Main-Thread).
  const cutResult = useMemo(
    () =>
      track
        ? applyCuts(track, satellites, cuts)
        : { track: null, satellites: null, derivation: null },
    [track, satellites, cuts],
  );
  const displayTrack = cutResult.track;
  const displaySatellites = cutResult.satellites;
  const derivation = cutResult.derivation;

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
        const { track: td, satellites: sat } = await loadTrackFile(file);
        if (td.meta.n_points === 0) {
          setError("Keine gueltigen Trackpunkte in der Datei.");
          setTrack(null);
          setSatellites(null);
        } else {
          setTrack(td);
          setSatellites(sat);
          setCuts([]); // Cuts beim Laden einer neuen Datei zuruecksetzen
          setCharts([]);
          setEditChartId(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setTrack(null);
        setSatellites(null);
      } finally {
        setLoading(false);
      }
    },
    [loadTrackFile],
  );

  // PNG-Karte importieren: anfangs zentriert auf die Track-Bounds platziert.
  const addChartFromFile = useCallback(
    async (file: File) => {
      if (!track) {
        setError("Erst einen Track laden, dann eine Karte hinzufügen.");
        return;
      }
      const image = await createImageBitmap(file);
      const b = track.meta.bounds;
      const centerLon = (b.lon_min + b.lon_max) / 2;
      const centerLat = (b.lat_min + b.lat_max) / 2;
      const mpLon = 111320 * Math.cos(centerLat * DEG2RAD);
      const bboxW = (b.lon_max - b.lon_min) * mpLon;
      const widthM = Math.max(300, bboxW * 0.5 || 1000);
      const heightM = widthM * (image.height / Math.max(image.width, 1));
      setCharts((cs) => [
        ...cs,
        {
          id: `${Date.now()}-${cs.length}`,
          name: file.name.replace(/\.[^.]+$/, ""),
          image,
          placement: { centerLon, centerLat, widthM, heightM, rotationDeg: 0 },
          elevationM: 0,
          visible: true,
        },
      ]);
    },
    [track],
  );

  const dispatchFile = useCallback(
    (file: File) => {
      if (isImageFile(file)) void addChartFromFile(file);
      else void handleFile(file);
    },
    [addChartFromFile, handleFile],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) dispatchFile(file);
    },
    [dispatchFile],
  );

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) dispatchFile(file);
      e.target.value = ""; // erneutes Laden derselben Datei erlauben
    },
    [dispatchFile],
  );

  // Fuer den Viewer: sichtbare Karten → Overlay (Eckkoordinaten) + Bild.
  const placedCharts = useMemo<PlacedChart[]>(
    () =>
      charts
        .filter((c) => c.visible)
        .map((c) => ({
          overlay: {
            name: c.name,
            ...placementToCorners(c.placement),
            elevation_m: c.elevationM,
          },
          image: c.image,
        })),
    [charts],
  );

  // Aktuell bearbeitete Karte → Griffe im Viewer.
  const editChart = useMemo(() => {
    const c = charts.find((x) => x.id === editChartId);
    if (!c) return null;
    return {
      placement: c.placement,
      onChange: (p: ChartPlacement) =>
        setCharts((cs) => cs.map((x) => (x.id === c.id ? { ...x, placement: p } : x))),
    };
  }, [charts, editChartId]);

  // Hilfsfunktion: eine Karte im State patchen.
  const patchChart = useCallback(
    (id: string, patch: Partial<AppChart> | { placement: Partial<ChartPlacement> }) => {
      setCharts((cs) =>
        cs.map((c) => {
          if (c.id !== id) return c;
          if ("placement" in patch && patch.placement) {
            return { ...c, placement: { ...c.placement, ...patch.placement } };
          }
          return { ...c, ...(patch as Partial<AppChart>) };
        }),
      );
    },
    [],
  );

  // Nur wenn Terrain sichtbar ist, gibt es einen Boden fuer above_terrain/AGL.
  const activeDem = showTerrain ? dem : null;

  // Track mit Terrain anreichern (above_terrain, track_mode) — fuer Tooltip
  // und Flug/Boden-Anzeige. Ohne Terrain bleibt der Originaltrack.
  const viewTrack = useMemo(
    () =>
      displayTrack && activeDem
        ? enrichTrackWithTerrain(displayTrack, activeDem)
        : displayTrack,
    [displayTrack, activeDem],
  );

  // activeIdx auf die (ggf. durch Cuts verkuerzte) Laenge begrenzen.
  const safeIdx = viewTrack
    ? Math.min(activeIdx, Math.max(0, viewTrack.meta.n_points - 1))
    : 0;

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
        accept=".gpx,.kml,.nmea,.log,.txt,.png,application/gpx+xml,application/vnd.google-earth.kml+xml,text/xml,image/png"
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

      {derivation && (
        <div
          style={{
            padding: "6px 16px",
            fontSize: 12,
            flexShrink: 0,
            background: derivation.severity === "warn" ? "#3a1f1f" : "#1f2a3a",
            color: derivation.severity === "warn" ? "#f4c0c0" : "#bcd",
            borderBottom: "1px solid #2a2a2a",
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

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
        {viewTrack ? (
          <>
            <TrackViewer
              track={viewTrack}
              dem={activeDem}
              colorMode={effColorMode}
              showCurtain={showCurtain}
              zScale={zScale}
              charts={placedCharts}
              editChart={editChart}
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

              {/* Cut-Werkzeug: Bereich (Original-Indizes) + Modus → Schneiden. */}
              {track && (
                <div style={cutBoxStyle}>
                  <div style={{ color: "#888", fontSize: 11 }}>
                    Schnitt (Index 0–{track.meta.n_points - 1})
                  </div>
                  <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <input
                      type="number"
                      min={0}
                      max={track.meta.n_points - 1}
                      value={cutStart}
                      onChange={(e) => setCutStart(Number(e.target.value))}
                      style={numStyle}
                    />
                    <span style={{ color: "#888" }}>–</span>
                    <input
                      type="number"
                      min={0}
                      max={track.meta.n_points - 1}
                      value={cutEnd}
                      onChange={(e) => setCutEnd(Number(e.target.value))}
                      style={numStyle}
                    />
                  </div>
                  <Segmented<CutMode>
                    value={cutMode}
                    options={[
                      ["trim", "Trim"],
                      ["gap", "Lücke"],
                      ["synthetic", "Privacy"],
                    ]}
                    onChange={setCutMode}
                  />
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      style={btnStyle}
                      onClick={() =>
                        setCuts((cs) => [
                          ...cs,
                          { start: cutStart, end: cutEnd, mode: cutMode },
                        ])
                      }
                    >
                      Schneiden
                    </button>
                    {cuts.length > 0 && (
                      <button style={btnStyle} onClick={() => setCuts([])}>
                        Zurücksetzen ({cuts.length})
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Karten-Overlays: PNG droppen, dann numerisch platzieren. */}
              <div style={cutBoxStyle}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ color: "#888", fontSize: 11 }}>
                    Karten ({charts.length})
                  </span>
                  <button style={btnStyle} onClick={() => fileInputRef.current?.click()}>
                    PNG…
                  </button>
                </div>
                {charts.map((c) => (
                  <ChartControls
                    key={c.id}
                    chart={c}
                    editing={editChartId === c.id}
                    onToggleEdit={() =>
                      setEditChartId((id) => (id === c.id ? null : c.id))
                    }
                    onPatch={(patch) => patchChart(c.id, patch)}
                    onRemove={() => {
                      setCharts((cs) => cs.filter((x) => x.id !== c.id));
                      setEditChartId((id) => (id === c.id ? null : id));
                    }}
                  />
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

        {viewTrack && displaySatellites && (
          <div style={sidePanelStyle}>
            <div style={{ color: "#888", fontSize: 11, marginBottom: 6 }}>
              Satellitenkonstellation
            </div>
            <SkyPlot satData={displaySatellites} trackIdx={safeIdx} />
            <div style={{ color: "#556", fontSize: 10, marginTop: 6 }}>
              {displaySatellites.talkers.join(" / ")}
            </div>
          </div>
        )}
      </div>

      {viewTrack && displaySatellites && (
        <div style={sliderStyle}>
          <input
            type="range"
            min={0}
            max={Math.max(0, viewTrack.meta.n_points - 1)}
            value={safeIdx}
            onChange={(e) => setActiveIdx(Number(e.target.value))}
            style={{ flex: 1 }}
          />
          <span style={{ color: "#888", fontSize: 11, minWidth: 200, textAlign: "right" }}>
            Punkt {safeIdx + 1}/{viewTrack.meta.n_points} ·{" "}
            {formatTimestamp(viewTrack.points.timestamp_ms[safeIdx])}
          </span>
        </div>
      )}
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
          GPX-, KML- oder NMEA-Datei hierher ziehen
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

function LabeledNum({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#999" }}>
      <span style={{ width: 56 }}>{label}</span>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ...numStyle, width: 90 }}
      />
    </label>
  );
}

function ChartControls({
  chart,
  editing,
  onToggleEdit,
  onPatch,
  onRemove,
}: {
  chart: AppChart;
  editing: boolean;
  onToggleEdit: () => void;
  onPatch: (patch: Partial<AppChart> | { placement: Partial<ChartPlacement> }) => void;
  onRemove: () => void;
}) {
  const p = chart.placement;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, borderTop: "1px solid #2a2a2a", paddingTop: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 11, color: "#ccc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {chart.name}
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            style={editing ? btnActiveStyle : btnStyle}
            onClick={onToggleEdit}
            title="Im 3D-Bild verschieben/skalieren/rotieren"
          >
            ✥
          </button>
          <button
            style={chart.visible ? btnActiveStyle : btnStyle}
            onClick={() => onPatch({ visible: !chart.visible })}
            title="Sichtbar"
          >
            {chart.visible ? "👁" : "—"}
          </button>
          <button style={btnStyle} onClick={onRemove} title="Entfernen">
            ✕
          </button>
        </div>
      </div>
      {editing && (
        <div style={{ fontSize: 10, color: "#5a7" }}>
          Griffe: Mitte = verschieben, Ecke = drehen + skalieren
        </div>
      )}
      <LabeledNum label="Lon" value={p.centerLon} step={0.0005} onChange={(v) => onPatch({ placement: { centerLon: v } })} />
      <LabeledNum label="Lat" value={p.centerLat} step={0.0005} onChange={(v) => onPatch({ placement: { centerLat: v } })} />
      <LabeledNum label="Breite m" value={Math.round(p.widthM)} step={50} onChange={(v) => onPatch({ placement: { widthM: v } })} />
      <LabeledNum label="Höhe m" value={Math.round(p.heightM)} step={50} onChange={(v) => onPatch({ placement: { heightM: v } })} />
      <LabeledNum label="Rot °" value={p.rotationDeg} step={5} onChange={(v) => onPatch({ placement: { rotationDeg: v } })} />
      <LabeledNum label="Elev m" value={chart.elevationM} step={10} onChange={(v) => onPatch({ elevationM: v })} />
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
const sidePanelStyle: React.CSSProperties = {
  width: 300,
  flexShrink: 0,
  background: "#111",
  borderLeft: "1px solid #2a2a2a",
  padding: 16,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  overflowY: "auto",
};
const sliderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "8px 16px",
  background: "#181818",
  borderTop: "1px solid #2a2a2a",
  flexShrink: 0,
};
const cutBoxStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  padding: 6,
  background: "rgba(20,20,20,0.7)",
  border: "1px solid #333",
  borderRadius: 4,
};
const numStyle: React.CSSProperties = {
  width: 64,
  background: "#222",
  color: "#ccc",
  border: "1px solid #333",
  borderRadius: 4,
  padding: "3px 4px",
  fontSize: 12,
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
