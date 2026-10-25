import { describe, expect, it } from "vitest";
import type { CompartmentNode } from "../compartments/types";
import { DEFAULT_CABINET } from "../furniture/defaults";
import type { CabinetConfiguration } from "../furniture/types";
import { buildCabinet } from "../geometry/buildCabinet";
import type { PanelPart } from "../geometry/types";
import type { DoorConfiguration, DrawerConfiguration, FurnitureAttachment } from "./types";

const NO_HANDLE = { type: "none", finish: "brushed-steel", align: "center", edgeOffset: 40, alignOffset: 100 } as const;
const DOOR: DoorConfiguration = { layout: "single", mounting: "overlay", hinge: "left", gap: 2, centerGap: 3, maxOpenAngle: 100, handle: NO_HANDLE };
const DRAWERS: DrawerConfiguration = {
  count: 3,
  placement: "exterior",
  mounting: "overlay",
  frontGap: 3,
  depth: 450,
  heightRatios: null,
  handle: NO_HANDLE,
};
const VERTICAL_SPLIT: CompartmentNode = {
  id: "root",
  split: { direction: "vertical", ratio: 0.5 },
  children: [{ id: "c1" }, { id: "c2" }],
};

function door(compartmentId: string, configuration: Partial<DoorConfiguration> = {}, id = "a1"): FurnitureAttachment {
  return { id, type: "door", compartmentId, configuration: { ...DOOR, ...configuration } };
}

function drawers(compartmentId: string, configuration: Partial<DrawerConfiguration> = {}, id = "a1"): FurnitureAttachment {
  return { id, type: "drawer", compartmentId, configuration: { ...DRAWERS, ...configuration } };
}

function build(attachments: FurnitureAttachment[], overrides: Partial<CabinetConfiguration> = {}): PanelPart[] {
  return buildCabinet({ ...DEFAULT_CABINET, ...overrides, attachments });
}

function attachmentParts(parts: readonly PanelPart[]) {
  return parts.filter((p) => p.attachmentId !== undefined);
}

function byId(parts: readonly PanelPart[], id: string): PanelPart {
  const part = parts.find((p) => p.id === id);
  if (!part) throw new Error(`Part ${id} not generated (have: ${parts.map((p) => p.id).join(", ")})`);
  return part;
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

function expectNoOverlaps(parts: readonly PanelPart[]) {
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      expect(overlapVolume(parts[i], parts[j]), `${parts[i].id} ∩ ${parts[j].id}`).toBeCloseTo(0, 9);
    }
  }
}

