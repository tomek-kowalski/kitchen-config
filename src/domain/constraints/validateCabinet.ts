import { validateAttachments } from "../attachments/validateAttachments";
import { calculateCompartmentBounds } from "../compartments/layout";
import { isValidSplitRatio } from "../compartments/tree";
import type { CompartmentId, CompartmentLayout } from "../compartments/types";
import { CABINET_LIMITS, CONSTRUCTION_LIMITS } from "../furniture/defaults";
import { formatMm, pluralPl } from "../furniture/format";
import { isMaterialId, MATERIAL_SLOTS, type MaterialSlot } from "../furniture/materials";
import type {
  CabinetConfiguration,
  CabinetDimensionKey,
  CabinetLimits,
  ConstructionLimits,
  DimensionRange,
  NumericField,
} from "../furniture/types";

export type CabinetValidationField = NumericField | `materials.${MaterialSlot}` | "compartments" | "attachments";

export type CabinetValidationCode =
  | "not_finite"
  | "not_positive"
  | "below_minimum"
  | "above_maximum"
  | "panels_exceed_width"
  | "panels_exceed_height"
  | "plinth_exceeds_height"
  | "unknown_material"
  | "invalid_structure"
  | "duplicate_compartment_id"
  | "invalid_split_ratio"
  | "max_depth_exceeded"
  | "max_leaves_exceeded"
  | "compartment_too_narrow"
  | "compartment_too_low"
  | "invalid_attachment"
  | "duplicate_attachment_id"
  | "attachment_compartment_not_found"
  | "attachment_not_on_leaf"
  | "attachment_conflict"
  | "attachment_gap_out_of_range"
  | "door_too_narrow"
  | "door_too_low"
  | "invalid_drawer_count"
  | "drawer_depth_out_of_range"
  | "drawer_front_too_low"
  | "drawer_box_too_small"
  | "removal_requires_confirmation"
  | "interior_drawer_without_door"
  | "invalid_drawer_heights"
  | "invalid_handle"
  | "handle_out_of_bounds";

export interface CabinetValidationError {
  readonly field: CabinetValidationField;
  readonly code: CabinetValidationCode;
  readonly message: string;
  /** The compartment the error refers to, for structure errors. */
  readonly compartmentId?: CompartmentId;
  /** The door or drawer assembly the error refers to. */
  readonly attachmentId?: string;
}

export interface CabinetValidationResult {
  readonly isValid: boolean;
  readonly errors: readonly CabinetValidationError[];
}

const DIMENSION_KEYS: readonly CabinetDimensionKey[] = ["width", "height", "depth", "panelThickness"];

export const NUMERIC_FIELD_LABELS: Readonly<Record<NumericField, string>> = {
  width: "Szerokość",
  height: "Wysokość",
  depth: "Głębokość",
  panelThickness: "Grubość płyty",
  "backPanel.thickness": "Grubość pleców",
  "plinth.height": "Wysokość cokołu",
  "plinth.setback": "Cofnięcie cokołu",
};

/** Genitive forms, as used in "materiał korpusu". */
const MATERIAL_SLOT_LABELS: Readonly<Record<MaterialSlot, string>> = {
  body: "korpusu",
  interior: "wnętrza",
  backPanel: "pleców",
  plinth: "cokołu",
  doorFront: "frontów drzwi",
  drawerFront: "frontów szuflad",
};

function validateRange(field: NumericField, value: number, { min, max }: DimensionRange): CabinetValidationError | null {
  const label = NUMERIC_FIELD_LABELS[field];

  if (!Number.isFinite(value)) {
    return { field, code: "not_finite", message: `${label}: podaj liczbę.` };
  }
  // Zero is a legitimate value only for fields whose range starts at 0 (e.g. plinth setback).
  if (value < 0 || (value === 0 && min > 0)) {
    return { field, code: "not_positive", message: `${label}: wartość musi być większa od 0 mm.` };
  }
  if (value < min) {
    return { field, code: "below_minimum", message: `${label}: minimum to ${min} mm.` };
  }
  if (value > max) {
    return { field, code: "above_maximum", message: `${label}: maksimum to ${max} mm.` };
  }
  return null;
}

