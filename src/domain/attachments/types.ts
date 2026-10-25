import type { CompartmentId } from "../compartments/types";
import type { Millimeters } from "../furniture/types";
import type { HandleType, HardwareFinishId } from "../hardware/catalog";

export type AttachmentId = string;

/**
 * - `overlay`: the front sits in front of the carcass and covers the panels around the opening
 *   (fully on outer carcass edges, half on shared panels; see `getFrontArea`).
 * - `inset`: the front sits inside the opening, flush with the carcass front.
 */
export type FrontMounting = "overlay" | "inset";

export type DoorLayout = "single" | "double";

export type HingeSide = "left" | "right";

/**
 * - `exterior`: the drawer fronts are part of the cabinet face (they may not overlap other fronts).
 * - `interior`: the drawers sit behind a door covering their compartment or an ancestor of it.
 */
export type DrawerPlacement = "exterior" | "interior";

export type HandleAlign = "top" | "center" | "bottom";

export interface HandleConfiguration {
  readonly type: HandleType;
  readonly finish: HardwareFinishId;
  /** Vertical placement on the front. */
  readonly align: HandleAlign;
  /** Doors: distance of the handle centre from the free (non-hinged) edge (mm). Unused on drawers (centred). */
  readonly edgeOffset: Millimeters;
  /** Distance of the handle centre from the top/bottom edge when aligned there (mm). */
  readonly alignOffset: Millimeters;
}

export interface DoorConfiguration {
  readonly layout: DoorLayout;
  readonly mounting: FrontMounting;
  /** Hinge side of a single door; a double door is always hinged left + right. */
  readonly hinge: HingeSide;
  /** Clearance around the front (mm). */
  readonly gap: Millimeters;
  /** Clearance between the two leaves of a double door (mm). */
  readonly centerGap: Millimeters;
  /** Requested maximum opening angle; collisions may restrict it further in the preview. */
  readonly maxOpenAngle: number;
  readonly handle: HandleConfiguration;
}

export interface DrawerConfiguration {
  /** Number of drawers stacked in the compartment. */
  readonly count: number;
  readonly placement: DrawerPlacement;
  /** Exterior drawers: overlay or inset fronts. Interior drawers always use `inset`. */
  readonly mounting: FrontMounting;
  /** Clearance around and between the drawer fronts (mm). */
  readonly frontGap: Millimeters;
  /** Outer depth of each drawer box (mm). */
  readonly depth: Millimeters;
  /**
   * `null`: equal heights. Otherwise one positive relative weight per drawer (bottom first); the
   * front heights are the available height split in these proportions, so they always fit exactly.
   */
  readonly heightRatios: readonly number[] | null;
  readonly handle: HandleConfiguration;
}

export interface DoorAttachment {
  readonly id: AttachmentId;
  readonly type: "door";
  readonly compartmentId: CompartmentId;
  readonly configuration: DoorConfiguration;
}

export interface DrawerAttachment {
  readonly id: AttachmentId;
  readonly type: "drawer";
  readonly compartmentId: CompartmentId;
  readonly configuration: DrawerConfiguration;
}

/** A module mounted in a compartment. Not part of the compartment tree; references it by ID. */
export type FurnitureAttachment = DoorAttachment | DrawerAttachment;

/** Doors and exterior drawers form the cabinet face; interior drawers sit behind a door. */
export function isExteriorFront(attachment: FurnitureAttachment): boolean {
  return attachment.type === "door" || attachment.configuration.placement === "exterior";
}
