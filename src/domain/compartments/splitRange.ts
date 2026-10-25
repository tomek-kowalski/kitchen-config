import { validateCabinet } from "../constraints/validateCabinet";
import type { CabinetConfiguration } from "../furniture/types";
import { calculateCompartmentBounds } from "./layout";
import { getCompartment, updateSplitRatio } from "./tree";
import { isBranch, type CompartmentId } from "./types";

/** Resolution of the search, in millimetres of the first child compartment. */
const RESOLUTION_MM = 0.1;

export interface SplitSizeRange {
  /** Space shared by both children (compartment size along the split axis minus the panel). */
  readonly usable: number;
  /** Current size of the first child (bottom / left). */
  readonly current: number;
  /** Smallest and largest valid size of the first child, in mm. */
  readonly min: number;
  readonly max: number;
}

function isValidSize(configuration: CabinetConfiguration, id: CompartmentId, usable: number, firstSize: number): boolean {
  const ratio = firstSize / usable;
  const result = updateSplitRatio(configuration.compartments, id, ratio);
  return result.ok && validateCabinet({ ...configuration, compartments: result.tree }).isValid;
}

/**
 * Valid range for the size of the first child of a split, found by bisection against the complete
 * validation — minimum compartment sizes, nested subdivisions, panel thickness, door and drawer
 * minimums, handles. The valid sizes form one interval around the current size (every limit is a
 * lower bound on one child), so the search walks outwards from it. Validation stays the authority.
 */
export function getSplitSizeRange(configuration: CabinetConfiguration, id: CompartmentId): SplitSizeRange | null {
  const node = getCompartment(configuration.compartments, id);
  const layout = calculateCompartmentBounds(configuration).find((l) => l.id === id);
  if (!node || !isBranch(node) || !layout) return null;
  const size = node.split.direction === "horizontal" ? layout.bounds.dimensions.height : layout.bounds.dimensions.width;
  const usable = size - configuration.panelThickness;
  const current = usable * node.split.ratio;
  if (usable <= 0) return null;

  const search = (validEnd: number, invalidEnd: number) => {
    let valid = validEnd;
    let invalid = invalidEnd;
    while (Math.abs(invalid - valid) > RESOLUTION_MM) {
      const mid = (valid + invalid) / 2;
      if (isValidSize(configuration, id, usable, mid)) valid = mid;
      else invalid = mid;
    }
    return valid;
  };
  return { usable, current, min: search(current, 0), max: search(current, usable) };
}

/**
 * Ratio that gives the first child exactly `firstSize` mm. The ratio is stored, the sizes are
 * derived from it, so repeated edits never accumulate rounding errors.
 */
export function ratioForFirstSize(range: Pick<SplitSizeRange, "usable">, firstSize: number): number {
  return firstSize / range.usable;
}
