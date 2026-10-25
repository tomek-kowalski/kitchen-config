import type { BoxMm } from "../compartments/types";
import type { CabinetConfiguration } from "../furniture/types";
import type { PanelPart, PartMotion } from "../geometry/types";
import type { HardwarePart } from "../hardware/geometry";
import { findCoveringDoor } from "./coverage";

/**
 * Opening limits of every moving front, from geometry (top view, X–Z plane), not from IDs.
 *
 * Model (conservative, no hardware simulation):
 * - Every moving unit is a set of boxes (front, handle; drawers also their box parts) moving rigidly:
 *   doors rotate about their vertical hinge axis, drawers translate along +Z.
 * - Two units can only touch if their height ranges overlap.
 * - Door vs door: for every pair, no pose of one (0…its limit) may intersect any pose of the other
 *   (0…its limit) — this covers one, the other or both open, in any order. On conflict both limits
 *   are lowered to the largest common angle that is collision free.
 * - Door vs exterior drawers: the door may not enter the drawer's whole extension path.
 * - Interior drawers: may only open when their covering door is open; their travel is limited so
 *   that they do not hit any door leaf standing at its (limited) open angle.
 * Angles are sampled finely enough (≤ 6 mm of edge travel per step) that no 12 mm+ part can be skipped.
 */
export interface MotionLimit {
  readonly groupId: string;
  readonly attachmentId: string;
  readonly kind: "hinge" | "slide";
  /** Requested opening: degrees (hinge) or millimetres (slide). */
  readonly requested: number;
  /** Collision-free opening, ≤ requested. */
  readonly allowed: number;
  /** Attachments that cause the restriction. */
  readonly blockedBy: readonly string[];
  /** Interior drawers: the door that must be open first. */
  readonly requiresOpen: string | null;
}

interface Point {
  readonly x: number;
  readonly z: number;
}

type Polygon = readonly Point[];

interface Pose {
  readonly value: number;
  readonly polygons: readonly Polygon[];
  readonly bounds: Bounds;
}

interface Bounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

interface Unit {
  readonly groupId: string;
  readonly attachmentId: string;
  readonly motion: PartMotion;
  readonly boxes: readonly BoxMm[];
  readonly minY: number;
  readonly maxY: number;
  readonly interior: boolean;
}

const EPSILON = 1e-6;
const MAX_EDGE_STEP_MM = 6;
const SLIDE_STEP_MM = 5;

function footprint({ position: p, dimensions: d }: BoxMm): Polygon {
  return [
    { x: p.x, z: p.z },
    { x: p.x + d.width, z: p.z },
    { x: p.x + d.width, z: p.z + d.depth },
    { x: p.x, z: p.z + d.depth },
  ];
}

function boundsOf(polygons: readonly Polygon[]): Bounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const polygon of polygons) {
    for (const { x, z } of polygon) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
  }
  return { minX, maxX, minZ, maxZ };
}

function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return a.minX < b.maxX - EPSILON && b.minX < a.maxX - EPSILON && a.minZ < b.maxZ - EPSILON && b.minZ < a.maxZ - EPSILON;
}

/** Separating-axis test for convex polygons; touching edges do not count as an intersection. */
function polygonsIntersect(a: Polygon, b: Polygon): boolean {
  for (const polygon of [a, b]) {
    for (let i = 0; i < polygon.length; i++) {
      const p = polygon[i];
      const q = polygon[(i + 1) % polygon.length];
      const axis = { x: q.z - p.z, z: p.x - q.x };
      const project = (poly: Polygon) => {
        let min = Infinity;
        let max = -Infinity;
        for (const v of poly) {
          const d = v.x * axis.x + v.z * axis.z;
          min = Math.min(min, d);
          max = Math.max(max, d);
        }
        return [min, max] as const;
      };
      const [aMin, aMax] = project(a);
      const [bMin, bMax] = project(b);
      const length = Math.hypot(axis.x, axis.z) || 1;
      if (aMax <= bMin + EPSILON * length || bMax <= aMin + EPSILON * length) return false;
    }
  }
  return true;
}

function posesIntersect(a: Pose, b: Pose): boolean {
  if (!boundsOverlap(a.bounds, b.bounds)) return false;
  return a.polygons.some((pa) => b.polygons.some((pb) => polygonsIntersect(pa, pb)));
}