/**
 * Structural checks on the subdivision tree. Written against `unknown` so that it also
 * guards data that bypassed the type system (e.g. imported JSON).
 */
function validateCompartmentTree(root: unknown, limits: ConstructionLimits): CabinetValidationError[] {
  const errors: CabinetValidationError[] = [];
  const seen = new Set<string>();
  let leafCount = 0;
  let deepestLevel = 0;

  const structureError = (message: string, compartmentId?: string) =>
    errors.push({ field: "compartments", code: "invalid_structure", message, compartmentId });

  const visit = (node: unknown, level: number) => {
    if (typeof node !== "object" || node === null) return structureError("Każdy przedział musi być obiektem.");
    const { id, split, children } = node as { id?: unknown; split?: unknown; children?: unknown };
    if (typeof id !== "string" || id === "") return structureError("Każdy przedział musi mieć niepusty identyfikator.");

    if (seen.has(id)) {
      errors.push({
        field: "compartments",
        code: "duplicate_compartment_id",
        message: `Identyfikator przedziału „${id}” występuje więcej niż raz.`,
        compartmentId: id,
      });
    }
    seen.add(id);

    if (split === undefined) {
      if (children !== undefined) structureError(`Przedział „${id}” ma przedziały podrzędne, ale nie ma podziału.`, id);
      leafCount++;
      deepestLevel = Math.max(deepestLevel, level);
      return;
    }

    const { direction, ratio } = (split ?? {}) as { direction?: unknown; ratio?: unknown };
    if (direction !== "horizontal" && direction !== "vertical") {
      structureError(`Przedział „${id}” ma nieznany kierunek podziału.`, id);
    }
    if (typeof ratio !== "number" || !isValidSplitRatio(ratio)) {
      errors.push({
        field: "compartments",
        code: "invalid_split_ratio",
        message: `Proporcja podziału przedziału „${id}” musi mieścić się między 0 a 1.`,
        compartmentId: id,
      });
    }
    if (!Array.isArray(children) || children.length !== 2) {
      return structureError(`Podzielony przedział „${id}” musi mieć dokładnie dwa przedziały podrzędne.`, id);
    }
    // Stop descending far beyond the limit so malformed input cannot exhaust the stack.
    if (level > limits.maxSubdivisionDepth + 1) return;
    children.forEach((child) => visit(child, level + 1));
  };

  visit(root, 0);

  if (deepestLevel > limits.maxSubdivisionDepth) {
    errors.push({
      field: "compartments",
      code: "max_depth_exceeded",
      message: `Podziały można zagnieżdżać maksymalnie na ${limits.maxSubdivisionDepth} poziomach.`,
    });
  }
  if (leafCount > limits.maxLeafCompartments) {
    errors.push({
      field: "compartments",
      code: "max_leaves_exceeded",
      message: `Szafka może mieć maksymalnie ${limits.maxLeafCompartments} ${pluralPl(limits.maxLeafCompartments, { one: "przedział", few: "przedziały", many: "przedziałów" })}.`,
    });
  }
  return errors;
}

/** Every compartment created by a split must stay above the minimum size. */
function validateCompartmentSizes(
  layouts: readonly CompartmentLayout[],
  limits: ConstructionLimits,
): CabinetValidationError[] {
  const errors: CabinetValidationError[] = [];
  for (const { id, isLeaf, level, bounds } of layouts) {
    if (!isLeaf || level === 0) continue;
    const { width, height } = bounds.dimensions;
    if (width < limits.minCompartmentWidth) {
      errors.push({
        field: "compartments",
        code: "compartment_too_narrow",
        message: `Przedział „${id}” miałby ${formatMm(width)} mm szerokości; minimum to ${limits.minCompartmentWidth} mm.`,
        compartmentId: id,
      });
    }
    if (height < limits.minCompartmentHeight) {
      errors.push({
        field: "compartments",
        code: "compartment_too_low",
        message: `Przedział „${id}” miałby ${formatMm(height)} mm wysokości; minimum to ${limits.minCompartmentHeight} mm.`,
        compartmentId: id,
      });
    }
  }
  return errors;
}

