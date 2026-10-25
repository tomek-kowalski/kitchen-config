import { describe, expect, it } from "vitest";
import type { CompartmentNode } from "../compartments/types";
import { CABINET_LIMITS, CONSTRUCTION_LIMITS, DEFAULT_CABINET } from "../furniture/defaults";
import { MATERIAL_IDS } from "../furniture/materials";
import type { CabinetConfiguration, CabinetLimits } from "../furniture/types";
import { assertValidCabinet, InvalidCabinetConfigurationError, validateCabinet } from "./validateCabinet";

function validate(overrides: Partial<CabinetConfiguration>, limits?: CabinetLimits) {
  return validateCabinet({ ...DEFAULT_CABINET, ...overrides }, limits);
}

describe("validateCabinet", () => {
  it("accepts the default cabinet", () => {
    expect(validateCabinet(DEFAULT_CABINET)).toEqual({ isValid: true, errors: [] });
  });

  it("accepts values exactly on the limits", () => {
    for (const key of ["width", "height", "depth", "panelThickness"] as const) {
      expect(validate({ [key]: CABINET_LIMITS[key].min }).isValid).toBe(true);
      expect(validate({ [key]: CABINET_LIMITS[key].max }).isValid).toBe(true);
    }
  });

  it.each([
    ["width", -1, "not_positive"],
    ["height", 0, "not_positive"],
    ["depth", Number.NaN, "not_finite"],
    ["panelThickness", Number.NEGATIVE_INFINITY, "not_finite"],
    ["width", 299, "below_minimum"],
    ["height", 2801, "above_maximum"],
    ["depth", 199.5, "below_minimum"],
    ["panelThickness", 26, "above_maximum"],
  ] as const)("reports %s = %s as %s", (field, value, code) => {
    const result = validate({ [field]: value });
    expect(result.isValid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ field, code });
    expect(result.errors[0].message).toEqual(expect.any(String));
  });

  it("reports every invalid field at once", () => {
    const result = validate({ width: 0, height: Number.NaN, depth: 5000 });
    expect(result.errors.map((e) => [e.field, e.code])).toEqual([
      ["width", "not_positive"],
      ["height", "not_finite"],
      ["depth", "above_maximum"],
    ]);
  });

  it("includes the limit in the error message", () => {
    expect(validate({ width: 100 }).errors[0].message).toBe("Szerokość: minimum to 300 mm.");
    expect(validate({ panelThickness: 30 }).errors[0].message).toBe("Grubość płyty: maksimum to 25 mm.");
  });

  it("rejects panel thicknesses that leave no interior space", () => {
    const permissive: CabinetLimits = {
      width: { min: 1, max: 10_000 },
      height: { min: 1, max: 10_000 },
      depth: { min: 1, max: 10_000 },
      panelThickness: { min: 1, max: 10_000 },
    };
    expect(validate({ width: 40, panelThickness: 20 }, permissive).errors).toEqual([
      expect.objectContaining({ field: "panelThickness", code: "panels_exceed_width" }),
    ]);
    expect(validate({ height: 30, panelThickness: 20 }, permissive).errors).toEqual([
      expect.objectContaining({ field: "panelThickness", code: "panels_exceed_height" }),
    ]);
    expect(validate({ width: 41, height: 41, panelThickness: 20 }, permissive).isValid).toBe(true);
  });

  it("uses custom limits when provided", () => {
    const limits: CabinetLimits = { ...CABINET_LIMITS, width: { min: 1000, max: 1200 } };
    expect(validate({ width: 800 }, limits).errors[0]).toMatchObject({ field: "width", code: "below_minimum" });
    expect(validate({ width: 1100 }, limits).isValid).toBe(true);
  });

  it("rejects unknown material IDs per slot", () => {
    const config = {
      ...DEFAULT_CABINET,
      materials: { ...DEFAULT_CABINET.materials, interior: "plywood", plinth: "oak" },
    } as unknown as CabinetConfiguration;
    expect(validateCabinet(config).errors).toEqual([
      expect.objectContaining({ field: "materials.interior", code: "unknown_material" }),
      expect.objectContaining({ field: "materials.plinth", code: "unknown_material" }),
    ]);
  });

  it("rejects configurations without a materials object", () => {
    const withoutMaterials: Record<string, unknown> = { ...DEFAULT_CABINET };
    delete withoutMaterials.materials;
    const result = validateCabinet(withoutMaterials as unknown as CabinetConfiguration);
    expect(result.errors.map((e) => e.field)).toEqual([
      "materials.body",
      "materials.interior",
      "materials.backPanel",
      "materials.plinth",
      "materials.doorFront",
      "materials.drawerFront",
    ]);
  });

  it("accepts every catalog finish in every slot", () => {
    for (const id of MATERIAL_IDS) {
      const materials = { body: id, interior: id, backPanel: id, plinth: id, doorFront: id, drawerFront: id };
      expect(validateCabinet({ ...DEFAULT_CABINET, materials }).isValid).toBe(true);
    }
  });

  it("never mutates or clamps the input", () => {
    const config = { ...DEFAULT_CABINET, width: 99_999 };
    validateCabinet(config);
    expect(config.width).toBe(99_999);
  });
});

