import { Color } from "three";
import { getMaterial, type MaterialId } from "@/domain/furniture/materials";

export interface MaterialAppearance {
  readonly color: string;
  readonly roughness: number;
  /** Panel outline color: darker than light finishes, lighter than dark ones, so edges stay readable. */
  readonly edgeColor: string;
}

const cache = new Map<MaterialId, MaterialAppearance>();

/** Resolves a catalog material into the values a MeshStandardMaterial needs. */
export function getMaterialAppearance(id: MaterialId): MaterialAppearance {
  let appearance = cache.get(id);
  if (!appearance) {
    const { color, roughness } = getMaterial(id);
    const edge = new Color(color);
    const { l } = edge.getHSL({ h: 0, s: 0, l: 0 });
    edge.offsetHSL(0, 0, l < 0.35 ? 0.14 : -0.22);
    appearance = { color, roughness, edgeColor: `#${edge.getHexString()}` };
    cache.set(id, appearance);
  }
  return appearance;
}
