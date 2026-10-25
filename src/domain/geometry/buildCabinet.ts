import { buildAttachmentParts } from "../attachments/geometry";
import { calculateCompartmentBounds, getPlinthHeight, layoutSplit } from "../compartments/layout";
import type { BoxMm, CompartmentLayout } from "../compartments/types";
import { assertValidCabinet } from "../constraints/validateCabinet";
import { CABINET_LIMITS, CONSTRUCTION_LIMITS } from "../furniture/defaults";
import type { FurnitureMaterials, MaterialId, MaterialSlot } from "../furniture/materials";
import type { CabinetConfiguration, CabinetLimits, ConstructionLimits } from "../furniture/types";
import type { PanelPart, PanelType } from "./types";

export const CABINET_PANEL_IDS = {
  leftSide: "cabinet/left-side",
  rightSide: "cabinet/right-side",
  top: "cabinet/top",
  bottom: "cabinet/bottom",
  backPanel: "cabinet/back-panel",
  plinth: "cabinet/plinth",
} as const;

/** Each subdivided compartment owns exactly one separating panel, so its ID derives from the compartment. */
export function shelfPartId(compartmentId: string): string {
  return `shelf/${compartmentId}`;
}

export function dividerPartId(compartmentId: string): string {
  return `divider/${compartmentId}`;
}

export interface BuildCabinetOptions {
  readonly limits?: CabinetLimits;
  readonly constructionLimits?: ConstructionLimits;
}

/**
 * Decides the finish of a single part. Every part currently inherits its slot's selection;
 * per-part material overrides (keyed by stable part ID) belong here when they are introduced.
 */
function resolvePartMaterial(materials: FurnitureMaterials, slot: MaterialSlot): MaterialId {
  return materials[slot];
}

/**
 * Generates every physical part of a cabinet. Pure and deterministic.
 *
 * Construction conventions (all mm, origin at the lower-left-back corner):
 * - Outer `width × height × depth` includes the plinth and the back panel.
 * - Sides span the full carcass height; top and bottom fit between the sides, full depth.
 * - Plinth (optional): a solid block under the carcass, full width, from the back up to
 *   `setback` short of the front; the carcass stands on it.
 * - Back panel (optional): inset between sides, top and bottom at the rear (z = 0); shelves
 *   and dividers start in front of it, so it never intersects them.
 * - Shelves span their compartment's width, dividers its height; both run the usable depth.
 *
 * - Doors and drawers: derived from their compartment's bounds (see attachments/layout.ts).
 *
 * Order: carcass, plinth, back panel, shelves/dividers in compartment pre-order, then
 * door and drawer parts in attachment order.
 *
 * @throws InvalidCabinetConfigurationError when the configuration is invalid.
 */
export function buildCabinet(
  configuration: CabinetConfiguration,
  { limits = CABINET_LIMITS, constructionLimits = CONSTRUCTION_LIMITS }: BuildCabinetOptions = {},
): PanelPart[] {
  assertValidCabinet(configuration, limits, constructionLimits);

  const { width, height, depth, panelThickness: t, materials, backPanel, plinth } = configuration;
  const base = getPlinthHeight(configuration);
  const carcassHeight = height - base;
  const innerWidth = width - 2 * t;

  const part = (id: string, type: PanelType, slot: MaterialSlot, box: BoxMm): PanelPart => ({
    id,
    type,
    materialSlot: slot,
    materialId: resolvePartMaterial(materials, slot),
    dimensions: box.dimensions,
    position: box.position,
  });

  const parts: PanelPart[] = [
    part(CABINET_PANEL_IDS.leftSide, "left-side", "body", {
      position: { x: 0, y: base, z: 0 },
      dimensions: { width: t, height: carcassHeight, depth },
    }),
    part(CABINET_PANEL_IDS.rightSide, "right-side", "body", {
      position: { x: width - t, y: base, z: 0 },
      dimensions: { width: t, height: carcassHeight, depth },
    }),
    part(CABINET_PANEL_IDS.top, "top", "body", {
      position: { x: t, y: height - t, z: 0 },
      dimensions: { width: innerWidth, height: t, depth },
    }),
    part(CABINET_PANEL_IDS.bottom, "bottom", "body", {
      position: { x: t, y: base, z: 0 },
      dimensions: { width: innerWidth, height: t, depth },
    }),
  ];

  if (plinth.enabled) {
    parts.push(
      part(CABINET_PANEL_IDS.plinth, "plinth", "plinth", {
        position: { x: 0, y: 0, z: 0 },
        dimensions: { width, height: plinth.height, depth: depth - plinth.setback },
      }),
    );
  }

  if (backPanel.enabled) {
    parts.push(
      part(CABINET_PANEL_IDS.backPanel, "back-panel", "backPanel", {
        position: { x: t, y: base + t, z: 0 },
        dimensions: { width: innerWidth, height: carcassHeight - 2 * t, depth: backPanel.thickness },
      }),
    );
  }

  const layouts = calculateCompartmentBounds(configuration);
  const recessed = getInsetCoveredCompartments(configuration, layouts);
  for (const { id, split, bounds } of layouts) {
    if (!split) continue;
    const { panel } = layoutSplit(bounds, split, t);
    // Behind an inset door the front occupies the first t mm of the opening, so the panel stops behind it.
    const box = recessed.has(id)
      ? { position: panel.position, dimensions: { ...panel.dimensions, depth: panel.dimensions.depth - t } }
      : panel;
    parts.push(
      split.direction === "horizontal"
        ? part(shelfPartId(id), "shelf", "interior", box)
        : part(dividerPartId(id), "divider", "interior", box),
    );
  }

  // Doors and drawers last; see attachments/layout.ts for the front conventions.
  const openings = new Map(layouts.map((layout) => [layout.id, layout.bounds]));
  for (const spec of buildAttachmentParts(configuration, openings)) {
    parts.push({ ...spec, materialId: resolvePartMaterial(materials, spec.materialSlot) });
  }

  return parts;
}

/** Compartments (including nested ones) whose opening is closed by an inset door. */
function getInsetCoveredCompartments(
  configuration: CabinetConfiguration,
  layouts: readonly CompartmentLayout[],
): Set<string> {
  const insetDoors = new Set(
    configuration.attachments
      .filter((a) => a.type === "door" && a.configuration.mounting === "inset")
      .map((a) => a.compartmentId),
  );
  const covered = new Set<string>();
  // Layouts are in pre-order, so a parent is always classified before its children.
  for (const { id, parentId } of layouts) {
    if (insetDoors.has(id) || (parentId !== null && covered.has(parentId))) covered.add(id);
  }
  return covered;
}

/**
 * Overall bounding box of the furniture, for camera framing. The carcass spans z ∈ [0, depth]
 * and faces +Z; overlay fronts stand out of it by `frontProjection`.
 */
export function getFurnitureBounds(
  { width, height, depth }: Pick<CabinetConfiguration, "width" | "height" | "depth">,
  frontProjection = 0,
): BoxMm {
  return { position: { x: 0, y: 0, z: 0 }, dimensions: { width, height, depth: depth + frontProjection } };
}
