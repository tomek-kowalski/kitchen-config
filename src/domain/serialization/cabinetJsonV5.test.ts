import { describe, expect, it } from "vitest";
import { DEFAULT_HANDLE } from "../attachments/operations";
import type { CabinetConfiguration } from "../furniture/types";
import { DEFAULT_CABINET } from "../furniture/defaults";
import { exportCabinetJson, importCabinetJson, parseCabinetDocument, type CabinetImportResult } from "./cabinetJson";

/** Door on the root, shelves behind it, interior drawers with custom heights and handles. */
const CONFIGURATION: CabinetConfiguration = {
  ...DEFAULT_CABINET,
  compartments: {
    id: "root",
    split: { direction: "horizontal", ratio: 0.5 },
    children: [{ id: "c1" }, { id: "c2", split: { direction: "horizontal", ratio: 0.5 }, children: [{ id: "c3" }, { id: "c4" }] }],
  },
  attachments: [
    {
      id: "a1",
      type: "door",
      compartmentId: "root",
      configuration: {
        layout: "single",
        mounting: "overlay",
        hinge: "right",
        gap: 2,
        centerGap: 3,
        maxOpenAngle: 110,
        handle: { type: "bar", finish: "brass", align: "center", edgeOffset: 50, alignOffset: 100 },
      },
    },
    {
      id: "a2",
      type: "drawer",
      compartmentId: "c1",
      configuration: {
        count: 3,
        placement: "interior",
        mounting: "inset",
        frontGap: 3,
        depth: 400,
        heightRatios: [120, 180, 400],
        handle: { type: "recessed", finish: "black-matte", align: "top", edgeOffset: 40, alignOffset: 40 },
      },
    },
  ],
};

function issues(result: CabinetImportResult) {
  if (result.ok) throw new Error("Expected the import to fail");
  return result.issues;
}

const document = () => JSON.parse(exportCabinetJson(CONFIGURATION));

/** The configuration as a v4 document (no v5 fields; v4 knew only exterior drawers). */
function v4Document() {
  const doc = document();
  doc.schemaVersion = 4;
  doc.cabinet.attachments = [
    { id: "a1", type: "door", compartmentId: "c1", configuration: { layout: "single", mounting: "inset", hinge: "right", gap: 2, centerGap: 3 } },
    { id: "a7", type: "drawer", compartmentId: "c3", configuration: { count: 2, mounting: "overlay", frontGap: 3, depth: 450 } },
  ];
  return doc;
}

