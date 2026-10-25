import { beforeEach, describe, expect, it } from "vitest";
import { buildCabinet } from "@/domain/geometry/buildCabinet";
import { useConfiguratorStore } from "./useConfiguratorStore";
import { usePreviewStore } from "./usePreviewStore";

const state = () => useConfiguratorStore.getState();
const preview = () => usePreviewStore.getState();

beforeEach(() => {
  state().reset();
  preview().closeAll();
});

/** Root split vertically into c1 | c2, with a single overlay door in c1. */
function cabinetWithDoorInC1() {
  state().splitCompartment("root", "vertical");
  expect(state().addDoor("c1", "single").ok).toBe(true);
}

describe("attachments in the store", () => {
  it("adds, edits and removes doors and drawers", () => {
    state().splitCompartment("root", "horizontal");
    expect(state().addDoor("c2", "double").ok).toBe(true);
    expect(state().addDrawers("c1").ok).toBe(true);
    expect(state().updateDoor("a1", { mounting: "inset" }).ok).toBe(true);
    expect(state().updateDrawers("a2", { count: 2 }).ok).toBe(true);
    expect(state().configuration.attachments.map((a) => [a.id, a.compartmentId])).toEqual([
      ["a1", "c2"],
      ["a2", "c1"],
    ]);
    expect(state().removeAttachment("a1").ok).toBe(true);
    expect(state().configuration.attachments.map((a) => a.id)).toEqual(["a2"]);
  });

  it("rejects an invalid edit and keeps the configuration and its errors local to the caller", () => {
    cabinetWithDoorInC1();
    const before = state().configuration;
    const result = state().updateDoor("a1", { gap: 50 });
    expect(result).toMatchObject({ ok: false, errors: [{ code: "attachment_gap_out_of_range", attachmentId: "a1" }] });
    expect(state().configuration).toBe(before);
    expect(state().rejection).toBeNull();
  });

  it("rejects adding to an occupied or subdivided compartment", () => {
    cabinetWithDoorInC1();
    expect(state().addDrawers("c1").ok).toBe(false);
    expect(state().addDoor("root", "single").ok).toBe(false);
    expect(state().rejection?.source).toBe("attachments");
  });

  it("rejects splitting a compartment that has drawers", () => {
    state().splitCompartment("root", "vertical");
    expect(state().addDrawers("c1").ok).toBe(true);
    const before = state().configuration;
    const result = state().splitCompartment("c1", "horizontal");
    expect(result).toMatchObject({ ok: false, errors: [{ code: "attachment_not_on_leaf" }] });
    expect(state().configuration).toBe(before);
  });
});

describe("transactional revalidation of attachments", () => {
  it("rejects a resize that would make a door too narrow and keeps everything unchanged", () => {
    cabinetWithDoorInC1();
    // Overlay door on c1 = opening + 17 (outer side) + 8 (shared divider).
    // 400 mm: c1 = 173 mm → door 198 mm. 360 mm: c1 = 153 mm (a valid compartment) → door 178 mm.
    expect(state().setNumericField("width", 400).ok).toBe(true);
    const before = state().configuration;
    const result = state().setNumericField("width", 360);
    expect(result).toMatchObject({ ok: false, errors: [{ code: "door_too_narrow", attachmentId: "a1" }] });
    expect(state().configuration).toBe(before);
    expect(state().pendingInputs.width?.value).toBe(360);
  });

  it("rejects a split-ratio change that would make a door too narrow", () => {
    cabinetWithDoorInC1();
    const before = state().configuration;
    // c1 = 152 mm is a valid compartment, but its overlay door would be 152 + 25 = 177 mm.
    const result = state().setSplitRatio("root", 152 / 746);
    expect(result).toMatchObject({ ok: false, errors: [{ code: "door_too_narrow" }] });
    expect(state().configuration).toBe(before);
  });

  it("rejects a drawer depth that no longer fits after adding a back panel", () => {
    state().addDrawers("root");
    expect(state().updateDrawers("a1", { depth: 490 }).ok).toBe(true);
    const before = state().configuration;
    expect(state().setBackPanelEnabled(true)).toMatchObject({ ok: false, errors: [{ code: "drawer_depth_out_of_range" }] });
    expect(state().configuration).toBe(before);
  });
});

describe("safe subdivision removal", () => {
  beforeEach(() => {
    state().splitCompartment("root", "horizontal");
    state().splitCompartment("c2", "vertical");
    state().addDrawers("c1");
    state().addDoor("c3", "single");
    state().addDoor("c4", "single");
  });

  it("refuses to remove attachments without confirmation and changes nothing", () => {
    const before = state().configuration;
    const result = state().removeSplit("c2");
    expect(result).toMatchObject({ ok: false, errors: [{ code: "removal_requires_confirmation" }] });
    expect(state().configuration).toBe(before);
  });

  it("removes the subdivision and the affected attachments atomically when confirmed", () => {
    state().selectCompartment("c4");
    expect(state().removeSplit("c2", { removeAttachments: true }).ok).toBe(true);
    const { configuration, selectedCompartmentId } = state();
    expect(configuration.attachments.map((a) => a.compartmentId)).toEqual(["c1"]);
    expect(selectedCompartmentId).toBe("c2");
    // Geometry builds, i.e. no orphaned attachment remains.
    expect(buildCabinet(configuration).some((p) => p.attachmentId === "a2")).toBe(false);
  });

  it("removes subdivisions without attachments directly", () => {
    state().removeAttachment("a2");
    state().removeAttachment("a3");
    expect(state().removeSplit("c2").ok).toBe(true);
  });
});

describe("preview state", () => {
  it("opens and closes fronts without touching the configuration", () => {
    cabinetWithDoorInC1();
    const before = state().configuration;
    preview().toggle("a1");
    expect(preview().openAttachmentIds.has("a1")).toBe(true);
    preview().setOpen(["a1", "a2"], true);
    expect([...preview().openAttachmentIds]).toEqual(["a1", "a2"]);
    preview().toggle("a1");
    expect(preview().openAttachmentIds.has("a1")).toBe(false);
    preview().closeAll();
    expect(preview().openAttachmentIds.size).toBe(0);
    expect(state().configuration).toBe(before);
  });
});
