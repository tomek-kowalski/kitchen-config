import { beforeEach, describe, expect, it } from "vitest";
import { resolvePreviewTarget } from "@/components/three/previewProgress";
import { calculateCompartmentBounds } from "@/domain/compartments/layout";
import { getSplitSizeRange, ratioForFirstSize } from "@/domain/compartments/splitRange";
import { validateCabinet } from "@/domain/constraints/validateCabinet";
import { buildFurniture } from "@/domain/geometry/buildFurniture";
import { useConfiguratorStore } from "./useConfiguratorStore";
import { usePreviewStore } from "./usePreviewStore";

const state = () => useConfiguratorStore.getState();
const limits = () => buildFurniture(state().configuration).motion;
const handleOf = (index = 0) => state().configuration.attachments[index].configuration.handle;

beforeEach(() => {
  state().reset();
  usePreviewStore.getState().closeAll();
});

/** Two single doors side by side (c1 | c2). */
function adjacentDoors(leftHinge: "left" | "right", rightHinge: "left" | "right") {
  state().splitCompartment("root", "vertical");
  state().addDoor("c1", "single");
  state().addDoor("c2", "single");
  state().updateDoor("a1", { hinge: leftHinge });
  state().updateDoor("a2", { hinge: rightHinge });
}

describe("opening collisions", () => {
  it("limits adjacent doors whose hinges meet at the shared divider to about 90°", () => {
    adjacentDoors("right", "left");
    const a = limits().get("door/a1");
    const b = limits().get("door/a2");
    for (const limit of [a, b]) {
      expect(limit?.requested).toBe(100);
      expect(limit?.allowed).toBeGreaterThanOrEqual(85);
      expect(limit?.allowed).toBeLessThan(92);
    }
    expect(a?.blockedBy).toEqual(["a2"]);
    expect(b?.blockedBy).toEqual(["a1"]);
  });

  it("does not restrict adjacent doors that open away from each other", () => {
    adjacentDoors("left", "right");
    expect(limits().get("door/a1")).toMatchObject({ allowed: 100, blockedBy: [] });
    expect(limits().get("door/a2")).toMatchObject({ allowed: 100, blockedBy: [] });
  });

  it("does not restrict the two leaves of a double door", () => {
    state().addDoor("root", "double");
    expect(limits().get("door/a1/left")).toMatchObject({ allowed: 100, blockedBy: [] });
    expect(limits().get("door/a1/right")).toMatchObject({ allowed: 100, blockedBy: [] });
  });

  it("keeps a door out of the extension path of neighbouring drawers with handles", () => {
    state().splitCompartment("root", "vertical");
    state().addDoor("c1", "single");
    state().updateDoor("a1", { hinge: "right" });
    state().addDrawers("c2");
    state().updateDrawers("a2", { handle: { ...handleOf(1), type: "bar" } });
    const door = limits().get("door/a1");
    expect(door?.allowed).toBeLessThan(100);
    expect(door?.allowed).toBeGreaterThan(80);
    expect(door?.blockedBy).toEqual(["a2"]);
    expect(limits().get("drawer/a2/1")).toMatchObject({ allowed: limits().get("drawer/a2/1")?.requested });
  });

  it("limits interior drawer travel when the covering door cannot open far enough", () => {
    state().addDoor("root", "single");
    state().splitCompartment("root", "horizontal");
    state().addDrawers("c1", "interior");
    expect(limits().get("drawer/a2/1")).toMatchObject({ allowed: 360, requiresOpen: "a1" });
    state().updateDoor("a1", { maxOpenAngle: 60 });
    const restricted = limits().get("drawer/a2/1");
    expect(restricted?.allowed).toBeGreaterThan(0);
    expect(restricted?.allowed).toBeLessThan(360);
    expect(restricted?.blockedBy).toEqual(["a1"]);
  });

  it("never changes the closed geometry", () => {
    adjacentDoors("right", "left");
    const before = buildFurniture(state().configuration).panels;
    expect(before.find((p) => p.id === "door/a1")?.motion).toMatchObject({ maxAngleDeg: 100 });
  });
});