describe("doors", () => {
  // Default interior opening: x 18–782, y 18–1782, z 0–500; t = 18.

  it("builds a single left-hinged overlay door in front of the carcass, fully covering the outer carcass panels", () => {
    const [leaf] = attachmentParts(build([door("root")]));
    expect(leaf).toMatchObject({
      id: "door/a1",
      type: "door",
      attachmentId: "a1",
      compartmentId: "root",
      materialSlot: "doorFront",
      materialId: "natural-oak",
      // All four edges are outer carcass panels: opening + (t − gap/2) = 17 mm per side.
      position: { x: 1, y: 1, z: 500 },
      dimensions: { width: 798, height: 1798, depth: 18 },
    });
    // Left hinge: axis on the front face at the left edge; negative rotation about +Y swings it outwards.
    expect(leaf.motion).toEqual({ kind: "hinge", groupId: "door/a1", pivot: { x: 1, y: 1, z: 518 }, direction: -1, maxAngleDeg: 100 });
  });

  it("puts the hinge of a right-hinged door on the right edge with the opposite rotation", () => {
    const [leaf] = attachmentParts(build([door("root", { hinge: "right" })]));
    expect(leaf.motion).toMatchObject({ kind: "hinge", pivot: { x: 799, z: 518 }, direction: 1 });
  });

  it("opens outwards for both hinge sides (the free edge moves to +Z)", () => {
    for (const hinge of ["left", "right"] as const) {
      const [leaf] = attachmentParts(build([door("root", { hinge })]));
      if (leaf.motion?.kind !== "hinge") throw new Error("expected a hinge");
      const freeEdgeX = hinge === "left" ? leaf.position.x + leaf.dimensions.width : leaf.position.x;
      const dx = freeEdgeX - leaf.motion.pivot.x;
      const angle = (leaf.motion.direction * Math.PI) / 2;
      // Rotation about +Y: z' = −x·sin(θ).
      expect(-dx * Math.sin(angle)).toBeGreaterThan(0);
    }
  });

  it("builds an inset door inside the opening, flush with the carcass front, hinged on its front edge", () => {
    const [leaf] = attachmentParts(build([door("root", { mounting: "inset" })]));
    expect(leaf).toMatchObject({
      position: { x: 20, y: 20, z: 482 },
      dimensions: { width: 760, height: 1760, depth: 18 },
      motion: { pivot: { x: 20, z: 500 }, direction: -1 },
    });
    expectNoOverlaps(build([door("root", { mounting: "inset" })]));
  });

  it("applies the configured clearance", () => {
    const [overlay] = attachmentParts(build([door("root", { gap: 4 })]));
    expect(overlay.dimensions.width).toBe(764 + 2 * (18 - 2));
    const [inset] = attachmentParts(build([door("root", { mounting: "inset", gap: 4 })]));
    expect(inset.dimensions.width).toBe(764 - 8);
  });

  it("builds double doors as two leaves hinged left and right with the centre gap between them", () => {
    const parts = attachmentParts(build([door("root", { layout: "double", centerGap: 3 })]));
    expect(parts.map((p) => p.id)).toEqual(["door/a1/left", "door/a1/right"]);
    const [left, right] = parts;
    expect(left.dimensions.width).toBe((798 - 3) / 2);
    expect(right.position.x - (left.position.x + left.dimensions.width)).toBe(3);
    expect(left.motion).toMatchObject({ groupId: "door/a1/left", pivot: { x: 1 }, direction: -1 });
    expect(right.motion).toMatchObject({ groupId: "door/a1/right", pivot: { x: 799 }, direction: 1 });
  });

  it("keeps overlay fronts of neighbouring compartments apart by exactly the gap", () => {
    const parts = build([door("c1", {}, "a1"), door("c2", {}, "a2")], { compartments: VERTICAL_SPLIT });
    const left = byId(parts, "door/a1");
    const right = byId(parts, "door/a2");
    expect(right.position.x - (left.position.x + left.dimensions.width)).toBeCloseTo(2, 9);
    expectNoOverlaps(parts);
  });

  it("follows cabinet resizing and panel thickness", () => {
    expect(byId(build([door("root")], { width: 1000 }), "door/a1").dimensions.width).toBe(1000 - 36 + 2 * 17);
    expect(byId(build([door("root")], { panelThickness: 25 }), "door/a1")).toMatchObject({
      // t = 25: opening 750 wide from x = 25, + (25 − 1) per outer side.
      position: { x: 1, z: 500 },
      dimensions: { width: 750 + 48, depth: 25 },
    });
  });

  it("generates stable part IDs across resizing and configuration changes", () => {
    const ids = (d: FurnitureAttachment, overrides: Partial<CabinetConfiguration> = {}) =>
      attachmentParts(build([d], overrides)).map((p) => p.id);
    expect(ids(door("root"))).toEqual(ids(door("root", { hinge: "right", mounting: "inset" }), { width: 1200 }));
    expect(ids(door("root", { layout: "double" }))).toEqual(ids(door("root", { layout: "double" }), { height: 2400 }));
  });
});

