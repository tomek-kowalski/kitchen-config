import { computeMotionLimits, type MotionLimit } from "../attachments/collisions";
import type { CabinetConfiguration } from "../furniture/types";
import { buildHardware, type HardwarePart } from "../hardware/geometry";
import { buildCabinet } from "./buildCabinet";
import type { PanelPart } from "./types";

/** Everything derived from a configuration for display: board parts, handles and safe motion limits. */
export interface FurnitureModel {
  readonly panels: readonly PanelPart[];
  readonly hardware: readonly HardwarePart[];
  /** Keyed by motion group ID. */
  readonly motion: ReadonlyMap<string, MotionLimit>;
}

// Configurations are immutable, so the derived model can be cached per configuration object;
// the renderer and the sidebar then share one (collision analysis is the costly part).
const cache = new WeakMap<CabinetConfiguration, FurnitureModel>();

export function buildFurniture(configuration: CabinetConfiguration): FurnitureModel {
  const cached = cache.get(configuration);
  if (cached) return cached;
  const panels = buildCabinet(configuration);
  const hardware = buildHardware(configuration, panels);
  const model = { panels, hardware, motion: computeMotionLimits(configuration, panels, hardware) };
  cache.set(configuration, model);
  return model;
}
