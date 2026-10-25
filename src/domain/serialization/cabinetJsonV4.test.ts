import { describe, expect, it } from "vitest";
import { DEFAULT_CABINET } from "../furniture/defaults";
import type { CabinetConfiguration } from "../furniture/types";
import { exportCabinetJson, importCabinetJson, parseCabinetDocument, type CabinetImportResult } from "./cabinetJson";

const NO_HANDLE = { type: "none", finish: "brushed-steel", align: "center", edgeOffset: 40, alignOffset: 100 } as const;

const CONFIGURATION: CabinetConfiguration = {
  ...DEFAULT_CABINET,
  materials: { ...DEFAULT_CABINET.materials, doorFront: "walnut", drawerFront: "anthracite" },
  compartments: {
    id: "root",
    split: { direction: "horizontal", ratio: 0.5 },
    children: [{ id: "c1" }, { id: "c2", split: { direction: "vertical", ratio: 0.5 }, children: [{ id: "c3" }, { id: "c4" }] }],
  },
  attachments: [
    {
      id: "a1",
      type: "drawer",
      compartmentId: "c1",
      configuration: { count: 3, placement: "exterior", mounting: "overlay", frontGap: 3, depth: 450, heightRatios: null, handle: NO_HANDLE },
    },
    {
      id: "a7",
      type: "door",
      compartmentId: "c4",
      configuration: { layout: "single", mounting: "inset", hinge: "right", gap: 2, centerGap: 3, maxOpenAngle: 100, handle: NO_HANDLE },
    },
  ],
};

function document() {
  return JSON.parse(exportCabinetJson(CONFIGURATION));
}

function issues(result: CabinetImportResult) {
  if (result.ok) throw new Error("Expected the import to fail");
  return result.issues;
}

describe("schema v4", () => {
  it("round-trips attachments, their IDs and the front materials", () => {
    const result = importCabinetJson(exportCabinetJson(CONFIGURATION));
    expect(result).toEqual({ ok: true, configuration: CONFIGURATION, migratedFrom: null });
  });

  it("writes attachments with a stable field order", () => {
    expect(document().cabinet.attachments[1]).toEqual({
      id: "a7",
      type: "door",
      compartmentId: "c4",
      configuration: { layout: "single", mounting: "inset", hinge: "right", gap: 2, centerGap: 3, maxOpenAngle: 100, handle: NO_HANDLE },
    });
    expect(Object.keys(document().cabinet.attachments[0].configuration)).toEqual([
      "count",
      "placement",
      "mounting",
      "frontGap",
      "depth",
      "heightRatios",
      "handle",
    ]);
  });

  it("migrates v3 documents: no attachments, oak fronts, everything else preserved", () => {
    const v3 = document();
    v3.schemaVersion = 3;
    delete v3.cabinet.attachments;
    delete v3.cabinet.materials.doorFront;
    delete v3.cabinet.materials.drawerFront;
    const result = parseCabinetDocument(v3);
    expect(result).toEqual({
      ok: true,
      migratedFrom: 3,
      configuration: {
        ...CONFIGURATION,
        materials: { ...CONFIGURATION.materials, doorFront: "natural-oak", drawerFront: "natural-oak" },
        attachments: [],
      },
    });
  });

  it("ignores attachment-like data in older documents rather than guessing its meaning", () => {
    const v3 = document();
    v3.schemaVersion = 3;
    const result = parseCabinetDocument(v3);
    expect(result.ok && result.configuration.attachments).toEqual([]);
  });

  it("drops unknown properties of attachments", () => {
    const doc = document();
    doc.cabinet.attachments[0].color = "#000";
    doc.cabinet.attachments[0].configuration.runner = "blum";
    const result = parseCabinetDocument(doc);
    expect(result.ok && result.configuration.attachments).toEqual(CONFIGURATION.attachments);
  });

  it.each([
    ["duplicate IDs", (d: ReturnType<typeof document>) => void (d.cabinet.attachments[1].id = "a1"), /występuje więcej niż raz/],
    ["missing compartments", (d: ReturnType<typeof document>) => void (d.cabinet.attachments[0].compartmentId = "c9"), /„c9” nie istnieje/],
    ["subdivided compartments", (d: ReturnType<typeof document>) => void (d.cabinet.attachments[0].compartmentId = "c2"), /jest podzielony/],
    ["conflicting attachments", (d: ReturnType<typeof document>) => void (d.cabinet.attachments[1].compartmentId = "c1"), /jest już zajęty/],
    ["invalid door options", (d: ReturnType<typeof document>) => void (d.cabinet.attachments[1].configuration.hinge = "top"), /zawiasów/],
    ["invalid drawer counts", (d: ReturnType<typeof document>) => void (d.cabinet.attachments[0].configuration.count = 9), /liczba szuflad/],
    ["drawers deeper than the cabinet", (d: ReturnType<typeof document>) => void (d.cabinet.attachments[0].configuration.depth = 900), /głębokość szuflady/],
  ])("rejects %s without discarding them silently", (_, mutate, message) => {
    const doc = document();
    mutate(doc);
    const [issue] = issues(parseCabinetDocument(doc));
    expect(issue.path).toBe("cabinet.attachments");
    expect(issue.message).toMatch(message);
  });

  it("rejects malformed attachment entries with precise paths", () => {
    const doc = document();
    doc.cabinet.attachments[0].type = "shelf";
    doc.cabinet.attachments[1].configuration.gap = "2";
    delete doc.cabinet.attachments[1].id;
    expect(issues(parseCabinetDocument(doc)).map((i) => i.path)).toEqual([
      "cabinet.attachments[0].type",
      "cabinet.attachments[1].id",
      "cabinet.attachments[1].configuration.gap",
    ]);
    const missing = document();
    delete missing.cabinet.attachments;
    expect(issues(parseCabinetDocument(missing)).map((i) => i.path)).toEqual(["cabinet.attachments"]);
  });

  it("rejects unknown front materials", () => {
    const doc = document();
    doc.cabinet.materials.drawerFront = "gold";
    expect(issues(parseCabinetDocument(doc)).map((i) => i.path)).toEqual(["cabinet.materials.drawerFront"]);
  });
});
