/**
 * RangeSelector — visuelle Cut-Leiste mit drei Modi (trim / gap / bridge).
 * Port aus gps_viewer/src/components/RangeSelector.tsx, angepasst an Traxel:
 *
 *   * KEINE cuts.json-Export-Maschinerie (Traxel hat kein Python-Backend) —
 *     Cuts wirken LIVE: App reicht `api.ranges` als CutSpec[] direkt an
 *     `applyCuts` weiter, das reaktiv neu rechnet. Daher auch kein „Anwenden".
 *   * Modus „synthetic" → „bridge" (Ueberbruecken).
 *
 * Eigenschaften:
 *   * Horizontale Cut-Leiste parallel zum Playback-Slider.
 *   * Cut-Bars farbcodiert: trim=rot (Schraffur an Edges), gap=gruen, bridge=blau.
 *   * Globaler Pill-Switch „Luecke / Zeit verschieben" fuer Middle-Cuts.
 *   * „+ Cut" deaktiviert, wenn um die Slider-Position keine Luecke mehr ist.
 *   * Drag-Handles mit Window-Level-Pointer-Events (robust gegen DOM-Wechsel,
 *     wenn ein Cut waehrend des Drags zur Trim-Edge wird).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CutMode } from "../pipeline";
import type { CutRange, MiddleMode, RangeSelectionApi } from "./useRangeSelection";

interface Props {
  totalPoints: number;
  activeIdx: number;
  api: RangeSelectionApi;
}

const TRACK_HEIGHT = 18;
const HANDLE_WIDTH = 10;

type ModeStyle = {
  bgSolid: string;
  bgHatched: string; // fuer Edge-Cuts
  border: string;
  handle: string;
  label: string;
};
const MODE_STYLES: Record<CutMode, ModeStyle> = {
  trim: {
    bgSolid: "rgba(220, 70, 70, 0.45)",
    bgHatched:
      "repeating-linear-gradient(45deg, rgba(220,70,70,0.55) 0 6px, rgba(220,70,70,0.3) 6px 12px)",
    border: "#c44",
    handle: "#f55",
    label: "Trim",
  },
  gap: {
    bgSolid: "rgba(70, 180, 90, 0.45)",
    bgHatched:
      "repeating-linear-gradient(45deg, rgba(70,180,90,0.55) 0 6px, rgba(70,180,90,0.3) 6px 12px)",
    border: "#4a4",
    handle: "#5d5",
    label: "Lücke",
  },
  bridge: {
    bgSolid: "rgba(80, 130, 220, 0.45)",
    bgHatched:
      "repeating-linear-gradient(45deg, rgba(80,130,220,0.55) 0 6px, rgba(80,130,220,0.3) 6px 12px)",
    border: "#46c",
    handle: "#69e",
    label: "Brücke",
  },
};

/** Liefert pro Cut sein Anzeige-Label und ob es ein Trim-Edge ist. */
function classifyCuts(
  cuts: CutRange[],
  totalPoints: number,
): Array<CutRange & { label: string; trimStart: boolean; trimEnd: boolean }> {
  const sorted = [...cuts].sort((a, b) => a.start - b.start);
  let cutCounter = 0;
  return sorted.map((r) => {
    const trimStart = r.start === 0;
    const trimEnd = r.end === totalPoints - 1;
    let label: string;
    if (trimStart && trimEnd) label = "Trim Alles";
    else if (trimStart) label = "Trim Start";
    else if (trimEnd) label = "Trim Ende";
    else {
      cutCounter += 1;
      label = `${MODE_STYLES[r.mode].label} ${cutCounter}`;
    }
    return { ...r, label, trimStart, trimEnd };
  });
}

// ---------------------------------------------------------------------------
// Hauptkomponente
// ---------------------------------------------------------------------------

