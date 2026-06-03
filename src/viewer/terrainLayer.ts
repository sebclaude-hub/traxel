// ---------------------------------------------------------------------------
// Terrain-Mesh-Layer (Port aus gps_viewer/src/layers/terrainLayer.ts).
//
// SimpleMeshLayer mit vorberechneten Positionen/Indizes aus demMesh.ts.
// Hypsometrische Vertex-Farben, kein Lighting (material=false → flat).
// Nimmt direkt ein DemGrid (kein LOD-Wrapper wie im Original).
// ---------------------------------------------------------------------------

import { SimpleMeshLayer } from "@deck.gl/mesh-layers";

import type { DemGrid } from "../types";
import { gridToMesh } from "./demMesh";

export function makeTerrainLayer(grid: DemGrid, altBase = 0, zScale = 1) {
  const mesh = gridToMesh(grid, altBase, zScale);

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
