import { create } from "zustand";
import type { AttachmentId } from "@/domain/attachments/types";

/**
 * View-only state for the open/close preview. Deliberately separate from the configuration
 * store: opening a door never changes, validates or persists the furniture configuration.
 */
interface PreviewState {
  readonly openAttachmentIds: ReadonlySet<AttachmentId>;
  toggle: (id: AttachmentId) => void;
  setOpen: (ids: readonly AttachmentId[], open: boolean) => void;
  closeAll: () => void;
}

export const usePreviewStore = create<PreviewState>()((set, get) => ({
  openAttachmentIds: new Set(),
  toggle: (id) => {
    const next = new Set(get().openAttachmentIds);
    if (!next.delete(id)) next.add(id);
    set({ openAttachmentIds: next });
  },
  setOpen: (ids, open) => {
    const next = new Set(get().openAttachmentIds);
    for (const id of ids) {
      if (open) next.add(id);
      else next.delete(id);
    }
    set({ openAttachmentIds: next });
  },
  closeAll: () => {
    if (get().openAttachmentIds.size > 0) set({ openAttachmentIds: new Set() });
  },
}));
