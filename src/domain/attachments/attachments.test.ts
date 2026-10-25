import { describe, expect, it } from "vitest";
import type { CompartmentNode } from "../compartments/types";
import { validateCabinet } from "../constraints/validateCabinet";
import { DEFAULT_CABINET } from "../furniture/defaults";
import type { CabinetConfiguration } from "../furniture/types";
import {
  addDoor,
  addDrawers,
  getAttachmentsAffectedBySplitRemoval,
  removeAttachment,
  removeSplitWithAttachments,
  updateDoor,
  updateDrawers,
  type AttachmentOperationResult,
} from "./operations";
import type { FurnitureAttachment } from "./types";

const SPLIT: CompartmentNode = {
  id: "root",
  split: { direction: "horizontal", ratio: 0.5 },
  children: [{ id: "c1" }, { id: "c2", split: { direction: "vertical", ratio: 0.5 }, children: [{ id: "c3" }, { id: "c4" }] }],
};
const BASE: CabinetConfiguration = { ...DEFAULT_CABINET, compartments: SPLIT };

function ok(result: AttachmentOperationResult): CabinetConfiguration {
  if (!result.ok) throw new Error(result.error.message);
  return result.configuration;
}

function codes(configuration: CabinetConfiguration) {
  return validateCabinet(configuration).errors.map((e) => e.code);
}

const door = (id: string, compartmentId: string, overrides = {}): FurnitureAttachment => ({
  id,
  type: "door",
  compartmentId,
  configuration: { layout: "single", mounting: "overlay", hinge: "left", gap: 2, centerGap: 3, maxOpenAngle: 100, handle: NO_HANDLE, ...overrides },
});

const drawer = (id: string, compartmentId: string, overrides = {}): FurnitureAttachment => ({
  id,
  type: "drawer",
  compartmentId,
  configuration: { count: 2, placement: "exterior", mounting: "overlay", frontGap: 3, depth: 400, heightRatios: null, handle: NO_HANDLE, ...overrides },
});

const NO_HANDLE = { type: "none", finish: "brushed-steel", align: "center", edgeOffset: 40, alignOffset: 100 } as const;

describe("attachment operations", () => {
  it("adds doors and drawers with deterministic IDs and valid defaults", () => {
    const withDoor = ok(addDoor(BASE, "c1", "double"));
    const withBoth = ok(addDrawers(withDoor, "c3"));
    expect(withBoth.attachments.map((a) => [a.id, a.type, a.compartmentId])).toEqual([
      ["a1", "door", "c1"],
      ["a2", "drawer", "c3"],
    ]);
    expect(withBoth.attachments[0].configuration).toEqual({
      layout: "double",
      mounting: "overlay",
      hinge: "left",
      gap: 2,
      centerGap: 3,
      maxOpenAngle: 100,
      handle: NO_HANDLE,
    });
    expect(validateCabinet(withBoth).isValid).toBe(true);
  });

  it("never mutates the input configuration", () => {
    const snapshot = structuredClone(BASE);
    ok(addDoor(BASE, "c1", "single"));
    expect(BASE).toEqual(snapshot);
  });

  it("refuses missing or occupied compartments, and drawers in subdivided ones", () => {
    expect(addDoor(BASE, "zzz", "single")).toMatchObject({ ok: false, error: { code: "compartment_not_found" } });
    // Drawer boxes fill the compartment, so it must be undivided; a door only covers the opening (see below).
    expect(addDrawers(BASE, "c2")).toMatchObject({ ok: false, error: { code: "not_a_leaf" } });
    const occupied = ok(addDoor(BASE, "c1", "single"));
    expect(addDrawers(occupied, "c1")).toMatchObject({ ok: false, error: { code: "compartment_occupied" } });
  });

  it("updates and removes attachments by ID, keeping the others", () => {
    let configuration = ok(addDrawers(ok(addDoor(BASE, "c1", "single")), "c3"));
    configuration = ok(updateDoor(configuration, "a1", { hinge: "right", mounting: "inset" }));
    configuration = ok(updateDrawers(configuration, "a2", { count: 2 }));
    expect(configuration.attachments[0].configuration).toMatchObject({ hinge: "right", mounting: "inset" });
    expect(configuration.attachments[1].configuration).toMatchObject({ count: 2 });
    expect(updateDrawers(configuration, "a1", { count: 1 })).toMatchObject({ ok: false, error: { code: "attachment_type_mismatch" } });
    expect(ok(removeAttachment(configuration, "a1")).attachments.map((a) => a.id)).toEqual(["a2"]);
    expect(removeAttachment(configuration, "a9")).toMatchObject({ ok: false, error: { code: "attachment_not_found" } });
  });

  it("does not reuse IDs of other attachments", () => {
    const configuration = { ...BASE, attachments: [door("a7", "c1")] };
    expect(ok(addDrawers(configuration, "c3")).attachments[1].id).toBe("a8");
  });
});

