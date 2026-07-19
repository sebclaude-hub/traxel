// ---------------------------------------------------------------------------
// MergeDialog — zwei im Vergleich geoeffnete Tracks zusammenfuegen.
//
// Zeigt die Reihenfolge (Standard: fruehere Startzeit zuerst, per Knopf
// tauschbar), erkennt Ueberlappung/Pause und laesst bei disjunkten Zeiten
// zwischen "Luecke behalten" und "Ueberbruecken" waehlen (bei Ueberlappung ist
// Ueberbruecken erzwungen — mergeTracks setzt das ohnehin durch, der Dialog
// kommuniziert es nur ehrlich).
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";

import type { TrackData } from "../types";
import type { JoinMode } from "../pipeline";
import { formatDuration, formatTimestamp } from "../viewer/formatters";

interface Props {
  /** Die beiden Tracks in beliebiger Reihenfolge (Haupt- + Vergleichstrack). */
  a: TrackData;
  b: TrackData;
  onCancel: () => void;
  onConfirm: (first: TrackData, second: TrackData, mode: JoinMode) => void;
}

export function MergeDialog({ a, b, onCancel, onConfirm }: Props) {
  // Standard-Reihenfolge: fruehere Startzeit zuerst.
  const chronological = useMemo(() => {
    const aStart = a.points.timestamp_ms[0] ?? 0;
    const bStart = b.points.timestamp_ms[0] ?? 0;
    return aStart <= bStart ? ([a, b] as const) : ([b, a] as const);
  }, [a, b]);
  const [swapped, setSwapped] = useState(false);
  const [first, second] = swapped
    ? [chronological[1], chronological[0]]
    : chronological;

  const firstEndMs = first.points.timestamp_ms[first.points.timestamp_ms.length - 1] ?? 0;
  const secondStartMs = second.points.timestamp_ms[0] ?? 0;
  const overlap = secondStartMs <= firstEndMs;
  const gapS = (secondStartMs - firstEndMs) / 1000;

  const [mode, setMode] = useState<JoinMode>("gap");
  const effectiveMode: JoinMode = overlap ? "bridge" : mode;

  // Schliessen per Escape (wie HelpModal).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const trackRow = (label: string, t: TrackData) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 }}>
      <span style={{ color: "#999", flexShrink: 0 }}>{label}</span>
      <span style={{ textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>
        {t.meta.name}
        <span style={{ color: "#778", marginLeft: 6 }}>
          ab {formatTimestamp(t.points.timestamp_ms[0] ?? 0)}
        </span>
      </span>
    </div>
  );

  return (
    <div style={backdropStyle} onClick={onCancel}>
      <div
        style={panelStyle}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>
          Tracks zusammenfügen
        </div>

        <div style={boxStyle}>
          {trackRow("1.", first)}
          {trackRow("2.", second)}
          <button
            style={{ ...btnStyle, alignSelf: "flex-end" }}
            onClick={() => setSwapped((s) => !s)}
            title="Reihenfolge der beiden Tracks tauschen"
          >
            ⇅ Reihenfolge tauschen
          </button>
        </div>

        {overlap ? (
          <p style={noteStyle}>
            ⚠ Die Zeitbereiche überlappen sich (oder der zweite Track liegt vor
            dem ersten). Die Zeitstempel des zweiten Tracks werden zwingend
            verschoben, sodass er nahtlos hinter dem ersten beginnt
            (Überbrücken).
          </p>
        ) : (
          <>
            <p style={noteStyle}>
              Zwischen Ende des ersten und Start des zweiten Tracks liegen{" "}
              {formatDuration(gapS)}.
            </p>
            <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
              <button
                style={mode === "gap" ? btnActiveStyle : btnStyle}
                onClick={() => setMode("gap")}
                title="Zeitstempel unverändert — die Pause bleibt als sichtbare Lücke, die Gesamtzeit bleibt echt."
              >
                Lücke behalten
              </button>
              <button
                style={mode === "bridge" ? btnActiveStyle : btnStyle}
                onClick={() => setMode("bridge")}
                title="Zweiten Track zeitlich nach vorne ziehen — die Pause wird durch eine plausible Brückenzeit (t = s/v) ersetzt: reine Bewegungszeit."
              >
                Überbrücken
              </button>
            </div>
          </>
        )}

        <p style={{ ...noteStyle, color: "#778" }}>
          Der neue Track wird als GPX-Datei in der Bibliothek gespeichert und
          geöffnet. Geschwindigkeit und HDOP bleiben erhalten;
          NMEA-Satellitendaten (Sky Plot) werden nicht übernommen.
        </p>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button style={btnStyle} onClick={onCancel}>
            Abbrechen
          </button>
          <button
            style={btnPrimaryStyle}
            onClick={() => onConfirm(first, second, effectiveMode)}
          >
            ⧉ Zusammenfügen
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Styles (Optik wie HelpModal, kompakter) --------------------------------

const backdropStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 2000,
};

const panelStyle: React.CSSProperties = {
  width: "min(440px, 92vw)",
  background: "#15151c",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 8,
  boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
  color: "#eee",
  fontFamily: "system-ui, sans-serif",
  padding: 16,
};

const boxStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: 8,
  background: "rgba(20,20,20,0.7)",
  border: "1px solid #333",
  borderRadius: 4,
  marginBottom: 10,
};

const noteStyle: React.CSSProperties = {
  margin: "0 0 10px 0",
  fontSize: 12,
  lineHeight: 1.5,
  color: "#cfcfd6",
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
  fontWeight: 600,
};
