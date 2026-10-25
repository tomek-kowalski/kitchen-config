import type { CompartmentLayout } from "../compartments/types";
import type { CabinetValidationCode, CabinetValidationError } from "../constraints/validateCabinet";
import { formatMm } from "../furniture/format";
import type { CabinetConfiguration, DimensionRange } from "../furniture/types";
import { HANDLE_RULES, HANDLE_TYPES, isHardwareFinishId } from "../hardware/catalog";
import { getHandleBox, handleFitsFront, type FrontKind } from "../hardware/geometry";
import { getAvailableDrawerDepth, layoutDoor, layoutDrawers, type DrawerContext } from "./layout";
import { DOOR_RULES, DRAWER_RULES } from "./rules";
import type { DoorAttachment, DrawerAttachment, HandleConfiguration } from "./types";

const inRange = (value: unknown, { min, max }: DimensionRange): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;

type Push = (code: CabinetValidationCode, message: string) => void;

interface Candidate {
  readonly id: string;
  readonly type: "door" | "drawer";
  readonly compartmentId: string;
  readonly exterior: boolean;
  readonly raw: unknown;
}

/**
 * Validates doors and drawers against the compartment layout. Expects a structurally valid
 * compartment tree; guards the attachment data itself against malformed (imported) input.
 *
 * Placement-aware rules:
 * - Exterior fronts (doors, exterior drawers) may not overlap: every front covers its compartment's
 *   whole opening and openings tile the cabinet face, so two fronts overlap exactly when one
 *   compartment is the other or contains it.
 * - Drawers (any placement) need an undivided compartment; one drawer assembly per compartment.
 * - Interior drawers need a door on their compartment or an ancestor, and inset fronts. They sit
 *   inside their compartment by construction, behind the door and in front of the back panel.
 */
export function validateAttachments(
  configuration: CabinetConfiguration,
  layouts: readonly CompartmentLayout[],
): CabinetValidationError[] {
  const errors: CabinetValidationError[] = [];
  const attachments: unknown = configuration.attachments;
  if (!Array.isArray(attachments)) {
    return [{ field: "attachments", code: "invalid_attachment", message: "Lista drzwi i szuflad jest nieprawidłowa." }];
  }

  const byCompartment = new Map(layouts.map((layout) => [layout.id, layout]));
  const ancestorsOrSelf = (id: string): string[] => {
    const chain: string[] = [];
    for (let current: string | null = id; current !== null; current = byCompartment.get(current)?.parentId ?? null) {
      chain.push(current);
    }
    return chain;
  };

  // First pass: shape checks, so the doors are known before interior drawers are checked.
  const candidates: Candidate[] = [];
  for (const raw of attachments as unknown[]) {
    const { id, type, compartmentId, configuration: c } = (raw ?? {}) as {
      id?: unknown;
      type?: unknown;
      compartmentId?: unknown;
      configuration?: { placement?: unknown };
    };
    if (typeof id !== "string" || id === "" || (type !== "door" && type !== "drawer") || typeof compartmentId !== "string") {
      errors.push({ field: "attachments", code: "invalid_attachment", message: "Każde drzwi i szuflady muszą mieć identyfikator, typ i przedział." });
      continue;
    }
    if (type === "drawer" && c?.placement !== "exterior" && c?.placement !== "interior") {
      // Unknown placement: report it rather than guessing which overlap rules apply.
      errors.push({
        field: "attachments",
        code: "invalid_attachment",
        message: `Szuflady „${id}”: nieprawidłowy montaż lub umiejscowienie frontów.`,
        attachmentId: id,
        compartmentId,
      });
      continue;
    }
    candidates.push({ id, type, compartmentId, exterior: type === "door" || c?.placement === "exterior", raw });
  }
  const doorsByCompartment = new Map(
    candidates.filter((c) => c.type === "door").map((c) => [c.compartmentId, c.raw as DoorAttachment]),
  );

  const seenIds = new Set<string>();
  /** Compartment → exterior front covering its opening. */
  const fronts = new Map<string, string>();
  /** Compartment → drawer assembly filling its volume. */
  const drawerVolumes = new Map<string, string>();

  for (const { id, type, compartmentId, exterior, raw } of candidates) {
    const label = type === "door" ? `Drzwi „${id}”` : exterior ? `Szuflady „${id}”` : `Szuflady wewnętrzne „${id}”`;
    const push: Push = (code, message) =>
      errors.push({ field: "attachments", code, message: `${label}: ${message}`, attachmentId: id, compartmentId });

    if (seenIds.has(id)) push("duplicate_attachment_id", "identyfikator występuje więcej niż raz.");
    seenIds.add(id);

    const layout = byCompartment.get(compartmentId);
    if (!layout) {
      push("attachment_compartment_not_found", `przedział „${compartmentId}” nie istnieje.`);
      continue;
    }
    if (type === "drawer" && !layout.isLeaf) {
      push("attachment_not_on_leaf", `przedział „${compartmentId}” jest podzielony; szuflady wymagają przedziału bez półek i przegród.`);
      continue;
    }
    if (type === "drawer") {
      const other = drawerVolumes.get(compartmentId);
      if (other) {
        push("attachment_conflict", `przedział „${compartmentId}” ma już szuflady „${other}”.`);
        continue;
      }
      drawerVolumes.set(compartmentId, id);
    }

    let coveringDoor: DoorAttachment | null = null;
    if (exterior) {
      const mine = ancestorsOrSelf(compartmentId);
      const clash = [...fronts].find(([other]) => mine.includes(other) || ancestorsOrSelf(other).includes(compartmentId));
      if (clash) {
        const [otherCompartment, otherId] = clash;
        push(
          "attachment_conflict",
          otherCompartment === compartmentId
            ? `przedział „${compartmentId}” jest już zajęty przez „${otherId}”.`
            : `front nachodziłby na front „${otherId}” w przedziale „${otherCompartment}”, bo jeden z tych przedziałów zawiera drugi.`,
        );
        continue;
      }
      fronts.set(compartmentId, id);
    } else {
      coveringDoor = ancestorsOrSelf(compartmentId).map((c) => doorsByCompartment.get(c)).find(Boolean) ?? null;
      if (!coveringDoor) {
        push("interior_drawer_without_door", `szuflady wewnętrzne wymagają drzwi zakrywających przedział „${compartmentId}” lub przedział nadrzędny.`);
        continue;
      }
    }

    if (type === "door") validateDoor(configuration, layout, raw as DoorAttachment, push);
    else validateDrawers(configuration, layout, raw as DrawerAttachment, { coveringDoor }, push);
  }
  return errors;
}

