import { describe, expect, it } from "vitest";
import { InvalidCabinetConfigurationError } from "../constraints/validateCabinet";
import { DEFAULT_CABINET } from "../furniture/defaults";
import type { CabinetConfiguration } from "../furniture/types";
import type { CompartmentNode } from "../compartments/types";
import { buildCabinet, CABINET_PANEL_IDS, dividerPartId, shelfPartId } from "./buildCabinet";
import type { PanelPart, PanelType } from "./types";

function build(overrides: Partial<CabinetConfiguration> = {}): PanelPart[] {
  return buildCabinet({ ...DEFAULT_CABINET, ...overrides });
}

function panel(panels: readonly PanelPart[], type: PanelType): PanelPart {
  const found = panels.find((p) => p.type === type);
  if (!found) throw new Error(`Panel "${type}" not generated`);
  return found;
}

function overlapVolume(a: PanelPart, b: PanelPart): number {
  const axis = (aMin: number, aSize: number, bMin: number, bSize: number) =>
    Math.max(0, Math.min(aMin + aSize, bMin + bSize) - Math.max(aMin, bMin));
  return (
    axis(a.position.x, a.dimensions.width, b.position.x, b.dimensions.width) *
    axis(a.position.y, a.dimensions.height, b.position.y, b.dimensions.height) *
    axis(a.position.z, a.dimensions.depth, b.position.z, b.dimensions.depth)
  );
}

/** Asserts the panels form a closed carcass of the given outer size with no overlaps or gaps. */
function expectConnectedCarcass(panels: readonly PanelPart[], config: CabinetConfiguration) {
  const left = panel(panels, "left-side");
  const right = panel(panels, "right-side");
  const top = panel(panels, "top");
  const bottom = panel(panels, "bottom");

  // Horizontal panels start exactly where the left side ends and end where the right side starts.
  for (const horizontal of [top, bottom]) {
    expect(horizontal.position.x).toBe(left.position.x + left.dimensions.width);
    expect(horizontal.position.x + horizontal.dimensions.width).toBe(right.position.x);
  }
  expect(bottom.position.y).toBe(0);
  expect(top.position.y + top.dimensions.height).toBe(config.height);
  expect(right.position.x + right.dimensions.width).toBe(config.width);

  for (let i = 0; i < panels.length; i++) {
    for (let j = i + 1; j < panels.length; j++) {
      expect(overlapVolume(panels[i], panels[j])).toBe(0);
    }
  }
}

