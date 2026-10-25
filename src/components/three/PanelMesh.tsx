"use client";

import { Edges } from "@react-three/drei";
import type { ThreeEvent } from "@react-three/fiber";
import type { PanelPart, Vector3Mm } from "@/domain/geometry/types";
import { getMaterialAppearance } from "./materialAppearance";
import { mmToM } from "./units";

/** Pixels the pointer may travel between down and up and still count as a click (not an orbit drag). */
export const CLICK_TOLERANCE_PX = 4;

const ORIGIN: Vector3Mm = { x: 0, y: 0, z: 0 };

interface PanelMeshProps {
  panel: PanelPart;
  /** Position of the parent group in domain millimeters (e.g. a hinge pivot); defaults to the origin. */
  origin?: Vector3Mm;
  /** Makes the panel clickable (used for fronts); orbit drags are ignored. */
  onSelect?: () => void;
}

/**
 * Renders one panel as a unit BoxGeometry scaled to the panel's size, so dimension
 * changes only update transforms and never reallocate GPU buffers.
 * Geometry and material are owned by R3F and disposed automatically on unmount.
 */
export function PanelMesh({ panel, origin = ORIGIN, onSelect }: PanelMeshProps) {
  const { dimensions: size, position: min } = panel;
  // Changing the finish only updates material uniforms; geometry and the canvas are untouched.
  const appearance = getMaterialAppearance(panel.materialId);

  return (
    <mesh
      name={panel.id}
      // BoxGeometry is centered on its origin; domain positions are minimum corners.
      position={[
        mmToM(min.x + size.width / 2 - origin.x),
        mmToM(min.y + size.height / 2 - origin.y),
        mmToM(min.z + size.depth / 2 - origin.z),
      ]}
      scale={[mmToM(size.width), mmToM(size.height), mmToM(size.depth)]}
      castShadow
      receiveShadow
      onClick={
        onSelect &&
        ((event: ThreeEvent<MouseEvent>) => {
          if (event.delta > CLICK_TOLERANCE_PX) return;
          // Stop here so the compartment hit region behind the front does not handle the click too.
          event.stopPropagation();
          onSelect();
        })
      }
    >
      <boxGeometry />
      <meshStandardMaterial color={appearance.color} roughness={appearance.roughness} />
      <Edges color={appearance.edgeColor} />
    </mesh>
  );
}
