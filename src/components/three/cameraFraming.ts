import { Box3, Frustum, Matrix4, Sphere, Vector3, type PerspectiveCamera } from "three";
import type { BoxMm } from "@/domain/compartments/types";
import { mmToM } from "./units";

/** Default orientation for Reset View: front-right, slightly above. */
export const DEFAULT_VIEW_DIRECTION = new Vector3(0.55, 0.35, 1).normalize();

const FIT_MARGIN = 1.08;

/**
 * Scene-space box (meters) of the furniture. FurnitureRenderer centres the carcass on the floor
 * origin (offset −width/2, −carcassDepth/2); the front faces +Z, so overlay fronts extend the box there.
 */
export function furnitureSceneBox({ position, dimensions }: BoxMm, carcassDepth: number): Box3 {
  const offsetX = dimensions.width / 2;
  const offsetZ = carcassDepth / 2;
  return new Box3(
    new Vector3(mmToM(position.x - offsetX), mmToM(position.y), mmToM(position.z - offsetZ)),
    new Vector3(
      mmToM(position.x + dimensions.width - offsetX),
      mmToM(position.y + dimensions.height),
      mmToM(position.z + dimensions.depth - offsetZ),
    ),
  );
}

/** Camera position and orbit target that fit the whole box for the given aspect ratio and direction. */
export function frameBox(camera: PerspectiveCamera, aspect: number, box: Box3, direction: Vector3) {
  const sphere = box.getBoundingSphere(new Sphere());
  const verticalFov = (camera.fov * Math.PI) / 180;
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
  const distance = (sphere.radius / Math.sin(Math.min(verticalFov, horizontalFov) / 2)) * FIT_MARGIN;
  const target = sphere.center.clone();
  return { target, position: target.clone().addScaledVector(direction.clone().normalize(), distance) };
}

/** Whether every corner of the box is inside the camera frustum. */
export function isBoxInView(camera: PerspectiveCamera, box: Box3): boolean {
  camera.updateMatrixWorld();
  const frustum = new Frustum().setFromProjectionMatrix(
    new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
  const { min, max } = box;
  for (const x of [min.x, max.x]) {
    for (const y of [min.y, max.y]) {
      for (const z of [min.z, max.z]) {
        if (!frustum.containsPoint(new Vector3(x, y, z))) return false;
      }
    }
  }
  return true;
}
