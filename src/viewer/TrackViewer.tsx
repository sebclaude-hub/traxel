// ---------------------------------------------------------------------------
// 3D-Track-Viewer: deck.gl-Canvas mit Vorhang, Track-Linie und Hover-Tooltip.
//
// Vereinfachter Port aus gps_viewer/src/components/TrackViewer.tsx fuer den
// Phase-3-Durchstich: ohne Terrain-Mesh, Karten-Overlays, Cut-Hervorhebung,
// Offset-Slider und Satelliten. Die kommen in spaeteren Phasen dazu.
// ---------------------------------------------------------------------------

import { useCallback, useMemo, useRef, useState } from "react";
import DeckGL from "deck.gl";
import { MapView } from "@deck.gl/core";
import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";

import { sampleDem } from "../pipeline/terrain/sample";
import type { ColorMode, DemGrid, TrackData } from "../types";
import { buildCurtainSegments, makeCurtainLayer } from "./curtainLayer";
import { makeTerrainLayer } from "./terrainLayer";
import { makeChartLayer } from "./chartLayer";
import type { ChartOverlay } from "./chartMesh";
import {
  cornerDragToPlacement,
  placementToCorners,
  type ChartPlacement,
} from "./chartPlacement";
import {
  accelerationColor,
  computeRankPositions,
  plasmaColor,
  type Rgba,
} from "./colorMap";
import { computeAcceleration3D, robustSymmetricScale } from "./kinematics";
import { formatAltitude, formatSpeed, formatTimestamp } from "./formatters";

export interface PlacedChart {
  overlay: ChartOverlay;
  image: ImageBitmap | HTMLImageElement;
}

/** Aktuell bearbeitete Karte: Platzierung + Aenderungs-Callback fuer die Griffe. */
export interface EditChart {
  placement: ChartPlacement;
  onChange: (p: ChartPlacement) => void;
}

interface Props {
  track: TrackData;
  dem: DemGrid | null;
  colorMode: ColorMode;
  showCurtain: boolean;
  zScale: number;
  /** Konstanter Hoehen-Versatz des Tracks in echten Metern (Darstellung). */
  zOffset?: number;
  charts?: PlacedChart[];
  editChart?: EditChart | null;
}

interface DeckViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

const FALLBACK: Rgba = [150, 150, 150, 180];

function buildInitialViewState(track: TrackData): DeckViewState {
  const { lon_min, lat_min, lon_max, lat_max } = track.meta.bounds;
  return {
    longitude: (lon_min + lon_max) / 2,
    latitude: (lat_min + lat_max) / 2,
    zoom: 10,
    pitch: 45,
    bearing: 0,
  };
}

/** Min ueber nicht-null-Hoehen, per Schleife (Spread sprengt bei langen Tracks den Stack). */
function minAlt(alts: (number | null)[]): number {
  let min = Infinity;
  for (const a of alts) {
    if (a !== null && a < min) min = a;
  }
  return Number.isFinite(min) ? min : 0;
}

