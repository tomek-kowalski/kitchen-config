import { describe, expect, it } from "vitest";
import { DEFAULT_CABINET, DEFAULT_MATERIALS } from "./defaults";
import { getMaterial, isMaterialId, MATERIAL_CATALOG, MATERIAL_IDS, MATERIAL_SLOTS } from "./materials";

describe("material catalog", () => {
  it("contains the eight initial finishes", () => {
    expect(MATERIAL_IDS).toEqual([
      "white-matte",
      "black-matte",
      "anthracite",
      "natural-oak",
      "sonoma-oak",
      "walnut",
      "light-grey",
      "cashmere",
    ]);
  });

  it("resolves every material ID to a valid catalog entry", () => {
    for (const id of MATERIAL_IDS) {
      const material = getMaterial(id);
      expect(material.id).toBe(id);
      expect(material.name.trim()).not.toBe("");
      expect(material.color).toMatch(/^#[0-9A-F]{6}$/i);
      expect(material.roughness).toBeGreaterThanOrEqual(0);
      expect(material.roughness).toBeLessThanOrEqual(1);
    }
  });

  it("has unique IDs and names", () => {
    expect(new Set(MATERIAL_CATALOG.map((m) => m.id)).size).toBe(MATERIAL_CATALOG.length);
    expect(new Set(MATERIAL_CATALOG.map((m) => m.name)).size).toBe(MATERIAL_CATALOG.length);
  });

  it("uses the specified colors", () => {
    expect(getMaterial("white-matte").color).toBe("#F2F0EA");
    expect(getMaterial("natural-oak").color).toBe("#C9A273");
    expect(getMaterial("walnut").color).toBe("#67452F");
  });

  it("rejects unknown and non-string material IDs", () => {
    for (const value of ["oak", "Walnut", "", "toString", "__proto__", 42, null, undefined, {}]) {
      expect(isMaterialId(value)).toBe(false);
    }
  });

  it("assigns a catalog finish to every slot of the default configuration", () => {
    expect(Object.keys(DEFAULT_MATERIALS).sort()).toEqual([...MATERIAL_SLOTS].sort());
    for (const slot of MATERIAL_SLOTS) expect(isMaterialId(DEFAULT_CABINET.materials[slot])).toBe(true);
  });
});
