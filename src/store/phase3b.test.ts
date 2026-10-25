import { beforeEach, describe, expect, it } from "vitest";
import { getInteriorDrawers } from "@/domain/attachments/operations";
import type { DrawerAttachment } from "@/domain/attachments/types";
import { validateCabinet } from "@/domain/constraints/validateCabinet";
import { buildCabinet } from "@/domain/geometry/buildCabinet";
import { buildFurniture } from "@/domain/geometry/buildFurniture";
import type { PanelPart } from "@/domain/geometry/types";
import { useConfiguratorStore } from "./useConfiguratorStore";

const state = () => useConfiguratorStore.getState();
const panels = () => buildCabinet(state().configuration);
const part = (id: string): PanelPart => {
  const found = panels().find((p) => p.id === id);
  if (!found) throw new Error(`missing part ${id}: ${panels().map((p) => p.id).join(", ")}`);
  return found;
};
const fronts = (attachmentId: string) =>
  panels().filter((p) => p.attachmentId === attachmentId && (p.type === "drawer-front" || p.type === "door"));
const drawer = (id: string) => state().configuration.attachments.find((a) => a.id === id) as DrawerAttachment;

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

/** Root door; root → c1 (bottom) | c2 (top); c2 → c3 | c4 (shelves); interior drawers in c1. */
function doorWithInteriorDrawers() {
  expect(state().addDoor("root", "single").ok).toBe(true);
  expect(state().splitCompartment("root", "horizontal").ok).toBe(true);
  expect(state().splitCompartment("c2", "horizontal").ok).toBe(true);
  expect(state().addDrawers("c1", "interior")).toEqual({ ok: true });
}