function validateHandle(handle: unknown, push: Push): handle is HandleConfiguration {
  const h = (handle ?? {}) as Partial<HandleConfiguration>;
  if (
    !(HANDLE_TYPES as readonly unknown[]).includes(h.type) ||
    !isHardwareFinishId(h.finish) ||
    (h.align !== "top" && h.align !== "center" && h.align !== "bottom")
  ) {
    push("invalid_handle", "nieprawidłowy typ, wykończenie lub położenie uchwytu.");
    return false;
  }
  if (!inRange(h.edgeOffset, HANDLE_RULES.edgeOffset) || !inRange(h.alignOffset, HANDLE_RULES.alignOffset)) {
    push(
      "invalid_handle",
      `odsunięcie uchwytu musi mieścić się w zakresie ${HANDLE_RULES.edgeOffset.min}–${HANDLE_RULES.edgeOffset.max} mm od krawędzi i ${HANDLE_RULES.alignOffset.min}–${HANDLE_RULES.alignOffset.max} mm od góry lub dołu.`,
    );
    return false;
  }
  return true;
}

function checkHandleFits(front: DoorAttachment["configuration"]["handle"], frontBox: Parameters<typeof getHandleBox>[0], kind: FrontKind, push: Push, label: string) {
  const placed = getHandleBox(frontBox, front, kind);
  if (placed && !handleFitsFront(frontBox, placed.box)) {
    push("handle_out_of_bounds", `uchwyt nie mieści się na ${label}; zmień położenie lub odsunięcie.`);
    return false;
  }
  return true;
}

function validateDoor(configuration: CabinetConfiguration, layout: CompartmentLayout, door: DoorAttachment, push: Push) {
  const c = (door.configuration ?? {}) as Partial<DoorAttachment["configuration"]>;
  if (
    (c.layout !== "single" && c.layout !== "double") ||
    (c.mounting !== "overlay" && c.mounting !== "inset") ||
    (c.hinge !== "left" && c.hinge !== "right")
  ) {
    return push("invalid_attachment", "nieprawidłowy układ, montaż lub strona zawiasów.");
  }
  let valid = true;
  if (!inRange(c.gap, DOOR_RULES.gap)) {
    valid = false;
    push("attachment_gap_out_of_range", `szczelina musi mieścić się w zakresie ${DOOR_RULES.gap.min}–${DOOR_RULES.gap.max} mm.`);
  }
  if (!inRange(c.centerGap, DOOR_RULES.centerGap)) {
    valid = false;
    push(
      "attachment_gap_out_of_range",
      `szczelina środkowa musi mieścić się w zakresie ${DOOR_RULES.centerGap.min}–${DOOR_RULES.centerGap.max} mm.`,
    );
  }
  if (!inRange(c.maxOpenAngle, DOOR_RULES.openAngle)) {
    valid = false;
    push("invalid_attachment", `kąt otwarcia musi mieścić się w zakresie ${DOOR_RULES.openAngle.min}–${DOOR_RULES.openAngle.max}°.`);
  }
  if (!validateHandle(c.handle, push)) valid = false;
  if (!valid) return;

  const leaves = layoutDoor(configuration, layout.bounds, door);
  const { width, height } = leaves[0].box.dimensions;
  const leafWord = c.layout === "double" ? "skrzydło" : "drzwi";
  if (width < DOOR_RULES.minimumWidth) {
    push("door_too_narrow", `${leafWord} miałoby ${formatMm(width)} mm szerokości; minimum to ${DOOR_RULES.minimumWidth} mm.`);
  }
  if (height < DOOR_RULES.minimumHeight) {
    push("door_too_low", `${leafWord} miałoby ${formatMm(height)} mm wysokości; minimum to ${DOOR_RULES.minimumHeight} mm.`);
  }
  for (const leaf of leaves) {
    if (!checkHandleFits(door.configuration.handle, leaf.box, { kind: "door", hinge: leaf.hinge }, push, "drzwiach")) break;
  }
}

