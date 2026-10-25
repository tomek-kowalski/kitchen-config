import { beforeEach, describe, expect, it } from "vitest";
import { getCompartment } from "@/domain/compartments/tree";
import { isBranch } from "@/domain/compartments/types";
import { DEFAULT_CABINET } from "@/domain/furniture/defaults";
import { buildCabinet } from "@/domain/geometry/buildCabinet";
import { useConfiguratorStore } from "./useConfiguratorStore";

const store = useConfiguratorStore;
const state = () => store.getState();

beforeEach(() => state().reset());

describe("useConfiguratorStore materials", () => {
  it("updates body and interior finishes independently", () => {
    state().setMaterial("interior", "white-matte");
    expect(state().configuration.materials).toEqual({ ...DEFAULT_CABINET.materials, interior: "white-matte" });

    state().setMaterial("body", "walnut");
    expect(state().configuration.materials.body).toBe("walnut");
    expect(state().configuration.materials.interior).toBe("white-matte");
  });

  it("stores back panel and plinth assignments", () => {
    state().setMaterial("backPanel", "light-grey");
    state().setMaterial("plinth", "black-matte");
    expect(state().configuration.materials).toEqual({
      body: "natural-oak",
      interior: "natural-oak",
      backPanel: "light-grey",
      plinth: "black-matte",
    });
  });

  it("applies finish changes to the preview while a dimension is invalid, keeping its last valid size", () => {
    state().setNumericField("width", 10);
    state().setMaterial("body", "anthracite");
    const { configuration, pendingInputs } = state();
    expect(pendingInputs.width?.value).toBe(10);
    expect(configuration.width).toBe(DEFAULT_CABINET.width);
    expect(configuration.materials.body).toBe("anthracite");
  });

  it("does not create a new state for an unchanged selection", () => {
    const before = state().configuration;
    state().setMaterial("body", "natural-oak");
    expect(state().configuration).toBe(before);
  });

  it("resets material selections to the defaults", () => {
    state().setMaterial("body", "cashmere");
    state().reset();
    expect(state().configuration).toEqual(DEFAULT_CABINET);
  });

  it("applies the interior finish only to shelves and dividers", () => {
    state().splitCompartment("root", "horizontal");
    state().setBackPanelEnabled(true);
    state().setMaterial("interior", "black-matte");
    const parts = buildCabinet(state().configuration);
    for (const part of parts) {
      expect(part.materialId).toBe(part.materialSlot === "interior" ? "black-matte" : "natural-oak");
    }
    expect(parts.some((p) => p.type === "shelf")).toBe(true);
  });
});

describe("useConfiguratorStore dimensions", () => {
  it("commits valid values and clears the pending input", () => {
    state().setNumericField("width", 5);
    expect(state().setNumericField("width", 1000)).toEqual({ ok: true });
    expect(state().configuration.width).toBe(1000);
    expect(state().pendingInputs.width).toBeUndefined();
  });

  it("keeps the committed configuration and records structured errors for rejected values", () => {
    const before = state().configuration;
    const result = state().setNumericField("height", 5000);
    expect(result.ok).toBe(false);
    expect(state().configuration).toBe(before);
    expect(state().pendingInputs.height).toEqual({
      value: 5000,
      errors: [expect.objectContaining({ field: "height", code: "above_maximum" })],
    });
  });

  it("rejects a width change that would make an existing compartment too narrow, without touching the tree", () => {
    state().splitCompartment("root", "vertical");
    const tree = state().configuration.compartments;
    // 500 mm wide → (500 − 36 − 18) / 2 = 223 mm per side: fine. 300 mm → 123 mm: too narrow.
    expect(state().setNumericField("width", 500).ok).toBe(true);
    const result = state().setNumericField("width", 300);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors.map((e) => e.code)).toEqual(["compartment_too_narrow", "compartment_too_narrow"]);
    expect(state().configuration.width).toBe(500);
    expect(state().configuration.compartments).toBe(tree);
  });

  it("updates nested back panel and plinth values", () => {
    state().setPlinthEnabled(true);
    expect(state().setNumericField("plinth.height", 120).ok).toBe(true);
    expect(state().setNumericField("backPanel.thickness", 4).ok).toBe(true);
    expect(state().configuration.plinth).toEqual({ enabled: true, height: 120, setback: 30 });
    expect(state().configuration.backPanel.thickness).toBe(4);
  });

  it("rejects enabling a plinth that would make compartments too low", () => {
    state().setNumericField("height", 560);
    state().splitCompartment("root", "horizontal");
    // Interior 524 mm → 253 mm per compartment; an 80 mm plinth leaves (444 − 18) / 2 = 213 mm: ok.
    expect(state().setPlinthEnabled(true).ok).toBe(true);
    expect(state().setNumericField("plinth.height", 250).ok).toBe(false);
    state().setPlinthEnabled(false);
    state().setNumericField("plinth.height", 250);
    const result = state().setPlinthEnabled(true);
    expect(result.ok).toBe(false);
    expect(state().configuration.plinth.enabled).toBe(false);
    expect(state().rejection?.source).toBe("plinth");
  });
});

