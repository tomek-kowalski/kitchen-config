import { calculateCompartmentBounds } from "../compartments/layout";
import { getCompartment, getCompartmentPath, removeSplit } from "../compartments/tree";
import { isBranch, type CompartmentId } from "../compartments/types";
import type { CabinetConfiguration } from "../furniture/types";
import { DEFAULT_HARDWARE_FINISH, HANDLE_RULES } from "../hardware/catalog";
import { findCoveringDoor } from "./coverage";
import { defaultDoorGap, getAvailableDrawerDepth, layoutDrawers } from "./layout";
import { DOOR_RULES, DRAWER_RULES } from "./rules";
import {
  isExteriorFront,
  type AttachmentId,
  type DoorAttachment,
  type DoorConfiguration,
  type DoorLayout,
  type DrawerAttachment,
  type DrawerConfiguration,
  type DrawerPlacement,
  type FurnitureAttachment,
  type HandleConfiguration,
} from "./types";

export type AttachmentOperationErrorCode =
  | "compartment_not_found"
  | "not_a_leaf"
  | "compartment_occupied"
  | "not_split"
  | "attachment_not_found"
  | "attachment_type_mismatch"
  | "no_covering_door";

export interface AttachmentOperationError {
  readonly code: AttachmentOperationErrorCode;
  readonly message: string;
  readonly compartmentId?: CompartmentId;
  readonly attachmentId?: AttachmentId;
}

/** Operations only shape the data; the result is validated as a whole before it is committed. */
export type AttachmentOperationResult =
  | { readonly ok: true; readonly configuration: CabinetConfiguration }
  | { readonly ok: false; readonly error: AttachmentOperationError };

/** Handle defaults: no handle (also what migrated configurations get). */
export const DEFAULT_HANDLE: HandleConfiguration = Object.freeze({
  type: "none",
  finish: DEFAULT_HARDWARE_FINISH,
  align: "center",
  edgeOffset: HANDLE_RULES.edgeOffset.default,
  alignOffset: HANDLE_RULES.alignOffset.default,
});

function failure(error: AttachmentOperationError): AttachmentOperationResult {
  return { ok: false, error };
}

export function getAttachment(configuration: CabinetConfiguration, id: AttachmentId): FurnitureAttachment | null {
  return configuration.attachments.find((a) => a.id === id) ?? null;
}

/** The exterior front (door or exterior drawers) mounted on exactly this compartment. */
export function getAttachmentForCompartment(
  configuration: CabinetConfiguration,
  compartmentId: CompartmentId,
): FurnitureAttachment | null {
  return configuration.attachments.find((a) => a.compartmentId === compartmentId && isExteriorFront(a)) ?? null;
}

/** Interior drawers mounted in exactly this compartment. */
export function getInteriorDrawers(configuration: CabinetConfiguration, compartmentId: CompartmentId): DrawerAttachment | null {
  return (
    configuration.attachments.find(
      (a): a is DrawerAttachment =>
        a.compartmentId === compartmentId && a.type === "drawer" && a.configuration.placement === "interior",
    ) ?? null
  );
}

/** Deterministic IDs (`a1`, `a2`, …) numbered after the highest existing one; never reused within a configuration. */
function createAttachmentId(configuration: CabinetConfiguration): AttachmentId {
  const ids = new Set(configuration.attachments.map((a) => a.id));
  let next = 1 + Math.max(0, ...[...ids].map((id) => Number(/^a(\d+)$/.exec(id)?.[1] ?? 0)));
  while (ids.has(`a${next}`)) next++;
  return `a${next}`;
}

/**
 * The exterior front covering this compartment from an enclosing (ancestor) compartment, if any.
 * Such a front also hides everything inside the compartment.
 */
export function getCoveringAttachment(
  configuration: CabinetConfiguration,
  compartmentId: CompartmentId,
): FurnitureAttachment | null {
  const ancestors = (getCompartmentPath(configuration.compartments, compartmentId) ?? []).slice(0, -1);
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const attachment = getAttachmentForCompartment(configuration, ancestors[i].id);
    if (attachment) return attachment;
  }
  return null;
}