export function RangeSelector({ totalPoints, activeIdx, api }: Props) {
  const trackRef = useRef<HTMLDivElement | null>(null);

  /** Bildschirm-X → Track-Index (clamped). */
  const xToIdx = useCallback(
    (clientX: number): number => {
      const el = trackRef.current;
      if (!el) return 0;
      const rect = el.getBoundingClientRect();
      const px = clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, px / rect.width));
      return Math.round(ratio * (totalPoints - 1));
    },
    [totalPoints],
  );

  const handleAdd = useCallback(() => {
    api.addRange(activeIdx, totalPoints);
  }, [api, activeIdx, totalPoints]);

  const canAdd = api.canAddRange(activeIdx, totalPoints);

  const labelled = useMemo(
    () => classifyCuts(api.ranges, totalPoints),
    [api.ranges, totalPoints],
  );

  const middleCutCount = labelled.filter((r) => !r.trimStart && !r.trimEnd).length;
  const hasAnyCut = labelled.length > 0;

  return (
    <div style={containerStyle}>
      <div style={leftCtrlsStyle}>
        <button
          onClick={handleAdd}
          disabled={!canAdd}
          style={{
            ...buttonStyle,
            opacity: canAdd ? 1 : 0.4,
            cursor: canAdd ? "pointer" : "not-allowed",
          }}
          title={
            canAdd
              ? "Cut um aktuelle Slider-Position einfügen"
              : "Keine freie Lücke um die Slider-Position"
          }
        >
          + Cut
        </button>
        {hasAnyCut && (
          <button onClick={api.clearAll} style={buttonStyle} title="Alle Cuts entfernen">
            Reset
          </button>
        )}
        <MiddleModeToggle
          value={api.middleMode}
          onChange={(m) => api.setMiddleMode(m, totalPoints)}
          disabled={middleCutCount === 0}
          title={
            middleCutCount === 0
              ? "Modus für künftige Middle-Cuts (aktuell keine vorhanden)"
              : `Modus für alle ${middleCutCount} Middle-Cut(s)`
          }
        />
      </div>

      <div ref={trackRef} style={trackStyle}>
        {labelled.map((r) => (
          <RangeBar
            key={r.id}
            range={r}
            label={r.label}
            trimStart={r.trimStart}
            trimEnd={r.trimEnd}
            totalPoints={totalPoints}
            onMove={(start, end) => api.updateRange(r.id, { start, end }, totalPoints)}
            onRemove={() => api.removeRange(r.id)}
            xToIdx={xToIdx}
          />
        ))}
      </div>

      <div style={countStyle}>
        {labelled.length === 0 ? (
          <span style={{ color: "#555" }}>keine Cuts</span>
        ) : (
          <span>
            {labelled.length} Cut{labelled.length > 1 ? "s" : ""}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MiddleModeToggle — Pill-Switch „Lücke" ↔ „Zeit verschieben"
// ---------------------------------------------------------------------------

interface MiddleModeToggleProps {
  value: MiddleMode;
  onChange: (m: MiddleMode) => void;
  disabled?: boolean;
  title?: string;
}

function MiddleModeToggle({ value, onChange, disabled, title }: MiddleModeToggleProps) {
  const isGap = value === "gap";
  return (
    <div
      style={{
        ...toggleContainerStyle,
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "default" : "pointer",
      }}
      title={title}
      onClick={() => {
        if (disabled) return;
        onChange(isGap ? "bridge" : "gap");
      }}
    >
      <div
        style={{
          ...toggleKnobStyle,
          left: isGap ? 2 : "calc(50% + 0px)",
          background: isGap ? MODE_STYLES.gap.handle : MODE_STYLES.bridge.handle,
        }}
      />
      <span
        style={{
          ...toggleLabelStyle,
          color: isGap ? "#fff" : "#888",
          fontWeight: isGap ? 600 : 400,
        }}
      >
        Lücke
      </span>
      <span
        style={{
          ...toggleLabelStyle,
          color: !isGap ? "#fff" : "#888",
          fontWeight: !isGap ? 600 : 400,
        }}
      >
        Zeit verschieben
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RangeBar — ein Cut-Balken
// ---------------------------------------------------------------------------

interface RangeBarProps {
  range: CutRange;
  label: string;
  trimStart: boolean;
  trimEnd: boolean;
  totalPoints: number;
  onMove: (start: number, end: number) => void;
  onRemove: () => void;
  xToIdx: (clientX: number) => number;
}

function RangeBar({
  range,
  label,
  trimStart,
  trimEnd,
  totalPoints,
  onMove,
  onRemove,
  xToIdx,
}: RangeBarProps) {
  const [dragging, setDragging] = useState<"start" | "end" | null>(null);

  const leftPct = (range.start / (totalPoints - 1)) * 100;
  const rightPct = (range.end / (totalPoints - 1)) * 100;
  const widthPct = Math.max(0.2, rightPct - leftPct);

  // Aktuelle Werte in Refs spiegeln, damit der Window-PointerMove-Handler immer
  // die neuesten Grenzen sieht, ohne die Listener bei jedem State-Update neu
  // zu binden. Zuweisung im Effekt (nach dem Commit), nicht waehrend des
  // Renders — der Drag-Handler liest die Refs ohnehin erst beim Pointer-Event.
  const rangeRef = useRef(range);
  const onMoveRef = useRef(onMove);
  const xToIdxRef = useRef(xToIdx);
  useEffect(() => {
    rangeRef.current = range;
    onMoveRef.current = onMove;
    xToIdxRef.current = xToIdx;
  });

  const startDrag = useCallback(
    (side: "start" | "end") => (e: React.PointerEvent) => {
      // Kein setPointerCapture — die Window-Listener kuemmern sich um Moves/Ups.
      // Damit ueberlebt der Drag das Verschwinden des Handle-DOM-Knotens (passiert,
      // wenn der Cut gerade zur Trim-Edge wird).
      e.preventDefault();
      e.stopPropagation();
      setDragging(side);
    },
    [],
  );

  useEffect(() => {
    if (!dragging) return;
    const onPointerMove = (e: PointerEvent) => {
      const idx = xToIdxRef.current(e.clientX);
      const r = rangeRef.current;
      if (dragging === "start") onMoveRef.current(idx, r.end);
      else onMoveRef.current(r.start, idx);
    };
    const onPointerUp = () => setDragging(null);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [dragging]);

  const style = MODE_STYLES[range.mode];
  const baseBackground = trimStart || trimEnd ? style.bgHatched : style.bgSolid;

  return (
    <div
      style={{
        position: "absolute",
        left: `${leftPct}%`,
        width: `${widthPct}%`,
        top: 0,
        bottom: 0,
        background: baseBackground,
        borderTop: `1px solid ${style.border}`,
        borderBottom: `1px solid ${style.border}`,
        pointerEvents: "none",
        overflow: "visible",
      }}
    >
      {!trimStart && (
        <div
          onPointerDown={startDrag("start")}
          style={{
            ...handleStyle,
            left: -HANDLE_WIDTH / 2,
            background: dragging === "start" ? "#fff" : style.handle,
          }}
          title={`Start: ${range.start}`}
        />
      )}

      {!trimEnd && (
        <div
          onPointerDown={startDrag("end")}
          style={{
            ...handleStyle,
            right: -HANDLE_WIDTH / 2,
            background: dragging === "end" ? "#fff" : style.handle,
          }}
          title={`Ende: ${range.end}`}
        />
      )}

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 10,
          fontWeight: 700,
          color: "#fff",
          textShadow: "0 1px 2px rgba(0,0,0,0.7)",
          pointerEvents: "none",
          whiteSpace: "nowrap",
          overflow: "hidden",
        }}
        title={`${label} (${range.start}..${range.end}, mode=${range.mode})`}
      >
        {label}
      </div>

      <button
        onClick={onRemove}
        style={{
          position: "absolute",
          top: -8,
          right: -8,
          width: 16,
          height: 16,
          borderRadius: 8,
          background: "#222",
          color: "#fff",
          border: "1px solid #555",
          fontSize: 11,
          cursor: "pointer",
          padding: 0,
          lineHeight: "14px",
          pointerEvents: "auto",
        }}
        title="Diesen Cut entfernen"
      >
        ×
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const containerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "4px 16px",
  background: "#0f0f0f",
  borderTop: "1px solid #2a2a2a",
};

const leftCtrlsStyle: React.CSSProperties = {
  display: "flex",
  gap: 4,
  flexShrink: 0,
  alignItems: "center",
};

const trackStyle: React.CSSProperties = {
  position: "relative",
  flex: 1,
  height: TRACK_HEIGHT,
  background: "#1a1a1a",
  borderRadius: 3,
  border: "1px solid #2a2a2a",
};

const handleStyle: React.CSSProperties = {
  position: "absolute",
  top: -2,
  bottom: -2,
  width: HANDLE_WIDTH,
  cursor: "ew-resize",
  borderRadius: 2,
  pointerEvents: "auto",
  touchAction: "none",
};

const buttonStyle: React.CSSProperties = {
  background: "#333",
  color: "#eee",
  border: "1px solid #444",
  borderRadius: 4,
  padding: "2px 8px",
  fontSize: 11,
  cursor: "pointer",
};

const countStyle: React.CSSProperties = {
  color: "#888",
  fontSize: 11,
  minWidth: 60,
  textAlign: "right",
  flexShrink: 0,
};

const toggleContainerStyle: React.CSSProperties = {
  position: "relative",
  display: "inline-flex",
  alignItems: "center",
  width: 200,
  height: 24,
  marginLeft: 8,
  borderRadius: 12,
  background: "#1a1a1a",
  border: "1px solid #333",
  padding: "0 4px",
  fontSize: 10,
  userSelect: "none",
};

const toggleKnobStyle: React.CSSProperties = {
  position: "absolute",
  top: 2,
  width: "calc(50% - 2px)",
  height: "calc(100% - 4px)",
  borderRadius: 10,
  transition: "left 0.18s cubic-bezier(0.4, 0.0, 0.2, 1), background 0.18s",
  pointerEvents: "none",
};

const toggleLabelStyle: React.CSSProperties = {
  flex: 1,
  textAlign: "center",
  zIndex: 1,
  transition: "color 0.18s, font-weight 0.18s",
};
