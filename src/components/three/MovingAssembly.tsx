"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import type { Group } from "three";
import type { MotionLimit } from "@/domain/attachments/collisions";
import type { PanelPart, PartMotion, Vector3Mm } from "@/domain/geometry/types";
import type { HardwarePart } from "@/domain/hardware/geometry";
import { useConfiguratorStore } from "@/store/useConfiguratorStore";
import { usePreviewStore } from "@/store/usePreviewStore";
import { HandleMesh } from "./HandleMesh";
import { PanelMesh } from "./PanelMesh";
import { forgetProgress, maxProgress, minProgress, reportProgress, resolvePreviewTarget } from "./previewProgress";
import { mmToM } from "./units";

const DURATION_S = 0.6;
/**
 * In demand mode the first frame after idling reports the whole idle time as its delta, so that
 * frame uses a nominal step. Later frames use the real delta (bounded against stalls), so the
 * animation takes DURATION_S regardless of the frame rate.
 */
const FIRST_FRAME_DELTA_S = 1 / 60;
const MAX_FRAME_DELTA_S = 0.1;
const ORIGIN: Vector3Mm = { x: 0, y: 0, z: 0 };
const FRONT_TYPES = new Set<PanelPart["type"]>(["door", "drawer-front"]);

export interface MovingGroup {
  readonly groupId: string;
  readonly attachmentId: string;
  readonly compartmentId: string;
  readonly motion: PartMotion;
  readonly parts: readonly PanelPart[];
  readonly handles: readonly HardwarePart[];
  /** Collision-safe limit; the animation stops there. */
  readonly limit: MotionLimit | undefined;
  /** Interior drawers behind this door: the door stays open until they are retracted. */
  readonly dependents: readonly string[];
}

/**
 * A door leaf (rotating about its hinge) or a drawer (sliding along +Z), with its handle. The open
 * state lives in the preview store, the animated transform only in this component's Three.js
 * group — never in the configuration. Progress is time-based with smoothstep easing.
 *
 * Interaction model with interior drawers:
 * - an interior drawer only moves out once its covering door is fully open;
 * - a door asked to close stays open until every interior drawer behind it is fully retracted
 *   (the panel closes those drawers together with the door), then closes.
 */
export function MovingAssembly({ group }: { group: MovingGroup }) {
  const { motion, attachmentId, compartmentId, parts, handles, limit, dependents } = group;
  const requiresOpen = limit?.requiresOpen ?? null;
  const open = usePreviewStore((state) => state.openAttachmentIds.has(attachmentId));
  const doorRequested = usePreviewStore((state) => (requiresOpen ? state.openAttachmentIds.has(requiresOpen) : true));
  const select = useConfiguratorStore((state) => state.selectCompartment);
  const invalidate = useThree((state) => state.invalidate);
  const ref = useRef<Group>(null);
  const progress = useRef(0);
  const animating = useRef(false);

  // Render loop runs on demand: request a frame whenever the target state changes.
  useEffect(() => invalidate(), [open, doorRequested, invalidate]);
  useEffect(() => () => forgetProgress(attachmentId, group.groupId), [attachmentId, group.groupId]);

  useFrame((_, delta) => {
    const { target, waiting } = resolvePreviewTarget({
      requested: open,
      coveringDoorRequested: doorRequested,
      coveringDoorProgress: requiresOpen ? minProgress(requiresOpen) : 1,
      dependentsProgress: Math.max(0, ...dependents.map(maxProgress)),
      currentProgress: progress.current,
    });

    const current = progress.current;
    const step = (animating.current ? Math.min(delta, MAX_FRAME_DELTA_S) : FIRST_FRAME_DELTA_S) / DURATION_S;
    const next = current < target ? Math.min(target, current + step) : Math.max(target, current - step);
    progress.current = next;
    reportProgress(attachmentId, group.groupId, next);

    const node = ref.current;
    if (node) {
      const eased = next * next * (3 - 2 * next);
      if (motion.kind === "hinge") {
        const angle = limit?.allowed ?? motion.maxAngleDeg;
        node.rotation.y = motion.direction * ((angle * Math.PI) / 180) * eased;
      } else {
        node.position.z = mmToM(limit?.allowed ?? motion.distance) * eased;
      }
    }
    animating.current = next !== target;
    if (animating.current || waiting) invalidate();
  });

  // A hinged group sits on its pivot and its panels are placed relative to it; a sliding group stays at the origin.
  const origin = motion.kind === "hinge" ? motion.pivot : ORIGIN;
  const selectCompartment = () => select(compartmentId);

  return (
    <group
      ref={ref}
      position-x={mmToM(origin.x)}
      position-y={mmToM(origin.y)}
      // The slide offset is owned by the animation; only hinge groups have a fixed z.
      {...(motion.kind === "hinge" ? { "position-z": mmToM(origin.z) } : {})}
    >
      {parts.map((part) => (
        <PanelMesh
          key={part.id}
          panel={part}
          origin={origin}
          onSelect={FRONT_TYPES.has(part.type) ? selectCompartment : undefined}
        />
      ))}
      {handles.map((handle) => (
        <HandleMesh key={handle.id} part={handle} origin={origin} onSelect={selectCompartment} />
      ))}
    </group>
  );
}
