import type { PartDimensions, Vector3Mm } from "../geometry/types";

export type CompartmentId = string;

/**
 * - `horizontal`: the compartment is cut by a shelf; children are [bottom, top].
 * - `vertical`: the compartment is cut by a divider; children are [left, right].
 */
export type SplitDirection = "horizontal" | "vertical";

export interface CompartmentSplit {
  readonly direction: SplitDirection;
  /**
   * Share of the usable space (compartment size minus the separating panel) given to the
   * first child. Exclusive range (0, 1).
   */
  readonly ratio: number;
}

export interface CompartmentLeaf {
  readonly id: CompartmentId;
}

export interface CompartmentBranch {
  readonly id: CompartmentId;
  readonly split: CompartmentSplit;
  readonly children: readonly [CompartmentNode, CompartmentNode];
}

/** A logical interior volume. Its position and size are always derived, never stored. */
export type CompartmentNode = CompartmentLeaf | CompartmentBranch;

/** Axis-aligned box in millimeters; `position` is the minimum (lower-left-back) corner. */
export interface BoxMm {
  readonly position: Vector3Mm;
  readonly dimensions: PartDimensions;
}

export interface CompartmentLayout {
  readonly id: CompartmentId;
  readonly parentId: CompartmentId | null;
  /** 0 for the root compartment. */
  readonly level: number;
  readonly isLeaf: boolean;
  readonly split: CompartmentSplit | null;
  readonly bounds: BoxMm;
}

export function isBranch(node: CompartmentNode): node is CompartmentBranch {
  return "split" in node;
}