describe("buildCabinet", () => {
  it("generates exactly four panels for the default cabinet", () => {
    const panels = build();
    expect(panels).toHaveLength(4);
    expect(panels.map((p) => p.type).sort()).toEqual(["bottom", "left-side", "right-side", "top"]);
    expectConnectedCarcass(panels, DEFAULT_CABINET);
  });

  it("makes the left and right panels span the full cabinet height", () => {
    const panels = build();
    for (const type of ["left-side", "right-side"] as const) {
      const side = panel(panels, type);
      expect(side.position.y).toBe(0);
      expect(side.dimensions).toEqual({ width: 18, height: 1800, depth: 500 });
    }
    expect(panel(panels, "left-side").position).toEqual({ x: 0, y: 0, z: 0 });
    expect(panel(panels, "right-side").position).toEqual({ x: 782, y: 0, z: 0 });
  });

  it("fits the top and bottom panels between the side panels", () => {
    const panels = build();
    const top = panel(panels, "top");
    const bottom = panel(panels, "bottom");

    expect(top.dimensions).toEqual({ width: 764, height: 18, depth: 500 });
    expect(bottom.dimensions).toEqual({ width: 764, height: 18, depth: 500 });
    expect(bottom.position).toEqual({ x: 18, y: 0, z: 0 });
    expect(top.position).toEqual({ x: 18, y: 1782, z: 0 });
  });

  it("updates widths and positions when the width changes", () => {
    const config = { ...DEFAULT_CABINET, width: 1200 };
    const panels = buildCabinet(config);

    expect(panel(panels, "right-side").position.x).toBe(1182);
    expect(panel(panels, "top").dimensions.width).toBe(1164);
    expect(panel(panels, "bottom").dimensions.width).toBe(1164);
    // Side panels keep their size.
    expect(panel(panels, "left-side").dimensions).toEqual({ width: 18, height: 1800, depth: 500 });
    expectConnectedCarcass(panels, config);
  });

  it("updates heights and positions when the height changes", () => {
    const config = { ...DEFAULT_CABINET, height: 2000 };
    const panels = buildCabinet(config);

    expect(panel(panels, "left-side").dimensions.height).toBe(2000);
    expect(panel(panels, "right-side").dimensions.height).toBe(2000);
    expect(panel(panels, "top").position.y).toBe(1982);
    expect(panel(panels, "bottom").position.y).toBe(0);
    expect(panel(panels, "top").dimensions.width).toBe(764);
    expectConnectedCarcass(panels, config);
  });

  it("updates the depth of every panel when the depth changes", () => {
    const panels = build({ depth: 600 });
    for (const p of panels) {
      expect(p.dimensions.depth).toBe(600);
      expect(p.position.z).toBe(0);
    }
  });

  it("updates geometry when the panel thickness changes", () => {
    const config = { ...DEFAULT_CABINET, panelThickness: 25 };
    const panels = buildCabinet(config);

    expect(panel(panels, "left-side").dimensions.width).toBe(25);
    expect(panel(panels, "right-side").dimensions.width).toBe(25);
    expect(panel(panels, "right-side").position.x).toBe(775);
    expect(panel(panels, "top").dimensions).toEqual({ width: 750, height: 25, depth: 500 });
    expect(panel(panels, "top").position).toEqual({ x: 25, y: 1775, z: 0 });
    expect(panel(panels, "bottom").position).toEqual({ x: 25, y: 0, z: 0 });
    expectConnectedCarcass(panels, config);
  });

  it.each<[string, Partial<CabinetConfiguration>]>([
    ["negative width", { width: -800 }],
    ["zero height", { height: 0 }],
    ["NaN depth", { depth: Number.NaN }],
    ["infinite thickness", { panelThickness: Number.POSITIVE_INFINITY }],
    ["width above the limit", { width: 2401 }],
    ["thickness below the limit", { panelThickness: 15 }],
  ])("rejects invalid dimensions: %s", (_, overrides) => {
    expect(() => build(overrides)).toThrow(InvalidCabinetConfigurationError);
  });

  it("rejects panel combinations that leave no interior space", () => {
    const limits = {
      width: { min: 1, max: 5000 },
      height: { min: 1, max: 5000 },
      depth: { min: 1, max: 5000 },
      panelThickness: { min: 1, max: 5000 },
    };
    expect(() => buildCabinet({ ...DEFAULT_CABINET, width: 36, panelThickness: 18 }, { limits })).toThrow(
      InvalidCabinetConfigurationError,
    );
    expect(() => buildCabinet({ ...DEFAULT_CABINET, height: 30, panelThickness: 18 }, { limits })).toThrow(
      InvalidCabinetConfigurationError,
    );
  });

  it("assigns stable part IDs independent of dimensions", () => {
    const expectedIds = [
      CABINET_PANEL_IDS.leftSide,
      CABINET_PANEL_IDS.rightSide,
      CABINET_PANEL_IDS.top,
      CABINET_PANEL_IDS.bottom,
    ];
    expect(build().map((p) => p.id)).toEqual(expectedIds);
    expect(build({ width: 1500, height: 2200, depth: 350, panelThickness: 22 }).map((p) => p.id)).toEqual(
      expectedIds,
    );
    expect(new Set(build().map((p) => p.id)).size).toBe(4);
  });

  it("is deterministic and does not mutate its input", () => {
    const config = { ...DEFAULT_CABINET, width: 950, depth: 420 };
    const snapshot = { ...config };
    expect(buildCabinet(config)).toEqual(buildCabinet(config));
    expect(config).toEqual(snapshot);
  });

  it("assigns the default oak finish to every body panel", () => {
    for (const p of build()) {
      expect(p.materialSlot).toBe("body");
      expect(p.materialId).toBe("natural-oak");
    }
  });

  it("preserves the selected body material ID on every carcass panel", () => {
    const panels = build({
      materials: { body: "walnut", interior: "white-matte", backPanel: "anthracite", plinth: "black-matte" },
    });
    expect(panels.map((p) => p.materialId)).toEqual(["walnut", "walnut", "walnut", "walnut"]);
  });

  it("keeps body panels independent of the interior, back panel and plinth finishes", () => {
    const base = build({ materials: { ...DEFAULT_CABINET.materials, body: "cashmere" } });
    const changed = build({
      materials: { body: "cashmere", interior: "black-matte", backPanel: "walnut", plinth: "anthracite" },
    });
    expect(changed).toEqual(base);
  });

  it("changes only material IDs, not geometry, when the body finish changes", () => {
    const oak = build();
    const white = build({ materials: { ...DEFAULT_CABINET.materials, body: "white-matte" } });
    const withoutMaterial = (p: PanelPart) => ({ ...p, materialId: null });
    expect(white.map(withoutMaterial)).toEqual(oak.map(withoutMaterial));
    expect(white.every((p) => p.materialId === "white-matte")).toBe(true);
  });

  it("rejects unknown material IDs", () => {
    const config = {
      ...DEFAULT_CABINET,
      materials: { ...DEFAULT_CABINET.materials, body: "mahogany" },
    } as unknown as CabinetConfiguration;
    expect(() => buildCabinet(config)).toThrow(InvalidCabinetConfigurationError);
  });
});

