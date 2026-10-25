/**
 * Animation progress (0 = closed, 1 = at its limit) of every moving group, written each frame by
 * MovingAssembly. Plain numbers in a module-level map: never persisted, never in Zustand, and no
 * Three.js objects. It lets a door wait for the interior drawers behind it and vice versa.
 */
const progressByAttachment = new Map<string, Map<string, number>>();

export function reportProgress(attachmentId: string, groupId: string, progress: number): void {
  let groups = progressByAttachment.get(attachmentId);
  if (!groups) {
    groups = new Map();
    progressByAttachment.set(attachmentId, groups);
  }
  groups.set(groupId, progress);
}

export function forgetProgress(attachmentId: string, groupId: string): void {
  const groups = progressByAttachment.get(attachmentId);
  groups?.delete(groupId);
  if (groups?.size === 0) progressByAttachment.delete(attachmentId);
}

/** Least-open group of an attachment (a door is fully open only when every leaf is). */
export function minProgress(attachmentId: string): number {
  const groups = progressByAttachment.get(attachmentId);
  return groups && groups.size > 0 ? Math.min(...groups.values()) : 0;
}

export interface PreviewTargetInput {
  /** The preview store asks this group to be open. */
  readonly requested: boolean;
  /** Interior drawers: whether the covering door is requested open (true when there is none). */
  readonly coveringDoorRequested: boolean;
  /** Interior drawers: progress of the covering door's least-open leaf (1 when there is none). */
  readonly coveringDoorProgress: number;
  /** Doors: progress of the most-open interior drawer behind the door (0 when there are none). */
  readonly dependentsProgress: number;
  readonly currentProgress: number;
}

/**
 * Where a moving group should head this frame, and whether it must keep requesting frames while it
 * waits for another group. Interaction model:
 * - an interior drawer moves out only once its covering door is fully open; if the door is not even
 *   requested open, the drawer stays (or goes) in;
 * - a door asked to close stays open until every interior drawer behind it is fully retracted.
 */
export function resolvePreviewTarget(input: PreviewTargetInput): { readonly target: 0 | 1; readonly waiting: boolean } {
  let target: 0 | 1 = input.requested ? 1 : 0;
  let waiting = false;
  if (target === 1) {
    if (!input.coveringDoorRequested) target = 0;
    else if (input.coveringDoorProgress < 1) {
      target = 0;
      waiting = true;
    }
  }
  if (target === 0 && input.dependentsProgress > 0) {
    target = 1;
    waiting = input.currentProgress >= 1;
  }
  return { target, waiting };
}

/** Most-open group of an attachment (drawers are retracted only when every drawer is). */
export function maxProgress(attachmentId: string): number {
  const groups = progressByAttachment.get(attachmentId);
  return groups && groups.size > 0 ? Math.max(...groups.values()) : 0;
}