/** Exterior fronts inside the compartment (in strict descendants), which a front on the compartment would overlap. */
function getNestedExteriorFront(configuration: CabinetConfiguration, compartmentId: CompartmentId): FurnitureAttachment | null {
  return (
    configuration.attachments.find((a) => {
      if (!isExteriorFront(a)) return false;
      const path = getCompartmentPath(configuration.compartments, a.compartmentId) ?? [];
      return path.slice(0, -1).some((node) => node.id === compartmentId);
    }) ?? null
  );
}

type MountKind = "door" | DrawerPlacement;

/**
 * Checks that a module can be mounted on the compartment; returns the error or null.
 * - Exterior fronts (doors, exterior drawers) may not overlap: none on the compartment itself,
 *   an ancestor or a descendant. Doors may cover a subdivided compartment.
 * - Drawers of either placement need an undivided compartment, one drawer assembly per compartment.
 * - Interior drawers need a door on the compartment or an ancestor.
 */
function checkMountable(
  configuration: CabinetConfiguration,
  compartmentId: CompartmentId,
  kind: MountKind,
): AttachmentOperationError | null {
  const node = getCompartment(configuration.compartments, compartmentId);
  if (!node) {
    return { code: "compartment_not_found", compartmentId, message: `Przedział „${compartmentId}” nie istnieje.` };
  }
  if (kind !== "door" && isBranch(node)) {
    return {
      code: "not_a_leaf",
      compartmentId,
      message: `Przedział „${compartmentId}” jest podzielony; szuflady można dodać tylko do przedziału bez półek i przegród.`,
    };
  }
  if (kind !== "door") {
    const other = configuration.attachments.find((a) => a.compartmentId === compartmentId && a.type === "drawer");
    if (other) {
      return { code: "compartment_occupied", compartmentId, message: `Przedział „${compartmentId}” ma już szuflady „${other.id}”.` };
    }
  }
  if (kind === "interior") {
    if (!findCoveringDoor(configuration, compartmentId)) {
      return {
        code: "no_covering_door",
        compartmentId,
        message: `Szuflady wewnętrzne wymagają drzwi zakrywających przedział „${compartmentId}” lub przedział nadrzędny.`,
      };
    }
    return null;
  }
  if (getAttachmentForCompartment(configuration, compartmentId)) {
    return { code: "compartment_occupied", compartmentId, message: `Przedział „${compartmentId}” ma już drzwi lub szuflady.` };
  }
  const covering = getCoveringAttachment(configuration, compartmentId);
  if (covering) {
    return {
      code: "compartment_occupied",
      compartmentId,
      message: `Przedział „${compartmentId}” jest już zakryty frontem „${covering.id}” przedziału „${covering.compartmentId}”.`,
    };
  }
  const nested = getNestedExteriorFront(configuration, compartmentId);
  if (nested) {
    return {
      code: "compartment_occupied",
      compartmentId,
      message: `W przedziale „${nested.compartmentId}” wewnątrz jest już front „${nested.id}”; fronty nie mogą na siebie nachodzić.`,
    };
  }
  return null;
}

export function addDoor(
  configuration: CabinetConfiguration,
  compartmentId: CompartmentId,
  layout: DoorLayout,
): AttachmentOperationResult {
  const error = checkMountable(configuration, compartmentId, "door");
  if (error) return failure(error);
  const door: DoorAttachment = {
    id: createAttachmentId(configuration),
    type: "door",
    compartmentId,
    configuration: {
      layout,
      mounting: "overlay",
      hinge: "left",
      gap: defaultDoorGap("overlay"),
      centerGap: DOOR_RULES.doubleDoorGap,
      maxOpenAngle: DOOR_RULES.maxOpenAngleDeg,
      handle: DEFAULT_HANDLE,
    },
  };
  return { ok: true, configuration: { ...configuration, attachments: [...configuration.attachments, door] } };
}

