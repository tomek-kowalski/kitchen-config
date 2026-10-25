import { DEFAULT_HANDLE } from "../attachments/operations";
import { DOOR_RULES } from "../attachments/rules";
import type { FurnitureAttachment, HandleConfiguration } from "../attachments/types";
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
 * - v5: v4 plus door `maxOpenAngle`, drawer `placement` (exterior / interior) and `heightRatios`,
 *   and a `handle` on every door and drawer assembly.
 * - v4: v3 plus `cabinet.attachments` (doors and drawers) and the `doorFront` / `drawerFront`
 *   material slots.
 *   Each structural extension is a new version (rather than optional fields) so that an older
 *   reader can never silently drop data it does not understand.
 *
 * Older versions are migrated step by step (v1 → v2 → v3 → v4 → v5) before validation. Every field keeps
 * its meaning across versions; migrations only add fields, with defaults equal to the old behavior
 * (no back panel, no plinth, an undivided interior, no doors or drawers, oak fronts).
 */
export const CABINET_SCHEMA_VERSION = 5;

/** The material slots that existed in schema v2 and v3. */
const V2_MATERIAL_SLOTS = ["body", "interior", "backPanel", "plinth"] as const;

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

function serializeHandle({ type, finish, align, edgeOffset, alignOffset }: HandleConfiguration): HandleConfiguration {
  return { type, finish, align, edgeOffset, alignOffset };
}

function serializeAttachment(attachment: FurnitureAttachment): FurnitureAttachment {
  const { id, compartmentId } = attachment;
  if (attachment.type === "door") {
    const { layout, mounting, hinge, gap, centerGap, maxOpenAngle, handle } = attachment.configuration;
    return {
      id,
      type: "door",
      compartmentId,
      configuration: { layout, mounting, hinge, gap, centerGap, maxOpenAngle, handle: serializeHandle(handle) },
    };
  }
  const { count, placement, mounting, frontGap, depth, heightRatios, handle } = attachment.configuration;
  return {
    id,
    type: "drawer",
    compartmentId,
    configuration: {
      count,
      placement,
      mounting,
      frontGap,
      depth,
      heightRatios: heightRatios ? [...heightRatios] : null,
      handle: serializeHandle(handle),
    },
  };
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
  const { width, height, depth, panelThickness, materials, backPanel, plinth, compartments, attachments } = configuration;
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
        doorFront: materials.doorFront,
        drawerFront: materials.drawerFront,
      },
      backPanel: { enabled: backPanel.enabled, thickness: backPanel.thickness },
      plinth: { enabled: plinth.enabled, height: plinth.height, setback: plinth.setback },
      compartments: serializeCompartment(compartments),
      attachments: attachments.map(serializeAttachment),
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
  const materials = Object.fromEntries(V2_MATERIAL_SLOTS.map((slot) => [slot, materialId]));
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

/** v3 → v4: no doors or drawers yet; the new front slots get the default (oak) finish. */
function migrateV3(document: JsonRecord): JsonRecord {
  const { cabinet } = document;
  if (!isRecord(cabinet)) return { schemaVersion: 4, cabinet };
  const materials = isRecord(cabinet.materials)
    ? { ...cabinet.materials, doorFront: DEFAULT_MATERIAL_ID, drawerFront: DEFAULT_MATERIAL_ID }
    : cabinet.materials;
  return { schemaVersion: 4, cabinet: { ...cabinet, materials, attachments: [] } };
}

/**
 * v4 → v5: drawers become exterior drawers with equal heights (identical layout), doors keep
 * their settings and get the former fixed opening angle; every assembly gets "no handle".
 * Entries that are not objects are left alone and rejected by the reader.
 */
function migrateV4(document: JsonRecord): JsonRecord {
  const { cabinet } = document;
  if (!isRecord(cabinet) || !Array.isArray(cabinet.attachments)) return { ...document, schemaVersion: 5 };
  const attachments = cabinet.attachments.map((attachment: unknown) => {
    if (!isRecord(attachment) || !isRecord(attachment.configuration)) return attachment;
    const extra =
      attachment.type === "door"
        ? { maxOpenAngle: DOOR_RULES.maxOpenAngleDeg, handle: DEFAULT_HANDLE }
        : { placement: "exterior", heightRatios: null, handle: DEFAULT_HANDLE };
    return { ...attachment, configuration: { ...attachment.configuration, ...extra } };
  });
  return { schemaVersion: 5, cabinet: { ...cabinet, attachments } };
}

