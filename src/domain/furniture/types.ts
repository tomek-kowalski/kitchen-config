import type { CompartmentNode } from "../compartments/types";
import type { FurnitureMaterials } from "./materials";

/** Millimeters are the canonical length unit across the whole domain. */
export type Millimeters = number;

export interface CabinetDimensions {
  /** Outer width along the X axis. */
  readonly width: Millimeters;
  /** Outer height along the Y axis, including the plinth when enabled. */
  readonly height: Millimeters;
  /** Outer depth along the Z axis, including the back panel when enabled. */
  readonly depth: Millimeters;
  readonly panelThickness: Millimeters;
}

export type CabinetDimensionKey = keyof CabinetDimensions;

/** Inset back panel: fitted between the sides, top and bottom at the rear of the carcass. */
export interface BackPanelOptions {
  readonly enabled: boolean;
  readonly thickness: Millimeters;
}

/** Solid base under the carcass, full width, recessed from the front by `setback`. */
export interface PlinthOptions {
  readonly enabled: boolean;
  readonly height: Millimeters;
  readonly setback: Millimeters;
}

export interface CabinetConfiguration extends CabinetDimensions {
  readonly materials: FurnitureMaterials;
  readonly backPanel: BackPanelOptions;
  readonly plinth: PlinthOptions;
  /** Root of the subdivision tree; it represents the whole cabinet interior. */
  readonly compartments: CompartmentNode;
}

/** Every numeric value a user can type, addressed by a stable path. */
export type NumericField = CabinetDimensionKey | "backPanel.thickness" | "plinth.height" | "plinth.setback";

export interface DimensionRange {
  readonly min: Millimeters;
  readonly max: Millimeters;
}

export type CabinetLimits = Readonly<Record<CabinetDimensionKey, DimensionRange>>;

/** Prototype limits for the interior structure and optional components. */
export interface ConstructionLimits {
  readonly minCompartmentWidth: Millimeters;
  readonly minCompartmentHeight: Millimeters;
  /** Maximum nesting level of a leaf compartment (the root is level 0). */
  readonly maxSubdivisionDepth: number;
  readonly maxLeafCompartments: number;
  readonly backPanelThickness: DimensionRange;
  readonly plinthHeight: DimensionRange;
  readonly plinthSetback: DimensionRange;
}
