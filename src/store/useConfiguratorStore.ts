import { create } from "zustand";
import {
  addDoor,
  addDrawers,
  getAttachmentsAffectedBySplitRemoval,
  removeAttachment,
  setDrawerFrontHeight,
  removeSplitWithAttachments,
  updateDoor,
  updateDrawers,
  type AttachmentOperationResult,
} from "@/domain/attachments/operations";
import type {
  AttachmentId,
  DoorConfiguration,
  DoorLayout,
  DrawerConfiguration,
  DrawerPlacement,
} from "@/domain/attachments/types";
import {
  getCompartment,
  getCompartmentPath,
  splitCompartment,
  updateSplitRatio,
  type CompartmentOperationResult,
} from "@/domain/compartments/tree";
import type { CompartmentId, CompartmentNode, SplitDirection } from "@/domain/compartments/types";
import { validateCabinet, type CabinetValidationError } from "@/domain/constraints/validateCabinet";
import { DEFAULT_CABINET } from "@/domain/furniture/defaults";
import { setNumericField } from "@/domain/furniture/fields";
import type { MaterialId, MaterialSlot } from "@/domain/furniture/materials";
import type { CabinetConfiguration, NumericField } from "@/domain/furniture/types";

export type CommitResult = { readonly ok: true } | { readonly ok: false; readonly errors: readonly CabinetValidationError[] };

/** A typed value that was rejected; kept so the form can show it with its errors. */
export interface PendingInput {
  readonly value: number;
  readonly errors: readonly CabinetValidationError[];
}

/** Where the most recent rejected (non-text-field) edit came from, so the UI can show it in place. */
export type RejectionSource = "structure" | "backPanel" | "plinth" | "attachments";

export interface Rejection {
  readonly source: RejectionSource;
  readonly errors: readonly CabinetValidationError[];
}

/** One-shot camera request; `seq` makes repeated requests of the same kind distinguishable. */
export interface ViewCommand {
  readonly kind: "fit" | "reset";
  readonly seq: number;
}

export interface ConfiguratorState {
  /** The committed configuration. Always valid; geometry and bounds are derived from it. */
  readonly configuration: CabinetConfiguration;
  readonly pendingInputs: Readonly<Partial<Record<NumericField, PendingInput>>>;
  readonly rejection: Rejection | null;
  readonly selectedCompartmentId: CompartmentId | null;
  readonly viewCommand: ViewCommand | null;

  setNumericField: (field: NumericField, value: number) => CommitResult;
  setMaterial: (slot: MaterialSlot, materialId: MaterialId) => CommitResult;
  setBackPanelEnabled: (enabled: boolean) => CommitResult;
  setPlinthEnabled: (enabled: boolean) => CommitResult;
  splitCompartment: (id: CompartmentId, direction: SplitDirection) => CommitResult;
  /**
   * Removes a subdivision. If doors or drawers sit in the removed compartments, the call is refused
   * unless `removeAttachments` is set, in which case they are removed in the same commit.
   */
  removeSplit: (id: CompartmentId, options?: { readonly removeAttachments?: boolean }) => CommitResult;
  addDoor: (compartmentId: CompartmentId, layout: DoorLayout) => CommitResult;
  addDrawers: (compartmentId: CompartmentId, placement?: DrawerPlacement) => CommitResult;
  updateDoor: (id: AttachmentId, patch: Partial<DoorConfiguration>) => CommitResult;
  updateDrawers: (id: AttachmentId, patch: Partial<DrawerConfiguration>) => CommitResult;
  removeAttachment: (id: AttachmentId) => CommitResult;
  /** Sets one drawer front (0-based, from the bottom) to an exact height; the others share the rest proportionally. */
  setDrawerFrontHeight: (id: AttachmentId, index: number, height: number) => CommitResult;
  setSplitRatio: (id: CompartmentId, ratio: number) => CommitResult;
  selectCompartment: (id: CompartmentId | null) => void;
  /** Atomically replaces the whole configuration (e.g. after a successful import). */
  replaceConfiguration: (configuration: CabinetConfiguration) => CommitResult;
  reset: () => void;
  requestView: (kind: ViewCommand["kind"]) => void;
}

/** Keeps the selection when possible, otherwise falls back to the nearest surviving ancestor. */
function reconcileSelection(
  selected: CompartmentId | null,
  previous: CompartmentNode,
  next: CompartmentNode,
): CompartmentId | null {
  if (selected === null) return null;
  const path = getCompartmentPath(previous, selected) ?? [];
  for (let i = path.length - 1; i >= 0; i--) {
    if (getCompartment(next, path[i].id)) return path[i].id;
  }
  return null;
}

const OK: CommitResult = { ok: true };

