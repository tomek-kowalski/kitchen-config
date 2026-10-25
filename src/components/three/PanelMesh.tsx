"use client";

import { Edges } from "@react-three/drei";
import type { PanelPart } from "@/domain/geometry/types";
import { getMaterialAppearance } from "./materialAppearance";
import { mmToM } from "./units";

interface PanelMeshProps {
  panel: PanelPart;
}

/**
 * Renders one panel as a unit BoxGeometry scaled to the panel's size, so dimension
 * changes only update transforms and never reallocate GPU buffers.
 * Geometry and material are owned by R3F and disposed automatically on unmount.
 */
export function PanelMesh({ panel }: PanelMeshProps) {
  const { dimensions: size, position: min } = panel;
  // Changing the finish only updates material uniforms; geometry and the canvas are untouched.
  const appearance = getMaterialAppearance(panel.materialId);

  return (
    <mesh
      name={panel.id}
      // BoxGeometry is centered on its origin; domain positions are minimum corners.
      position={[mmToM(min.x + size.width / 2), mmToM(min.y + size.height / 2), mmToM(min.z + size.depth / 2)]}
      scale={[mmToM(size.width), mmToM(size.height), mmToM(size.depth)]}
      castShadow
      receiveShadow
    >
      <boxGeometry />
      <meshStandardMaterial color={appearance.color} roughness={appearance.roughness} />
      <Edges color={appearance.edgeColor} />
    </mesh>
  );
}
