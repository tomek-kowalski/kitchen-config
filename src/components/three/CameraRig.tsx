"use client";

import { OrbitControls } from "@react-three/drei";
import { useThree, type RootState } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef, type ComponentRef } from "react";
import { PerspectiveCamera, type Box3, type Vector3 } from "three";
import { getFurnitureBounds } from "@/domain/geometry/buildCabinet";
import { useConfiguratorStore } from "@/store/useConfiguratorStore";
import { DEFAULT_VIEW_DIRECTION, frameBox, furnitureSceneBox, isBoxInView } from "./cameraFraming";

type OrbitControlsImpl = ComponentRef<typeof OrbitControls>;

/** Points the camera along `direction` at the furniture, at a distance that fits it in the viewport. */
function frameCamera(state: RootState, controls: OrbitControlsImpl | null, box: Box3, direction: Vector3) {
  const { camera, size, invalidate } = state;
  if (!(camera instanceof PerspectiveCamera) || !controls) return;
  // R3F also keeps the aspect in sync, but framing must not depend on effect ordering.
  camera.aspect = size.width / size.height;
  camera.updateProjectionMatrix();
  const { position, target } = frameBox(camera, camera.aspect, box, direction);
  // An update without damping discards leftover orbit/pan momentum, which would otherwise
  // keep moving the camera away from the framed position on the following frames.
  const damping = controls.enableDamping;
  controls.enableDamping = false;
  controls.update();
  camera.position.copy(position);
  controls.target.copy(target);
  controls.update();
  controls.enableDamping = damping;
  invalidate();
}

/** The user's current viewing direction, so Fit to View keeps the orientation. */
function currentDirection(state: RootState, controls: OrbitControlsImpl | null): Vector3 {
  if (!controls) return DEFAULT_VIEW_DIRECTION.clone();
  const direction = state.camera.position.clone().sub(controls.target);
  return direction.lengthSq() > 0 ? direction : DEFAULT_VIEW_DIRECTION.clone();
}

/**
 * Owns the orbit controls and camera framing:
 * - initial mount and "Reset view": default orientation, framed to the furniture;
 * - "Fit to view": keeps the current orientation, frames the furniture;
 * - dimension or viewport changes: re-frames (keeping orientation) only when the furniture
 *   no longer fits, so ordinary edits never move the camera.
 */
export function CameraRig() {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const get = useThree((state) => state.get);
  const viewportWidth = useThree((state) => state.size.width);
  const viewportHeight = useThree((state) => state.size.height);

  const width = useConfiguratorStore((state) => state.configuration.width);
  const height = useConfiguratorStore((state) => state.configuration.height);
  const depth = useConfiguratorStore((state) => state.configuration.depth);
  const viewCommand = useConfiguratorStore((state) => state.viewCommand);

  const box = useMemo(() => furnitureSceneBox(getFurnitureBounds({ width, height, depth })), [width, height, depth]);

  // Initial framing, before the first visible frame (refs are attached before layout effects run).
  const framedOnce = useRef(false);
  useLayoutEffect(() => {
    if (framedOnce.current) return;
    framedOnce.current = true;
    frameCamera(get(), controlsRef.current, box, DEFAULT_VIEW_DIRECTION);
  }, [get, box]);

  // Explicit user requests. Commands issued before mount are ignored.
  const handledSeq = useRef(useConfiguratorStore.getState().viewCommand?.seq ?? 0);
  useEffect(() => {
    if (!viewCommand || viewCommand.seq === handledSeq.current) return;
    handledSeq.current = viewCommand.seq;
    const state = get();
    const direction =
      viewCommand.kind === "reset" ? DEFAULT_VIEW_DIRECTION : currentDirection(state, controlsRef.current);
    frameCamera(state, controlsRef.current, box, direction);
  }, [viewCommand, get, box]);

  // Major size or viewport changes: refit only if part of the furniture is now cut off.
  useEffect(() => {
    const state = get();
    const { camera } = state;
    if (!(camera instanceof PerspectiveCamera) || viewportHeight === 0) return;
    camera.aspect = viewportWidth / viewportHeight;
    camera.updateProjectionMatrix();
    if (!isBoxInView(camera, box)) {
      frameCamera(state, controlsRef.current, box, currentDirection(state, controlsRef.current));
    }
  }, [get, box, viewportWidth, viewportHeight]);

  return (
    <OrbitControls
      ref={controlsRef}
      makeDefault
      enableDamping
      minDistance={0.4}
      maxDistance={20}
      // Keep the camera above the floor.
      maxPolarAngle={Math.PI / 2 - 0.02}
    />
  );
}
