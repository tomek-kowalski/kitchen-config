import { isBranch, type CompartmentNode } from "../compartments/types";
import { validateCabinet } from "../constraints/validateCabinet";
import {
  CABINET_LIMITS,
  CONSTRUCTION_LIMITS,
  DEFAULT_BACK_PANEL,
  DEFAULT_COMPARTMENTS,
  DEFAULT_MATERIAL_ID,
  DEFAULT_PLINTH,
} from "../furniture/defaults";
import { MATERIAL_SLOTS, type MaterialId, type MaterialSlot } from "../furniture/materials";
import type { CabinetConfiguration, CabinetDimensionKey, CabinetLimits, ConstructionLimits } from "../furniture/types";

/**
 * Versioned JSON document for cabinet configurations.
 *
 * - v1: the Phase 1 configuration object `{ width, height, depth, panelThickness, materialId? }`,
 *   recognised by the absence of `schemaVersion` (or `schemaVersion: 1`).
 * - v2: `{ schemaVersion: 2, cabinet: { ...dimensions, materials: { body, interior, backPanel, plinth } } }`.
 * - v3: v2 plus `cabinet.backPanel`, `cabinet.plinth` and the `cabinet.compartments` tree.
 *   A new version (rather than optional v2 fields) so that a v2 reader can never silently
 *   drop a structure it does not understand.
 *
 * Older versions are migrated step by step (v1 → v2 → v3) before validation. Every field keeps
 * its meaning across versions; migrations only add fields, with defaults equal to the old behavior
 * (no back panel, no plinth, an undivided interior).
 */
export const CABINET_SCHEMA_VERSION = 3;

export interface CabinetDocument {
  readonly schemaVersion: typeof CABINET_SCHEMA_VERSION;
  readonly cabinet: CabinetConfiguration;
}

export interface CabinetImportIssue {
  /** Dotted path of the offending value within the document, e.g. `cabinet.materials.body`. */
  readonly path: string;
  readonly message: string;
}

export type CabinetImportResult =
  | { readonly ok: true; readonly configuration: CabinetConfiguration; readonly migratedFrom: number | null }
  | { readonly ok: false; readonly issues: readonly CabinetImportIssue[] };

/** Phase 1 material IDs that were renamed in the catalog. */
const LEGACY_MATERIAL_IDS: Readonly<Record<string, MaterialId>> = { oak: "natural-oak" };

const DIMENSION_KEYS: readonly CabinetDimensionKey[] = ["width", "height", "depth", "panelThickness"];

/** Hard stop for recursion on untrusted input; far above the real nesting limit. */
const MAX_PARSE_DEPTH = 64;

const MM_EXPECTED = "Oczekiwano liczby w milimetrach.";
const BOOLEAN_EXPECTED = "Oczekiwano wartości true lub false.";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure(...issues: CabinetImportIssue[]): CabinetImportResult {
  return { ok: false, issues };
}

function serializeCompartment(node: CompartmentNode): CompartmentNode {
  if (!isBranch(node)) return { id: node.id };
  return {
    id: node.id,
    split: { direction: node.split.direction, ratio: node.split.ratio },
    children: [serializeCompartment(node.children[0]), serializeCompartment(node.children[1])],
  };
}

export function toCabinetDocument(configuration: CabinetConfiguration): CabinetDocument {
  const { width, height, depth, panelThickness, materials, backPanel, plinth, compartments } = configuration;
  // Fields are listed explicitly so the output has a stable key order and no stray properties.
  return {
    schemaVersion: CABINET_SCHEMA_VERSION,
    cabinet: {
      width,
      height,
      depth,
      panelThickness,
      materials: {
        body: materials.body,
        interior: materials.interior,
        backPanel: materials.backPanel,
        plinth: materials.plinth,
      },
      backPanel: { enabled: backPanel.enabled, thickness: backPanel.thickness },
      plinth: { enabled: plinth.enabled, height: plinth.height, setback: plinth.setback },
      compartments: serializeCompartment(compartments),
    },
  };
}

