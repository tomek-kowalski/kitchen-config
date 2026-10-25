import type { BoxMm } from "../compartments/types";
import type { CabinetConfiguration } from "../furniture/types";
import type { PanelPart, PanelType } from "../geometry/types";
import type { MaterialSlot } from "../furniture/materials";
import { layoutDoor, layoutDrawers } from "./layout";
import { findCoveringDoor } from "./coverage";
import { isExteriorFront, type AttachmentId, type FurnitureAttachment } from "./types";

/** A generated part before its finish is resolved by the geometry engine. */
export type AttachmentPartSpec = Omit<PanelPart, "materialId">;

export function doorPartId(attachmentId: AttachmentId, side: "left" | "right" | null): string {
  return side ? `door/${attachmentId}/${side}` : `door/${attachmentId}`;
}

export function drawerGroupId(attachmentId: AttachmentId, index: number): string {
  return `drawer/${attachmentId}/${index}`;
}

/**
 * Parts for every door and drawer, in attachment order. Each door leaf is its own hinge group;
 * each drawer (front + box) is one slide group.
 */
export function buildAttachmentParts(
  configuration: CabinetConfiguration,
  openings: ReadonlyMap<string, BoxMm>,
): AttachmentPartSpec[] {
  const parts: AttachmentPartSpec[] = [];

  for (const attachment of configuration.attachments) {
    const opening = openings.get(attachment.compartmentId);
    if (!opening) continue; // Unreachable for validated configurations.
    const base = (id: string, type: PanelType, slot: MaterialSlot, box: BoxMm) => ({
      id,
      type,
      materialSlot: slot,
      dimensions: box.dimensions,
      position: box.position,
      attachmentId: attachment.id,
      compartmentId: attachment.compartmentId,
    });
    parts.push(
      ...(attachment.type === "door"
        ? doorParts(configuration, opening, attachment, base)
        : drawerParts(configuration, opening, attachment, base)),
    );
  }
  return parts;
}

type BaseFactory = (id: string, type: PanelType, slot: MaterialSlot, box: BoxMm) => AttachmentPartSpec;

function doorParts(
  configuration: CabinetConfiguration,
  opening: BoxMm,
  door: Extract<FurnitureAttachment, { type: "door" }>,
  base: BaseFactory,
): AttachmentPartSpec[] {
  return layoutDoor(configuration, opening, door).map((leaf) => {
    const id = doorPartId(door.id, leaf.side);
    return {
      ...base(id, "door", "doorFront", leaf.box),
      motion: {
        kind: "hinge",
        groupId: id,
        pivot: { x: leaf.pivot.x, y: leaf.box.position.y, z: leaf.pivot.z },
        direction: leaf.direction,
        maxAngleDeg: door.configuration.maxOpenAngle,
      },
    };
  });
}

function drawerParts(
  configuration: CabinetConfiguration,
  opening: BoxMm,
  drawer: Extract<FurnitureAttachment, { type: "drawer" }>,
  base: BaseFactory,
): AttachmentPartSpec[] {
  const context = { coveringDoor: findCoveringDoor(configuration, drawer.compartmentId) };
  return layoutDrawers(configuration, opening, drawer, context).flatMap((layout) => {
    const groupId = drawerGroupId(drawer.id, layout.index);
    const motion = { kind: "slide", groupId, distance: layout.travel } as const;
    return [
      { ...base(`${groupId}/front`, "drawer-front", "drawerFront", layout.front), motion },
      { ...base(`${groupId}/side-left`, "drawer-side", "interior", layout.sideLeft), motion },
      { ...base(`${groupId}/side-right`, "drawer-side", "interior", layout.sideRight), motion },
      { ...base(`${groupId}/back`, "drawer-back", "interior", layout.back), motion },
      { ...base(`${groupId}/bottom`, "drawer-bottom", "interior", layout.bottom), motion },
    ];
  });
}

/** How far exterior overlay fronts stand out of the carcass front (0 when there are none). */
export function getFrontProjection(configuration: CabinetConfiguration): number {
  return configuration.attachments.some((a) => isExteriorFront(a) && a.configuration.mounting === "overlay")
    ? configuration.panelThickness
    : 0;
}
