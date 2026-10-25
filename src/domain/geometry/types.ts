import type { MaterialId, MaterialSlot } from "../furniture/materials";
import type { Millimeters } from "../furniture/types";

/**
 * Coordinate system (all values in millimeters):
 * X = width (left → right), Y = height (floor → top), Z = depth (back → front).
 * The origin is the cabinet's lower-left-back corner.
 */
export interface Vector3Mm {
  readonly x: Millimeters;
  readonly y: Millimeters;
  readonly z: Millimeters;
}

/** Extents of a part along the X (width), Y (height) and Z (depth) axes. */
export interface PartDimensions {
  readonly width: Millimeters;
  readonly height: Millimeters;
  readonly depth: Millimeters;
}

export type PanelType =
  | "left-side"
  | "right-side"
  | "top"
  | "bottom"
  | "shelf"
  | "divider"
  | "back-panel"
  | "plinth"
  | "door"
  | "drawer-front"
  | "drawer-side"
  | "drawer-back"
  | "drawer-bottom";

/**
 * How a moving part travels in the preview. Parts sharing a `groupId` move together.
 * - `hinge`: rotation about a vertical axis through `pivot` (x, z); `direction` is the sign of the
 *   rotation about +Y that opens the door outwards.
 * - `slide`: translation along +Z (out of the cabinet front) by `distance`.
 */
export type PartMotion =
  | {
      readonly kind: "hinge";
      readonly groupId: string;
      readonly pivot: Vector3Mm;
      readonly direction: 1 | -1;
      readonly maxAngleDeg: number;
    }
  | { readonly kind: "slide"; readonly groupId: string; readonly distance: Millimeters };

export interface PanelPart {
  /** Stable identifier, identical across rebuilds of the same part. */
  readonly id: string;
  readonly type: PanelType;
  /** Which finish selection the part belongs to. */
  readonly materialSlot: MaterialSlot;
  /** Resolved finish of this specific part. */
  readonly materialId: MaterialId;
  readonly dimensions: PartDimensions;
  /** Position of the part's minimum corner (its lower-left-back corner). */
  readonly position: Vector3Mm;
  /** Set on parts generated for a door or drawer attachment. */
  readonly attachmentId?: string;
  /** The compartment an attachment part belongs to. */
  readonly compartmentId?: string;
  /** Present on parts that move in the open/close preview. */
  readonly motion?: PartMotion;
}
