import { CONSTRUCTION_LIMITS } from "../furniture/defaults";
import type { CabinetConfiguration, ConstructionLimits } from "../furniture/types";
import { getCompartment } from "./tree";
import {
  isBranch,
  type BoxMm,
  type CompartmentId,
  type CompartmentLayout,
  type CompartmentNode,
  type CompartmentSplit,
  type SplitDirection,
} from "./types";

/** Height taken by the plinth at the bottom of the cabinet (0 when disabled). */
export function getPlinthHeight({ plinth }: CabinetConfiguration): number {
  return plinth.enabled ? plinth.height : 0;
}

/** Depth taken by the inset back panel at the rear of the carcass (0 when disabled). */
export function getBackPanelDepth({ backPanel }: CabinetConfiguration): number {
  return backPanel.enabled ? backPanel.thickness : 0;
}

/** The root compartment: between the sides, above the bottom, below the top, in front of the back panel. */
export function getInteriorBounds(configuration: CabinetConfiguration): BoxMm {
  const { width, height, depth, panelThickness: t } = configuration;
  const base = getPlinthHeight(configuration);
  const back = getBackPanelDepth(configuration);
  return {
    position: { x: t, y: base + t, z: back },
    dimensions: { width: width - 2 * t, height: height - base - 2 * t, depth: depth - back },
  };
}

/**
 * Divides a box by a panel of `thickness`. The ratio applies to the space left after the panel,
 * so an 800 mm wide compartment with an 18 mm divider yields children sharing 782 mm.
 */
export function layoutSplit(box: BoxMm, split: CompartmentSplit, thickness: number) {
  const { position: p, dimensions: d } = box;
  if (split.direction === "horizontal") {
    const usable = d.height - thickness;
    const first = usable * split.ratio;
    return {
      first: { position: p, dimensions: { ...d, height: first } },
      panel: { position: { ...p, y: p.y + first }, dimensions: { ...d, height: thickness } },
      second: { position: { ...p, y: p.y + first + thickness }, dimensions: { ...d, height: usable - first } },
    } satisfies Record<string, BoxMm>;
  }
  const usable = d.width - thickness;
  const first = usable * split.ratio;
  return {
    first: { position: p, dimensions: { ...d, width: first } },
    panel: { position: { ...p, x: p.x + first }, dimensions: { ...d, width: thickness } },
    second: { position: { ...p, x: p.x + first + thickness }, dimensions: { ...d, width: usable - first } },
  } satisfies Record<string, BoxMm>;
}

/** Derives the bounds of every compartment (pre-order: parent, first child subtree, second child subtree). */
export function calculateCompartmentBounds(configuration: CabinetConfiguration): CompartmentLayout[] {
  const layouts: CompartmentLayout[] = [];
  const visit = (node: CompartmentNode, bounds: BoxMm, level: number, parentId: CompartmentId | null) => {
    const split = isBranch(node) ? node.split : null;
    layouts.push({ id: node.id, parentId, level, isLeaf: split === null, split, bounds });
    if (!isBranch(node)) return;
    const { first, second } = layoutSplit(bounds, node.split, configuration.panelThickness);
    visit(node.children[0], first, level + 1, node.id);
    visit(node.children[1], second, level + 1, node.id);
  };
  visit(configuration.compartments, getInteriorBounds(configuration), 0, null);
  return layouts;
}

function axisSize(box: BoxMm, direction: SplitDirection): number {
  return direction === "horizontal" ? box.dimensions.height : box.dimensions.width;
}

/** Smallest size a subtree can occupy along the axis cut by `direction`. */
function minimumExtent(
  node: CompartmentNode,
  direction: SplitDirection,
  thickness: number,
  limits: ConstructionLimits,
): number {
  if (!isBranch(node)) {
    return direction === "horizontal" ? limits.minCompartmentHeight : limits.minCompartmentWidth;
  }
  const [a, b] = node.children.map((child) => minimumExtent(child, direction, thickness, limits));
  return node.split.direction === direction ? a + thickness + b : Math.max(a, b);
}

/**
 * Range of ratios for an existing split that keeps every descendant above the minimum
 * compartment size, or `null` when no ratio is valid.
 */
export function getSplitRatioRange(
  configuration: CabinetConfiguration,
  id: CompartmentId,
  limits: ConstructionLimits = CONSTRUCTION_LIMITS,
): { min: number; max: number } | null {
  const node = getCompartment(configuration.compartments, id);
  const layout = calculateCompartmentBounds(configuration).find((l) => l.id === id);
  if (!node || !isBranch(node) || !layout) return null;

  const { direction } = node.split;
  const t = configuration.panelThickness;
  const usable = axisSize(layout.bounds, direction) - t;
  const min = minimumExtent(node.children[0], direction, t, limits) / usable;
  const max = 1 - minimumExtent(node.children[1], direction, t, limits) / usable;
  return usable > 0 && min <= max ? { min, max } : null;
}
