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
  | "plinth";

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
}
