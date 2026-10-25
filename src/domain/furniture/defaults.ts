import type { CompartmentNode } from "../compartments/types";
import type { FurnitureMaterials, MaterialId } from "./materials";
import type {
  BackPanelOptions,
  CabinetConfiguration,
  CabinetLimits,
  ConstructionLimits,
  PlinthOptions,
} from "./types";

/** The finish Phase 1 rendered everything in; also used to fill selections missing from older data. */
export const DEFAULT_MATERIAL_ID: MaterialId = "natural-oak";

export const DEFAULT_MATERIALS: FurnitureMaterials = Object.freeze({
  body: DEFAULT_MATERIAL_ID,
  interior: DEFAULT_MATERIAL_ID,
  backPanel: DEFAULT_MATERIAL_ID,
  plinth: DEFAULT_MATERIAL_ID,
  doorFront: DEFAULT_MATERIAL_ID,
  drawerFront: DEFAULT_MATERIAL_ID,
});

export const ROOT_COMPARTMENT_ID = "root";

export const DEFAULT_COMPARTMENTS: CompartmentNode = Object.freeze({ id: ROOT_COMPARTMENT_ID });

export const DEFAULT_BACK_PANEL: BackPanelOptions = Object.freeze({ enabled: false, thickness: 8 });

export const DEFAULT_PLINTH: PlinthOptions = Object.freeze({ enabled: false, height: 80, setback: 30 });

export const DEFAULT_CABINET: CabinetConfiguration = Object.freeze({
  width: 800,
  height: 1800,
  depth: 500,
  panelThickness: 18,
  materials: DEFAULT_MATERIALS,
  backPanel: DEFAULT_BACK_PANEL,
  plinth: DEFAULT_PLINTH,
  compartments: DEFAULT_COMPARTMENTS,
  attachments: Object.freeze([]),
});

/** Prototype limits for Phase 1 — not final manufacturing specifications. */
export const CABINET_LIMITS: CabinetLimits = Object.freeze({
  width: { min: 300, max: 2400 },
  height: { min: 400, max: 2800 },
  depth: { min: 200, max: 900 },
  panelThickness: { min: 16, max: 25 },
});

/** Prototype limits for Phase 2 — not final manufacturing specifications. */
export const CONSTRUCTION_LIMITS: ConstructionLimits = Object.freeze({
  minCompartmentWidth: 150,
  minCompartmentHeight: 150,
  maxSubdivisionDepth: 6,
  maxLeafCompartments: 32,
  backPanelThickness: { min: 3, max: 18 },
  plinthHeight: { min: 50, max: 250 },
  plinthSetback: { min: 0, max: 150 },
});