function makePose(value: number, polygons: Polygon[]): Pose {
  return { value, polygons, bounds: boundsOf(polygons) };
}

/** Door poses from closed to the requested angle. */
function hingePoses(unit: Unit, motion: Extract<PartMotion, { kind: "hinge" }>): Pose[] {
  const base = unit.boxes.map(footprint);
  const radius = Math.max(
    1,
    ...base.flat().map(({ x, z }) => Math.hypot(x - motion.pivot.x, z - motion.pivot.z)),
  );
  const stepDeg = Math.min(1, ((MAX_EDGE_STEP_MM / radius) * 180) / Math.PI);
  const poses: Pose[] = [];
  for (let k = 0; ; k++) {
    const angle = Math.min(motion.maxAngleDeg, k * stepDeg);
    const theta = (motion.direction * angle * Math.PI) / 180;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const rotate = ({ x, z }: Point): Point => {
      const dx = x - motion.pivot.x;
      const dz = z - motion.pivot.z;
      return { x: motion.pivot.x + dx * cos + dz * sin, z: motion.pivot.z - dx * sin + dz * cos };
    };
    poses.push(makePose(angle, base.map((polygon) => polygon.map(rotate))));
    if (angle >= motion.maxAngleDeg) break;
  }
  return poses;
}

/** The region a sliding unit occupies while travelling `distance`: its footprint stretched along +Z. */
function slideSweep(unit: Unit, distance: number): Pose {
  const bounds = boundsOf(unit.boxes.map(footprint));
  const polygon: Polygon = [
    { x: bounds.minX, z: bounds.minZ },
    { x: bounds.maxX, z: bounds.minZ },
    { x: bounds.maxX, z: bounds.maxZ + distance },
    { x: bounds.minX, z: bounds.maxZ + distance },
  ];
  return makePose(distance, [polygon]);
}

const overlapsVertically = (a: Unit, b: Unit) => a.minY < b.maxY - EPSILON && b.minY < a.maxY - EPSILON;