describe("buildCabinet — interior structure", () => {
  const SHELF_THEN_DIVIDER: CompartmentNode = {
    id: "root",
    split: { direction: "horizontal", ratio: 0.5 },
    children: [{ id: "c1" }, { id: "c2", split: { direction: "vertical", ratio: 0.5 }, children: [{ id: "c3" }, { id: "c4" }] }],
  };

  function expectNoOverlaps(panels: readonly PanelPart[]) {
    for (let i = 0; i < panels.length; i++) {
      for (let j = i + 1; j < panels.length; j++) {
        expect(overlapVolume(panels[i], panels[j]), `${panels[i].id} ∩ ${panels[j].id}`).toBe(0);
      }
    }
  }

  it("generates a full-width shelf for a horizontal split", () => {
    const panels = build({ compartments: { id: "root", split: { direction: "horizontal", ratio: 0.5 }, children: [{ id: "c1" }, { id: "c2" }] } });
    expect(panels).toHaveLength(5);
    expect(panel(panels, "shelf")).toEqual({
      id: shelfPartId("root"),
      type: "shelf",
      materialSlot: "interior",
      materialId: "natural-oak",
      // Interior 764 × 1764; usable height 1764 − 18 = 1746, half = 873.
      dimensions: { width: 764, height: 18, depth: 500 },
      position: { x: 18, y: 18 + 873, z: 0 },
    });
    expectNoOverlaps(panels);
  });

  it("generates a full-height divider for a vertical split", () => {
    const panels = build({ compartments: { id: "root", split: { direction: "vertical", ratio: 0.25 }, children: [{ id: "c1" }, { id: "c2" }] } });
    const divider = panel(panels, "divider");
    expect(divider.id).toBe(dividerPartId("root"));
    // Usable width 764 − 18 = 746; a quarter is 186.5 mm.
    expect(divider.dimensions).toEqual({ width: 18, height: 1764, depth: 500 });
    expect(divider.position).toEqual({ x: 18 + 186.5, y: 18, z: 0 });
    expectNoOverlaps(panels);
  });

  it("sizes nested panels to their own compartment", () => {
    const panels = build({ compartments: SHELF_THEN_DIVIDER });
    const shelf = panels.find((p) => p.id === shelfPartId("root"));
    const divider = panels.find((p) => p.id === dividerPartId("c2"));
    // The divider stands on the shelf and reaches the top panel.
    expect(divider?.position.y).toBe((shelf?.position.y ?? 0) + 18);
    expect((divider?.position.y ?? 0) + (divider?.dimensions.height ?? 0)).toBe(1800 - 18);
    expect(divider?.position.x).toBe(18 + 373);
    expect(panels.map((p) => p.id)).toEqual([
      "cabinet/left-side",
      "cabinet/right-side",
      "cabinet/top",
      "cabinet/bottom",
      "shelf/root",
      "divider/c2",
    ]);
    expectNoOverlaps(panels);
  });

  it("keeps part IDs stable across resizing, thickness and ratio changes", () => {
    const ids = (overrides: Partial<CabinetConfiguration>) => build({ compartments: SHELF_THEN_DIVIDER, ...overrides }).map((p) => p.id);
    const reference = ids({});
    expect(ids({ width: 1400, height: 2400, panelThickness: 25 })).toEqual(reference);
    expect(
      ids({
        compartments: { ...SHELF_THEN_DIVIDER, split: { direction: "horizontal", ratio: 0.3 } } as CompartmentNode,
      }),
    ).toEqual(reference);
  });

  it("produces exactly one separating panel per subdivision", () => {
    const panels = build({ compartments: SHELF_THEN_DIVIDER });
    const interior = panels.filter((p) => p.materialSlot === "interior");
    expect(interior).toHaveLength(2);
    expect(new Set(panels.map((p) => p.id)).size).toBe(panels.length);
  });

  it("assigns material slots per part type", () => {
    const panels = build({
      compartments: SHELF_THEN_DIVIDER,
      backPanel: { enabled: true, thickness: 8 },
      plinth: { enabled: true, height: 80, setback: 30 },
      materials: { body: "white-matte", interior: "walnut", backPanel: "light-grey", plinth: "black-matte" },
    });
    const slots = Object.fromEntries(panels.map((p) => [p.type, [p.materialSlot, p.materialId]]));
    expect(slots).toEqual({
      "left-side": ["body", "white-matte"],
      "right-side": ["body", "white-matte"],
      top: ["body", "white-matte"],
      bottom: ["body", "white-matte"],
      shelf: ["interior", "walnut"],
      divider: ["interior", "walnut"],
      "back-panel": ["backPanel", "light-grey"],
      plinth: ["plinth", "black-matte"],
    });
  });

  it("rejects trees whose compartments would be too small", () => {
    const tooFine: CompartmentNode = { id: "root", split: { direction: "horizontal", ratio: 0.05 }, children: [{ id: "a" }, { id: "b" }] };
    expect(() => build({ compartments: tooFine })).toThrow(InvalidCabinetConfigurationError);
  });
});