describe("removing subdivisions with attachments", () => {
  const configuration = { ...BASE, attachments: [door("a1", "c1"), drawer("a2", "c3"), door("a3", "c4")] };

  it("finds the attachments in the compartments that would disappear", () => {
    expect(getAttachmentsAffectedBySplitRemoval(configuration, "c2").map((a) => a.id)).toEqual(["a2", "a3"]);
    expect(getAttachmentsAffectedBySplitRemoval(configuration, "root").map((a) => a.id)).toEqual(["a1", "a2", "a3"]);
    expect(getAttachmentsAffectedBySplitRemoval(configuration, "c1")).toEqual([]);
  });

  it("removes the subdivision and its attachments in one step, leaving no orphans", () => {
    const next = ok(removeSplitWithAttachments(configuration, "c2"));
    expect(next.attachments.map((a) => a.id)).toEqual(["a1"]);
    expect(validateCabinet(next).isValid).toBe(true);
    expect(ok(removeSplitWithAttachments(configuration, "root")).attachments).toEqual([]);
  });

  it("rejects removing a split that does not exist", () => {
    expect(removeSplitWithAttachments(configuration, "c1")).toMatchObject({ ok: false, error: { code: "not_split" } });
  });
});

describe("attachment validation", () => {
  it("rejects references to missing compartments", () => {
    expect(codes({ ...BASE, attachments: [door("a1", "nope")] })).toEqual(["attachment_compartment_not_found"]);
  });

  it("rejects drawers on subdivided compartments", () => {
    expect(codes({ ...BASE, attachments: [drawer("a1", "c2")] })).toEqual(["attachment_not_on_leaf"]);
  });

  it("accepts doors on subdivided compartments", () => {
    expect(codes({ ...BASE, attachments: [door("a1", "c2")] })).toEqual([]);
    expect(codes({ ...BASE, attachments: [door("a1", "root", { layout: "double" })] })).toEqual([]);
  });

  it("rejects duplicate attachment IDs", () => {
    expect(codes({ ...BASE, attachments: [door("a1", "c1"), drawer("a1", "c3")] })).toEqual(["duplicate_attachment_id"]);
  });

  it("rejects two assemblies in one compartment, including a door and a drawer", () => {
    expect(codes({ ...BASE, attachments: [door("a1", "c1"), drawer("a2", "c1")] })).toEqual(["attachment_conflict"]);
    expect(codes({ ...BASE, attachments: [door("a1", "c1"), door("a2", "c1")] })).toEqual(["attachment_conflict"]);
  });

  it("enforces minimum door dimensions", () => {
    // c1 opening 150 mm wide → overlay door 150 + 17 (outer side) + 8 (shared divider) = 175 mm < 180 mm.
    const narrow: CompartmentNode = { id: "root", split: { direction: "vertical", ratio: 150 / 746 }, children: [{ id: "c1" }, { id: "c2" }] };
    expect(codes({ ...DEFAULT_CABINET, compartments: narrow, attachments: [door("a1", "c1")] })).toEqual(["door_too_narrow"]);
    // Each leaf of a double door must also be wide enough: (780 − 3) / 2 = 388.5 is fine, at 360 mm it is not.
    expect(codes({ ...DEFAULT_CABINET, attachments: [door("a1", "root", { layout: "double" })] })).toEqual([]);
    expect(codes({ ...DEFAULT_CABINET, width: 360, attachments: [door("a1", "root", { layout: "double" })] })).toEqual([
      "door_too_narrow",
    ]);
    const low: CompartmentNode = { id: "root", split: { direction: "horizontal", ratio: 200 / 1746 }, children: [{ id: "c1" }, { id: "c2" }] };
    expect(codes({ ...DEFAULT_CABINET, compartments: low, attachments: [door("a1", "c1")] })).toEqual(["door_too_low"]);
  });

  it("enforces drawer counts as integers within the limits", () => {
    for (const count of [0, 7, 2.5, Number.NaN]) {
      expect(codes({ ...BASE, attachments: [drawer("a1", "c1", { count })] })).toEqual(["invalid_drawer_count"]);
    }
  });

  it("enforces minimum drawer front and box sizes", () => {
    // 450 mm cabinet: 414 mm opening → six fronts of 69 mm and boxes of 49 mm.
    const result = codes({ ...DEFAULT_CABINET, height: 450, attachments: [drawer("a1", "root", { count: 6 })] });
    expect(result).toEqual(["drawer_front_too_low", "drawer_box_too_small"]);
  });

  it("keeps drawer depth within the available depth", () => {
    // 500 mm opening − 10 mm rear clearance = 490 mm; an inset front takes another 18 mm.
    expect(codes({ ...BASE, attachments: [drawer("a1", "c1", { depth: 490 })] })).toEqual([]);
    expect(codes({ ...BASE, attachments: [drawer("a1", "c1", { depth: 491 })] })).toEqual(["drawer_depth_out_of_range"]);
    expect(codes({ ...BASE, attachments: [drawer("a1", "c1", { depth: 490, mounting: "inset" })] })).toEqual([
      "drawer_depth_out_of_range",
    ]);
    expect(codes({ ...BASE, attachments: [drawer("a1", "c1", { depth: 100 })] })).toEqual(["drawer_depth_out_of_range"]);
  });

  it("rejects clearances outside the allowed ranges", () => {
    expect(codes({ ...BASE, attachments: [door("a1", "c1", { gap: 0 })] })).toEqual(["attachment_gap_out_of_range"]);
    expect(codes({ ...BASE, attachments: [door("a1", "c1", { centerGap: 20 })] })).toEqual(["attachment_gap_out_of_range"]);
    expect(codes({ ...BASE, attachments: [drawer("a1", "c1", { frontGap: 7 })] })).toEqual(["attachment_gap_out_of_range"]);
  });

  it("rejects unknown door options", () => {
    expect(codes({ ...BASE, attachments: [door("a1", "c1", { hinge: "top" })] })).toEqual(["invalid_attachment"]);
    expect(codes({ ...BASE, attachments: [drawer("a1", "c1", { mounting: "glued" })] })).toEqual(["invalid_attachment"]);
  });

  it("revalidates attachments when the panel thickness changes", () => {
    // Inset door in a 420 mm cabinet: c1 = 186 mm at t = 16 → 182 mm door; at t = 20, c1 = 180 → 176 mm door.
    const split: CompartmentNode = { id: "root", split: { direction: "vertical", ratio: 0.5 }, children: [{ id: "c1" }, { id: "c2" }] };
    const configuration = { ...DEFAULT_CABINET, width: 420, compartments: split, attachments: [door("a1", "c1", { mounting: "inset" })] };
    expect(codes({ ...configuration, panelThickness: 16 })).toEqual([]);
    expect(codes({ ...configuration, panelThickness: 20 })).toEqual(["door_too_narrow"]);
  });

  it("names the attachment and compartment in structured errors", () => {
    const [error] = validateCabinet({ ...BASE, attachments: [door("a5", "nope")] }).errors;
    expect(error).toMatchObject({ field: "attachments", attachmentId: "a5", compartmentId: "nope" });
    expect(error.message).toMatch(/^Drzwi „a5”/);
    const [drawerError] = validateCabinet({ ...BASE, attachments: [drawer("a6", "c2")] }).errors;
    expect(drawerError).toMatchObject({ field: "attachments", attachmentId: "a6", compartmentId: "c2" });
    expect(drawerError.message).toMatch(/^Szuflady „a6”/);
  });
});