export const useConfiguratorStore = create<ConfiguratorState>()((set, get) => {
  /**
   * The single write path: a candidate is committed only when the complete configuration
   * validates, so the committed state can never become invalid.
   */
  const commit = (
    candidate: CabinetConfiguration,
    source: RejectionSource | null,
    extra: Partial<ConfiguratorState> = {},
  ): CommitResult => {
    const validation = validateCabinet(candidate);
    if (!validation.isValid) {
      if (source) set({ rejection: { source, errors: validation.errors } });
      return { ok: false, errors: validation.errors };
    }
    const { configuration, selectedCompartmentId } = get();
    set({
      configuration: candidate,
      rejection: null,
      selectedCompartmentId: reconcileSelection(
        selectedCompartmentId,
        configuration.compartments,
        candidate.compartments,
      ),
      ...extra,
    });
    return OK;
  };

  const commitAttachments = (
    result: AttachmentOperationResult,
    source: RejectionSource | null = "attachments",
  ): CommitResult => {
    if (!result.ok) {
      const error: CabinetValidationError = {
        field: "attachments",
        code: "invalid_attachment",
        message: result.error.message,
        compartmentId: result.error.compartmentId,
        attachmentId: result.error.attachmentId,
      };
      if (source) set({ rejection: { source, errors: [error] } });
      return { ok: false, errors: [error] };
    }
    return commit(result.configuration, source);
  };

  const commitTree = (result: CompartmentOperationResult): CommitResult => {
    if (!result.ok) {
      const error: CabinetValidationError = {
        field: "compartments",
        code: "invalid_structure",
        message: result.error.message,
        compartmentId: result.error.compartmentId,
      };
      set({ rejection: { source: "structure", errors: [error] } });
      return { ok: false, errors: [error] };
    }
    const { configuration } = get();
    if (result.tree === configuration.compartments) return OK;
    return commit({ ...configuration, compartments: result.tree }, "structure");
  };

  return {
    configuration: DEFAULT_CABINET,
    pendingInputs: {},
    rejection: null,
    selectedCompartmentId: null,
    viewCommand: null,

    setNumericField: (field, value) => {
      const { configuration, pendingInputs } = get();
      const otherPending = { ...pendingInputs };
      delete otherPending[field];
      const result = commit(setNumericField(configuration, field, value), null, { pendingInputs: otherPending });
      if (!result.ok) set({ pendingInputs: { ...pendingInputs, [field]: { value, errors: result.errors } } });
      return result;
    },

    setMaterial: (slot, materialId) => {
      const { configuration } = get();
      if (configuration.materials[slot] === materialId) return OK;
      return commit({ ...configuration, materials: { ...configuration.materials, [slot]: materialId } }, null);
    },

    setBackPanelEnabled: (enabled) => {
      const { configuration } = get();
      return commit({ ...configuration, backPanel: { ...configuration.backPanel, enabled } }, "backPanel");
    },

    setPlinthEnabled: (enabled) => {
      const { configuration } = get();
      return commit({ ...configuration, plinth: { ...configuration.plinth, enabled } }, "plinth");
    },

    splitCompartment: (id, direction) =>
      commitTree(splitCompartment(get().configuration.compartments, id, direction)),

    removeSplit: (id, { removeAttachments = false } = {}) => {
      const { configuration } = get();
      const affected = getAttachmentsAffectedBySplitRemoval(configuration, id);
      if (affected.length > 0 && !removeAttachments) {
        const error: CabinetValidationError = {
          field: "attachments",
          code: "removal_requires_confirmation",
          message: `Usunięcie podziału usunęłoby drzwi lub szuflady (${affected.length}); wymagane potwierdzenie.`,
          compartmentId: id,
        };
        return { ok: false, errors: [error] };
      }
      return commitAttachments(removeSplitWithAttachments(configuration, id), "structure");
    },

    addDoor: (compartmentId, layout) => commitAttachments(addDoor(get().configuration, compartmentId, layout)),

    addDrawers: (compartmentId, placement) => commitAttachments(addDrawers(get().configuration, compartmentId, placement)),

    // Edits report errors to the caller only, so the UI can show them next to the edited control.
    updateDoor: (id, patch) => commitAttachments(updateDoor(get().configuration, id, patch), null),

    updateDrawers: (id, patch) => commitAttachments(updateDrawers(get().configuration, id, patch), null),

    removeAttachment: (id) => commitAttachments(removeAttachment(get().configuration, id)),

    setDrawerFrontHeight: (id, index, height) =>
      commitAttachments(setDrawerFrontHeight(get().configuration, id, index, height), null),

    setSplitRatio: (id, ratio) => commitTree(updateSplitRatio(get().configuration.compartments, id, ratio)),

    selectCompartment: (id) => {
      if (id !== null && !getCompartment(get().configuration.compartments, id)) return;
      if (get().selectedCompartmentId !== id) set({ selectedCompartmentId: id });
    },

    replaceConfiguration: (configuration) =>
      commit(configuration, null, { pendingInputs: {}, selectedCompartmentId: null }),

    reset: () =>
      set({ configuration: DEFAULT_CABINET, pendingInputs: {}, rejection: null, selectedCompartmentId: null }),

    requestView: (kind) => set({ viewCommand: { kind, seq: (get().viewCommand?.seq ?? 0) + 1 } }),
  };
});