/**
 * Validates a cabinet configuration. Never clamps or mutates values;
 * every problem is reported as a structured error.
 */
export function validateCabinet(
  configuration: CabinetConfiguration,
  limits: CabinetLimits = CABINET_LIMITS,
  construction: ConstructionLimits = CONSTRUCTION_LIMITS,
): CabinetValidationResult {
  const errors: CabinetValidationError[] = [];
  const push = (error: CabinetValidationError | null) => error && errors.push(error);

  for (const key of DIMENSION_KEYS) push(validateRange(key, configuration[key], limits[key]));

  const { backPanel, plinth } = configuration;
  if (backPanel?.enabled) {
    push(validateRange("backPanel.thickness", backPanel.thickness, construction.backPanelThickness));
  }
  if (plinth?.enabled) {
    push(validateRange("plinth.height", plinth.height, construction.plinthHeight));
    push(validateRange("plinth.setback", plinth.setback, construction.plinthSetback));
  }

  // Cross-field geometry checks only make sense once the individual values are usable numbers.
  const { width, height, panelThickness } = configuration;
  const usable = errors.length === 0;
  if (usable) {
    if (width - 2 * panelThickness <= 0) {
      errors.push({
        field: "panelThickness",
        code: "panels_exceed_width",
        message: `Dwa boki (2 × ${panelThickness} mm) nie zostawiają miejsca we wnętrzu szafki o szerokości ${width} mm.`,
      });
    }
    if (height - 2 * panelThickness <= 0) {
      errors.push({
        field: "panelThickness",
        code: "panels_exceed_height",
        message: `Wieniec górny i dolny (2 × ${panelThickness} mm) nie zostawiają miejsca we wnętrzu szafki o wysokości ${height} mm.`,
      });
    } else if (plinth?.enabled && height - plinth.height - 2 * panelThickness <= 0) {
      errors.push({
        field: "plinth.height",
        code: "plinth_exceeds_height",
        message: `Cokół o wysokości ${plinth.height} mm nie zostawia miejsca na korpus szafki o wysokości ${height} mm.`,
      });
    }
  }

  for (const slot of MATERIAL_SLOTS) {
    const materialId: unknown = configuration.materials?.[slot];
    if (!isMaterialId(materialId)) {
      errors.push({
        field: `materials.${slot}`,
        code: "unknown_material",
        message: `Nieznany materiał ${MATERIAL_SLOT_LABELS[slot]}: „${String(materialId)}”.`,
      });
    }
  }

  const structureErrors = validateCompartmentTree(configuration.compartments, construction);
  errors.push(...structureErrors);
  // Sizes are derived from the dimensions and the tree, so they are only meaningful when both are sound.
  if (errors.length === 0) {
    const layouts = calculateCompartmentBounds(configuration);
    errors.push(...validateCompartmentSizes(layouts, construction));
    // Doors and drawers are sized from the compartments, so they are checked once those are valid.
    if (errors.length === 0) errors.push(...validateAttachments(configuration, layouts));
  }

  return { isValid: errors.length === 0, errors };
}

export class InvalidCabinetConfigurationError extends Error {
  readonly errors: readonly CabinetValidationError[];

  constructor(errors: readonly CabinetValidationError[]) {
    super(`Nieprawidłowa konfiguracja szafki: ${errors.map((e) => e.message).join(" ")}`);
    this.name = "InvalidCabinetConfigurationError";
    this.errors = errors;
  }
}

export function assertValidCabinet(
  configuration: CabinetConfiguration,
  limits: CabinetLimits = CABINET_LIMITS,
  construction: ConstructionLimits = CONSTRUCTION_LIMITS,
): void {
  const result = validateCabinet(configuration, limits, construction);
  if (!result.isValid) throw new InvalidCabinetConfigurationError(result.errors);
}