export function exportCabinetJson(configuration: CabinetConfiguration): string {
  return JSON.stringify(toCabinetDocument(configuration), null, 2);
}

function migrateLegacyMaterialId(value: unknown): unknown {
  if (value === undefined) return DEFAULT_MATERIAL_ID;
  if (typeof value === "string" && Object.hasOwn(LEGACY_MATERIAL_IDS, value)) return LEGACY_MATERIAL_IDS[value];
  // Anything else is passed through unchanged and rejected later if it is not a catalog ID.
  return value;
}

/** v1 → v2: the single Phase 1 material applies to every slot; a missing one becomes the oak finish. */
function migrateV1(document: JsonRecord): JsonRecord {
  const materialId = migrateLegacyMaterialId(document.materialId);
  const materials = Object.fromEntries(MATERIAL_SLOTS.map((slot) => [slot, materialId]));
  return {
    schemaVersion: 2,
    cabinet: {
      width: document.width,
      height: document.height,
      depth: document.depth,
      panelThickness: document.panelThickness,
      materials,
    },
  };
}

/** v2 → v3: adds the optional components (disabled) and an undivided interior. */
function migrateV2(document: JsonRecord): JsonRecord {
  const { cabinet } = document;
  return {
    schemaVersion: 3,
    cabinet: isRecord(cabinet)
      ? { ...cabinet, backPanel: DEFAULT_BACK_PANEL, plinth: DEFAULT_PLINTH, compartments: DEFAULT_COMPARTMENTS }
      : cabinet,
  };
}

/** Rebuilds a typed tree from untrusted JSON, keeping only known fields. Semantics are validated later. */
function readCompartment(value: unknown, path: string, depth: number, issues: CabinetImportIssue[]): CompartmentNode {
  if (depth > MAX_PARSE_DEPTH) {
    issues.push({ path, message: "Drzewo przedziałów jest zagnieżdżone zbyt głęboko." });
    return { id: "" };
  }
  if (!isRecord(value)) {
    issues.push({ path, message: "Oczekiwano obiektu przedziału." });
    return { id: "" };
  }
  if (typeof value.id !== "string") issues.push({ path: `${path}.id`, message: "Oczekiwano identyfikatora przedziału." });
  const id = typeof value.id === "string" ? value.id : "";

  if (value.split === undefined && value.children === undefined) return { id };

  const { split, children } = value;
  if (!isRecord(split)) {
    issues.push({ path: `${path}.split`, message: "Oczekiwano obiektu podziału." });
    return { id };
  }
  if (split.direction !== "horizontal" && split.direction !== "vertical") {
    issues.push({ path: `${path}.split.direction`, message: "Oczekiwano „horizontal” lub „vertical”." });
  }
  if (typeof split.ratio !== "number") {
    issues.push({ path: `${path}.split.ratio`, message: "Oczekiwano liczby." });
  }
  if (!Array.isArray(children) || children.length !== 2) {
    issues.push({ path: `${path}.children`, message: "Oczekiwano dokładnie dwóch przedziałów podrzędnych." });
    return { id };
  }
  return {
    id,
    split: { direction: split.direction === "vertical" ? "vertical" : "horizontal", ratio: split.ratio as number },
    children: [
      readCompartment(children[0], `${path}.children[0]`, depth + 1, issues),
      readCompartment(children[1], `${path}.children[1]`, depth + 1, issues),
    ],
  };
}