describe("door and interior drawer preview interaction", () => {
  const base = { requested: false, coveringDoorRequested: true, coveringDoorProgress: 1, dependentsProgress: 0, currentProgress: 0 };

  it("keeps an interior drawer in while its door is closed", () => {
    expect(resolvePreviewTarget({ ...base, requested: true, coveringDoorRequested: false, coveringDoorProgress: 0 })).toEqual({
      target: 0,
      waiting: false,
    });
  });

  it("waits for the door to open fully before moving the drawer out", () => {
    expect(resolvePreviewTarget({ ...base, requested: true, coveringDoorProgress: 0.4 })).toEqual({ target: 0, waiting: true });
    expect(resolvePreviewTarget({ ...base, requested: true, coveringDoorProgress: 1 })).toEqual({ target: 1, waiting: false });
  });

  it("holds a closing door open until the drawers behind it are retracted", () => {
    expect(resolvePreviewTarget({ ...base, dependentsProgress: 0.5, currentProgress: 1 })).toEqual({ target: 1, waiting: true });
    expect(resolvePreviewTarget({ ...base, dependentsProgress: 0, currentProgress: 1 })).toEqual({ target: 0, waiting: false });
  });

  it("closes everything after a reset of the preview", () => {
    usePreviewStore.getState().setOpen(["a1", "a2"], true);
    usePreviewStore.getState().closeAll();
    const open = usePreviewStore.getState().openAttachmentIds;
    expect(resolvePreviewTarget({ ...base, requested: open.has("a1") })).toEqual({ target: 0, waiting: false });
  });
});

describe("split ranges and exact dimensions", () => {
  const firstWidth = () => calculateCompartmentBounds(state().configuration).find((l) => l.id === "c1")?.bounds.dimensions.width;

  it("derives the range from the minimum compartment size", () => {
    state().splitCompartment("root", "vertical");
    const range = getSplitSizeRange(state().configuration, "root");
    expect(range?.usable).toBe(746);
    expect(range?.min).toBeCloseTo(150, 0);
    expect(range?.max).toBeCloseTo(596, 0);
    expect(range?.min).toBeGreaterThanOrEqual(150);
  });

  it("accounts for nested subdivisions and door minimums", () => {
    state().splitCompartment("root", "vertical");
    state().splitCompartment("c1", "vertical");
    // c1 must hold 150 + 18 + 150 mm.
    expect(getSplitSizeRange(state().configuration, "root")?.min).toBeCloseTo(318, 0);
    state().reset();
    state().splitCompartment("root", "vertical");
    state().addDoor("c1", "single");
    // Overlay door on c1 = c1 + 17 + 8 ≥ 180 mm → c1 ≥ 155 mm.
    expect(getSplitSizeRange(state().configuration, "root")?.min).toBeCloseTo(155, 0);
  });

  it("only reports sizes that pass the full validation", () => {
    state().splitCompartment("root", "vertical");
    state().addDoor("c2", "single");
    const range = getSplitSizeRange(state().configuration, "root");
    if (!range) throw new Error("no range");
    for (const size of [range.min, range.max, (range.min + range.max) / 2]) {
      expect(state().setSplitRatio("root", ratioForFirstSize(range, size)).ok).toBe(true);
    }
    expect(state().setSplitRatio("root", ratioForFirstSize(range, range.max + 1)).ok).toBe(false);
  });

  it("sets an exact child dimension and gives the other child the rest", () => {
    state().splitCompartment("root", "vertical");
    state().addDoor("c2", "single");
    const range = getSplitSizeRange(state().configuration, "root");
    if (!range) throw new Error("no range");
    expect(state().setSplitRatio("root", ratioForFirstSize(range, 300)).ok).toBe(true);
    expect(firstWidth()).toBeCloseTo(300, 9);
    // Repeated exact edits do not accumulate rounding errors.
    for (const size of [310.5, 299.9, 300]) state().setSplitRatio("root", ratioForFirstSize(range, size));
    expect(firstWidth()).toBeCloseTo(300, 9);
    expect(state().configuration.attachments.map((a) => a.id)).toEqual(["a1"]);
    expect(validateCabinet(state().configuration).isValid).toBe(true);
  });

  it("rejects an impossible exact dimension without changing anything", () => {
    state().splitCompartment("root", "vertical");
    const before = state().configuration;
    const range = getSplitSizeRange(before, "root");
    if (!range) throw new Error("no range");
    expect(state().setSplitRatio("root", ratioForFirstSize(range, 100)).ok).toBe(false);
    expect(state().setSplitRatio("root", ratioForFirstSize(range, 800)).ok).toBe(false);
    expect(state().configuration).toBe(before);
  });
});
