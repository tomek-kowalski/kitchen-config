"use client";

import type { ThreeEvent } from "@react-three/fiber";
import type { Vector3Mm } from "@/domain/geometry/types";
import { getHardwareFinish, HANDLE_RULES } from "@/domain/hardware/catalog";
import type { HardwarePart } from "@/domain/hardware/geometry";
import { CLICK_TOLERANCE_PX } from "./PanelMesh";
import { mmToM } from "./units";

const ORIGIN: Vector3Mm = { x: 0, y: 0, z: 0 };
const RECESS_COLOR = "#1b1b1b";

interface HandleMeshProps {
  part: HardwarePart;
  /** Position of the parent group in domain millimetres (e.g. a hinge pivot). */
  origin?: Vector3Mm;
  onSelect?: () => void;
}

/**
 * Generic handle shapes, built in the handle's own frame (centre of its box on the front face,
 * +Z out of the front):
 * - knob: a cylinder tapering to a narrower neck;
 * - bar: a cylinder along the front edge on two cylindrical standoffs;
 * - recessed: a thin dark plate — a visual stand-in for a milled grip, not a real groove.
 */
export function HandleMesh({ part, origin = ORIGIN, onSelect }: HandleMeshProps) {
  const finish = getHardwareFinish(part.finish);
  const { position: p, dimensions: d } = part.box;
  const center: [number, number, number] = [
    mmToM(p.x + d.width / 2 - origin.x),
    mmToM(p.y + d.height / 2 - origin.y),
    mmToM(p.z - origin.z),
  ];
  const material = <meshStandardMaterial color={finish.color} metalness={finish.metalness} roughness={finish.roughness} />;
  const vertical = part.orientation === "vertical";

  const onClick = onSelect
    ? (event: ThreeEvent<MouseEvent>) => {
        if (event.delta > CLICK_TOLERANCE_PX) return;
        event.stopPropagation();
        onSelect();
      }
    : undefined;

  if (part.type === "knob") {
    const { diameter, projection } = HANDLE_RULES.knob;
    return (
      <mesh position={[center[0], center[1], center[2] + mmToM(projection / 2)]} rotation-x={Math.PI / 2} castShadow onClick={onClick}>
        <cylinderGeometry args={[mmToM(diameter / 2), mmToM(diameter / 4), mmToM(projection), 24]} />
        {material}
      </mesh>
    );
  }

  if (part.type === "bar") {
    const { length, diameter, projection } = HANDLE_RULES.bar;
    const standoff = projection - diameter / 2;
    const spacing = length * 0.8;
    return (
      <group position={center} onClick={onClick}>
        <mesh position-z={mmToM(standoff)} rotation-z={vertical ? 0 : Math.PI / 2} castShadow>
          <cylinderGeometry args={[mmToM(diameter / 2), mmToM(diameter / 2), mmToM(length), 16]} />
          {material}
        </mesh>
        {[-1, 1].map((sign) => (
          <mesh
            key={sign}
            position={[vertical ? 0 : mmToM((sign * spacing) / 2), vertical ? mmToM((sign * spacing) / 2) : 0, mmToM(standoff / 2)]}
            rotation-x={Math.PI / 2}
            castShadow
          >
            <cylinderGeometry args={[mmToM(diameter / 3), mmToM(diameter / 3), mmToM(standoff), 12]} />
            {material}
          </mesh>
        ))}
      </group>
    );
  }

  return (
    <mesh position={[center[0], center[1], center[2] + mmToM(d.depth / 2)]} onClick={onClick}>
      <boxGeometry args={[mmToM(d.width), mmToM(d.height), mmToM(d.depth)]} />
      <meshStandardMaterial color={RECESS_COLOR} roughness={0.9} />
    </mesh>
  );
}
