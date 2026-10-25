"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Modal confirmation built on the native <dialog> element: focus is moved into the dialog and
 * trapped by the browser, Esc cancels, and focus returns to the trigger when it closes.
 * The cancel button is focused first so that Enter never confirms a destructive action by accident.
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Anuluj",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        // Esc: keep React in control of the open state.
        event.preventDefault();
        onCancel();
      }}
      className="m-auto w-[min(26rem,calc(100vw-2rem))] rounded-xl border border-stone-200 bg-white p-0 text-stone-900 shadow-xl backdrop:bg-stone-900/40"
    >
      <div className="space-y-3 p-5">
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        <div id={descriptionId} className="text-sm text-stone-600">
          {children}
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-stone-200 px-5 py-3">
        <button
          type="button"
          autoFocus
          onClick={onCancel}
          className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-800 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-800"
        >
          {cancelLabel}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
