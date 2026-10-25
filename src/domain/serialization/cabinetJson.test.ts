import { describe, expect, it } from "vitest";
import { DEFAULT_CABINET } from "../furniture/defaults";
import type { CabinetConfiguration } from "../furniture/types";
import {
  CABINET_SCHEMA_VERSION,
  exportCabinetJson,
  importCabinetJson,
  parseCabinetDocument,
  type CabinetImportResult,
} from "./cabinetJson";

const NO_HANDLE = { type: "none", finish: "brushed-steel", align: "center", edgeOffset: 40, alignOffset: 100 } as const;

const CUSTOM: CabinetConfiguration = {
  width: 1200,
  height: 2000,
  depth: 450,
  panelThickness: 22,
  materials: {
    body: "anthracite",
    interior: "white-matte",
    backPanel: "light-grey",
    plinth: "black-matte",
    doorFront: "walnut",
    drawerFront: "cashmere",
  },
  backPanel: { enabled: true, thickness: 6 },
  plinth: { enabled: true, height: 100, setback: 40 },
  compartments: {
    id: "root",
    split: { direction: "horizontal", ratio: 0.4 },
    children: [{ id: "c1" }, { id: "c2", split: { direction: "vertical", ratio: 0.5 }, children: [{ id: "c3" }, { id: "c4" }] }],
  },
  attachments: [
    {
      id: "a1",
      type: "door",
      compartmentId: "c1",
      configuration: { layout: "double", mounting: "overlay", hinge: "left", gap: 2, centerGap: 3, maxOpenAngle: 100, handle: NO_HANDLE },
    },
    {
      id: "a2",
      type: "drawer",
      compartmentId: "c3",
      configuration: { count: 3, placement: "exterior", mounting: "inset", frontGap: 3, depth: 350, heightRatios: null, handle: NO_HANDLE },
    },
  ],
};

function expectOk(result: CabinetImportResult): CabinetConfiguration {
  if (!result.ok) throw new Error(`Import failed: ${JSON.stringify(result.issues)}`);
  return result.configuration;
}

function issuePaths(result: CabinetImportResult): string[] {
  if (result.ok) throw new Error("Expected the import to fail");
  return result.issues.map((i) => i.path);
}