/** Deepest box in 50 mm steps that fits the compartment for the given placement. */
function defaultDrawerDepth(
  configuration: CabinetConfiguration,
  compartmentId: CompartmentId,
  drawer: Pick<DrawerConfiguration, "mounting" | "placement">,
): number {
  const opening = calculateCompartmentBounds(configuration).find((l) => l.id === compartmentId)?.bounds;
  if (!opening) return DRAWER_RULES.minDepth;
  const available = getAvailableDrawerDepth(configuration, opening, drawer, {
    coveringDoor: findCoveringDoor(configuration, compartmentId),
  });
  return Math.max(DRAWER_RULES.minDepth, Math.floor(available / 50) * 50);
}

/**
 * Adds a drawer stack with defaults derived from the compartment: about one drawer per 200 mm,
 * equal heights, deepest box in 50 mm steps. Interior drawers always get inset fronts.
 */
export function addDrawers(
  configuration: CabinetConfiguration,
  compartmentId: CompartmentId,
  placement: DrawerPlacement = "exterior",
): AttachmentOperationResult {
  const error = checkMountable(configuration, compartmentId, placement);
  if (error) return failure(error);
  const opening = calculateCompartmentBounds(configuration).find((l) => l.id === compartmentId)?.bounds;
  if (!opening) return failure({ code: "compartment_not_found", compartmentId, message: `Przedział „${compartmentId}” nie istnieje.` });

  const mounting = placement === "interior" ? "inset" : "overlay";
  const drawer: DrawerAttachment = {
    id: createAttachmentId(configuration),
    type: "drawer",
    compartmentId,
    configuration: {
      count: Math.min(3, Math.max(DRAWER_RULES.minCount, Math.floor(opening.dimensions.height / 200))),
      placement,
      mounting,
      frontGap: DRAWER_RULES.defaultFrontGap,
      depth: defaultDrawerDepth(configuration, compartmentId, { mounting, placement }),
      heightRatios: null,
      handle: DEFAULT_HANDLE,
    },
  };
  return { ok: true, configuration: { ...configuration, attachments: [...configuration.attachments, drawer] } };
}

function updateAttachment<T extends FurnitureAttachment>(
  configuration: CabinetConfiguration,
  id: AttachmentId,
  type: T["type"],
  update: (attachment: T) => T,
): AttachmentOperationResult {
  const attachment = getAttachment(configuration, id);
  if (!attachment) return failure({ code: "attachment_not_found", attachmentId: id, message: `Element „${id}” nie istnieje.` });
  if (attachment.type !== type) {
    return failure({ code: "attachment_type_mismatch", attachmentId: id, message: `Element „${id}” ma inny typ.` });
  }
  const next = update(attachment as T);
  return {
    ok: true,
    configuration: { ...configuration, attachments: configuration.attachments.map((a) => (a.id === id ? next : a)) },
  };
}

export function updateDoor(
  configuration: CabinetConfiguration,
  id: AttachmentId,
  patch: Partial<DoorConfiguration>,
): AttachmentOperationResult {
  return updateAttachment<DoorAttachment>(configuration, id, "door", (door) => ({
    ...door,
    configuration: { ...door.configuration, ...patch },
  }));
}

/**
 * Updates drawer settings. Deterministic side effects:
 * - changing the count resets custom heights to equal ones (unless new heights are given);
 * - switching to interior placement forces inset fronts; switching placement caps the depth at
 *   the default for the new placement (the depth shown in the panel changes accordingly).
 */