describe("interior drawers", () => {
  it("are valid in a child compartment behind a door on the parent", () => {
    doorWithInteriorDrawers();
    expect(state().configuration.attachments.map((a) => [a.id, a.type, a.compartmentId])).toEqual([
      ["a1", "door", "root"],
      ["a2", "drawer", "c1"],
    ]);
    expect(drawer("a2").configuration).toMatchObject({ placement: "interior", mounting: "inset", count: 3, depth: 450 });
    expect(validateCabinet(state().configuration).isValid).toBe(true);
  });

  it("sit inside their compartment, behind the door and the hinge clearance", () => {
    doorWithInteriorDrawers();
    // c1 opening: x 18–782, y 18–891, z 0–500. Overlay door → no recess; front face at 500 − 20 = 480.
    // Sides inset by gap + t + 2 = 23 mm; fronts (873 − 2·3 − 2·3) / 3 = 287 mm high.
    expect(part("drawer/a2/1/front")).toMatchObject({
      position: { x: 41, y: 21, z: 462 },
      dimensions: { width: 718, height: 287, depth: 18 },
      materialSlot: "drawerFront",
    });
    const side = part("drawer/a2/1/side-left");
    expect(side.position.x).toBe(41);
    expect(side.position.z + side.dimensions.depth).toBe(462);
    // Nothing intersects: carcass, shelves, door, all drawer parts.
    expectNoOverlaps(panels());
  });

  it("never intersect the closed door, for overlay and inset doors", () => {
    doorWithInteriorDrawers();
    const door = part("door/a1");
    for (const p of panels().filter((x) => x.attachmentId === "a2")) expect(overlapVolume(p, door)).toBe(0);
    expect(state().updateDoor("a1", { mounting: "inset" }).ok).toBe(false); // 450 mm drawers no longer fit…
    expect(state().updateDrawers("a2", { depth: 400 }).ok).toBe(true);
    expect(state().updateDoor("a1", { mounting: "inset" }).ok).toBe(true); // …but 400 mm do.
    const inset = part("door/a1");
    expect(part("drawer/a2/1/front").position.z + 18).toBe(inset.position.z - 20);
    expectNoOverlaps(panels());
  });

  it("use the depth left behind the door, hinge clearance, front and rear clearance", () => {
    doorWithInteriorDrawers();
    // 500 − 0 (overlay) − 20 − 18 − 10 = 452 mm available.
    expect(state().updateDrawers("a2", { depth: 452 }).ok).toBe(true);
    expect(state().updateDrawers("a2", { depth: 453 })).toMatchObject({ ok: false, errors: [{ code: "drawer_depth_out_of_range" }] });
    // A back panel takes 8 mm more.
    expect(state().setBackPanelEnabled(true)).toMatchObject({ ok: false, errors: [{ code: "drawer_depth_out_of_range" }] });
  });

  it("require a covering door", () => {
    state().splitCompartment("root", "horizontal");
    expect(state().addDrawers("c1", "interior")).toMatchObject({ ok: false });
    expect(state().rejection?.errors[0].message).toMatch(/wymagają drzwi/);
    state().reset();
    doorWithInteriorDrawers();
    expect(state().removeAttachment("a1")).toMatchObject({ ok: false, errors: [{ code: "interior_drawer_without_door" }] });
  });

  it("reject references to missing or subdivided compartments", () => {
    doorWithInteriorDrawers();
    const base = state().configuration;
    const interior = drawer("a2");
    const withRef = (compartmentId: string) => ({ ...base, attachments: [base.attachments[0], { ...interior, compartmentId }] });
    expect(validateCabinet(withRef("zz")).errors.map((e) => e.code)).toEqual(["attachment_compartment_not_found"]);
    expect(validateCabinet(withRef("c2")).errors.map((e) => e.code)).toEqual(["attachment_not_on_leaf"]);
  });

  it("reject compartments without enough space", () => {
    state().setNumericField("depth", 200);
    state().addDoor("root", "single");
    // 200 − 20 − 18 − 10 = 152 mm ≥ 150 …
    expect(state().addDrawers("root", "interior").ok).toBe(true);
    // … but with an 8 mm back panel only 144 mm remain.
    expect(state().setBackPanelEnabled(true)).toMatchObject({ ok: false, errors: [{ code: "drawer_depth_out_of_range" }] });
  });

  it("allow one drawer assembly per compartment and coexist with exterior fronts elsewhere", () => {
    doorWithInteriorDrawers();
    expect(state().addDrawers("c1", "interior").ok).toBe(false);
    expect(getInteriorDrawers(state().configuration, "c1")?.id).toBe("a2");
  });

  it("are preserved by valid resizing and keep their IDs", () => {
    doorWithInteriorDrawers();
    expect(state().setNumericField("width", 1000).ok).toBe(true);
    expect(state().setNumericField("height", 2000).ok).toBe(true);
    expect(state().configuration.attachments.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(part("drawer/a2/1/front").dimensions.width).toBe(1000 - 36 - 46);
  });

  it("only open behind an open door and do not collide with the door leaf", () => {
    doorWithInteriorDrawers();
    const limit = buildFurniture(state().configuration).motion.get("drawer/a2/1");
    expect(limit).toMatchObject({ requiresOpen: "a1", requested: 360, allowed: 360, blockedBy: [] });
  });
});

describe("variable drawer heights", () => {
  beforeEach(() => {
    state().setNumericField("height", 760);
    expect(state().addDrawers("root").ok).toBe(true);
    expect(state().updateDrawers("a1", { count: 3 }).ok).toBe(true);
  });

  // 760 mm cabinet: opening 724 mm, overlay area 724 + 2·16.5 = 757 mm, minus two 3 mm gaps = 751 mm of fronts.
  const heights = () => fronts("a1").map((p) => p.dimensions.height);

  it("splits the height equally by default", () => {
    expect(drawer("a1").configuration.heightRatios).toBeNull();
    for (const h of heights()) expect(h).toBeCloseTo(751 / 3, 9);
  });

  it("sets one front exactly; the top drawer absorbs the difference, earlier entries stay as typed", () => {
    const equal = 751 / 3;
    expect(state().setDrawerFrontHeight("a1", 0, 120).ok).toBe(true);
    expect(heights()[0]).toBeCloseTo(120, 1);
    expect(heights()[1]).toBeCloseTo(equal, 1);
    expect(state().setDrawerFrontHeight("a1", 1, 180).ok).toBe(true);
    const [a, b, c] = heights();
    expect(a).toBeCloseTo(120, 1);
    expect(b).toBeCloseTo(180, 1);
    expect(c).toBeCloseTo(751 - 300, 1);
    // Editing the top drawer moves the difference to the one below it.
    expect(state().setDrawerFrontHeight("a1", 2, 400).ok).toBe(true);
    expect(heights()).toEqual([expect.closeTo(120, 1), expect.closeTo(231, 1), expect.closeTo(400, 1)]);
  });

  it("keeps the total exactly equal to the available height, without overlaps", () => {
    state().setDrawerFrontHeight("a1", 0, 123.4);
    state().setDrawerFrontHeight("a1", 2, 401.7);
    expect(heights().reduce((x, y) => x + y, 0)).toBe(751);
    const list = fronts("a1");
    for (let i = 1; i < list.length; i++) {
      expect(list[i].position.y - (list[i - 1].position.y + list[i - 1].dimensions.height)).toBeCloseTo(3, 9);
    }
    expectNoOverlaps(panels());
  });

  it("enforces the minimum front and box heights", () => {
    // A 60 mm front also leaves its box too low (37.8 mm < 50 mm): both are reported.
    expect(state().setDrawerFrontHeight("a1", 0, 60)).toMatchObject({
      ok: false,
      errors: [{ code: "drawer_front_too_low" }, { code: "drawer_box_too_small" }],
    });
    expect(state().setDrawerFrontHeight("a1", 0, 751)).toMatchObject({ ok: false });
    expect(drawer("a1").configuration.heightRatios).toBeNull();
  });

  it("rejects invalid ratios", () => {
    for (const heightRatios of [[1, 2], [1, -1, 1], [1, 0, 1], [1, Number.NaN, 1]]) {
      expect(state().updateDrawers("a1", { heightRatios })).toMatchObject({ ok: false, errors: [{ code: "invalid_drawer_heights" }] });
    }
  });

  it("scales proportionally when the cabinet height changes", () => {
    state().setDrawerFrontHeight("a1", 0, 120);
    const before = heights();
    expect(state().setNumericField("height", 1100).ok).toBe(true);
    const after = heights();
    expect(after[0] / after[2]).toBeCloseTo(before[0] / before[2], 6);
    expect(after.reduce((x, y) => x + y, 0)).toBeCloseTo(1064 + 33 - 6, 9);
  });

  it("resets to equal heights when the count changes or on request", () => {
    state().setDrawerFrontHeight("a1", 0, 120);
    expect(state().updateDrawers("a1", { count: 2 }).ok).toBe(true);
    expect(drawer("a1").configuration.heightRatios).toBeNull();
    state().setDrawerFrontHeight("a1", 0, 200);
    state().updateDrawers("a1", { heightRatios: null });
    expect(heights()[0]).toBeCloseTo(heights()[1], 9);
  });
});

describe("overlay front layout", () => {
  it("covers the outer carcass panels fully with one full-height door", () => {
    state().addDoor("root", "single");
    // 18 − gap/2 = 17 mm beyond the opening on every outer edge → 1 mm reveal at the carcass edge.
    expect(part("door/a1")).toMatchObject({ position: { x: 1, y: 1 }, dimensions: { width: 798, height: 1798 } });
  });

  it("shares a divider between two adjacent doors with exactly one gap", () => {
    state().splitCompartment("root", "vertical");
    state().addDoor("c1", "single");
    state().addDoor("c2", "single");
    const left = part("door/a1");
    const right = part("door/a2");
    expect(left.position.x).toBe(1);
    expect(left.position.x + left.dimensions.width).toBe(391 + 8);
    expect(right.position.x).toBe(409 - 8);
    expect(right.position.x + right.dimensions.width).toBe(799);
    expectNoOverlaps(panels());
  });

  it("keeps fronts above and below one another apart over a shared shelf", () => {
    state().splitCompartment("root", "horizontal");
    state().addDoor("c1", "single");
    state().addDrawers("c2");
    const door = part("door/a1");
    const lowestDrawer = fronts("a2")[0];
    expect(lowestDrawer.position.y - (door.position.y + door.dimensions.height)).toBeCloseTo(1 + 1.5, 9);
    expectNoOverlaps(panels());
  });

  it("combines overlay, inset and drawer fronts and nested parent doors without overlaps", () => {
    state().splitCompartment("root", "vertical");
    state().splitCompartment("c2", "horizontal");
    state().addDoor("c1", "single");
    state().updateDoor("a1", { mounting: "inset" });
    state().addDrawers("c3");
    state().addDoor("c4", "double");
    expectNoOverlaps(panels());
    // Inset door inside its opening; its neighbours are overlay fronts in front of the carcass.
    expect(part("door/a1").position).toMatchObject({ x: 20, z: 482 });
  });

  it("covers a nested parent compartment: outer edges fully, the shared shelf by half", () => {
    state().splitCompartment("root", "horizontal");
    state().splitCompartment("c2", "vertical");
    state().addDoor("c2", "single");
    // c2: y 909–1782; bottom on the shared shelf (half), top/sides outer (full).
    expect(part("door/a1")).toMatchObject({ position: { x: 1, y: 909 - 8 }, dimensions: { width: 798, height: 1782 + 17 - 901 } });
  });

  it("scales with the panel thickness", () => {
    state().setNumericField("panelThickness", 25);
    state().addDoor("root", "single");
    expect(part("door/a1")).toMatchObject({ position: { x: 1 }, dimensions: { width: 798, depth: 25 } });
  });
});

describe("handles", () => {
  const hardware = () => buildFurniture(state().configuration).hardware;

  it("places a door knob on the free edge, depending on the hinge side", () => {
    state().addDoor("root", "single");
    state().updateDoor("a1", { handle: { ...state().configuration.attachments[0].configuration.handle, type: "knob" } });
    // Door x 1–799, y 1–1799; knob 40 mm from the free (right) edge, centred: (759, 900).
    expect(hardware()[0]).toMatchObject({
      id: "handle/door/a1",
      frontId: "door/a1",
      type: "knob",
      box: { position: { x: 759 - 16, y: 900 - 16, z: 518 }, dimensions: { width: 32, height: 32, depth: 28 } },
    });
    state().updateDoor("a1", { hinge: "right" });
    expect(hardware()[0].box.position.x).toBe(41 - 16);
  });

  it("puts the handles of double doors on the meeting edges", () => {
    state().addDoor("root", "double");
    const config = state().configuration.attachments[0].configuration;
    state().updateDoor("a1", { handle: { ...config.handle, type: "bar", align: "top", alignOffset: 200 } });
    const [left, right] = hardware();
    // Leaves (798 − 3) / 2 = 397.5 wide: left 1–398.5, right 401.5–799.
    expect(left.box.position.x + left.box.dimensions.width / 2).toBeCloseTo(398.5 - 40, 9);
    expect(right.box.position.x + right.box.dimensions.width / 2).toBeCloseTo(401.5 + 40, 9);
    expect(left.orientation).toBe("vertical");
    expect(left.box.position.y + left.box.dimensions.height / 2).toBe(1799 - 200);
  });

  it("centres drawer handles horizontally", () => {
    state().addDrawers("root");
    state().updateDrawers("a1", { handle: { ...state().configuration.attachments[0].configuration.handle, type: "bar" } });
    const handles = hardware();
    expect(handles.map((h) => h.id)).toEqual(["handle/drawer/a1/1/front", "handle/drawer/a1/2/front", "handle/drawer/a1/3/front"]);
    for (const h of handles) {
      expect(h.orientation).toBe("horizontal");
      expect(h.box.position.x + h.box.dimensions.width / 2).toBe(400);
    }
  });

  it("moves with its front and follows resizing", () => {
    state().addDoor("root", "single");
    state().updateDoor("a1", { handle: { ...state().configuration.attachments[0].configuration.handle, type: "recessed" } });
    const doorMotion = part("door/a1").motion;
    expect(hardware()[0].motion).toEqual(doorMotion);
    state().setNumericField("width", 1000);
    expect(hardware()[0].box.position.x + hardware()[0].box.dimensions.width / 2).toBe(999 - 40);
  });

  it("validates hardware finish, type, offsets and fit", () => {
    state().addDrawers("root");
    const handle = state().configuration.attachments[0].configuration.handle;
    expect(state().updateDrawers("a1", { handle: { ...handle, type: "knob", finish: "gold" as never } })).toMatchObject({
      ok: false,
      errors: [{ code: "invalid_handle" }],
    });
    expect(state().updateDrawers("a1", { handle: { ...handle, type: "lever" as never } })).toMatchObject({ ok: false });
    expect(state().updateDrawers("a1", { handle: { ...handle, type: "bar", alignOffset: 5 } })).toMatchObject({ ok: false });
    // 600 mm from the top of a 597 mm drawer front is off the front.
    expect(state().updateDrawers("a1", { handle: { ...handle, type: "bar", align: "top", alignOffset: 600 } })).toMatchObject({
      ok: false,
      errors: [{ code: "handle_out_of_bounds" }],
    });
    for (const finish of ["chrome", "brushed-steel", "black-matte", "brass", "white"] as const) {
      expect(state().updateDrawers("a1", { handle: { ...handle, type: "knob", finish } }).ok).toBe(true);
    }
  });
});
