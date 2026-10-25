import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_HANDLE } from "@/domain/attachments/operations";
import { validateCabinet } from "@/domain/constraints/validateCabinet";
import { DEFAULT_CABINET } from "@/domain/furniture/defaults";
import { buildCabinet } from "@/domain/geometry/buildCabinet";
import type { PanelPart } from "@/domain/geometry/types";
import { exportCabinetJson, importCabinetJson, parseCabinetDocument } from "@/domain/serialization/cabinetJson";
import { useConfiguratorStore } from "./useConfiguratorStore";

const state = () => useConfiguratorStore.getState();
const parts = () => buildCabinet(state().configuration);
const doorParts = () => parts().filter((p) => p.type === "door");
const interiorPanels = () => parts().filter((p) => p.type === "shelf" || p.type === "divider");

function overlapVolume(a: PanelPart, b: PanelPart): number {
  const axis = (aMin: number, aSize: number, bMin: number, bSize: number) =>
    Math.max(0, Math.min(aMin + aSize, bMin + bSize) - Math.max(aMin, bMin));
  return (
    axis(a.position.x, a.dimensions.width, b.position.x, b.dimensions.width) *
    axis(a.position.y, a.dimensions.height, b.position.y, b.dimensions.height) *
    axis(a.position.z, a.dimensions.depth, b.position.z, b.dimensions.depth)
  );
}

function expectNoOverlaps(all: readonly PanelPart[]) {
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      expect(overlapVolume(all[i], all[j]), `${all[i].id} ∩ ${all[j].id}`).toBeCloseTo(0, 9);
    }
  }
}

beforeEach(() => state().reset());

describe("doors in front of a subdivided interior", () => {
  beforeEach(() => {
    expect(state().addDoor("root", "single").ok).toBe(true);
  });

  it("allows adding a shelf behind a door", () => {
    expect(state().splitCompartment("root", "horizontal")).toEqual({ ok: true });
    expect(interiorPanels().map((p) => p.type)).toEqual(["shelf"]);
    expect(state().configuration.attachments).toMatchObject([{ id: "a1", compartmentId: "root" }]);
  });

  it("allows adding a vertical divider behind a door", () => {
    expect(state().splitCompartment("root", "vertical")).toEqual({ ok: true });
    expect(interiorPanels().map((p) => p.type)).toEqual(["divider"]);
  });

  it("allows several nested subdivisions behind one door and keeps it on the parent", () => {
    expect(state().splitCompartment("root", "horizontal").ok).toBe(true);
    expect(state().splitCompartment("c2", "vertical").ok).toBe(true);
    expect(state().splitCompartment("c3", "horizontal").ok).toBe(true);
    expect(state().splitCompartment("c1", "vertical").ok).toBe(true);
    expect(interiorPanels()).toHaveLength(4);
    expect(state().configuration.attachments).toEqual([
      expect.objectContaining({ id: "a1", type: "door", compartmentId: "root" }),
    ]);
    expectNoOverlaps(parts());
  });

  it("preserves the door ID, finish and hinge configuration across subdivisions", () => {
    state().updateDoor("a1", { hinge: "right", layout: "double", gap: 3 });
    state().setMaterial("doorFront", "walnut");
    const before = state().configuration.attachments[0];
    state().splitCompartment("root", "vertical");
    state().splitCompartment("c1", "horizontal");
    expect(state().configuration.attachments).toEqual([before]);
    expect(doorParts().every((p) => p.materialId === "walnut")).toBe(true);
  });

  it("keeps covering the complete original opening", () => {
    const before = doorParts();
    state().splitCompartment("root", "horizontal");
    state().splitCompartment("c2", "vertical");
    expect(doorParts()).toEqual(before);
    // Overlay door over the default interior (18–782 × 18–1782): +17 mm on every (outer) side.
    expect(before[0]).toMatchObject({ position: { x: 1, y: 1, z: 500 }, dimensions: { width: 798, height: 1798 } });
  });

  it("follows the parent's dimensions when the cabinet is resized", () => {
    state().splitCompartment("root", "vertical");
    expect(state().setNumericField("width", 1000).ok).toBe(true);
    expect(doorParts()[0].dimensions.width).toBe(1000 - 36 + 2 * 17);
  });

  it("sets interior panels back behind an inset door so they never intersect it", () => {
    state().updateDoor("a1", { mounting: "inset" });
    state().splitCompartment("root", "horizontal");
    state().splitCompartment("c2", "vertical");
    const [door] = doorParts();
    for (const panel of interiorPanels()) {
      expect(panel.position.z + panel.dimensions.depth).toBe(door.position.z);
    }
    expectNoOverlaps(parts());
  });

  it("keeps interior panels full depth behind an overlay door", () => {
    state().splitCompartment("root", "horizontal");
    expect(interiorPanels()[0].dimensions.depth).toBe(500);
    expectNoOverlaps(parts());
  });

  it("removes an internal subdivision without touching the parent door", () => {
    state().splitCompartment("root", "horizontal");
    state().splitCompartment("c2", "vertical");
    expect(state().removeSplit("c2")).toEqual({ ok: true });
    expect(state().removeSplit("root")).toEqual({ ok: true });
    expect(state().configuration.compartments).toEqual({ id: "root" });
    expect(state().configuration.attachments.map((a) => a.id)).toEqual(["a1"]);
  });

  it("rejects invalid structure changes transactionally and keeps the door", () => {
    state().splitCompartment("root", "vertical");
    const before = state().configuration;
    expect(state().setSplitRatio("root", 0.05).ok).toBe(false);
    expect(state().setNumericField("width", 300).ok).toBe(false);
    expect(state().configuration).toBe(before);
  });
});

