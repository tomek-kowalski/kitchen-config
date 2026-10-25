import { describe, expect, it } from "vitest";
import { DEFAULT_CABINET } from "../furniture/defaults";
import type { CabinetConfiguration } from "../furniture/types";
import { calculateCompartmentBounds, getInteriorBounds, getSplitRatioRange, layoutSplit } from "./layout";
import type { CompartmentNode } from "./types";

function withTree(compartments: CompartmentNode, overrides: Partial<CabinetConfiguration> = {}): CabinetConfiguration {
  return { ...DEFAULT_CABINET, ...overrides, compartments };
}

function boundsById(configuration: CabinetConfiguration) {
  return new Map(calculateCompartmentBounds(configuration).map((l) => [l.id, l.bounds]));
}

describe("getInteriorBounds", () => {
  it("is the space between the carcass panels", () => {
    expect(getInteriorBounds(DEFAULT_CABINET)).toEqual({
      position: { x: 18, y: 18, z: 0 },
      dimensions: { width: 764, height: 1764, depth: 500 },
    });
  });

  it("accounts for the plinth and the back panel", () => {
    const configuration = {
      ...DEFAULT_CABINET,
      backPanel: { enabled: true, thickness: 8 },
      plinth: { enabled: true, height: 100, setback: 30 },
    };
    expect(getInteriorBounds(configuration)).toEqual({
      position: { x: 18, y: 118, z: 8 },
      dimensions: { width: 764, height: 1664, depth: 492 },
    });
  });
});

describe("layoutSplit", () => {
  const box = { position: { x: 0, y: 0, z: 0 }, dimensions: { width: 800, height: 600, depth: 400 } };

  it("subtracts the divider thickness before applying the ratio", () => {
    const { first, panel, second } = layoutSplit(box, { direction: "vertical", ratio: 0.5 }, 18);
    expect(first.dimensions.width + second.dimensions.width).toBe(782);
    expect(first.dimensions.width).toBe(391);
    expect(panel).toEqual({ position: { x: 391, y: 0, z: 0 }, dimensions: { width: 18, height: 600, depth: 400 } });
    expect(second.position.x).toBe(409);
  });

  it("places shelves along the height", () => {
    const { first, panel, second } = layoutSplit(box, { direction: "horizontal", ratio: 0.25 }, 20);
    expect(first.dimensions).toEqual({ width: 800, height: 145, depth: 400 });
    expect(panel.position.y).toBe(145);
    expect(second.position.y).toBe(165);
    expect(second.dimensions.height).toBe(435);
  });
});

describe("calculateCompartmentBounds", () => {
  const tree: CompartmentNode = {
    id: "root",
    split: { direction: "horizontal", ratio: 0.5 },
    children: [{ id: "c1" }, { id: "c2", split: { direction: "vertical", ratio: 0.5 }, children: [{ id: "c3" }, { id: "c4" }] }],
  };

  it("derives nested bounds from the dimensions and the tree", () => {
    const bounds = boundsById(withTree(tree));
    expect(bounds.get("root")?.dimensions).toEqual({ width: 764, height: 1764, depth: 500 });
    expect(bounds.get("c1")).toEqual({ position: { x: 18, y: 18, z: 0 }, dimensions: { width: 764, height: 873, depth: 500 } });
    expect(bounds.get("c2")?.position.y).toBe(18 + 873 + 18);
    expect(bounds.get("c3")?.dimensions.width).toBe(373);
    expect(bounds.get("c4")?.position.x).toBe(18 + 373 + 18);
  });

  it("reports levels, parents and leaves in pre-order", () => {
    expect(calculateCompartmentBounds(withTree(tree)).map((l) => [l.id, l.parentId, l.level, l.isLeaf])).toEqual([
      ["root", null, 0, false],
      ["c1", "root", 1, true],
      ["c2", "root", 1, false],
      ["c3", "c2", 2, true],
      ["c4", "c2", 2, true],
    ]);
  });

  it("recomputes bounds when the cabinet is resized, keeping IDs", () => {
    const bounds = boundsById(withTree(tree, { width: 1000, panelThickness: 20 }));
    expect([...bounds.keys()]).toEqual(["root", "c1", "c2", "c3", "c4"]);
    expect(bounds.get("c3")?.dimensions.width).toBe((1000 - 40 - 20) / 2);
  });
});

describe("getSplitRatioRange", () => {
  it("keeps both children at least the minimum size", () => {
    const configuration = withTree({
      id: "root",
      split: { direction: "vertical", ratio: 0.5 },
      children: [{ id: "c1" }, { id: "c2" }],
    });
    const range = getSplitRatioRange(configuration, "root");
    expect(range?.min).toBeCloseTo(150 / 746);
    expect(range?.max).toBeCloseTo(1 - 150 / 746);
  });

  it("accounts for nested subdivisions along the same axis", () => {
    const configuration = withTree({
      id: "root",
      split: { direction: "vertical", ratio: 0.6 },
      children: [{ id: "c1", split: { direction: "vertical", ratio: 0.5 }, children: [{ id: "c3" }, { id: "c4" }] }, { id: "c2" }],
    });
    // The left subtree needs 150 + 18 + 150 = 318 mm.
    expect(getSplitRatioRange(configuration, "root")?.min).toBeCloseTo(318 / 746);
  });

  it("returns null for leaves and missing compartments", () => {
    expect(getSplitRatioRange(DEFAULT_CABINET, "root")).toBeNull();
    expect(getSplitRatioRange(DEFAULT_CABINET, "missing")).toBeNull();
  });
});