describe("buildCabinet — back panel", () => {
  it("is inset between the carcass panels at the rear", () => {
    const panels = build({ backPanel: { enabled: true, thickness: 8 } });
    expect(panel(panels, "back-panel")).toMatchObject({
      id: CABINET_PANEL_IDS.backPanel,
      materialSlot: "backPanel",
      dimensions: { width: 764, height: 1764, depth: 8 },
      position: { x: 18, y: 18, z: 0 },
    });
    expectConnectedCarcass(panels, DEFAULT_CABINET);
  });

  it("pushes shelves and dividers in front of it", () => {
    const panels = build({
      backPanel: { enabled: true, thickness: 8 },
      compartments: { id: "root", split: { direction: "vertical", ratio: 0.5 }, children: [{ id: "c1" }, { id: "c2" }] },
    });
    expect(panel(panels, "divider")).toMatchObject({ position: { z: 8 }, dimensions: { depth: 492 } });
    expectConnectedCarcass(panels, DEFAULT_CABINET);
  });

  it("is not generated when disabled, even with a thickness set", () => {
    expect(build({ backPanel: { enabled: false, thickness: 12 } }).some((p) => p.type === "back-panel")).toBe(false);
  });
});

describe("buildCabinet — plinth", () => {
  const PLINTH = { enabled: true, height: 100, setback: 40 };

  it("is a recessed block under the carcass", () => {
    const panels = build({ plinth: PLINTH });
    expect(panel(panels, "plinth")).toMatchObject({
      id: CABINET_PANEL_IDS.plinth,
      materialSlot: "plinth",
      dimensions: { width: 800, height: 100, depth: 460 },
      position: { x: 0, y: 0, z: 0 },
    });
  });

  it("raises the carcass so that the outer height is unchanged", () => {
    const panels = build({ plinth: PLINTH });
    expect(panel(panels, "left-side")).toMatchObject({ position: { y: 100 }, dimensions: { height: 1700 } });
    expect(panel(panels, "bottom").position.y).toBe(100);
    expect(panel(panels, "top").position.y + 18).toBe(1800);
    for (let i = 0; i < panels.length; i++) {
      for (let j = i + 1; j < panels.length; j++) expect(overlapVolume(panels[i], panels[j])).toBe(0);
    }
  });

  it("follows cabinet resizing", () => {
    const panels = build({ plinth: PLINTH, width: 1200, depth: 600 });
    expect(panel(panels, "plinth").dimensions).toEqual({ width: 1200, height: 100, depth: 560 });
  });

  it("rejects a plinth that is out of range", () => {
    expect(() => build({ plinth: { enabled: true, height: 20, setback: 0 } })).toThrow(InvalidCabinetConfigurationError);
  });
});
