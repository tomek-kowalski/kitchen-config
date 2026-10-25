import type { FurnitureAttachment, HandleConfiguration, HingeSide } from "../attachments/types";
import type { BoxMm } from "../compartments/types";
import type { CabinetConfiguration } from "../furniture/types";
import type { PanelPart, PartMotion } from "../geometry/types";
import { HANDLE_RULES, type HandleType, type HardwareFinishId } from "./catalog";

export type HandleOrientation = "vertical" | "horizontal";

/** A handle mounted on a front. Positioned in the same coordinate system as the panels. */
export interface HardwarePart {
  /** `handle/<front part id>`: stable as long as the front exists. */
  readonly id: string;
  readonly frontId: string;
  readonly attachmentId: string;
  readonly compartmentId: string;
  readonly type: Exclude<HandleType, "none">;
  readonly finish: HardwareFinishId;
  readonly orientation: HandleOrientation;
  /** Bounding box: on the front face, extending `projection` mm in +Z. */
  readonly box: BoxMm;
  /** Same motion as the front, so the handle rotates/slides with it. */
  readonly motion?: PartMotion;
}

export type FrontKind = { readonly kind: "door"; readonly hinge: HingeSide } | { readonly kind: "drawer" };

/**
 * Handle placement derived from the front:
 * - doors: on the free (non-hinged) edge, `edgeOffset` from it; vertical bars and grooves;
 * - drawers: centred horizontally; horizontal bars and grooves;
 * - vertically: centred, or `alignOffset` from the top/bottom edge.
 * The recessed handle is simplified to a thin dark plate on the face (no milled groove).
 */
export function getHandleBox(
  front: BoxMm,
  handle: HandleConfiguration,
  kind: FrontKind,
): { readonly box: BoxMm; readonly orientation: HandleOrientation } | null {
  if (handle.type === "none") return null;
  const { position: p, dimensions: d } = front;
  const orientation: HandleOrientation = kind.kind === "door" ? "vertical" : "horizontal";
  const cx =
    kind.kind === "drawer"
      ? p.x + d.width / 2
      : kind.hinge === "left"
        ? p.x + d.width - handle.edgeOffset
        : p.x + handle.edgeOffset;
  const cy =
    handle.align === "center"
      ? p.y + d.height / 2
      : handle.align === "top"
        ? p.y + d.height - handle.alignOffset
        : p.y + handle.alignOffset;

  let along: number;
  let across: number;
  let projection: number;
  if (handle.type === "knob") {
    along = across = HANDLE_RULES.knob.diameter;
    projection = HANDLE_RULES.knob.projection;
  } else if (handle.type === "bar") {
    along = HANDLE_RULES.bar.length;
    across = HANDLE_RULES.bar.diameter;
    projection = HANDLE_RULES.bar.projection;
  } else {
    along = HANDLE_RULES.recessed.length;
    across = HANDLE_RULES.recessed.width;
    projection = HANDLE_RULES.recessed.projection;
  }
  const width = orientation === "horizontal" ? along : across;
  const height = orientation === "horizontal" ? across : along;
  return {
    orientation,
    box: {
      position: { x: cx - width / 2, y: cy - height / 2, z: p.z + d.depth },
      dimensions: { width, height, depth: projection },
    },
  };
}

/** Whether the handle lies on its front with at least the margin to every edge. */
export function handleFitsFront(front: BoxMm, handle: BoxMm): boolean {
  const m = HANDLE_RULES.margin;
  const { position: f, dimensions: fd } = front;
  const { position: h, dimensions: hd } = handle;
  return (
    h.x >= f.x + m - 1e-9 &&
    h.x + hd.width <= f.x + fd.width - m + 1e-9 &&
    h.y >= f.y + m - 1e-9 &&
    h.y + hd.height <= f.y + fd.height - m + 1e-9
  );
}

/** Handles for every door leaf and drawer front, in front order. */
export function buildHardware(configuration: CabinetConfiguration, panels: readonly PanelPart[]): HardwarePart[] {
  const attachments = new Map<string, FurnitureAttachment>(configuration.attachments.map((a) => [a.id, a]));
  const hardware: HardwarePart[] = [];
  for (const panel of panels) {
    if ((panel.type !== "door" && panel.type !== "drawer-front") || !panel.attachmentId || !panel.compartmentId) continue;
    const attachment = attachments.get(panel.attachmentId);
    if (!attachment) continue;
    const kind: FrontKind =
      panel.type === "door"
        ? { kind: "door", hinge: panel.motion?.kind === "hinge" && panel.motion.direction === 1 ? "right" : "left" }
        : { kind: "drawer" };
    const handle = attachment.configuration.handle;
    const placed = getHandleBox({ position: panel.position, dimensions: panel.dimensions }, handle, kind);
    if (!placed || handle.type === "none") continue;
    hardware.push({
      id: `handle/${panel.id}`,
      frontId: panel.id,
      attachmentId: panel.attachmentId,
      compartmentId: panel.compartmentId,
      type: handle.type,
      finish: handle.finish,
      orientation: placed.orientation,
      box: placed.box,
      ...(panel.motion ? { motion: panel.motion } : {}),
    });
  }
  return hardware;
}
