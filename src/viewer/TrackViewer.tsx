// ---------------------------------------------------------------------------
// 3D-Track-Viewer: deck.gl-Canvas mit Vorhang, Track-Linie und Hover-Tooltip.
//
// Unterstuetzt das gleichzeitige Anzeigen MEHRERER Tracks (Vergleich): alle
// Tracks teilen sich Kamera, Terrain, Karten UND die Farbskala. Die geteilte
// Skala ist entscheidend — nur so bedeutet eine Farbe auf beiden Tracks
// denselben Wert (z.B. dieselbe Geschwindigkeit) und der Vergleich ist direkt
// ablesbar. Quantil-Modi (Tempo/Hoehe/Energie) nutzen gemeinsame breaks ueber
// die kombinierten Werte, signierte Modi (Beschl./ΔEnergie) einen gemeinsamen
// robusten Scale; Flug/Drohne sind regelbasiert und ohnehin absolut.
// ---------------------------------------------------------------------------

import { useCallback, useMemo, useRef, useState } from "react";
import DeckGL from "deck.gl";
import { MapView } from "@deck.gl/core";
import { LineLayer, PathLayer, ScatterplotLayer } from "@deck.gl/layers";

import { sampleDem } from "../pipeline/terrain/sample";
import type { ColorMode, DemGrid, TrackData } from "../types";
import { buildCurtainSegments, makeCurtainLayer } from "./curtainLayer";
import { gridToMesh } from "./demMesh";
import { makeTerrainLayer, makeSatelliteLayer } from "./terrainLayer";
import { makeChartLayer } from "./chartLayer";
import type { ChartOverlay } from "./chartMesh";
import type { SatelliteImage } from "../pipeline/terrain/satellite";
import {
  cornerDragToPlacement,
  placementToCorners,
  type ChartPlacement,
} from "./chartPlacement";
import {
  accelerationColor,
  plasmaColor,
  quantileLinearPositions,
  type Rgba,
} from "./colorMap";
import {
  computeAcceleration3D,
  computeEnergyRate,
  robustSymmetricScale,
  type AccelDecomp,
} from "./kinematics";
import { colorScaleFor, combinedBreaks } from "./colorScale";
import { formatAltitude, formatSpeed, formatTimestamp } from "./formatters";

export interface PlacedChart {
  overlay: ChartOverlay;
  image: ImageBitmap | HTMLImageElement;
}

export interface EditChart {
  placement: ChartPlacement;
  onChange: (p: ChartPlacement) => void;
}

interface Props {
  /** Ein oder mehrere Tracks. Beim Vergleich teilen sich alle eine Farbskala. */
  tracks: TrackData[];
  dem: DemGrid | null;
  colorMode: ColorMode;
  showCurtain: boolean;
  zScale: number;
  /**
   * Versatz des DEM in echten Metern — verschiebt Terrain, Karten und
   * Satellitenbilder gemeinsam nach oben/unten; der GPS-Track bleibt
   * unveraendert (er ist Grundwahrheit). Korrigiert z.B. den Ellipsoid-/
   * Geoid-Versatz zwischen SkyDemon-GPS (WGS-84-ellipsoidisch) und DEM (NN).
   */
  zOffset?: number;
  /** Hypsometrisches Terrain rendern. */
  showTerrain?: boolean;
  /** Satellitenbild auf dem DEM draped rendern (liegt unter Anflugkarten). */
  satelliteImage?: SatelliteImage | null;
  charts?: PlacedChart[];
  editChart?: EditChart | null;
  /**
   * Beschleunigungs-Zerlegung des PRIMAEREN Tracks (tracks[0]) pro Punkt. Wird
   * in App berechnet (decomposeAcceleration) und sowohl fuer die Pfeile am
   * aktiven Punkt als auch im Tooltip verwendet. null = G-Vektor-Modus aus.
   */
  accelDecomp?: (AccelDecomp | null)[] | null;
  /** Aktiver Punkt (Slider/Wiedergabe) — dort werden die Pfeile gezeichnet. */
  activeIdx?: number;
  /** Pfeile (laengs/quer/vertikal) am aktiven Punkt anzeigen. */
  showAccelArrows?: boolean;
}

