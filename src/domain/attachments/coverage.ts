import { getCompartmentPath } from "../compartments/tree";
import type { CompartmentId } from "../compartments/types";
import type { CabinetConfiguration } from "../furniture/types";
import type { DoorAttachment } from "./types";

/**
 * The door covering a compartment: a door on the compartment itself or on the nearest enclosing
 * compartment. Interior drawers require one; it also decides their recess.
 */
export function findCoveringDoor(configuration: CabinetConfiguration, compartmentId: CompartmentId): DoorAttachment | null {
  const path = getCompartmentPath(configuration.compartments, compartmentId) ?? [];
  for (let i = path.length - 1; i >= 0; i--) {
    const door = configuration.attachments.find(
      (a): a is DoorAttachment => a.type === "door" && a.compartmentId === path[i].id,
    );
    if (door) return door;
  }
  return null;
}
