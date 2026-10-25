import type { Millimeters } from "@/domain/furniture/types";

/** Converts domain millimeters to Three.js scene units (meters). Use only at the rendering boundary. */
export function mmToM(value: Millimeters): number {
  return value / 1000;
}