function validateDrawers(
  configuration: CabinetConfiguration,
  layout: CompartmentLayout,
  drawer: DrawerAttachment,
  context: DrawerContext,
  push: Push,
) {
  const c = (drawer.configuration ?? {}) as Partial<DrawerAttachment["configuration"]>;
  if ((c.mounting !== "overlay" && c.mounting !== "inset") || (c.placement !== "exterior" && c.placement !== "interior")) {
    return push("invalid_attachment", "nieprawidłowy montaż lub umiejscowienie frontów.");
  }
  if (c.placement === "interior" && c.mounting !== "inset") {
    return push("invalid_attachment", "szuflady wewnętrzne mają zawsze fronty wpuszczane.");
  }

  let valid = true;
  if (typeof c.count !== "number" || !Number.isInteger(c.count) || c.count < DRAWER_RULES.minCount || c.count > DRAWER_RULES.maxCount) {
    valid = false;
    push("invalid_drawer_count", `liczba szuflad musi być liczbą całkowitą od ${DRAWER_RULES.minCount} do ${DRAWER_RULES.maxCount}.`);
  }
  if (!inRange(c.frontGap, DRAWER_RULES.frontGap)) {
    valid = false;
    push(
      "attachment_gap_out_of_range",
      `szczelina frontów musi mieścić się w zakresie ${DRAWER_RULES.frontGap.min}–${DRAWER_RULES.frontGap.max} mm.`,
    );
  }
  const ratios: unknown = c.heightRatios;
  if (
    ratios !== null &&
    (!Array.isArray(ratios) ||
      ratios.length !== c.count ||
      !ratios.every((r) => typeof r === "number" && Number.isFinite(r) && r > 0))
  ) {
    valid = false;
    push("invalid_drawer_heights", "wysokości szuflad muszą być dodatnie, po jednej na każdą szufladę.");
  }
  const available = getAvailableDrawerDepth(configuration, layout.bounds, { mounting: c.mounting, placement: c.placement }, context);
  if (typeof c.depth !== "number" || !Number.isFinite(c.depth) || c.depth < DRAWER_RULES.minDepth || c.depth > available) {
    valid = false;
    push(
      "drawer_depth_out_of_range",
      available < DRAWER_RULES.minDepth
        ? `przedział jest za płytki na szuflady (dostępne ${formatMm(available)} mm, minimum ${DRAWER_RULES.minDepth} mm).`
        : `głębokość szuflady musi mieścić się w zakresie ${DRAWER_RULES.minDepth}–${formatMm(available)} mm.`,
    );
  }
  if (!validateHandle(c.handle, push)) valid = false;
  if (!valid) return;

  const drawers = layoutDrawers(configuration, layout.bounds, drawer, context);
  const lowFront = drawers.find((d) => d.front.dimensions.height < DRAWER_RULES.minFrontHeight);
  if (lowFront) {
    push(
      "drawer_front_too_low",
      `front ${lowFront.index} miałby ${formatMm(lowFront.front.dimensions.height)} mm wysokości; minimum to ${DRAWER_RULES.minFrontHeight} mm.`,
    );
  }
  const smallBox = drawers.find(
    (d) => d.box.dimensions.height < DRAWER_RULES.minBoxHeight || d.internalWidth < DRAWER_RULES.minInternalWidth,
  );
  if (smallBox) {
    push(
      "drawer_box_too_small",
      `skrzynka ${smallBox.index} miałaby ${formatMm(smallBox.internalWidth)} × ${formatMm(smallBox.box.dimensions.height)} mm (szerokość wewnętrzna × wysokość); minimum to ${DRAWER_RULES.minInternalWidth} × ${DRAWER_RULES.minBoxHeight} mm.`,
    );
  }
  for (const d of drawers) {
    if (!checkHandleFits(drawer.configuration.handle, d.front, { kind: "drawer" }, push, `froncie ${d.index}`)) break;
  }
}