interface DeckViewState {
  longitude: number;
  latitude: number;
  zoom: number;
  pitch: number;
  bearing: number;
}

const FALLBACK: Rgba = [150, 150, 150, 180];

// G-Vektor-Pfeile: feste Laenge in Metern je 1 m/s² (kein Regler — die Pfeile
// werden ohnehin erst im hineingezoomten Zustand gut sichtbar). Empirisch am
// GA-Flug getunt: die kinematischen Beschleunigungen sind dort klein (oft
// < 1 m/s²), 20 m/(m/s²) waren kaum sichtbar → Faktor 20 hoeher. Sehr dynamische
// Quellen (Motorrad, ~8 m/s²) wuerden hiermit lange Pfeile erzeugen; falls noetig
// spaeter quellenabhaengig skalieren. Farben: laengs=gruen, quer=orange,
// vertikal=blau, Aktiv-Marker weiss.
const ARROW_M_PER_MS2 = 400;
const COL_LONG: Rgba = [80, 210, 120, 255];
const COL_LAT: Rgba = [240, 150, 40, 255];
const COL_VERT: Rgba = [80, 150, 240, 255];
const COL_ACTIVE: Rgba = [255, 255, 255, 255];

// Anfangskamera ueber die Vereinigung aller Track-Bounds (zentriert beide).
function buildInitialViewState(tracks: TrackData[]): DeckViewState {
  let lonMin = Infinity, lonMax = -Infinity, latMin = Infinity, latMax = -Infinity;
  for (const t of tracks) {
    const b = t.meta.bounds;
    if (b.lon_min < lonMin) lonMin = b.lon_min;
    if (b.lon_max > lonMax) lonMax = b.lon_max;
    if (b.lat_min < latMin) latMin = b.lat_min;
    if (b.lat_max > latMax) latMax = b.lat_max;
  }
  return {
    longitude: (lonMin + lonMax) / 2,
    latitude: (latMin + latMax) / 2,
    zoom: 10,
    pitch: 45,
    bearing: 0,
  };
}

function minAlt(alts: (number | null)[]): number {
  let min = Infinity;
  for (const a of alts) {
    if (a !== null && a < min) min = a;
  }
  return min;
}

/** Mittelt zwei Werte null/NaN-sicher; beide fehlen → NaN. */
function mean2(a: number | null, b: number | null): number {
  const av = a === null || Number.isNaN(a) ? null : a;
  const bv = b === null || Number.isNaN(b) ? null : b;
  if (av === null && bv === null) return NaN;
  if (av === null) return bv as number;
  if (bv === null) return av;
  return (av + bv) / 2;
}