function readV3(document: JsonRecord): CabinetImportResult | CabinetConfiguration {
  const { cabinet } = document;
  if (!isRecord(cabinet)) return failure({ path: "cabinet", message: "Oczekiwano obiektu szafki." });

  const issues: CabinetImportIssue[] = [];
  const expectType = (value: unknown, type: "number" | "boolean" | "string", path: string, message: string) => {
    if (typeof value !== type) issues.push({ path, message });
  };

  for (const key of DIMENSION_KEYS) {
    expectType(cabinet[key], "number", `cabinet.${key}`, MM_EXPECTED);
  }

  const { materials, backPanel, plinth } = cabinet;
  if (!isRecord(materials)) {
    issues.push({ path: "cabinet.materials", message: "Oczekiwano obiektu materiałów." });
  } else {
    for (const slot of MATERIAL_SLOTS) {
      expectType(materials[slot], "string", `cabinet.materials.${slot}`, "Oczekiwano identyfikatora materiału.");
    }
  }

  if (!isRecord(backPanel)) {
    issues.push({ path: "cabinet.backPanel", message: "Oczekiwano obiektu pleców." });
  } else {
    expectType(backPanel.enabled, "boolean", "cabinet.backPanel.enabled", BOOLEAN_EXPECTED);
    expectType(backPanel.thickness, "number", "cabinet.backPanel.thickness", MM_EXPECTED);
  }

  if (!isRecord(plinth)) {
    issues.push({ path: "cabinet.plinth", message: "Oczekiwano obiektu cokołu." });
  } else {
    expectType(plinth.enabled, "boolean", "cabinet.plinth.enabled", BOOLEAN_EXPECTED);
    expectType(plinth.height, "number", "cabinet.plinth.height", MM_EXPECTED);
    expectType(plinth.setback, "number", "cabinet.plinth.setback", MM_EXPECTED);
  }

  const compartments = readCompartment(cabinet.compartments, "cabinet.compartments", 0, issues);
  if (issues.length > 0) return failure(...issues);

  // Shapes are checked above; catalog membership, ranges and tree rules are checked by validateCabinet.
  const back = backPanel as JsonRecord;
  const base = plinth as JsonRecord;
  return {
    width: cabinet.width as number,
    height: cabinet.height as number,
    depth: cabinet.depth as number,
    panelThickness: cabinet.panelThickness as number,
    materials: Object.fromEntries(
      MATERIAL_SLOTS.map((slot) => [slot, (materials as JsonRecord)[slot]]),
    ) as Record<MaterialSlot, MaterialId>,
    backPanel: { enabled: back.enabled as boolean, thickness: back.thickness as number },
    plinth: { enabled: base.enabled as boolean, height: base.height as number, setback: base.setback as number },
    compartments,
  };
}

/** Parses an already-decoded JSON value, migrating older schema versions. Never clamps or guesses values. */
export function parseCabinetDocument(
  data: unknown,
  limits: CabinetLimits = CABINET_LIMITS,
  construction: ConstructionLimits = CONSTRUCTION_LIMITS,
): CabinetImportResult {
  if (!isRecord(data)) return failure({ path: "", message: "Oczekiwano obiektu JSON." });

  // Only an absent field means v1; an explicit null or any other value must be a supported version.
  const version = "schemaVersion" in data ? data.schemaVersion : 1;
  if (version !== 1 && version !== 2 && version !== CABINET_SCHEMA_VERSION) {
    return failure({ path: "schemaVersion", message: `Nieobsługiwana wersja schematu: ${JSON.stringify(version)}.` });
  }

  let current = data;
  if (version === 1) current = migrateV1(current);
  if (version === 1 || version === 2) current = migrateV2(current);

  const read = readV3(current);
  if ("ok" in read) return read;

  const validation = validateCabinet(read, limits, construction);
  if (!validation.isValid) {
    return failure(...validation.errors.map((e) => ({ path: `cabinet.${e.field}`, message: e.message })));
  }
  return { ok: true, configuration: read, migratedFrom: version === CABINET_SCHEMA_VERSION ? null : version };
}

export function importCabinetJson(
  json: string,
  limits: CabinetLimits = CABINET_LIMITS,
  construction: ConstructionLimits = CONSTRUCTION_LIMITS,
): CabinetImportResult {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return failure({ path: "", message: "Plik nie zawiera poprawnego JSON-a." });
  }
  return parseCabinetDocument(data, limits, construction);
}
