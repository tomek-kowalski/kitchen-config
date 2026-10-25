import { describe, expect, it } from "vitest";
import {
  collectCompartmentIds,
  getCompartment,
  getCompartmentPath,
  getLeafCompartments,
  removeSplit,
  splitCompartment,
  updateSplitRatio,
  type CompartmentOperationResult,
} from "./tree";
import { isBranch, type CompartmentNode } from "./types";

function expectTree(result: CompartmentOperationResult): CompartmentNode {
  if (!result.ok) throw new Error(result.error.message);
  return result.tree;
}

function expectError(result: CompartmentOperationResult) {
  if (result.ok) throw new Error("Expected the operation to fail");
  return result.error;
}

const ROOT: CompartmentNode = Object.freeze({ id: "root" });

/** root ─ shelf ─┬ c1
 *                └ c2 ─ divider ─┬ c3
 *                                └ c4 */
function sampleTree(): CompartmentNode {
  const shelf = expectTree(splitCompartment(ROOT, "root", "horizontal"));
  return expectTree(splitCompartment(shelf, "c2", "vertical"));
}

describe("splitCompartment", () => {
  it("turns a leaf into a branch with two new leaves", () => {
    expect(expectTree(splitCompartment(ROOT, "root", "horizontal", 0.25))).toEqual({
      id: "root",
      split: { direction: "horizontal", ratio: 0.25 },
      children: [{ id: "c1" }, { id: "c2" }],
    });
  });

  it("defaults to an even split", () => {
    const tree = expectTree(splitCompartment(ROOT, "root", "vertical"));
    expect(isBranch(tree) && tree.split).toEqual({ direction: "vertical", ratio: 0.5 });
  });

  it("does not mutate the input and shares untouched subtrees", () => {
    const tree = sampleTree();
    const snapshot = structuredClone(tree);
    const next = expectTree(splitCompartment(tree, "c3", "horizontal"));
    expect(tree).toEqual(snapshot);
    expect(isBranch(tree) && isBranch(next) && next.children[0]).toBe(isBranch(tree) && tree.children[0]);
  });

  it("generates unique, deterministic IDs after the highest existing one", () => {
    const tree = expectTree(splitCompartment(sampleTree(), "c1", "vertical"));
    expect(collectCompartmentIds(tree)).toEqual(["root", "c1", "c5", "c6", "c2", "c3", "c4"]);
    expect(expectTree(splitCompartment(sampleTree(), "c1", "vertical"))).toEqual(tree);
  });

  it("never reuses IDs that already exist, whatever their format", () => {
    const imported: CompartmentNode = {
      id: "c7",
      split: { direction: "vertical", ratio: 0.5 },
      children: [{ id: "left" }, { id: "c8" }],
    };
    const tree = expectTree(splitCompartment(imported, "left", "horizontal"));
    const ids = collectCompartmentIds(tree);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("c9");
  });

  it.each([
    ["a missing compartment", "nope", 0.5, "compartment_not_found"],
    ["an already subdivided compartment", "c2", 0.5, "not_a_leaf"],
    ["a ratio of 0", "c1", 0, "invalid_ratio"],
    ["a ratio of 1", "c1", 1, "invalid_ratio"],
    ["a NaN ratio", "c1", Number.NaN, "invalid_ratio"],
  ] as const)("rejects %s", (_, id, ratio, code) => {
    const tree = sampleTree();
    expect(expectError(splitCompartment(tree, id, "vertical", ratio))).toMatchObject({ code, compartmentId: id });
  });
});

describe("removeSplit", () => {
  it("removes the subdivision and all descendants, keeping the compartment ID", () => {
    const tree = expectTree(removeSplit(sampleTree(), "root"));
    expect(tree).toEqual({ id: "root" });
  });

  it("removes only the targeted subtree", () => {
    const tree = expectTree(removeSplit(sampleTree(), "c2"));
    expect(collectCompartmentIds(tree)).toEqual(["root", "c1", "c2"]);
    expect(getCompartment(tree, "c3")).toBeNull();
  });

  it("rejects leaves and missing compartments", () => {
    expect(expectError(removeSplit(sampleTree(), "c1")).code).toBe("not_split");
    expect(expectError(removeSplit(sampleTree(), "zzz")).code).toBe("compartment_not_found");
  });
});

describe("updateSplitRatio", () => {
  it("changes only the ratio and keeps every ID", () => {
    const tree = sampleTree();
    const next = expectTree(updateSplitRatio(tree, "c2", 0.3));
    expect(collectCompartmentIds(next)).toEqual(collectCompartmentIds(tree));
    const c2 = getCompartment(next, "c2");
    expect(c2 && isBranch(c2) && c2.split).toEqual({ direction: "vertical", ratio: 0.3 });
  });

  it("returns the same tree when the ratio is unchanged", () => {
    const tree = sampleTree();
    expect(expectTree(updateSplitRatio(tree, "c2", 0.5))).toBe(tree);
  });

  it("rejects invalid ratios, leaves and missing compartments", () => {
    const tree = sampleTree();
    expect(expectError(updateSplitRatio(tree, "c2", 1.2)).code).toBe("invalid_ratio");
    expect(expectError(updateSplitRatio(tree, "c2", -0.1)).code).toBe("invalid_ratio");
    expect(expectError(updateSplitRatio(tree, "c1", 0.3)).code).toBe("not_split");
    expect(expectError(updateSplitRatio(tree, "zzz", 0.3)).code).toBe("compartment_not_found");
  });
});

describe("queries", () => {
  it("finds compartments and their paths", () => {
    const tree = sampleTree();
    expect(getCompartment(tree, "c4")).toEqual({ id: "c4" });
    expect(getCompartment(tree, "missing")).toBeNull();
    expect(getCompartmentPath(tree, "c4")?.map((n) => n.id)).toEqual(["root", "c2", "c4"]);
  });

  it("lists leaves in reading order (bottom/left first)", () => {
    expect(getLeafCompartments(sampleTree()).map((n) => n.id)).toEqual(["c1", "c3", "c4"]);
    expect(getLeafCompartments(ROOT)).toEqual([ROOT]);
  });
});