export function TrackViewer({
  tracks,
  dem,
  colorMode,
  showCurtain,
  zScale,
  zOffset = 0,
  showTerrain = true,
  satelliteImage = null,
  charts = [],
  editChart = null,
  accelDecomp = null,
  activeIdx = 0,
  showAccelArrows = false,
}: Props) {
  // Anfangskamera nur einmal aus dem ERSTEN Track-Set ableiten. Ein spaeter
  // hinzukommender Vergleichstrack veraendert die Kamera nicht (der Nutzer
  // kann frei navigieren) — bewusst, um die Ansicht nicht zu "springen".
  const [viewState, setViewState] = useState<DeckViewState>(() =>
    buildInitialViewState(tracks),
  );

  const [handleDragging, setHandleDragging] = useState(false);
  const dragRef = useRef<{
    kind: "center" | "corner";
    base: ChartPlacement;
    startLon: number;
    startLat: number;
    chartZ: number;
  } | null>(null);

  // Gemeinsamer Hoehen-Anker ueber ALLE Tracks → identische Z-Ueberhoehung.
  const altBase = useMemo(() => {
    let min = Infinity;
    for (const t of tracks) min = Math.min(min, minAlt(t.points.alt));
    return Number.isFinite(min) ? min : 0;
  }, [tracks]);

  // GPS-Track ist Grundwahrheit → kein Versatz auf die Track-Hoehe.
  const exagAlt = useCallback(
    (alt: number | null) => altBase + ((alt ?? altBase) - altBase) * zScale,
    [altBase, zScale],
  );

  const trackColorMode: ColorMode =
    colorMode === "flight" || colorMode === "drone" ? "speed" : colorMode;

  // Pro Track: Farb-Positionen + (signierte) Rohwerte/Normwerte — aber aus
  // EINER geteilten Skala (gemeinsame breaks bzw. gemeinsamer signed-Scale).
  const signedUnit = colorMode === "accel" ? "m/s²" : colorMode === "energy_rate" ? "m/s" : "";
  const perTrack = useMemo(() => {
    const breaks = combinedBreaks(tracks, trackColorMode);
    const rawPerTrack = tracks.map((t) =>
      colorMode === "accel"
        ? computeAcceleration3D(t.points)
        : colorMode === "energy_rate"
          ? computeEnergyRate(t.points)
          : null,
    );
    const hasSigned = rawPerTrack.some((r) => r !== null);
    const signedScale = hasSigned
      ? robustSymmetricScale(rawPerTrack.flatMap((r) => r ?? []))
      : 1;
    return tracks.map((t, k) => {
      const positions = quantileLinearPositions(
        colorScaleFor(t, trackColorMode).values,
        breaks,
      );
      const raw = rawPerTrack[k];
      const signedNorm = raw
        ? raw.map((v) => (v === null ? null : Math.max(-1, Math.min(1, v / signedScale))))
        : null;
      return { positions, signedRaw: raw, signedNorm };
    });
    // trackColorMode haengt deterministisch an colorMode → colorMode genuegt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracks, colorMode]);

  const curtainsPerTrack = useMemo(
    () =>
      tracks.map((t, k) =>
        buildCurtainSegments(
          t,
          dem,
          perTrack[k].positions,
          altBase,
          zScale,
          perTrack[k].signedNorm,
          zOffset,
        ),
      ),
    [tracks, dem, perTrack, altBase, zScale, zOffset],
  );

  const pathsPerTrack = useMemo(
    () =>
      tracks.map((t, k) => {
        const { lon, lat, alt } = t.points;
        const positions = perTrack[k].positions;
        const signedNorm = perTrack[k].signedNorm;
        const segs: { path: [number, number, number][]; t: number; signedN: number }[] = [];
        for (let i = 0; i < lon.length - 1; i++) {
          segs.push({
            path: [
              [lon[i], lat[i], exagAlt(alt[i])],
              [lon[i + 1], lat[i + 1], exagAlt(alt[i + 1])],
            ],
            t: mean2(positions[i], positions[i + 1]),
            signedN: signedNorm ? mean2(signedNorm[i], signedNorm[i + 1]) : NaN,
          });
        }
        return segs;
      }),
    [tracks, perTrack, exagAlt],
  );

  // DEM-Mesh: einmal berechnet, von Terrain-, Satelliten- und Chart-Layer geteilt.
  // demOffset = zOffset verschiebt alle DEM-basierten Layer gemeinsam.
  const demMesh = useMemo(
    () => (dem ? gridToMesh(dem, altBase, zScale, zOffset) : null),
    [dem, altBase, zScale, zOffset],
  );

  const isSigned = colorMode === "accel" || colorMode === "energy_rate";

  const layers = useMemo(() => {
    const result = [];

    // 1. Hypsometrisches Terrain (unterste Ebene).
    if (demMesh && showTerrain) result.push(makeTerrainLayer(demMesh));

    // 2. Satellitenbild: liegt ueber dem Terrain, aber unter Anflugkarten.
    if (demMesh && dem && satelliteImage) {
      result.push(makeSatelliteLayer(demMesh, dem, satelliteImage.image, satelliteImage.bounds));
    }

    // 3. Anflugkarten (draped auf dem DEM mit demOffset).
    for (const c of charts) {
      result.push(makeChartLayer(c.overlay, c.image, dem, altBase, zScale, zOffset));
    }

    // 4. Vorhang und Track — je Track eigene Layer (eindeutige IDs).
    tracks.forEach((t, k) => {
      if (showCurtain) result.push(makeCurtainLayer(curtainsPerTrack[k], colorMode, `curtain-${k}`));

      result.push(
        new PathLayer<{ path: [number, number, number][]; t: number; signedN: number }>({
          id: `track-path-${k}`,
          data: pathsPerTrack[k],
          getPath: (d) => d.path,
          getColor: (d) =>
            isSigned
              ? Number.isNaN(d.signedN)
                ? FALLBACK
                : accelerationColor(d.signedN, 255)
              : Number.isNaN(d.t)
                ? FALLBACK
                : plasmaColor(d.t, 255),
          getWidth: 2,
          widthUnits: "pixels",
          pickable: false,
          updateTriggers: { getColor: [colorMode] },
        }),
      );

      result.push(
        new ScatterplotLayer<number>({
          id: `track-pick-${k}`,
          data: t.points.lat.map((_la, i) => i),
          getPosition: (i) => [t.points.lon[i], t.points.lat[i], exagAlt(t.points.alt[i])],
          getRadius: 6,
          radiusUnits: "pixels",
          getFillColor: [0, 0, 0, 0],
          pickable: true,
          updateTriggers: { getPosition: [zScale, altBase] },
        }),
      );
    });

    // 4b. G-Vektor: Aktiv-Marker + Komponenten-Pfeile am aktiven Punkt des
    // primaeren Tracks. Vertikalkomponente wird mit zScale ueberhoeht wie die
    // Szene; horizontale Pfeile bleiben in echten Metern. depthCompare 'always'
    // → immer obenauf.
    if (showAccelArrows && accelDecomp && tracks[0]) {
      const tp = tracks[0].points;
      const i = activeIdx;
      if (i >= 0 && i < tp.lat.length) {
        const lon = tp.lon[i];
        const lat = tp.lat[i];
        const z = exagAlt(tp.alt[i]);
        result.push(
          new ScatterplotLayer<number>({
            id: "accel-active",
            data: [0],
            getPosition: () => [lon, lat, z],
            getRadius: 7,
            radiusUnits: "pixels",
            getFillColor: COL_ACTIVE,
            stroked: true,
            getLineColor: [0, 0, 0, 255],
            lineWidthMinPixels: 1,
            pickable: false,
            parameters: { depthCompare: "always" },
            updateTriggers: { getPosition: [i, zScale, altBase, tracks] },
          }),
        );
        const d = accelDecomp[i];
        const mPerDegLon = 111320 * Math.cos((lat * Math.PI) / 180);
        const target = (oe: number, on: number, ou: number): [number, number, number] => [
          lon + oe / mPerDegLon,
          lat + on / 111320,
          z + ou * zScale,
        ];
        // Pfeile immer als Array fester Laenge — leeres Array wenn kein Wert,
        // damit deck.gl den Layer updaten kann statt ihn zu zerstoeren/neu anlegen.
        const S = ARROW_M_PER_MS2;
        const arrows: { color: Rgba; target: [number, number, number] }[] = d
          ? [
              { color: COL_LONG, target: target(d.long * S * d.headingE, d.long * S * d.headingN, 0) },
              { color: COL_LAT, target: target(d.lateral * S * -d.headingN, d.lateral * S * d.headingE, 0) },
              { color: COL_VERT, target: target(0, 0, d.vertical * S) },
            ]
          : [];
        result.push(
          new LineLayer<{ color: Rgba; target: [number, number, number] }>({
            id: "accel-arrows",
            data: arrows,
            getSourcePosition: () => [lon, lat, z],
            getTargetPosition: (a) => a.target,
            getColor: (a) => a.color,
            getWidth: 3,
            widthUnits: "pixels",
            pickable: false,
            parameters: { depthCompare: "always" },
            updateTriggers: { getSourcePosition: [i, zScale, altBase], getTargetPosition: [i, zScale, accelDecomp] },
          }),
        );
        result.push(
          new ScatterplotLayer<{ color: Rgba; target: [number, number, number] }>({
            id: "accel-tips",
            data: arrows,
            getPosition: (a) => a.target,
            getRadius: 4,
            radiusUnits: "pixels",
            getFillColor: (a) => a.color,
            pickable: false,
            parameters: { depthCompare: "always" },
            updateTriggers: { getPosition: [i, zScale, accelDecomp] },
          }),
        );
      }
    }

    // 5. Chart-Griffe (immer zuoberst).
    if (editChart) {
      const pl = editChart.placement;
      const tr = placementToCorners(pl).corner_tr;
      // Griff-Z auf verschobenem DEM (demOffset einrechnen).
      const zAt = (lon: number, lat: number) => {
        const terr = dem ? sampleDem(dem, lon, lat) ?? 0 : 0;
        return altBase + (terr + zOffset - altBase) * zScale + 60;
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
          parameters: { depthCompare: "always" },
          updateTriggers: { getPosition: [editChart, zScale, altBase, dem, zOffset] },
        }),
      );
    }

    return result;
  }, [demMesh, showTerrain, satelliteImage, dem, charts, tracks, curtainsPerTrack, pathsPerTrack, showCurtain, colorMode, isSigned, exagAlt, zScale, altBase, zOffset, editChart, showAccelArrows, accelDecomp, activeIdx]);

  const handleViewStateChange = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ({ viewState: vs }: any) => setViewState(vs as DeckViewState),
    [],
  );

  const getTooltip = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (info: any) => {
      const id: string | undefined = info?.layer?.id;
      if (!id || !id.startsWith("track-pick-")) return null;
      const tIdx = Number(id.slice("track-pick-".length));
      const track = tracks[tIdx];
      if (!track) return null;
      const idx = info.object as number | undefined;
      if (idx === undefined || idx === null) return null;

      const ts = track.points.timestamp_ms[idx];
      const speed = track.points.speed_kmh[idx] ?? null;
      const alt = track.points.alt[idx] ?? null;
      const above = track.points.above_terrain[idx] ?? null;
      const sr = perTrack[tIdx]?.signedRaw ? (perTrack[tIdx].signedRaw![idx] ?? null) : null;

      const lines: string[] = [];
      // Bei mehreren Tracks: Trackname als erste Zeile zur Zuordnung.
      if (tracks.length > 1) lines.push(`<b>${track.meta.name}</b>`);
      if (ts) lines.push(formatTimestamp(ts));
      lines.push(formatSpeed(speed));
      lines.push(`MSL ${formatAltitude(alt)}`);
      if (above !== null) lines.push(`üG ${Math.round(above)} m`);
      if (sr !== null && Number.isFinite(sr)) {
        const lbl = colorMode === "accel" ? "Beschl." : "ΔEnergie";
        lines.push(`${lbl} ${sr >= 0 ? "+" : "−"}${Math.abs(sr).toFixed(1)} ${signedUnit}`);
      }

      // G-Vektor-Zerlegung (nur primaerer Track, nur wenn aktiv).
      if (tIdx === 0 && accelDecomp) {
        const d = accelDecomp[idx];
        if (d) {
          const sgn = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`;
          const mag = Math.hypot(d.long, d.lateral, d.vertical);
          lines.push(`a ${mag.toFixed(1)} m/s²`);
          lines.push(`längs ${sgn(d.long)} · quer ${sgn(d.lateral)} · vert ${sgn(d.vertical)}`);
        }
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
    [tracks, perTrack, signedUnit, colorMode, accelDecomp],
  );

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onDragStart = useCallback(
    (info: any) => {
      if (!editChart || !info?.object || info.layer?.id !== "chart-handles") return false;
      const base = editChart.placement;
      const terr = dem ? sampleDem(dem, base.centerLon, base.centerLat) ?? 0 : 0;
      const chartZ = altBase + (terr + zOffset - altBase) * zScale;
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
    [editChart, dem, altBase, zScale, zOffset, groundAt],
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

  const footer =
    tracks.length > 1
      ? tracks.map((t) => t.meta.name).join("  vs  ")
      : `${tracks[0].meta.name} · ${tracks[0].meta.n_points} Punkte`;

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
        {footer}
      </div>
    </DeckGL>
  );
}
