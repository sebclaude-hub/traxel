// ---------------------------------------------------------------------------
// chartLayer — rendert ein Karten-Overlay als gedraptes, texturiertes Mesh
// (Port aus gps_viewer/src/layers/chartLayer.ts).
//
// SimpleMeshLayer mit per-Vertex UV (texCoords) + PNG-Textur. Z-Exaggeration
// muss identisch zu Terrain/Track sein, sonst schwebt die Karte.
// ---------------------------------------------------------------------------

import { SimpleMeshLayer } from "@deck.gl/mesh-layers";

import type { DemGrid } from "../types";
import { buildChartMesh, type ChartOverlay } from "./chartMesh";

const TINT: [number, number, number, number] = [255, 255, 255, 255];

export function makeChartLayer(
  chart: ChartOverlay,
  image: ImageBitmap | HTMLImageElement,
  demGrid: DemGrid | null,
  altBase = 0,
  zScale = 1,
) {
  const mesh = buildChartMesh(chart, demGrid, altBase, zScale);

  const deckMesh = {
    attributes: {
      positions: { value: mesh.positions, size: 3 },
      texCoords: { value: mesh.texCoords, size: 2 },
    },
    indices: { value: mesh.indices, size: 1 },
  };

  return new SimpleMeshLayer<{ position: [number, number, number] }>({
    id: `chart-${chart.name}`,
    data: [{ position: [mesh.anchor[0], mesh.anchor[1], 0] }],
    mesh: deckMesh,
    texture: image,
    // clamp-to-edge: UV ausserhalb [0,1] (bei gedrehten Karten) sampelt den
    // transparenten 1px-Rand des Bildes → ausserhalb des Rechtecks transparent.
    textureParameters: {
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    },
    getPosition: (d) => d.position,
    getColor: TINT,
    material: false,
    pickable: false,
    wireframe: false,
  });
}
