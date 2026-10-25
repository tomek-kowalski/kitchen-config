/**
 * Central material catalog. Configurations reference finishes by ID only;
 * colors are resolved here. Colors are visual approximations, not certified manufacturer values.
 */
export interface MaterialDefinition {
  readonly id: string;
  readonly name: string;
  /** sRGB hex color of the solid finish. */
  readonly color: `#${string}`;
  /** MeshStandardMaterial roughness, 0 (glossy) – 1 (fully matte). */
  readonly roughness: number;
}

export const MATERIAL_CATALOG = [
  { id: "white-matte", name: "Biały mat", color: "#F2F0EA", roughness: 0.85 },
  { id: "black-matte", name: "Czarny mat", color: "#292929", roughness: 0.8 },
  { id: "anthracite", name: "Antracyt", color: "#484B50", roughness: 0.75 },
  { id: "natural-oak", name: "Dąb naturalny", color: "#C9A273", roughness: 0.7 },
  { id: "sonoma-oak", name: "Dąb sonoma", color: "#B89469", roughness: 0.7 },
  { id: "walnut", name: "Orzech", color: "#67452F", roughness: 0.65 },
  { id: "light-grey", name: "Jasnoszary", color: "#C5C5C3", roughness: 0.8 },
  { id: "cashmere", name: "Kaszmir", color: "#C8BBA8", roughness: 0.8 },
] as const satisfies readonly MaterialDefinition[];

export type MaterialId = (typeof MATERIAL_CATALOG)[number]["id"];

export type Material = MaterialDefinition & { readonly id: MaterialId };

export const MATERIAL_IDS: readonly MaterialId[] = MATERIAL_CATALOG.map((m) => m.id);

const MATERIALS_BY_ID: ReadonlyMap<string, Material> = new Map(MATERIAL_CATALOG.map((m) => [m.id, m]));

export function isMaterialId(value: unknown): value is MaterialId {
  return typeof value === "string" && MATERIALS_BY_ID.has(value);
}

export function getMaterial(id: MaterialId): Material {
  const material = MATERIALS_BY_ID.get(id);
  if (!material) throw new Error(`Nieznany materiał „${id}”`);
  return material;
}

/** Groups of parts that share one finish selection. */
export const MATERIAL_SLOTS = ["body", "interior", "backPanel", "plinth", "doorFront", "drawerFront"] as const;

export type MaterialSlot = (typeof MATERIAL_SLOTS)[number];

/**
 * Finish selection per slot: body = sides/top/bottom, interior = shelves, dividers and drawer boxes,
 * doorFront / drawerFront = the visible fronts.
 */
export type FurnitureMaterials = Readonly<Record<MaterialSlot, MaterialId>>;
