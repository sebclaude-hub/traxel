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
  compare: "Vergleichen",
  // Bewusst "Löschen" (nicht "Entfernen" oder ein blosses ✕) — die Aktion ist
  // unwiderruflich und darf nicht mit dem Schliessen-X verwechselt werden.
  remove: "Löschen",
  confirmRemove: "Wirklich löschen?",
  cancel: "Abbrechen",
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
  onCompareTrack,
  activeTrackHash,
  onChartDeleted,
}: {
  onClose: () => void;
  onOpenTrack: (hash: string, name: string, format: string) => void;
  /** Track als Vergleich (Overlay) zum aktuellen laden. Nur verfuegbar, wenn
   *  bereits ein Track angezeigt wird (sonst undefined). */
  onCompareTrack?: (hash: string, name: string, format: string) => void;
  /** Hash des aktuell angezeigten Haupttracks — fuer diesen wird "Vergleichen"
   *  deaktiviert (ein Track mit sich selbst zu vergleichen ist sinnlos). */
  activeTrackHash?: string | null;
  /** App-seitige Synchronisierung: aktuell angezeigte Karte aus dem State werfen. */
  onChartDeleted: (hash: string) => void;
}) {
  const [tracks, setTracks] = useState<TrackRecord[]>([]);
  const [charts, setCharts] = useState<ChartRecord[]>([]);
  // Zwei-Stufen-Löschen als Sicherheitsnetz: der erste Klick merkt sich nur die
  // Zeile (Schlüssel "track:<hash>" / "chart:<hash>"), erst der zweite Klick auf
  // "Wirklich löschen?" führt aus. Schützt vor versehentlichem Datenverlust.
  const [confirmKey, setConfirmKey] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [trk, crt] = await Promise.all([getAllTrackRecords(), getAllCharts()]);
    trk.sort((a, b) => b.savedAt - a.savedAt);
    crt.sort((a, b) => b.savedAt - a.savedAt);
    setTracks(trk);
    setCharts(crt);
  }, []);

  // Erstbefuellung beim Mount. setState liegt hinter dem await (asynchron) —
  // inline als IIFE, damit das kein synchroner Effekt-State-Set ist.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [trk, crt] = await Promise.all([getAllTrackRecords(), getAllCharts()]);
      if (cancelled) return;
      trk.sort((a, b) => b.savedAt - a.savedAt);
      crt.sort((a, b) => b.savedAt - a.savedAt);
      setTracks(trk);
      setCharts(crt);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  // Zweistufige Lösch-Steuerung pro Zeile. Erster Klick → Bestätigungszustand,
  // zweiter Klick auf "Wirklich löschen?" → Ausführung. "Abbrechen" verwirft.
  const renderDelete = (kind: "track" | "chart", hash: string, onConfirm: () => void) => {
    const key = `${kind}:${hash}`;
    const noun = kind === "track" ? "Track" : "Karte";
    if (confirmKey === key) {
      return (
        <>
          <button
            style={btnDanger}
            title={`${noun} unwiderruflich aus der Bibliothek löschen`}
            onClick={() => {
              setConfirmKey(null);
              onConfirm();
            }}
          >
            {t.confirmRemove}
          </button>
          <button style={btn} title="Löschen abbrechen" onClick={() => setConfirmKey(null)}>
            {t.cancel}
          </button>
        </>
      );
    }
    return (
      <button style={btnDanger} title={`${noun} löschen`} onClick={() => setConfirmKey(key)}>
        {t.remove}
      </button>
    );
  };

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
              {onCompareTrack && trk.hash !== activeTrackHash && (
                <button
                  style={btn}
                  title="Als Overlay zum aktuellen Track vergleichen"
                  onClick={() => onCompareTrack(trk.hash, trk.name, trk.format)}
                >
                  {t.compare}
                </button>
              )}
              {renderDelete("track", trk.hash, () => void handleDeleteTrack(trk.hash))}
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
              {renderDelete("chart", crt.hash, () => void handleDeleteChart(crt.hash))}
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
// Destruktive Aktion (Löschen): rot abgesetzt, damit sie sich klar vom neutralen
// "Schließen" und den übrigen Aktionen abhebt — beugt versehentlichem Löschen vor.
const btnDanger: React.CSSProperties = {
  ...btn,
  background: "#3a1414",
  color: "#f0a0a0",
  border: "1px solid #6a2020",
};