describe("exportCabinetJson / importCabinetJson", () => {
  it("round-trips every material selection and dimension", () => {
    const json = exportCabinetJson(CUSTOM);
    const result = importCabinetJson(json);
    expect(expectOk(result)).toEqual(CUSTOM);
    expect(result.ok && result.migratedFrom).toBeNull();
  });

  it("writes a versioned document that stores material IDs, not colors", () => {
    const document = JSON.parse(exportCabinetJson(CUSTOM));
    expect(document).toEqual({
      schemaVersion: CABINET_SCHEMA_VERSION,
      cabinet: {
        width: 1200,
        height: 2000,
        depth: 450,
        panelThickness: 22,
        materials: {
          body: "anthracite",
          interior: "white-matte",
          backPanel: "light-grey",
          plinth: "black-matte",
          doorFront: "walnut",
          drawerFront: "cashmere",
        },
        backPanel: { enabled: true, thickness: 6 },
        plinth: { enabled: true, height: 100, setback: 40 },
        compartments: {
          id: "root",
          split: { direction: "horizontal", ratio: 0.4 },
          children: [
            { id: "c1" },
            { id: "c2", split: { direction: "vertical", ratio: 0.5 }, children: [{ id: "c3" }, { id: "c4" }] },
          ],
        },
        attachments: [
          {
            id: "a1",
            type: "door",
            compartmentId: "c1",
            configuration: { layout: "double", mounting: "overlay", hinge: "left", gap: 2, centerGap: 3, maxOpenAngle: 100, handle: NO_HANDLE },
          },
          {
            id: "a2",
            type: "drawer",
            compartmentId: "c3",
            configuration: { count: 3, placement: "exterior", mounting: "inset", frontGap: 3, depth: 350, heightRatios: null, handle: NO_HANDLE },
          },
        ],
      },
    });
    expect(exportCabinetJson(CUSTOM)).not.toMatch(/#[0-9a-f]{6}/i);
  });

  it("is deterministic", () => {
    expect(exportCabinetJson({ ...CUSTOM })).toBe(exportCabinetJson(CUSTOM));
  });

  it("keeps body and interior selections independent through a round trip", () => {
    const config = { ...DEFAULT_CABINET, materials: { ...DEFAULT_CABINET.materials, interior: "walnut" as const } };
    const imported = expectOk(importCabinetJson(exportCabinetJson(config)));
    expect(imported.materials.body).toBe("natural-oak");
    expect(imported.materials.interior).toBe("walnut");
  });

  it("rejects unknown material IDs instead of replacing them", () => {
    const document = JSON.parse(exportCabinetJson(CUSTOM));
    document.cabinet.materials.backPanel = "mahogany";
    document.cabinet.materials.plinth = "#FFFFFF";
    expect(issuePaths(parseCabinetDocument(document))).toEqual([
      "cabinet.materials.backPanel",
      "cabinet.materials.plinth",
    ]);
  });

  it("rejects missing or mistyped material selections in current-version documents", () => {
    const document = JSON.parse(exportCabinetJson(CUSTOM));
    delete document.cabinet.materials.interior;
    document.cabinet.materials.body = 3;
    expect(issuePaths(parseCabinetDocument(document))).toEqual(["cabinet.materials.body", "cabinet.materials.interior"]);
  });

  it("rejects malformed input with structured issues", () => {
    expect(issuePaths(importCabinetJson("{not json"))).toEqual([""]);
    expect(issuePaths(importCabinetJson("[]"))).toEqual([""]);
    expect(issuePaths(parseCabinetDocument({ schemaVersion: 99, cabinet: {} }))).toEqual(["schemaVersion"]);
    expect(issuePaths(parseCabinetDocument({ schemaVersion: 2 }))).toEqual(["cabinet"]);
    expect(
      issuePaths(parseCabinetDocument({ schemaVersion: 2, cabinet: { ...CUSTOM, width: "800", materials: null } })),
    ).toEqual(["cabinet.width", "cabinet.materials"]);
  });

  it("validates dimensions without clamping them", () => {
    const document = JSON.parse(exportCabinetJson(CUSTOM));
    document.cabinet.width = 5000;
    const result = parseCabinetDocument(document);
    expect(issuePaths(result)).toEqual(["cabinet.width"]);
  });
});

describe("migration of Phase 1 configurations", () => {
  const PHASE_1 = { width: 800, height: 1800, depth: 500, panelThickness: 18, materialId: "oak" };

  it("maps the Phase 1 oak finish to natural-oak in every slot", () => {
    const result = parseCabinetDocument(PHASE_1);
    expect(expectOk(result)).toEqual(DEFAULT_CABINET);
    expect(result.ok && result.migratedFrom).toBe(1);
  });

  it("assigns the oak finish when the material selection is missing", () => {
    const withoutMaterial: Partial<typeof PHASE_1> = { ...PHASE_1 };
    delete withoutMaterial.materialId;
    expect(expectOk(parseCabinetDocument({ ...withoutMaterial, width: 1000 })).materials).toEqual(
      DEFAULT_CABINET.materials,
    );
  });

  it("accepts an explicit schemaVersion 1 and a current catalog ID", () => {
    const migrated = expectOk(parseCabinetDocument({ ...PHASE_1, schemaVersion: 1, materialId: "walnut" }));
    // v1 → v2 applies the single material to the four v2 slots; v3 → v4 adds the oak front slots.
    expect(migrated.materials).toEqual({
      body: "walnut",
      interior: "walnut",
      backPanel: "walnut",
      plinth: "walnut",
      doorFront: "natural-oak",
      drawerFront: "natural-oak",
    });
  });

  it("does not silently accept unknown legacy material IDs", () => {
    expect(issuePaths(parseCabinetDocument({ ...PHASE_1, materialId: "pine" }))).toEqual([
      "cabinet.materials.body",
      "cabinet.materials.interior",
      "cabinet.materials.backPanel",
      "cabinet.materials.plinth",
    ]);
    expect(parseCabinetDocument({ ...PHASE_1, materialId: "constructor" }).ok).toBe(false);
  });

  it("is deterministic and re-exports as the current schema version", () => {
    const first = expectOk(parseCabinetDocument(PHASE_1));
    const second = expectOk(parseCabinetDocument(structuredClone(PHASE_1)));
    expect(first).toEqual(second);
    expect(JSON.parse(exportCabinetJson(first)).schemaVersion).toBe(CABINET_SCHEMA_VERSION);
  });

  it("still validates migrated dimensions", () => {
    expect(issuePaths(parseCabinetDocument({ ...PHASE_1, depth: 0 }))).toEqual(["cabinet.depth"]);
  });

  it("migrates to an undivided interior without back panel or plinth", () => {
    const migrated = expectOk(parseCabinetDocument(PHASE_1));
    expect(migrated.compartments).toEqual({ id: "root" });
    expect(migrated.backPanel.enabled).toBe(false);
    expect(migrated.plinth.enabled).toBe(false);
  });
});

describe("schema v3: structure and optional components", () => {
  it("preserves the compartment tree, IDs, back panel and plinth settings", () => {
    const imported = expectOk(importCabinetJson(exportCabinetJson(CUSTOM)));
    expect(imported.compartments).toEqual(CUSTOM.compartments);
    expect(imported.backPanel).toEqual({ enabled: true, thickness: 6 });
    expect(imported.plinth).toEqual({ enabled: true, height: 100, setback: 40 });
  });

  it("drops unknown properties instead of carrying them into the configuration", () => {
    const document = JSON.parse(exportCabinetJson(CUSTOM));
    document.cabinet.compartments.color = "#ff0000";
    document.cabinet.compartments.children[0].bounds = { x: 1 };
    expect(expectOk(parseCabinetDocument(document)).compartments).toEqual(CUSTOM.compartments);
  });

  it("rejects duplicate compartment IDs", () => {
    const document = JSON.parse(exportCabinetJson(CUSTOM));
    document.cabinet.compartments.children[1].children[1].id = "c1";
    const result = parseCabinetDocument(document);
    expect(issuePaths(result)).toEqual(["cabinet.compartments"]);
    expect(!result.ok && result.issues[0].message).toMatch(/„c1” występuje więcej niż raz/);
  });

  it("rejects structurally malformed trees with precise paths", () => {
    const document = JSON.parse(exportCabinetJson(CUSTOM));
    document.cabinet.compartments.children[1].split.direction = "diagonal";
    document.cabinet.compartments.children[1].children = [{ id: "c3" }];
    document.cabinet.compartments.children[0].id = 5;
    expect(issuePaths(parseCabinetDocument(document))).toEqual([
      "cabinet.compartments.children[0].id",
      "cabinet.compartments.children[1].split.direction",
      "cabinet.compartments.children[1].children",
    ]);
  });

  it("rejects trees that violate the compartment limits", () => {
    const document = JSON.parse(exportCabinetJson(CUSTOM));
    document.cabinet.compartments.split.ratio = 0.02;
    const result = parseCabinetDocument(document);
    expect(!result.ok && result.issues.map((i) => i.message).join(" ")).toMatch(/minimum to 150 mm/);
  });

  it("rejects missing or mistyped optional component settings", () => {
    const document = JSON.parse(exportCabinetJson(CUSTOM));
    delete document.cabinet.backPanel;
    document.cabinet.plinth.enabled = "yes";
    expect(issuePaths(parseCabinetDocument(document))).toEqual(["cabinet.backPanel", "cabinet.plinth.enabled"]);
  });

  it("survives absurdly deep input without overflowing the stack", () => {
    let node: unknown = { id: "leaf" };
    for (let i = 0; i < 5000; i++) {
      node = { id: `n${i}`, split: { direction: "vertical", ratio: 0.5 }, children: [node, { id: `m${i}` }] };
    }
    const cabinet = { ...JSON.parse(exportCabinetJson(CUSTOM)).cabinet, compartments: node };
    expect(parseCabinetDocument({ schemaVersion: 3, cabinet }).ok).toBe(false);
  });

  it("rejects unsupported schema versions", () => {
    for (const schemaVersion of [0, 6, "3", "4", "5", null]) {
      expect(issuePaths(parseCabinetDocument({ schemaVersion, cabinet: {} }))).toEqual(["schemaVersion"]);
    }
  });
});

describe("migration of schema v2 documents", () => {
  const V2 = {
    schemaVersion: 2,
    cabinet: {
      width: 1000,
      height: 2000,
      depth: 450,
      panelThickness: 18,
      materials: { body: "walnut", interior: "white-matte", backPanel: "anthracite", plinth: "black-matte" },
    },
  };

  it("keeps dimensions and materials and adds an undivided interior without back panel or plinth", () => {
    const result = parseCabinetDocument(V2);
    expect(expectOk(result)).toEqual({
      ...V2.cabinet,
      materials: { ...V2.cabinet.materials, doorFront: "natural-oak", drawerFront: "natural-oak" },
      backPanel: { enabled: false, thickness: 8 },
      plinth: { enabled: false, height: 80, setback: 30 },
      compartments: { id: "root" },
      attachments: [],
    });
    expect(result.ok && result.migratedFrom).toBe(2);
  });

  it("re-exports migrated documents as the current schema with the same values", () => {
    const migrated = expectOk(parseCabinetDocument(V2));
    expect(expectOk(importCabinetJson(exportCabinetJson(migrated)))).toEqual(migrated);
    expect(JSON.parse(exportCabinetJson(migrated)).schemaVersion).toBe(CABINET_SCHEMA_VERSION);
  });

  it("still rejects unknown materials in v2 documents", () => {
    const document = structuredClone(V2);
    document.cabinet.materials.interior = "plywood";
    expect(issuePaths(parseCabinetDocument(document))).toEqual(["cabinet.materials.interior"]);
  });
});
