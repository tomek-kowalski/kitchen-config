import {
  isBranch,
  type CompartmentBranch,
  type CompartmentId,
  type CompartmentLeaf,
  type CompartmentNode,
  type SplitDirection,
} from "./types";

export type CompartmentOperationErrorCode = "compartment_not_found" | "not_a_leaf" | "not_split" | "invalid_ratio";

export interface CompartmentOperationError {
  readonly code: CompartmentOperationErrorCode;
  readonly compartmentId: CompartmentId;
  readonly message: string;
}

export type CompartmentOperationResult =
  | { readonly ok: true; readonly tree: CompartmentNode }
  | { readonly ok: false; readonly error: CompartmentOperationError };

const RATIO_MESSAGE = "Proporcja podziału musi mieścić się między 0 a 1.";

export function isValidSplitRatio(ratio: number): boolean {
  return Number.isFinite(ratio) && ratio > 0 && ratio < 1;
}

/** Nodes from the root down to the requested compartment, or `null` when it does not exist. */
export function getCompartmentPath(tree: CompartmentNode, id: CompartmentId): CompartmentNode[] | null {
  if (tree.id === id) return [tree];
  if (!isBranch(tree)) return null;
  for (const child of tree.children) {
    const path = getCompartmentPath(child, id);
    if (path) return [tree, ...path];
  }
  return null;
}

export function getCompartment(tree: CompartmentNode, id: CompartmentId): CompartmentNode | null {
  return getCompartmentPath(tree, id)?.at(-1) ?? null;
}

/** Leaves in reading order: bottom before top, left before right. */
export function getLeafCompartments(tree: CompartmentNode): CompartmentLeaf[] {
  return isBranch(tree) ? tree.children.flatMap(getLeafCompartments) : [tree];
}

export function collectCompartmentIds(tree: CompartmentNode): CompartmentId[] {
  return isBranch(tree) ? [tree.id, ...tree.children.flatMap(collectCompartmentIds)] : [tree.id];
}

/**
 * Deterministic, collision-free IDs (`c1`, `c2`, …) numbered after the highest existing one.
 * Called only when a subdivision is created, never while rendering.
 */
function createCompartmentIds(tree: CompartmentNode, count: number): CompartmentId[] {
  const existing = new Set(collectCompartmentIds(tree));
  let next = 1 + Math.max(0, ...[...existing].map((id) => Number(/^c(\d+)$/.exec(id)?.[1] ?? 0)));
  const ids: CompartmentId[] = [];
  while (ids.length < count) {
    const id = `c${next++}`;
    if (!existing.has(id)) ids.push(id);
  }
  return ids;
}

/** Path-copying replacement: untouched subtrees keep their identity. */
function replaceCompartment(
  node: CompartmentNode,
  id: CompartmentId,
  update: (target: CompartmentNode) => CompartmentNode,
): CompartmentNode {
  if (node.id === id) return update(node);
  if (!isBranch(node)) return node;
  const [first, second] = node.children;
  const nextFirst = replaceCompartment(first, id, update);
  const nextSecond = nextFirst === first ? replaceCompartment(second, id, update) : second;
  return nextFirst === first && nextSecond === second ? node : { ...node, children: [nextFirst, nextSecond] };
}

function failure(code: CompartmentOperationErrorCode, compartmentId: CompartmentId, message: string) {
  return { ok: false, error: { code, compartmentId, message } } as const;
}

function findOrFail(tree: CompartmentNode, id: CompartmentId) {
  const node = getCompartment(tree, id);
  return node ?? failure("compartment_not_found", id, `Przedział „${id}” nie istnieje.`);
}

/** Splits a leaf in two: a shelf for `horizontal`, a divider for `vertical`. */
export function splitCompartment(
  tree: CompartmentNode,
  id: CompartmentId,
  direction: SplitDirection,
  ratio = 0.5,
): CompartmentOperationResult {
  const node = findOrFail(tree, id);
  if ("ok" in node) return node;
  if (isBranch(node)) return failure("not_a_leaf", id, `Przedział „${id}” jest już podzielony.`);
  if (!isValidSplitRatio(ratio)) return failure("invalid_ratio", id, RATIO_MESSAGE);

  const [firstId, secondId] = createCompartmentIds(tree, 2);
  const branch: CompartmentBranch = {
    id,
    split: { direction, ratio },
    children: [{ id: firstId }, { id: secondId }],
  };
  return { ok: true, tree: replaceCompartment(tree, id, () => branch) };
}

/** Removes a subdivision together with all of its descendants; the compartment becomes a leaf again. */
export function removeSplit(tree: CompartmentNode, id: CompartmentId): CompartmentOperationResult {
  const node = findOrFail(tree, id);
  if ("ok" in node) return node;
  if (!isBranch(node)) return failure("not_split", id, `Przedział „${id}” nie ma podziału do usunięcia.`);
  return { ok: true, tree: replaceCompartment(tree, id, () => ({ id })) };
}

export function updateSplitRatio(tree: CompartmentNode, id: CompartmentId, ratio: number): CompartmentOperationResult {
  const node = findOrFail(tree, id);
  if ("ok" in node) return node;
  if (!isBranch(node)) return failure("not_split", id, `Przedział „${id}” nie ma podziału.`);
  if (!isValidSplitRatio(ratio)) return failure("invalid_ratio", id, RATIO_MESSAGE);
  if (node.split.ratio === ratio) return { ok: true, tree };
  return { ok: true, tree: replaceCompartment(tree, id, () => ({ ...node, split: { ...node.split, ratio } })) };
}