describe("assertValidCabinet", () => {
  it("throws a structured error for invalid configurations", () => {
    try {
      assertValidCabinet({ ...DEFAULT_CABINET, depth: -5 });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidCabinetConfigurationError);
      expect((error as InvalidCabinetConfigurationError).errors).toEqual([
        expect.objectContaining({ field: "depth", code: "not_positive" }),
      ]);
    }
  });

  it("does not throw for valid configurations", () => {
    expect(() => assertValidCabinet(DEFAULT_CABINET)).not.toThrow();
  });
});

describe("validateCabinet — optional components", () => {
  it("validates the back panel thickness only when the back panel is enabled", () => {
    expect(validate({ backPanel: { enabled: false, thickness: 999 } }).isValid).toBe(true);
    expect(validate({ backPanel: { enabled: true, thickness: 2 } }).errors).toEqual([
      expect.objectContaining({ field: "backPanel.thickness", code: "below_minimum" }),
    ]);
  });

  it("validates plinth height and setback when the plinth is enabled", () => {
    const result = validate({ plinth: { enabled: true, height: 300, setback: -1 } });
    expect(result.errors.map((e) => [e.field, e.code])).toEqual([
      ["plinth.height", "above_maximum"],
      ["plinth.setback", "not_positive"],
    ]);
    expect(validate({ plinth: { enabled: true, height: 80, setback: 0 } }).isValid).toBe(true);
  });

  it("rejects a plinth that leaves no room for the carcass", () => {
    const permissive = { ...CONSTRUCTION_LIMITS, plinthHeight: { min: 1, max: 10_000 } };
    const configuration = { ...DEFAULT_CABINET, height: 400, plinth: { enabled: true, height: 370, setback: 0 } };
    expect(validateCabinet(configuration, CABINET_LIMITS, permissive).errors).toEqual([
      expect.objectContaining({ field: "plinth.height", code: "plinth_exceeds_height" }),
    ]);
  });
});