describe("useConfiguratorStore structure", () => {
  it("splits, adjusts and removes subdivisions immutably", () => {
    const original = state().configuration;
    expect(state().splitCompartment("root", "horizontal").ok).toBe(true);
    const split = state().configuration;
    expect(original.compartments).toEqual({ id: "root" });
    expect(isBranch(split.compartments)).toBe(true);

    expect(state().setSplitRatio("root", 0.3).ok).toBe(true);
    const root = state().configuration.compartments;
    expect(isBranch(root) && root.split.ratio).toBe(0.3);

    expect(state().removeSplit("root").ok).toBe(true);
    expect(state().configuration.compartments).toEqual({ id: "root" });
  });

  it("rejects operations on missing compartments and leaves the configuration unchanged", () => {
    const before = state().configuration;
    const result = state().splitCompartment("nope", "vertical");
    expect(result.ok).toBe(false);
    expect(state().configuration).toBe(before);
    expect(state().rejection).toEqual({
      source: "structure",
      errors: [expect.objectContaining({ compartmentId: "nope" })],
    });
  });

  it("rejects ratios that would violate the minimum compartment size", () => {
    state().splitCompartment("root", "horizontal");
    const before = state().configuration;
    expect(state().setSplitRatio("root", 0.01).ok).toBe(false);
    expect(state().configuration).toBe(before);
  });

  it("clears the structure rejection after a successful edit", () => {
    state().splitCompartment("missing", "vertical");
    state().splitCompartment("root", "vertical");
    expect(state().rejection).toBeNull();
  });
});

describe("useConfiguratorStore selection", () => {
  it("selects existing compartments only", () => {
    state().selectCompartment("root");
    expect(state().selectedCompartmentId).toBe("root");
    state().selectCompartment("missing");
    expect(state().selectedCompartmentId).toBe("root");
    state().selectCompartment(null);
    expect(state().selectedCompartmentId).toBeNull();
  });

  it("moves the selection to the nearest surviving ancestor when its subtree is removed", () => {
    state().splitCompartment("root", "horizontal");
    state().splitCompartment("c2", "vertical");
    state().selectCompartment("c4");
    state().removeSplit("c2");
    expect(state().selectedCompartmentId).toBe("c2");
    state().removeSplit("root");
    expect(state().selectedCompartmentId).toBe("root");
  });

  it("keeps the selection across unrelated edits", () => {
    state().splitCompartment("root", "vertical");
    state().selectCompartment("c1");
    state().setNumericField("height", 2000);
    state().setMaterial("interior", "walnut");
    expect(state().selectedCompartmentId).toBe("c1");
  });

  it("clears the selection on reset and import", () => {
    state().selectCompartment("root");
    state().reset();
    expect(state().selectedCompartmentId).toBeNull();
    state().selectCompartment("root");
    state().replaceConfiguration({ ...DEFAULT_CABINET, width: 900 });
    expect(state().selectedCompartmentId).toBeNull();
  });
});

describe("useConfiguratorStore replaceConfiguration", () => {
  it("replaces the configuration atomically and clears pending inputs", () => {
    state().setNumericField("depth", 1);
    const next = { ...DEFAULT_CABINET, depth: 600, backPanel: { enabled: true, thickness: 5 } };
    expect(state().replaceConfiguration(next).ok).toBe(true);
    expect(state().configuration).toEqual(next);
    expect(state().pendingInputs).toEqual({});
  });

  it("refuses invalid configurations and keeps the current one", () => {
    state().splitCompartment("root", "vertical");
    const before = state().configuration;
    const invalid = { ...DEFAULT_CABINET, compartments: { id: "x", split: { direction: "vertical" as const, ratio: 2 }, children: [{ id: "a" }, { id: "a" }] as const } };
    expect(state().replaceConfiguration(invalid).ok).toBe(false);
    expect(state().configuration).toBe(before);
    expect(getCompartment(state().configuration.compartments, "c1")).not.toBeNull();
  });
});

describe("useConfiguratorStore view commands", () => {
  it("issues distinguishable camera requests", () => {
    state().requestView("fit");
    const first = state().viewCommand;
    state().requestView("fit");
    expect(state().viewCommand?.kind).toBe("fit");
    expect(state().viewCommand?.seq).toBe((first?.seq ?? 0) + 1);
  });
});