describe("overlapping fronts", () => {
  it("rejects a front in a compartment covered by a parent door, in either order", () => {
    state().splitCompartment("root", "horizontal");
    state().addDoor("root", "single");
    expect(state().addDoor("c1", "single")).toMatchObject({ ok: false });
    expect(state().addDrawers("c2")).toMatchObject({ ok: false });
    expect(state().rejection?.errors[0].message).toMatch(/zakryty frontem „a1”/);

    state().reset();
    state().splitCompartment("root", "horizontal");
    state().addDrawers("c1");
    expect(state().addDoor("root", "single")).toMatchObject({ ok: false });
    expect(state().rejection?.errors[0].message).toMatch(/nie mogą na siebie nachodzić/);
  });

  it("rejects overlapping fronts in validation, e.g. in imported data", () => {
    const configuration = {
      ...DEFAULT_CABINET,
      compartments: {
        id: "root",
        split: { direction: "horizontal" as const, ratio: 0.5 },
        children: [{ id: "c1" }, { id: "c2" }] as const,
      },
      attachments: [
        { id: "a1", type: "door" as const, compartmentId: "root", configuration: { layout: "single" as const, mounting: "overlay" as const, hinge: "left" as const, gap: 2, centerGap: 3, maxOpenAngle: 100, handle: DEFAULT_HANDLE } },
        { id: "a2", type: "drawer" as const, compartmentId: "c1", configuration: { count: 2, placement: "exterior" as const, mounting: "overlay" as const, frontGap: 3, depth: 400, heightRatios: null, handle: DEFAULT_HANDLE } },
      ],
    };
    expect(validateCabinet(configuration).errors).toEqual([
      expect.objectContaining({ code: "attachment_conflict", attachmentId: "a2", compartmentId: "c1" }),
    ]);
    // Sibling fronts do not overlap.
    expect(validateCabinet({ ...configuration, attachments: [{ ...configuration.attachments[0], compartmentId: "c2" }, configuration.attachments[1]] }).isValid).toBe(true);
  });

  it("rejects drawers whose compartment gets subdivided, even behind nothing", () => {
    state().splitCompartment("root", "vertical");
    state().addDrawers("c2");
    expect(state().splitCompartment("c2", "horizontal")).toMatchObject({ ok: false, errors: [{ code: "attachment_not_on_leaf" }] });
  });
});

describe("JSON with a door on a subdivided compartment", () => {
  it("round-trips the structure and the parent door", () => {
    state().addDoor("root", "double");
    state().updateDoor("a1", { mounting: "inset" });
    state().splitCompartment("root", "horizontal");
    state().splitCompartment("c2", "vertical");
    state().setMaterial("doorFront", "cashmere");
    const configuration = state().configuration;
    const result = importCabinetJson(exportCabinetJson(configuration));
    expect(result).toEqual({ ok: true, configuration, migratedFrom: null });
  });

  it("keeps the meaning of existing v4 documents (doors on undivided compartments)", () => {
    state().splitCompartment("root", "vertical");
    state().addDoor("c1", "single");
    state().addDrawers("c2");
    // Write the same configuration as a v4 document (without the v5 fields) and read it back.
    const document = JSON.parse(exportCabinetJson(state().configuration));
    document.schemaVersion = 4;
    for (const attachment of document.cabinet.attachments) {
      for (const field of ["maxOpenAngle", "handle", "placement", "heightRatios"]) delete attachment.configuration[field];
    }
    const result = parseCabinetDocument(document);
    expect(result.ok && result.configuration).toEqual(state().configuration);
  });
});