const HANDLE_FIELDS = { type: "string", finish: "string", align: "string", edgeOffset: "number", alignOffset: "number" } as const;

/** Rebuilds a typed attachment from untrusted JSON, keeping only known fields; semantics are validated later. */
function readAttachment(value: unknown, path: string, issues: CabinetImportIssue[]): FurnitureAttachment | null {
  if (!isRecord(value)) {
    issues.push({ path, message: "Oczekiwano obiektu drzwi lub szuflad." });
    return null;
  }
  const before = issues.length;
  const expect = (field: string, actual: unknown, type: "string" | "number", message: string) => {
    if (typeof actual !== type) issues.push({ path: `${path}.${field}`, message });
  };
  expect("id", value.id, "string", "Oczekiwano identyfikatora.");
  expect("compartmentId", value.compartmentId, "string", "Oczekiwano identyfikatora przedziału.");
  if (value.type !== "door" && value.type !== "drawer") {
    issues.push({ path: `${path}.type`, message: "Oczekiwano „door” lub „drawer”." });
    return null;
  }
  const c = value.configuration;
  if (!isRecord(c)) {
    issues.push({ path: `${path}.configuration`, message: "Oczekiwano obiektu konfiguracji." });
    return null;
  }
  const fields: Readonly<Record<string, "string" | "number">> =
    value.type === "door"
      ? { layout: "string", mounting: "string", hinge: "string", gap: "number", centerGap: "number", maxOpenAngle: "number" }
      : { count: "number", placement: "string", mounting: "string", frontGap: "number", depth: "number" };
  for (const [field, type] of Object.entries(fields)) {
    expect(`configuration.${field}`, c[field], type, type === "number" ? "Oczekiwano liczby." : "Oczekiwano tekstu.");
  }
  if (value.type === "drawer") {
    const ratios = c.heightRatios;
    if (ratios !== null && !(Array.isArray(ratios) && ratios.every((r) => typeof r === "number"))) {
      issues.push({ path: `${path}.configuration.heightRatios`, message: "Oczekiwano null lub listy liczb." });
    }
  }
  const handle = c.handle;
  if (!isRecord(handle)) {
    issues.push({ path: `${path}.configuration.handle`, message: "Oczekiwano obiektu uchwytu." });
  } else {
    for (const [field, type] of Object.entries(HANDLE_FIELDS)) {
      expect(`configuration.handle.${field}`, handle[field], type, type === "number" ? "Oczekiwano liczby." : "Oczekiwano tekstu.");
    }
  }
  if (issues.length > before) return null;

  const configuration: JsonRecord = Object.fromEntries(Object.keys(fields).map((field) => [field, c[field]]));
  if (value.type === "drawer") configuration.heightRatios = Array.isArray(c.heightRatios) ? [...c.heightRatios] : null;
  configuration.handle = Object.fromEntries(Object.keys(HANDLE_FIELDS).map((field) => [field, (handle as JsonRecord)[field]]));
  // Field types were checked above; enum values and ranges are checked by validateCabinet.
  return { id: value.id, type: value.type, compartmentId: value.compartmentId, configuration } as unknown as FurnitureAttachment;
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

function readV4(document: JsonRecord): CabinetImportResult | CabinetConfiguration {
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

  const attachments: FurnitureAttachment[] = [];
  if (!Array.isArray(cabinet.attachments)) {
    issues.push({ path: "cabinet.attachments", message: "Oczekiwano listy drzwi i szuflad." });
  } else {
    cabinet.attachments.forEach((value, index) => {
      const attachment = readAttachment(value, `cabinet.attachments[${index}]`, issues);
      if (attachment) attachments.push(attachment);
    });
  }
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
    attachments,
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
  if (version !== 1 && version !== 2 && version !== 3 && version !== 4 && version !== CABINET_SCHEMA_VERSION) {
    return failure({ path: "schemaVersion", message: `Nieobsługiwana wersja schematu: ${JSON.stringify(version)}.` });
  }

  let current = data;
  if (version === 1) current = migrateV1(current);
  if (version === 1 || version === 2) current = migrateV2(current);
  if (version === 1 || version === 2 || version === 3) current = migrateV3(current);
  if (version === 1 || version === 2 || version === 3 || version === 4) current = migrateV4(current);

  const read = readV4(current);
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