describe("schema v5", () => {
  it("round-trips interior drawers, custom heights, handles and opening angles exactly", () => {
    const result = importCabinetJson(exportCabinetJson(CONFIGURATION));
    expect(result).toEqual({ ok: true, configuration: CONFIGURATION, migratedFrom: null });
    expect(exportCabinetJson((result as { configuration: CabinetConfiguration }).configuration)).toBe(exportCabinetJson(CONFIGURATION));
  });

  it("writes the new fields with a stable order", () => {
    expect(document().schemaVersion).toBe(5);
    expect(Object.keys(document().cabinet.attachments[0].configuration)).toEqual([
      "layout",
      "mounting",
      "hinge",
      "gap",
      "centerGap",
      "maxOpenAngle",
      "handle",
    ]);
    expect(Object.keys(document().cabinet.attachments[1].configuration.handle)).toEqual(["type", "finish", "align", "edgeOffset", "alignOffset"]);
  });

  it("rejects invalid handle configurations", () => {
    const badFinish = document();
    badFinish.cabinet.attachments[0].configuration.handle.finish = "gold";
    expect(issues(parseCabinetDocument(badFinish))[0].message).toMatch(/uchwytu/);
    const missing = document();
    delete missing.cabinet.attachments[1].configuration.handle;
    expect(issues(parseCabinetDocument(missing)).map((i) => i.path)).toEqual(["cabinet.attachments[1].configuration.handle"]);
    const mistyped = document();
    mistyped.cabinet.attachments[0].configuration.handle.edgeOffset = "50";
    expect(issues(parseCabinetDocument(mistyped)).map((i) => i.path)).toEqual(["cabinet.attachments[0].configuration.handle.edgeOffset"]);
  });

  it("rejects invalid drawer heights", () => {
    const wrongLength = document();
    wrongLength.cabinet.attachments[1].configuration.heightRatios = [1, 2];
    expect(issues(parseCabinetDocument(wrongLength))[0].message).toMatch(/wysokości szuflad/);
    const notNumbers = document();
    notNumbers.cabinet.attachments[1].configuration.heightRatios = "equal";
    expect(issues(parseCabinetDocument(notNumbers)).map((i) => i.path)).toEqual(["cabinet.attachments[1].configuration.heightRatios"]);
    const tooLow = document();
    tooLow.cabinet.attachments[1].configuration.heightRatios = [1, 1, 100];
    expect(issues(parseCabinetDocument(tooLow))[0].message).toMatch(/minimum to 80 mm/);
  });

  it("rejects invalid placements and interior drawers without a door", () => {
    const placement = document();
    placement.cabinet.attachments[1].configuration.placement = "floating";
    expect(issues(parseCabinetDocument(placement))[0].message).toMatch(/umiejscowienie/);
    const noDoor = document();
    noDoor.cabinet.attachments.splice(0, 1);
    expect(issues(parseCabinetDocument(noDoor))[0].message).toMatch(/wymagają drzwi/);
    const overlay = document();
    overlay.cabinet.attachments[1].configuration.mounting = "overlay";
    expect(issues(parseCabinetDocument(overlay))[0].message).toMatch(/fronty wpuszczane/);
  });

  it("rejects an exterior front overlapping the parent door", () => {
    const doc = document();
    doc.cabinet.attachments[1].configuration.placement = "exterior";
    expect(issues(parseCabinetDocument(doc))[0].message).toMatch(/nachodziłby na front „a1”/);
  });
});

describe("migration v4 → v5", () => {
  it("turns drawers into exterior drawers with equal heights and gives everything 'no handle'", () => {
    const result = parseCabinetDocument(v4Document());
    expect(result.ok && result.migratedFrom).toBe(4);
    expect(result.ok && result.configuration.attachments).toEqual([
      {
        id: "a1",
        type: "door",
        compartmentId: "c1",
        configuration: { layout: "single", mounting: "inset", hinge: "right", gap: 2, centerGap: 3, maxOpenAngle: 100, handle: DEFAULT_HANDLE },
      },
      {
        id: "a7",
        type: "drawer",
        compartmentId: "c3",
        configuration: {
          count: 2,
          placement: "exterior",
          mounting: "overlay",
          frontGap: 3,
          depth: 450,
          heightRatios: null,
          handle: DEFAULT_HANDLE,
        },
      },
    ]);
  });

  it("keeps materials, structure and IDs unchanged", () => {
    const result = parseCabinetDocument(v4Document());
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.configuration.materials).toEqual(CONFIGURATION.materials);
    expect(result.configuration.compartments).toEqual(CONFIGURATION.compartments);
    expect(result.configuration.attachments.map((a) => a.id)).toEqual(["a1", "a7"]);
  });

  it("still migrates v1, v2 and v3 documents through to v5", () => {
    const v1 = { width: 800, height: 1800, depth: 500, panelThickness: 18, materialId: "oak" };
    expect(parseCabinetDocument(v1)).toEqual({ ok: true, configuration: DEFAULT_CABINET, migratedFrom: 1 });
    const v3 = v4Document();
    v3.schemaVersion = 3;
    const result = parseCabinetDocument(v3);
    expect(result.ok && result.configuration.attachments).toEqual([]);
  });

  it("rejects malformed v4 attachments instead of guessing", () => {
    const doc = v4Document();
    doc.cabinet.attachments[1].configuration.count = "two";
    expect(issues(parseCabinetDocument(doc)).map((i) => i.path)).toEqual(["cabinet.attachments[1].configuration.count"]);
  });
});