describe("drawers", () => {
  it("builds a front and a five-part box for a single drawer", () => {
    const parts = attachmentParts(build([drawers("root", { count: 1 })]));
    expect(parts.map((p) => [p.id, p.type, p.materialSlot])).toEqual([
      ["drawer/a1/1/front", "drawer-front", "drawerFront"],
      ["drawer/a1/1/side-left", "drawer-side", "interior"],
      ["drawer/a1/1/side-right", "drawer-side", "interior"],
      ["drawer/a1/1/back", "drawer-back", "interior"],
      ["drawer/a1/1/bottom", "drawer-bottom", "interior"],
    ]);
  });

  it("stacks equal-height fronts bottom-up with the front gap between them", () => {
    const parts = build([drawers("root")]);
    const fronts = [1, 2, 3].map((i) => byId(parts, `drawer/a1/${i}/front`));
    // Outer edges: opening + (18 − 1.5) per side → 797 × 1797 from (1.5, 1.5); (1797 − 2·3) / 3 = 597.
    for (const front of fronts) expect(front.dimensions).toEqual({ width: 797, height: 597, depth: 18 });
    expect(fronts.map((f) => f.position.y)).toEqual([1.5, 601.5, 1201.5]);
    expect(fronts[1].position.y - (fronts[0].position.y + fronts[0].dimensions.height)).toBe(3);
    expect(fronts.every((f) => f.position.z === 500)).toBe(true);
  });

  it("builds the box behind the front with runner clearance and real panel thicknesses", () => {
    const parts = build([drawers("root")]);
    const side = byId(parts, "drawer/a1/1/side-left");
    const right = byId(parts, "drawer/a1/1/side-right");
    const back = byId(parts, "drawer/a1/1/back");
    const bottom = byId(parts, "drawer/a1/1/bottom");
    // Opening 764 wide → 13 mm runner clearance per side → box 738 wide from x = 31.
    expect(side).toMatchObject({ position: { x: 31, y: 28, z: 50 }, dimensions: { width: 12, height: 568, depth: 450 } });
    expect(right.position.x + right.dimensions.width).toBe(31 + 738);
    expect(back).toMatchObject({ position: { x: 43, z: 50 }, dimensions: { width: 714, depth: 12 } });
    expect(bottom).toMatchObject({ position: { x: 43, y: 28, z: 62 }, dimensions: { width: 714, height: 8, depth: 438 } });
    // The box ends exactly at the back of the front.
    expect(side.position.z + side.dimensions.depth).toBe(500);
    expectNoOverlaps(parts);
  });

  it("moves each drawer as one unit along +Z, constrained by its depth", () => {
    const parts = attachmentParts(build([drawers("root")]));
    const first = parts.filter((p) => p.id.startsWith("drawer/a1/1/"));
    expect(first).toHaveLength(5);
    for (const part of first) expect(part.motion).toEqual({ kind: "slide", groupId: "drawer/a1/1", distance: 360 });
    expect(new Set(parts.map((p) => p.motion?.groupId))).toEqual(new Set(["drawer/a1/1", "drawer/a1/2", "drawer/a1/3"]));
  });

  it("places inset drawer fronts inside the opening and the box behind them", () => {
    const parts = build([drawers("root", { mounting: "inset", count: 2, depth: 400 })]);
    const front = byId(parts, "drawer/a1/1/front");
    expect(front.position).toEqual({ x: 21, y: 21, z: 482 });
    const side = byId(parts, "drawer/a1/1/side-left");
    expect(side.position.z + side.dimensions.depth).toBe(482);
    expectNoOverlaps(parts);
  });

  it("starts the box in front of the back panel", () => {
    const parts = build([drawers("root", { depth: 480 })], { backPanel: { enabled: true, thickness: 8 } });
    // Available: 492 − 10 rear clearance = 482 ≥ 480.
    expect(byId(parts, "drawer/a1/1/side-left").position.z).toBe(20);
    expectNoOverlaps(parts);
  });

  it("generates stable part IDs when resizing", () => {
    const ids = (overrides: Partial<CabinetConfiguration>) => attachmentParts(build([drawers("root")], overrides)).map((p) => p.id);
    expect(ids({ width: 1200, height: 2000 })).toEqual(ids({}));
  });

  it("is deterministic", () => {
    const configuration = { ...DEFAULT_CABINET, attachments: [drawers("root")] };
    expect(buildCabinet(configuration)).toEqual(buildCabinet(structuredClone(configuration)));
  });
});

describe("front materials", () => {
  it("resolves door and drawer fronts through their own slots and drawer boxes through interior", () => {
    const materials = { ...DEFAULT_CABINET.materials, doorFront: "walnut", drawerFront: "black-matte", interior: "white-matte" } as const;
    const parts = build([door("c1", {}, "a1"), drawers("c2", { count: 2 }, "a2")], { compartments: VERTICAL_SPLIT, materials });
    const finishes = Object.fromEntries(parts.map((p) => [p.type, p.materialId]));
    expect(finishes).toMatchObject({
      door: "walnut",
      "drawer-front": "black-matte",
      "drawer-side": "white-matte",
      "drawer-bottom": "white-matte",
      divider: "white-matte",
      "left-side": "natural-oak",
    });
  });
});
