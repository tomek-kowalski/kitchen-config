import { getInteriorBounds } from "../compartments/layout";
import type { BoxMm } from "../compartments/types";
import type { CabinetConfiguration } from "../furniture/types";
import { DOOR_RULES, DRAWER_RULES } from "./rules";
import type { DoorAttachment, DrawerAttachment, FrontMounting, HingeSide } from "./types";

/**
 * Front conventions (mm, origin at the lower-left-back corner, the front faces +Z):
 * - The carcass front plane is z = depth. Fronts are as thick as the carcass panels (t).
 * - Overlay: the front lies in z ∈ [depth, depth + t]. Each edge of the opening is classified:
 *   • on an outer carcass panel (side, top, bottom) the front covers the whole panel (t), less gap / 2;
 *   • on a shared panel (shelf, divider) it covers half of it (t / 2), less gap / 2, so that two
 *     neighbouring fronts meet on the panel's centre line with exactly one gap between them.
 *   Front cells therefore tile the cabinet face and closed overlay fronts can never overlap.
 * - Inset: the front lies inside the opening, z ∈ [depth − t, depth], shrunk by `gap` per side.
 */
export interface FrontArea {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Back face of the front. */
  readonly zBack: number;
}

const EPSILON = 1e-6;

export function getFrontArea(
  configuration: CabinetConfiguration,
  opening: BoxMm,
  mounting: FrontMounting,
  gap: number,
): FrontArea {
  const t = configuration.panelThickness;
  const { position: p, dimensions: d } = opening;
  if (mounting === "inset") {
    return {
      x: p.x + gap,
      y: p.y + gap,
      width: d.width - 2 * gap,
      height: d.height - 2 * gap,
      zBack: configuration.depth - t,
    };
  }
  const interior = getInteriorBounds(configuration);
  const { position: ip, dimensions: id } = interior;
  const near = (a: number, b: number) => Math.abs(a - b) < EPSILON;
  const inflate = (onOuterPanel: boolean) => (onOuterPanel ? t : t / 2) - gap / 2;
  const left = inflate(near(p.x, ip.x));
  const right = inflate(near(p.x + d.width, ip.x + id.width));
  const bottom = inflate(near(p.y, ip.y));
  const top = inflate(near(p.y + d.height, ip.y + id.height));
  return {
    x: p.x - left,
    y: p.y - bottom,
    width: d.width + left + right,
    height: d.height + bottom + top,
    zBack: configuration.depth,
  };
}

export interface DoorLeafLayout {
  readonly side: HingeSide | null;
  readonly hinge: HingeSide;
  readonly box: BoxMm;
  /**
   * Vertical hinge axis (x, z) on the front face at the hinge edge. Rotating about it, the
   * hinge-side front corner stays put and the leaf never swings into the carcass or the
   * neighbour on its hinge side (a simplified "virtual pivot" of a cabinet hinge).
   */
  readonly pivot: { readonly x: number; readonly z: number };
  /** Sign of the rotation about +Y that swings the free edge outwards (+Z). */
  readonly direction: 1 | -1;
}

export function layoutDoor(configuration: CabinetConfiguration, opening: BoxMm, door: DoorAttachment): DoorLeafLayout[] {
  const { layout, mounting, hinge, gap, centerGap } = door.configuration;
  const t = configuration.panelThickness;
  const area = getFrontArea(configuration, opening, mounting, gap);
  const pivotZ = area.zBack + t;

  const leaf = (side: HingeSide | null, hingeSide: HingeSide, x: number, width: number): DoorLeafLayout => ({
    side,
    hinge: hingeSide,
    box: {
      position: { x, y: area.y, z: area.zBack },
      dimensions: { width, height: area.height, depth: t },
    },
    pivot: { x: hingeSide === "left" ? x : x + width, z: pivotZ },
    // Rotating about +Y moves a point at +x towards −z, so a left hinge needs a negative angle.
    direction: hingeSide === "left" ? -1 : 1,
  });

  if (layout === "single") return [leaf(null, hinge, area.x, area.width)];
  const leafWidth = (area.width - centerGap) / 2;
  return [leaf("left", "left", area.x, leafWidth), leaf("right", "right", area.x + leafWidth + centerGap, leafWidth)];
}

export interface DrawerLayout {
  /** 1-based, counted from the bottom. */
  readonly index: number;
  readonly front: BoxMm;
  readonly sideLeft: BoxMm;
  readonly sideRight: BoxMm;
  readonly back: BoxMm;
  readonly bottom: BoxMm;
  /** Outer box, for validation. */
  readonly box: BoxMm;
  /** Inner width between the sides. */
  readonly internalWidth: number;
  /** Travel along +Z in the preview. */
  readonly travel: number;
}

/** The door that closes an interior drawer's compartment, if known (it decides the recess). */
export interface DrawerContext {
  readonly coveringDoor: DoorAttachment | null;
}

/** Depth taken at the front of the opening by a covering inset door (0 for overlay doors). */
function doorRecess(configuration: CabinetConfiguration, context: DrawerContext): number {
  return context.coveringDoor?.configuration.mounting === "inset" ? configuration.panelThickness : 0;
}

/**
 * Front area of interior drawers: inside the opening, behind the covering door and the hinge
 * clearance, and narrowed on both sides by the gap plus one door thickness (+2 mm) so the drawers
 * pass a door leaf opened to 90°.
 */