export function TrackViewer({ track, dem, colorMode, showCurtain, zScale, zOffset = 0, charts = [], editChart = null }: Props) {
  const [viewState, setViewState] = useState<DeckViewState>(() =>
    buildInitialViewState(track),
  );

  // Drag-Zustand der Karten-Griffe. baseRef haelt die Platzierung beim
  // Drag-Start fest (stabile Skalierung beim Eck-Griff).
  const [handleDragging, setHandleDragging] = useState(false);
  const dragRef = useRef<{
    kind: "center" | "corner";
    base: ChartPlacement;
    startLon: number;
    startLat: number;
    chartZ: number;
  } | null>(null);

  const altBase = useMemo(() => minAlt(track.points.alt), [track]);
  // z-Versatz (echte Meter) vor der Ueberhoehung → skaliert konsistent mit dem Terrain.
  const exagAlt = useCallback(
    (alt: number | null) => altBase + ((alt ?? altBase) + zOffset - altBase) * zScale,
    [altBase, zScale, zOffset],
  );

  // Die Track-Linie bleibt bei flight/drone auf Speed-Plasma; die Klassen-
  // faerbung passiert nur am Vorhang. Fuer speed/altitude folgt sie dem Modus.
  const trackColorMode: ColorMode =
    colorMode === "flight" || colorMode === "drone" ? "speed" : colorMode;

  // Rang-Position pro Punkt fuer den effektiven Track-Farbmodus.
  const rankPositions = useMemo(() => {
    const values =
      trackColorMode === "altitude" ? track.points.alt : track.points.speed_kmh;
    return computeRankPositions(values);
  }, [track, trackColorMode]);

  // 3D-Beschleunigung pro Punkt (m/s²) + robuste, symmetrische Skala. Daraus
  // accelNorm ∈ [−1,1] fuer die viridis/magma-Farbgebung. Reine Track-Ableitung,
  // daher auf [track] memoisiert (wie rankPositions).
  const { accel, accelNorm } = useMemo(() => {
    const a = computeAcceleration3D(track.points);
    const scale = robustSymmetricScale(a);
    const norm = a.map((v) =>
      v === null ? null : Math.max(-1, Math.min(1, v / scale)),
    );
    return { accel: a, accelNorm: norm };
  }, [track]);

  const curtainSegments = useMemo(
    () => buildCurtainSegments(track, dem, rankPositions, altBase, zScale, accelNorm, zOffset),
    [track, dem, rankPositions, altBase, zScale, accelNorm, zOffset],
  );

  // Track als individuelle, eingefaerbte Segmente. Pro Segment: Rang t (speed/
  // altitude) und normalisierte Beschleunigung accelN (accel), je gemittelt.
  const pathSegments = useMemo(() => {
    const { lon, lat, alt } = track.points;
    const mean2 = (a: number | null, b: number | null): number => {
      const av = a === null || Number.isNaN(a) ? null : a;
      const bv = b === null || Number.isNaN(b) ? null : b;
      if (av === null && bv === null) return NaN;
      if (av === null) return bv as number;
      if (bv === null) return av;
      return (av + bv) / 2;
    };
    const segs: {
      path: [number, number, number][];
      t: number;
      accelN: number;
    }[] = [];
    for (let i = 0; i < lon.length - 1; i++) {
      segs.push({
        path: [
          [lon[i], lat[i], exagAlt(alt[i])],
          [lon[i + 1], lat[i + 1], exagAlt(alt[i + 1])],
        ],
        t: mean2(rankPositions[i], rankPositions[i + 1]),
        accelN: mean2(accelNorm[i], accelNorm[i + 1]),
      });
    }
    return segs;
  }, [track, rankPositions, accelNorm, exagAlt]);

  const layers = useMemo(() => {
    const result = [];

    // Terrain zuerst, damit Vorhang und Track darueber liegen.
    if (dem) result.push(makeTerrainLayer(dem, altBase, zScale));

    // Karten-Overlays auf das Terrain drapen (unter Vorhang/Track).
    for (const c of charts) {
      result.push(makeChartLayer(c.overlay, c.image, dem, altBase, zScale));
    }

    if (showCurtain) result.push(makeCurtainLayer(curtainSegments, colorMode));

    result.push(
      new PathLayer<{ path: [number, number, number][]; t: number; accelN: number }>({
        id: "track-path",
        data: pathSegments,
        getPath: (d) => d.path,
        getColor: (d) =>
          colorMode === "accel"
            ? Number.isNaN(d.accelN)
              ? FALLBACK
              : accelerationColor(d.accelN, 255)
            : Number.isNaN(d.t)
              ? FALLBACK
              : plasmaColor(d.t, 255),
        getWidth: 2,
        widthUnits: "pixels",
        pickable: false,
        updateTriggers: { getColor: [colorMode] },
      }),
    );

    // Unsichtbarer Pickable-Layer fuer den Hover-Tooltip (deck.gl pickt auch
    // bei alpha = 0, weil das Picking eine separate Off-Screen-Pass nutzt).
    result.push(
      new ScatterplotLayer<number>({
        id: "track-pick",
        data: track.points.lat.map((_la, i) => i),
        getPosition: (i) => [
          track.points.lon[i],
          track.points.lat[i],
          exagAlt(track.points.alt[i]),
        ],
        getRadius: 6,
        radiusUnits: "pixels",
        getFillColor: [0, 0, 0, 0],
        pickable: true,
        updateTriggers: { getPosition: [zScale, altBase, zOffset] },
      }),
    );

    // Georeferenzier-Griffe der aktuell bearbeiteten Karte (zuoberst).
    if (editChart) {
      const pl = editChart.placement;
      const tr = placementToCorners(pl).corner_tr;
      const zAt = (lon: number, lat: number) => {
        const terr = dem ? sampleDem(dem, lon, lat) ?? 0 : 0;
        return altBase + (terr - altBase) * zScale + 60; // ueber der Karte
      };
      const handles = [
        { kind: "center", position: [pl.centerLon, pl.centerLat, zAt(pl.centerLon, pl.centerLat)], color: [230, 80, 230, 255] },
        { kind: "corner", position: [tr[0], tr[1], zAt(tr[0], tr[1])], color: [255, 220, 40, 255] },
      ];
      result.push(
        new ScatterplotLayer<{ kind: string; position: number[]; color: number[] }>({
          id: "chart-handles",
          data: handles,
          getPosition: (d) => d.position as [number, number, number],
          getFillColor: (d) => d.color as [number, number, number, number],
          getRadius: 13,
          radiusUnits: "pixels",
          stroked: true,
          getLineColor: [255, 255, 255, 255],
          lineWidthMinPixels: 2,
          pickable: true,
          // Immer obenauf, damit die Griffe nicht hinter Terrain-Graten
          // verschwinden (und gut greifbar bleiben).
          parameters: { depthCompare: "always" },
          updateTriggers: { getPosition: [editChart, zScale, altBase, dem] },
        }),
      );
    }

    return result;
  }, [dem, charts, curtainSegments, pathSegments, showCurtain, colorMode, track, exagAlt, zScale, altBase, editChart]);

  // deck.gl-Callback-Typen (ViewStateChangeParameters/PickingInfo) passen nicht
  // auf eine handgeschnittene Form — wie im Ursprungs-Viewer `any`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleViewStateChange = useCallback(
    ({ viewState: vs }: any) => setViewState(vs as DeckViewState),
    [],
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const getTooltip = useCallback(
    (info: any) => {
      if (!info || info.layer?.id !== "track-pick") return null;
      const idx = info.object as number | undefined;
      if (idx === undefined || idx === null) return null;

      const ts = track.points.timestamp_ms[idx];
      const speed = track.points.speed_kmh[idx] ?? null;
      const alt = track.points.alt[idx] ?? null;
      const above = track.points.above_terrain[idx] ?? null;
      const a = accel[idx] ?? null;

      const lines: string[] = [];
      if (ts) lines.push(formatTimestamp(ts));
      lines.push(formatSpeed(speed));
      lines.push(`MSL ${formatAltitude(alt)}`);
      if (above !== null) lines.push(`üG ${Math.round(above)} m`);
      if (a !== null && Number.isFinite(a)) {
        // 3D-Tangentialbeschleunigung; Vorzeichen: + schneller, − langsamer.
        lines.push(`Beschl. ${a >= 0 ? "+" : "−"}${Math.abs(a).toFixed(1)} m/s²`);
      }

      return {
        html: lines.map((l) => `<div>${l}</div>`).join(""),
        style: {
          background: "rgba(20, 20, 28, 0.92)",
          color: "#eee",
          fontSize: "11px",
          fontFamily: "system-ui, sans-serif",
          padding: "6px 8px",
          borderRadius: "4px",
          border: "1px solid rgba(255,255,255,0.15)",
        },
      };
    },
    [track, accel],
  );

  // Cursor auf die Karten-Hoehe zurueckprojizieren (statt z=0) — sonst springt
  // die Karte in der gekippten Ansicht weit weg. Fallback: info.coordinate.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const groundAt = useCallback((info: any, z: number): [number, number] | null => {
    if (info?.viewport && typeof info.x === "number" && typeof info.y === "number") {
      try {
        const c = info.viewport.unproject([info.x, info.y], { targetZ: z });
        if (c && Number.isFinite(c[0]) && Number.isFinite(c[1])) return [c[0], c[1]];
      } catch {
        /* Fallback unten */
      }
    }
    return info?.coordinate ? [info.coordinate[0], info.coordinate[1]] : null;
  }, []);

  // Drag der Karten-Griffe (auf DeckGL-Ebene; true zurueckgeben stoppt das Pan).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onDragStart = useCallback(
    (info: any) => {
      if (!editChart || !info?.object || info.layer?.id !== "chart-handles") return false;
      const base = editChart.placement;
      const terr = dem ? sampleDem(dem, base.centerLon, base.centerLat) ?? 0 : 0;
      const chartZ = altBase + (terr - altBase) * zScale;
      const start = groundAt(info, chartZ);
      if (!start) return false;
      dragRef.current = {
        kind: info.object.kind,
        base,
        startLon: start[0],
        startLat: start[1],
        chartZ,
      };
      setHandleDragging(true);
      return true;
    },
    [editChart, dem, altBase, zScale, groundAt],
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onDrag = useCallback(
    (info: any) => {
      const d = dragRef.current;
      if (!d || !editChart) return false;
      const coord = groundAt(info, d.chartZ);
      if (!coord) return false;
      const [lon, lat] = coord;
      if (d.kind === "center") {
        // Per Delta verschieben (robust gegen Rest-Versatz der Projektion).
        editChart.onChange({
          ...d.base,
          centerLon: d.base.centerLon + (lon - d.startLon),
          centerLat: d.base.centerLat + (lat - d.startLat),
        });
      } else {
        editChart.onChange(cornerDragToPlacement(d.base, lon, lat));
      }
      return true;
    },
    [editChart, groundAt],
  );
  const onDragEnd = useCallback(() => {
    dragRef.current = null;
    setHandleDragging(false);
  }, []);

  return (
    <DeckGL
      views={new MapView({ id: "map", repeat: false })}
      viewState={viewState}
      controller={{ dragRotate: true, touchRotate: true, dragPan: !handleDragging }}
      layers={layers}
      onViewStateChange={handleViewStateChange}
      onDragStart={onDragStart}
      onDrag={onDrag}
      onDragEnd={onDragEnd}
      getTooltip={getTooltip}
      style={{ position: "relative", width: "100%", height: "100%" }}
    >
      <div
        style={{
          position: "absolute",
          bottom: 8,
          right: 8,
          color: "#aaa",
          fontSize: 11,
          pointerEvents: "none",
        }}
      >
        {track.meta.name} · {track.meta.n_points} Punkte
      </div>
    </DeckGL>
  );
}