describe("validateCabinet — compartments", () => {
  const split = (
    id: string,
    direction: "horizontal" | "vertical",
    children: [CompartmentNode, CompartmentNode],
    ratio = 0.5,
  ): CompartmentNode => ({ id, split: { direction, ratio }, children });

  it("accepts a valid nested tree", () => {
    const tree = split("root", "horizontal", [{ id: "a" }, split("b", "vertical", [{ id: "c" }, { id: "d" }])]);
    expect(validate({ compartments: tree }).isValid).toBe(true);
  });

  it("enforces the minimum compartment width and height", () => {
    const narrow = validate({ compartments: split("root", "vertical", [{ id: "a" }, { id: "b" }], 0.1) });
    expect(narrow.errors).toEqual([expect.objectContaining({ code: "compartment_too_narrow", compartmentId: "a" })]);
    const low = validate({ compartments: split("root", "horizontal", [{ id: "a" }, { id: "b" }], 0.95) });
    expect(low.errors).toEqual([expect.objectContaining({ code: "compartment_too_low", compartmentId: "b" })]);
  });

  it("does not apply the minimum size to the undivided interior", () => {
    const limits = { ...CABINET_LIMITS, width: { min: 100, max: 2400 } };
    expect(validateCabinet({ ...DEFAULT_CABINET, width: 150 }, limits).isValid).toBe(true);
  });

  it("rejects resizing that would shrink existing compartments below the minimum", () => {
    const tree = split("root", "vertical", [{ id: "a" }, { id: "b" }]);
    // 400 mm: (400 − 36 − 18) / 2 = 173 mm per side is fine; 300 mm leaves 123 mm.
    expect(validate({ compartments: tree, width: 400 }).isValid).toBe(true);
    expect(validate({ compartments: tree, width: 300 }).errors.map((e) => e.compartmentId)).toEqual(["a", "b"]);
  });

  it("rejects invalid split ratios", () => {
    for (const ratio of [0, 1, -0.5, 1.5, Number.NaN]) {
      const result = validate({ compartments: split("root", "vertical", [{ id: "a" }, { id: "b" }], ratio) });
      expect(result.errors).toContainEqual(expect.objectContaining({ code: "invalid_split_ratio", compartmentId: "root" }));
    }
  });

  it("rejects duplicate compartment IDs", () => {
    const result = validate({ compartments: split("root", "vertical", [{ id: "a" }, { id: "a" }]) });
    expect(result.errors).toEqual([expect.objectContaining({ code: "duplicate_compartment_id", compartmentId: "a" })]);
  });

  it("rejects malformed nodes", () => {
    const malformed = [
      { id: "" },
      { id: "root", children: [{ id: "a" }, { id: "b" }] },
      { id: "root", split: { direction: "diagonal", ratio: 0.5 }, children: [{ id: "a" }, { id: "b" }] },
      { id: "root", split: { direction: "vertical", ratio: 0.5 }, children: [{ id: "a" }] },
    ];
    for (const compartments of malformed) {
      expect(validate({ compartments: compartments as unknown as CompartmentNode }).errors).toContainEqual(
        expect.objectContaining({ code: "invalid_structure" }),
      );
    }
  });

  it("limits the nesting depth", () => {
    const limits = { ...CONSTRUCTION_LIMITS, minCompartmentWidth: 1, minCompartmentHeight: 1, maxSubdivisionDepth: 2 };
    const deep = split("root", "vertical", [
      split("a", "vertical", [split("b", "vertical", [{ id: "c" }, { id: "d" }]), { id: "e" }]),
      { id: "f" },
    ]);
    const configuration = { ...DEFAULT_CABINET, compartments: deep };
    expect(validateCabinet(configuration, CABINET_LIMITS, limits).errors).toEqual([
      expect.objectContaining({ code: "max_depth_exceeded" }),
    ]);
    expect(validateCabinet(configuration, CABINET_LIMITS, { ...limits, maxSubdivisionDepth: 3 }).isValid).toBe(true);
  });

  it("limits the number of leaf compartments", () => {
    const limits = { ...CONSTRUCTION_LIMITS, minCompartmentWidth: 1, minCompartmentHeight: 1, maxLeafCompartments: 3 };
    const four = split("root", "vertical", [
      split("a", "vertical", [{ id: "b" }, { id: "c" }]),
      split("d", "horizontal", [{ id: "e" }, { id: "f" }]),
    ]);
    expect(validateCabinet({ ...DEFAULT_CABINET, compartments: four }, CABINET_LIMITS, limits).errors).toEqual([
      expect.objectContaining({ code: "max_leaves_exceeded" }),
    ]);
  });

  it("uses the prototype limits by default", () => {
    expect(CONSTRUCTION_LIMITS).toMatchObject({
      minCompartmentWidth: 150,
      minCompartmentHeight: 150,
      maxSubdivisionDepth: 6,
      maxLeafCompartments: 32,
    });
  });
});