function getInteriorFrontArea(
  configuration: CabinetConfiguration,
  opening: BoxMm,
  frontGap: number,
  context: DrawerContext,
): FrontArea & { readonly sideInset: number } {
  const t = configuration.panelThickness;
  const { position: p, dimensions: d } = opening;
  const sideInset = frontGap + t + DRAWER_RULES.interiorDoorClearance;
  const frontFace = configuration.depth - doorRecess(configuration, context) - DRAWER_RULES.interiorFrontClearance;
  return {
    x: p.x + sideInset,
    y: p.y + frontGap,
    width: d.width - 2 * sideInset,
    height: d.height - 2 * frontGap,
    zBack: frontFace - t,
    sideInset,
  };
}

/** Depth available for a drawer box: the opening minus whatever sits in front of the box, minus the rear clearance. */
export function getAvailableDrawerDepth(
  configuration: CabinetConfiguration,
  opening: BoxMm,
  drawer: Pick<DrawerAttachment["configuration"], "mounting" | "placement">,
  context: DrawerContext = { coveringDoor: null },
): number {
  const t = configuration.panelThickness;
  const inFront =
    drawer.placement === "interior"
      ? doorRecess(configuration, context) + DRAWER_RULES.interiorFrontClearance + t
      : drawer.mounting === "inset"
        ? t
        : 0;
  return opening.dimensions.depth - inFront - DRAWER_RULES.rearClearance;
}

/**
 * Splits `total` into parts proportional to `weights`; the last part takes the remainder so the
 * parts always add up to `total` exactly. `null` weights mean equal parts.
 */
export function splitByWeights(total: number, count: number, weights: readonly number[] | null): number[] {
  const w = weights ?? Array.from({ length: count }, () => 1);
  const sum = w.reduce((a, b) => a + b, 0);
  const parts: number[] = [];
  let used = 0;
  for (let i = 0; i < count; i++) {
    const part = i === count - 1 ? total - used : (total * w[i]) / sum;
    parts.push(part);
    used += part;
  }
  return parts;
}

/**
 * Drawer conventions: fronts stack bottom-up inside the front area with `frontGap` between them;
 * their heights split the area (minus the gaps) by `heightRatios` (equal when null). Each box
 * occupies the same share of the opening height, minus vertical clearance above and below, and the
 * opening width minus side clearance (runners, or the door clearance of interior drawers). Box = two
 * full-depth sides, a back between the sides and a bottom between the sides in front of the back;
 * the box front plane is the back of the drawer front.
 */
export function layoutDrawers(
  configuration: CabinetConfiguration,
  opening: BoxMm,
  drawer: DrawerAttachment,
  context: DrawerContext = { coveringDoor: null },
): DrawerLayout[] {
  const { count, mounting, frontGap, depth, placement, heightRatios } = drawer.configuration;
  const t = configuration.panelThickness;
  const interior = placement === "interior" ? getInteriorFrontArea(configuration, opening, frontGap, context) : null;
  const area = interior ?? getFrontArea(configuration, opening, mounting, frontGap);
  const frontHeights = splitByWeights(area.height - (count - 1) * frontGap, count, heightRatios);
  const slotHeights = splitByWeights(opening.dimensions.height, count, heightRatios);
  const boxFrontZ = area.zBack;
  const boxBackZ = boxFrontZ - depth;
  const { boxPanelThickness: bt, bottomThickness, verticalClearance } = DRAWER_RULES;
  const sideClearance = Math.max(DRAWER_RULES.sideClearance, interior?.sideInset ?? 0);
  const boxX = opening.position.x + sideClearance;
  const boxWidth = opening.dimensions.width - 2 * sideClearance;
  const internalWidth = boxWidth - 2 * bt;

  let frontY = area.y;
  let slotY = opening.position.y;
  return Array.from({ length: count }, (_, i) => {
    const boxY = slotY + verticalClearance;
    const boxHeight = slotHeights[i] - 2 * verticalClearance;
    const layout: DrawerLayout = {
      index: i + 1,
      front: {
        position: { x: area.x, y: frontY, z: area.zBack },
        dimensions: { width: area.width, height: frontHeights[i], depth: t },
      },
      sideLeft: {
        position: { x: boxX, y: boxY, z: boxBackZ },
        dimensions: { width: bt, height: boxHeight, depth },
      },
      sideRight: {
        position: { x: boxX + boxWidth - bt, y: boxY, z: boxBackZ },
        dimensions: { width: bt, height: boxHeight, depth },
      },
      back: {
        position: { x: boxX + bt, y: boxY, z: boxBackZ },
        dimensions: { width: internalWidth, height: boxHeight, depth: bt },
      },
      bottom: {
        position: { x: boxX + bt, y: boxY, z: boxBackZ + bt },
        dimensions: { width: internalWidth, height: bottomThickness, depth: depth - bt },
      },
      box: {
        position: { x: boxX, y: boxY, z: boxBackZ },
        dimensions: { width: boxWidth, height: boxHeight, depth },
      },
      internalWidth,
      travel: Math.round(depth * DRAWER_RULES.extension),
    };
    frontY += frontHeights[i] + frontGap;
    slotY += slotHeights[i];
    return layout;
  });
}

/** Default door clearance for a mounting type. */
export function defaultDoorGap(mounting: FrontMounting): number {
  return mounting === "inset" ? DOOR_RULES.insetGap : DOOR_RULES.overlayGap;
}
