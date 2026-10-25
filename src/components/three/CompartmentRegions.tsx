"use client";

import { Edges } from "@react-three/drei";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import { calculateCompartmentBounds } from "@/domain/compartments/layout";
import type { BoxMm, CompartmentId } from "@/domain/compartments/types";
import { useConfiguratorStore } from "@/store/useConfiguratorStore";
import { mmToM } from "./units";

const HIGHLIGHT_COLOR = "#2563eb";
/** Pixels the pointer may travel between down and up and still count as a click (not an orbit drag). */
const CLICK_TOLERANCE_PX = 4;
/** Regions are shrunk slightly so their faces never coincide with panel faces. */
const INSET_MM = 1.5;

function boxTransform({ position: p, dimensions: d }: BoxMm) {
  const w = Math.max(d.width - 2 * INSET_MM, 1);
  const h = Math.max(d.height - 2 * INSET_MM, 1);
  const dz = Math.max(d.depth - 2 * INSET_MM, 1);
  return {
    position: [mmToM(p.x + d.width / 2), mmToM(p.y + d.height / 2), mmToM(p.z + d.depth / 2)] as const,
    scale: [mmToM(w), mmToM(h), mmToM(dz)] as const,
  };
}

interface HitRegionProps {
  id: CompartmentId;
  bounds: BoxMm;
  hovered: boolean;
  onHover: (id: CompartmentId | null) => void;
}

/** Invisible box over a leaf compartment that receives pointer events. */
function HitRegion({ id, bounds, hovered, onHover }: HitRegionProps) {
  const select = useConfiguratorStore((state) => state.selectCompartment);
  const { position, scale } = boxTransform(bounds);

  return (
    <mesh
      position={position}
      scale={scale}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        if (event.delta > CLICK_TOLERANCE_PX) return;
        event.stopPropagation();
        select(id);
      }}
      onPointerOver={(event) => {
        event.stopPropagation();
        onHover(id);
      }}
      onPointerOut={() => onHover(null)}
    >
      <boxGeometry />
      <meshBasicMaterial color={HIGHLIGHT_COLOR} transparent opacity={hovered ? 0.08 : 0} depthWrite={false} />
    </mesh>
  );
}

/** Compartments are logical volumes: leaves get hit regions, the selection gets a highlight box. */
export function CompartmentRegions() {
  const configuration = useConfiguratorStore((state) => state.configuration);
  const selectedId = useConfiguratorStore((state) => state.selectedCompartmentId);
  const layouts = useMemo(() => calculateCompartmentBounds(configuration), [configuration]);
  const [hoveredId, setHoveredId] = useState<CompartmentId | null>(null);
  const get = useThree((state) => state.get);

  useEffect(() => {
    const canvas = get().gl.domElement;
    canvas.style.cursor = hoveredId ? "pointer" : "";
    return () => {
      canvas.style.cursor = "";
    };
  }, [get, hoveredId]);

  const selected = layouts.find((layout) => layout.id === selectedId);
  const highlight = selected && boxTransform(selected.bounds);

  return (
    <>
      {layouts
        .filter((layout) => layout.isLeaf)
        .map((layout) => (
          <HitRegion
            key={layout.id}
            id={layout.id}
            bounds={layout.bounds}
            hovered={hoveredId === layout.id && hoveredId !== selectedId}
            onHover={setHoveredId}
          />
        ))}
      {highlight && (
        <mesh position={highlight.position} scale={highlight.scale} raycast={() => null}>
          <boxGeometry />
          <meshBasicMaterial color={HIGHLIGHT_COLOR} transparent opacity={0.16} depthWrite={false} />
          <Edges color={HIGHLIGHT_COLOR} />
        </mesh>
      )}
    </>
  );
}
