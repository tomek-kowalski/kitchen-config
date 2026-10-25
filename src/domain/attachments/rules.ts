/**
 * Prototype rules for fronts and drawer boxes (Phase 3A/3B).
 * These are not manufacturer-certified values.
 */
export const DOOR_RULES = Object.freeze({
  /** Minimum width of a single door leaf (each leaf of a double door). */
  minimumWidth: 180,
  minimumHeight: 250,
  insetGap: 2,
  overlayGap: 2,
  doubleDoorGap: 3,
  gap: { min: 1, max: 6 },
  centerGap: { min: 2, max: 8 },
  /** Default requested opening angle; collisions may restrict it in the preview. */
  maxOpenAngleDeg: 100,
  openAngle: { min: 60, max: 120 },
});

export const DRAWER_RULES = Object.freeze({
  minCount: 1,
  maxCount: 6,
  defaultFrontGap: 3,
  frontGap: { min: 1, max: 6 },
  /** Space left on each side of the box for (unspecified) runners. */
  sideClearance: 13,
  boxPanelThickness: 12,
  bottomThickness: 8,
  /** Space above and below each box within its share of the opening. */
  verticalClearance: 10,
  /** Space kept free behind the box. */
  rearClearance: 10,
  minDepth: 150,
  minFrontHeight: 80,
  minBoxHeight: 50,
  minInternalWidth: 100,
  /** Share of the box depth a drawer travels when opened in the preview. */
  extension: 0.8,
  /**
   * Interior drawers: space between the back of the covering door (or the carcass front plane
   * behind an overlay door) and the interior drawer front — room for hinge cups and arms.
   */
  interiorFrontClearance: 20,
  /**
   * Interior drawers: extra side space beyond the front gap so that the drawer passes a door leaf
   * opened to 90° (the leaf then occupies one door thickness at the hinge side of the opening).
   */
  interiorDoorClearance: 2,
});
