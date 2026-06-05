// ---------------------------------------------------------------------------
// Terrain-Layer und Satelliten-Layer (beide draped auf dem DEM-Mesh).
//
// makeTerrainLayer: hypsometrische Faerbung per Vertex-Farben.
// makeSatelliteLayer: Esri-Satellitenbild als Textur auf denselben Vertices.
//
// Beide nehmen ein vorberechnetes DemMesh entgegen, das im TrackViewer per
// useMemo gecacht wird — so wird gridToMesh() nur einmal pro DEM/zScale/
// demOffset-Aenderung aufgerufen.
// ---------------------------------------------------------------------------

import { SimpleMeshLayer } from "@deck.gl/mesh-layers";

import type { DemGrid } from "../types";
import type { DemMesh } from "./demMesh";
import type { SatBounds } from "../pipeline/terrain/satellite";

/** Hypsometrisches Terrain mit Vertex-Farben aus gridToMesh. */
export function makeTerrainLayer(mesh: DemMesh) {
  const deckMesh = {
    attributes: {
      positions: { value: mesh.positions, size: 3 },
      colors: { value: mesh.colors, size: 4, normalized: true },
    },
    indices: { value: mesh.indices, size: 1 },
  };

  return new SimpleMeshLayer<{ position: [number, number, number] }>({
    id: "terrain",
    data: [{ position: [mesh.anchor[0], mesh.anchor[1], 0] }],
    mesh: deckMesh,
    getPosition: (d) => d.position,
    getColor: [180, 168, 140, 220],
    material: false,
    pickable: false,
    wireframe: false,
  });
}

/**
 * Satellitenbilder als Textur auf den exakt gleichen DEM-Vertices.
 * UV-Berechnung: DEM-Gitter-Position → Bildkoordinate basierend auf der
 * geographischen Ausdehnung des Kachel-Mosaiks (satBounds).
 *
 * Weil die Vertices identisch mit dem Terrain sind, gibt es konstruktions-
 * bedingt kein Z-Fighting zwischen Terrain- und Satelliten-Layer.
 */
export function makeSatelliteLayer(
  mesh: DemMesh,
  dem: DemGrid,
  image: ImageBitmap,
  sat: SatBounds,
) {
  const { n_rows, n_cols, lat_min, lat_max, lon_min, lon_max } = dem;
  const satLonSpan = sat.lon_max - sat.lon_min || 1;
  const satLatSpan = sat.lat_max - sat.lat_min || 1;

  // UV pro Vertex: u = west→east, v = nord-oben (v=0 = Norden, v=1 = Sueden).
  const texCoords = new Float32Array(n_rows * n_cols * 2);
  let tIdx = 0;
  for (let r = 0; r < n_rows; r++) {
    const lat = lat_min + (r / Math.max(n_rows - 1, 1)) * (lat_max - lat_min);
    for (let c = 0; c < n_cols; c++) {
      const lon = lon_min + (c / Math.max(n_cols - 1, 1)) * (lon_max - lon_min);
      texCoords[tIdx++] = (lon - sat.lon_min) / satLonSpan;
      texCoords[tIdx++] = 1 - (lat - sat.lat_min) / satLatSpan;
    }
  }

  const deckMesh = {
    attributes: {
      positions: { value: mesh.positions, size: 3 },
      texCoords: { value: texCoords, size: 2 },
    },
    indices: { value: mesh.indices, size: 1 },
  };

  return new SimpleMeshLayer<{ position: [number, number, number] }>({
    id: "satellite",
    data: [{ position: [mesh.anchor[0], mesh.anchor[1], 0] }],
    mesh: deckMesh,
    texture: image,
    textureParameters: {
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    },
    getPosition: (d) => d.position,
    getColor: [255, 255, 255, 255],
    material: false,
    pickable: false,
    wireframe: false,
  });
}