export function computeMotionLimits(
  configuration: CabinetConfiguration,
  panels: readonly PanelPart[],
  hardware: readonly HardwarePart[],
): Map<string, MotionLimit> {
  const attachments = new Map(configuration.attachments.map((a) => [a.id, a]));
  const grouped = new Map<string, { motion: PartMotion; attachmentId: string; boxes: BoxMm[] }>();
  for (const part of [...panels, ...hardware]) {
    if (!part.motion || !part.attachmentId) continue;
    const box = "box" in part ? part.box : { position: part.position, dimensions: part.dimensions };
    const entry = grouped.get(part.motion.groupId) ?? { motion: part.motion, attachmentId: part.attachmentId, boxes: [] };
    entry.boxes.push(box);
    grouped.set(part.motion.groupId, entry);
  }
  const units: Unit[] = [...grouped].map(([groupId, { motion, attachmentId, boxes }]) => {
    const attachment = attachments.get(attachmentId);
    return {
      groupId,
      attachmentId,
      motion,
      boxes,
      minY: Math.min(...boxes.map((b) => b.position.y)),
      maxY: Math.max(...boxes.map((b) => b.position.y + b.dimensions.height)),
      interior: attachment?.type === "drawer" && attachment.configuration.placement === "interior",
    };
  });

  const doors = units.filter((u) => u.motion.kind === "hinge");
  const exteriorDrawers = units.filter((u) => u.motion.kind === "slide" && !u.interior);
  const interiorDrawers = units.filter((u) => u.motion.kind === "slide" && u.interior);

  const poses = new Map(doors.map((d) => [d.groupId, hingePoses(d, d.motion as Extract<PartMotion, { kind: "hinge" }>)]));
  const limit = new Map(doors.map((d) => [d.groupId, (d.motion as Extract<PartMotion, { kind: "hinge" }>).maxAngleDeg]));
  const blockedBy = new Map<string, Set<string>>(units.map((u) => [u.groupId, new Set<string>()]));
  const posesUpTo = (groupId: string, max: number) => (poses.get(groupId) ?? []).filter((p) => p.value <= max + EPSILON);

  // Doors vs the full extension path of exterior drawers.
  for (const door of doors) {
    for (const drawer of exteriorDrawers) {
      if (drawer.attachmentId === door.attachmentId || !overlapsVertically(door, drawer)) continue;
      const sweep = slideSweep(drawer, (drawer.motion as Extract<PartMotion, { kind: "slide" }>).distance);
      const doorPoses = posesUpTo(door.groupId, limit.get(door.groupId) ?? 0);
      const first = doorPoses.findIndex((pose, k) => k > 0 && posesIntersect(pose, sweep));
      if (first > 0) {
        limit.set(door.groupId, doorPoses[first - 1].value);
        blockedBy.get(door.groupId)?.add(drawer.attachmentId);
      }
    }
  }

  // Door pairs: any pose of one against any pose of the other.
  const conflict = (a: Unit, la: number, b: Unit, lb: number) => {
    const pb = posesUpTo(b.groupId, lb);
    return posesUpTo(a.groupId, la).some((poseA) => pb.some((poseB) => posesIntersect(poseA, poseB)));
  };
  for (let pass = 0, changed = true; changed && pass < 4; pass++) {
    changed = false;
    for (let i = 0; i < doors.length; i++) {
      for (let j = i + 1; j < doors.length; j++) {
        const a = doors[i];
        const b = doors[j];
        if (!overlapsVertically(a, b)) continue;
        const la = limit.get(a.groupId) ?? 0;
        const lb = limit.get(b.groupId) ?? 0;
        if (!conflict(a, la, b, lb)) continue;
        // Largest common cap that removes the conflict (binary search over sampled angles).
        const caps = [...new Set(posesUpTo(a.groupId, Math.min(la, lb)).map((p) => p.value))].sort((x, y) => x - y);
        let lo = 0;
        let hi = caps.length - 1;
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2);
          if (conflict(a, Math.min(la, caps[mid]), b, Math.min(lb, caps[mid]))) hi = mid - 1;
          else lo = mid;
        }
        const cap = caps[lo] ?? 0;
        limit.set(a.groupId, Math.min(la, cap));
        limit.set(b.groupId, Math.min(lb, cap));
        blockedBy.get(a.groupId)?.add(b.attachmentId);
        blockedBy.get(b.groupId)?.add(a.attachmentId);
        changed = true;
      }
    }
  }

  const result = new Map<string, MotionLimit>();
  for (const door of doors) {
    const requested = (door.motion as Extract<PartMotion, { kind: "hinge" }>).maxAngleDeg;
    result.set(door.groupId, {
      groupId: door.groupId,
      attachmentId: door.attachmentId,
      kind: "hinge",
      requested,
      allowed: limit.get(door.groupId) ?? requested,
      blockedBy: [...(blockedBy.get(door.groupId) ?? [])],
      requiresOpen: null,
    });
  }
  for (const drawer of exteriorDrawers) {
    const requested = (drawer.motion as Extract<PartMotion, { kind: "slide" }>).distance;
    result.set(drawer.groupId, {
      groupId: drawer.groupId,
      attachmentId: drawer.attachmentId,
      kind: "slide",
      requested,
      allowed: requested,
      blockedBy: [],
      requiresOpen: null,
    });
  }

  // Interior drawers vs every door leaf at its final (limited) open pose.
  for (const drawer of interiorDrawers) {
    const requested = (drawer.motion as Extract<PartMotion, { kind: "slide" }>).distance;
    const coveringDoor = findCoveringDoor(configuration, attachments.get(drawer.attachmentId)?.compartmentId ?? "");
    const openDoors = doors
      .filter((door) => overlapsVertically(door, drawer))
      .map((door) => ({ door, pose: posesUpTo(door.groupId, limit.get(door.groupId) ?? 0).at(-1) }));
    let allowed = requested;
    const blockers = new Set<string>();
    for (let s = SLIDE_STEP_MM; s <= requested + SLIDE_STEP_MM - EPSILON; s += SLIDE_STEP_MM) {
      const travel = Math.min(s, requested);
      const sweep = slideSweep(drawer, travel);
      const hit = openDoors.find(({ pose }) => pose && posesIntersect(pose, sweep));
      if (hit) {
        allowed = Math.max(0, travel - SLIDE_STEP_MM);
        blockers.add(hit.door.attachmentId);
        break;
      }
    }
    result.set(drawer.groupId, {
      groupId: drawer.groupId,
      attachmentId: drawer.attachmentId,
      kind: "slide",
      requested,
      allowed,
      blockedBy: [...blockers],
      requiresOpen: coveringDoor?.id ?? null,
    });
  }
  return result;
}
