// ---------------------------------------------------------------------------
// 3D-Track-Viewer: deck.gl-Canvas mit Vorhang, Track-Linie und Hover-Tooltip.
//
// Vereinfachter Port aus gps_viewer/src/components/TrackViewer.tsx fuer den
// Phase-3-Durchstich: ohne Terrain-Mesh, Karten-Overlays, Cut-Hervorhebung,
// Offset-Slider und Satelliten. Die kommen in spaeteren Phasen dazu.
// ---------------------------------------------------------------------------

import { useCallback, useMemo, useState } from "react";
import DeckGL from "deck.gl";
import { MapView } from "@deck.gl/core";
import { PathLayer, ScatterplotLayer } from "@deck.gl/layers";

import type { ColorMode, DemGrid, TrackData } from "../types";
import { buildCurtainSegments, makeCurtainLayer } from "./curtainLayer";
import { makeTerrainLayer } from "./terrainLayer";
import { makeChartLayer } from "./chartLayer";
import type { ChartOverlay } from "./chartMesh";
import { computeRankPositions, plasmaColor, type Rgba } from "./colorMap";
import { formatAltitude, formatSpeed, formatTimestamp } from "./formatters";

export interface PlacedChart {
  overlay: ChartOverlay;
  image: ImageBitmap | HTMLImageElement;
}

interface Props {
  track: TrackData;
  dem: DemGrid | null;
  colorMode: ColorMode;
  showCurtain: boolean;
  zScale: number;
  charts?: PlacedChart[];
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

export function TrackViewer({ track, dem, colorMode, showCurtain, zScale, charts = [] }: Props) {
  const [viewState, setViewState] = useState<DeckViewState>(() =>
    buildInitialViewState(track),
  );

  const altBase = useMemo(() => minAlt(track.points.alt), [track]);
  const exagAlt = useCallback(
    (alt: number | null) => altBase + ((alt ?? altBase) - altBase) * zScale,
    [altBase, zScale],
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

  const curtainSegments = useMemo(
    () => buildCurtainSegments(track, dem, rankPositions, altBase, zScale),
    [track, dem, rankPositions, altBase, zScale],
  );

  // Track als individuelle, eingefaerbte Segmente.
  const pathSegments = useMemo(() => {
    const { lon, lat, alt } = track.points;
    const segs: { path: [number, number, number][]; t: number }[] = [];
    for (let i = 0; i < lon.length - 1; i++) {
      const tI = rankPositions[i];
      const tI1 = rankPositions[i + 1];
      let t: number;
      if (Number.isNaN(tI) && Number.isNaN(tI1)) t = NaN;
      else if (Number.isNaN(tI)) t = tI1;
      else if (Number.isNaN(tI1)) t = tI;
      else t = (tI + tI1) / 2;
      segs.push({
        path: [
          [lon[i], lat[i], exagAlt(alt[i])],
          [lon[i + 1], lat[i + 1], exagAlt(alt[i + 1])],
        ],
        t,
      });
    }
    return segs;
  }, [track, rankPositions, exagAlt]);

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
      new PathLayer<{ path: [number, number, number][]; t: number }>({
        id: "track-path",
        data: pathSegments,
        getPath: (d) => d.path,
        getColor: (d) => (Number.isNaN(d.t) ? FALLBACK : plasmaColor(d.t, 255)),
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
        updateTriggers: { getPosition: [zScale, altBase] },
      }),
    );

    return result;
  }, [dem, charts, curtainSegments, pathSegments, showCurtain, colorMode, track, exagAlt, zScale, altBase]);

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

      const lines: string[] = [];
      if (ts) lines.push(formatTimestamp(ts));
      lines.push(formatSpeed(speed));
      lines.push(`MSL ${formatAltitude(alt)}`);
      if (above !== null) lines.push(`üG ${Math.round(above)} m`);

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
    [track],
  );

  return (
    <DeckGL
      views={new MapView({ id: "map", repeat: false })}
      viewState={viewState}
      controller={{ dragRotate: true, touchRotate: true }}
      layers={layers}
      onViewStateChange={handleViewStateChange}
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