export function updateDrawers(
  configuration: CabinetConfiguration,
  id: AttachmentId,
  patch: Partial<DrawerConfiguration>,
): AttachmentOperationResult {
  return updateAttachment<DrawerAttachment>(configuration, id, "drawer", (drawer) => {
    const current = drawer.configuration;
    let next: DrawerConfiguration = { ...current, ...patch };
    if (patch.count !== undefined && patch.count !== current.count && patch.heightRatios === undefined) {
      next = { ...next, heightRatios: null };
    }
    if (patch.placement !== undefined && patch.placement !== current.placement) {
      const mounting = patch.placement === "interior" ? "inset" : (patch.mounting ?? current.mounting);
      const depth = Math.min(next.depth, defaultDrawerDepth(configuration, drawer.compartmentId, { mounting, placement: patch.placement }));
      next = { ...next, mounting, depth };
    }
    return { ...drawer, configuration: next };
  });
}

/**
 * Sets the height of one drawer front (index from the bottom, 0-based) to `height` mm. The
 * difference is absorbed by the top drawer — or, when the top drawer itself is edited, by the one
 * below it — so heights entered one after another (bottom up) stay exactly as typed. The result is
 * stored as weights equal to the heights rounded to 0.01 mm, so later cabinet resizing scales all
 * fronts proportionally. Out-of-range values produce weights that validation rejects.
 */
export function setDrawerFrontHeight(
  configuration: CabinetConfiguration,
  id: AttachmentId,
  index: number,
  height: number,
): AttachmentOperationResult {
  const drawer = getAttachment(configuration, id);
  if (!drawer || drawer.type !== "drawer") {
    return failure({ code: "attachment_not_found", attachmentId: id, message: `Szuflady „${id}” nie istnieją.` });
  }
  const opening = calculateCompartmentBounds(configuration).find((l) => l.id === drawer.compartmentId)?.bounds;
  if (!opening) return failure({ code: "compartment_not_found", attachmentId: id, message: `Przedział „${drawer.compartmentId}” nie istnieje.` });

  const fronts = layoutDrawers(configuration, opening, drawer, {
    coveringDoor: findCoveringDoor(configuration, drawer.compartmentId),
  }).map((d) => d.front.dimensions.height);
  if (fronts.length < 2) return updateDrawers(configuration, id, { heightRatios: null });
  const absorbing = index === fronts.length - 1 ? fronts.length - 2 : fronts.length - 1;
  const heights = fronts.map((h, i) => (i === index ? height : i === absorbing ? h + fronts[index] - height : h));
  const heightRatios = heights.map((h) => Math.round(h * 100) / 100);
  return updateDrawers(configuration, id, { heightRatios });
}

export function removeAttachment(configuration: CabinetConfiguration, id: AttachmentId): AttachmentOperationResult {
  if (!getAttachment(configuration, id)) {
    return failure({ code: "attachment_not_found", attachmentId: id, message: `Element „${id}” nie istnieje.` });
  }
  return { ok: true, configuration: { ...configuration, attachments: configuration.attachments.filter((a) => a.id !== id) } };
}

/** Attachments mounted in compartments that disappear when the subdivision of `compartmentId` is removed. */
export function getAttachmentsAffectedBySplitRemoval(
  configuration: CabinetConfiguration,
  compartmentId: CompartmentId,
): FurnitureAttachment[] {
  return configuration.attachments.filter((attachment) => {
    const path = getCompartmentPath(configuration.compartments, attachment.compartmentId);
    return path !== null && path.length > 1 && path.slice(0, -1).some((node) => node.id === compartmentId);
  });
}

/** Removes a subdivision and, in the same step, every attachment in the removed compartments. */
export function removeSplitWithAttachments(
  configuration: CabinetConfiguration,
  compartmentId: CompartmentId,
): AttachmentOperationResult {
  const result = removeSplit(configuration.compartments, compartmentId);
  if (!result.ok) {
    const code = result.error.code === "compartment_not_found" ? "compartment_not_found" : "not_split";
    return failure({ code, compartmentId, message: result.error.message });
  }
  const removed = new Set(getAttachmentsAffectedBySplitRemoval(configuration, compartmentId).map((a) => a.id));
  return {
    ok: true,
    configuration: {
      ...configuration,
      compartments: result.tree,
      attachments: configuration.attachments.filter((a) => !removed.has(a.id)),
    },
  };
}
