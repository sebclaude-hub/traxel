// ---------------------------------------------------------------------------
// Bibliotheks-Verwaltung: Modal-Overlay zum Wiederoeffnen/Loeschen gespeicherter
// Tracks und zum Loeschen gespeicherter Karten.
//
// Bewusst in sich geschlossen + alle sichtbaren Texte in `t` gesammelt, damit
// Umstyling und spaetere Uebersetzung (i18n) einfach bleiben. Tracks werden
// automatisch beim Laden gespeichert (Recents); Karten ueber den Verankern-Pin.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";

import {
  getAllTrackRecords,
  removeTrack,
} from "../library/track-store";
import { removeChart } from "../library/chart-store";
import { getAllCharts, type ChartRecord, type TrackRecord } from "../library/db";
import { formatDistance, formatDuration } from "../viewer/formatters";

// Alle sichtbaren Strings an einer Stelle → spaeter leicht zu uebersetzen.
const t = {
  title: "Bibliothek",
  tracks: "Tracks",
  charts: "Karten",
  open: "Öffnen",
  remove: "Entfernen",
  close: "Schließen",
  noTracks: "Noch keine Tracks gespeichert.",
  noCharts: "Noch keine Karten gespeichert.",
  points: "Punkte",
  savedAt: "gespeichert",
};

function fmtDate(iso: string | null, fallbackMs: number): string {
  const d = iso ? new Date(iso) : new Date(fallbackMs);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export function LibraryPanel({
  onClose,
  onOpenTrack,
  onChartDeleted,
}: {
  onClose: () => void;
  onOpenTrack: (hash: string, name: string, format: string) => void;
  /** App-seitige Synchronisierung: aktuell angezeigte Karte aus dem State werfen. */
  onChartDeleted: (hash: string) => void;
}) {
  const [tracks, setTracks] = useState<TrackRecord[]>([]);
  const [charts, setCharts] = useState<ChartRecord[]>([]);

  const reload = useCallback(async () => {
    const [trk, crt] = await Promise.all([getAllTrackRecords(), getAllCharts()]);
    trk.sort((a, b) => b.savedAt - a.savedAt);
    crt.sort((a, b) => b.savedAt - a.savedAt);
    setTracks(trk);
    setCharts(crt);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleDeleteTrack = useCallback(
    async (hash: string) => {
      await removeTrack(hash);
      await reload();
    },
    [reload],
  );

  const handleDeleteChart = useCallback(
    async (hash: string) => {
      await removeChart(hash);
      onChartDeleted(hash);
      await reload();
    },
    [reload, onChartDeleted],
  );

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
        <div style={headerRowStyle}>
          <span style={{ fontWeight: 600, fontSize: 16 }}>📚 {t.title}</span>
          <button style={btn} onClick={onClose}>
            {t.close}
          </button>
        </div>

        <div style={sectionLabelStyle}>
          {t.tracks} ({tracks.length})
        </div>
        {tracks.length === 0 ? (
          <div style={emptyStyle}>{t.noTracks}</div>
        ) : (
          tracks.map((trk) => (
            <div key={trk.hash} style={rowStyle}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={nameStyle}>{trk.name}</div>
                <div style={metaStyle}>
                  {trk.format.toUpperCase()} · {trk.nPoints} {t.points} ·{" "}
                  {formatDistance(trk.totalDistanceM)} · {formatDuration(trk.durationS)} ·{" "}
                  {fmtDate(trk.timestampStartUtc, trk.savedAt)}
                </div>
              </div>
              <button
                style={btnPrimary}
                onClick={() => onOpenTrack(trk.hash, trk.name, trk.format)}
              >
                {t.open}
              </button>
              <button style={btn} title={t.remove} onClick={() => void handleDeleteTrack(trk.hash)}>
                ✕
              </button>
            </div>
          ))
        )}

        <div style={{ ...sectionLabelStyle, marginTop: 14 }}>
          {t.charts} ({charts.length})
        </div>
        {charts.length === 0 ? (
          <div style={emptyStyle}>{t.noCharts}</div>
        ) : (
          charts.map((crt) => (
            <div key={crt.hash} style={rowStyle}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={nameStyle}>{crt.name}</div>
                <div style={metaStyle}>
                  {t.savedAt} {fmtDate(null, crt.savedAt)} · {crt.bbox.lat_min.toFixed(3)},
                  {crt.bbox.lon_min.toFixed(3)} … {crt.bbox.lat_max.toFixed(3)},
                  {crt.bbox.lon_max.toFixed(3)}
                </div>
              </div>
              <button style={btn} title={t.remove} onClick={() => void handleDeleteChart(crt.hash)}>
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// --- Styles (lokal gehalten → leicht umzustylen) ---------------------------

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};
const cardStyle: React.CSSProperties = {
  width: "min(640px, 92vw)",
  maxHeight: "82vh",
  overflowY: "auto",
  background: "#161616",
  border: "1px solid #2a2a2a",
  borderRadius: 8,
  padding: 18,
  color: "#eee",
  fontFamily: "system-ui, sans-serif",
};
const headerRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 12,
};
const sectionLabelStyle: React.CSSProperties = {
  color: "#888",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  margin: "8px 0 4px",
};
const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 0",
  borderTop: "1px solid #232323",
};
const nameStyle: React.CSSProperties = {
  fontSize: 13,
  color: "#ddd",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const metaStyle: React.CSSProperties = {
  fontSize: 11,
  color: "#777",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const emptyStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#666",
  padding: "6px 0",
};
const btn: React.CSSProperties = {
  background: "#222",
  color: "#ccc",
  border: "1px solid #333",
  borderRadius: 4,
  padding: "4px 8px",
  fontSize: 12,
  cursor: "pointer",
  flexShrink: 0,
};
const btnPrimary: React.CSSProperties = {
  ...btn,
  background: "#2a6",
  color: "#021",
  fontWeight: 600,
};
