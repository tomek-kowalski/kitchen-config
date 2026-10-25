"use client";

import { isBranch } from "@/domain/compartments/types";
import { getMaterial, MATERIAL_CATALOG, type MaterialSlot } from "@/domain/furniture/materials";
import type { CabinetConfiguration } from "@/domain/furniture/types";
import { useConfiguratorStore } from "@/store/useConfiguratorStore";
import { CheckIcon } from "./SectionHeading";

interface SlotDefinition {
  slot: MaterialSlot;
  label: string;
  /** Whether any generated part uses this slot. */
  isAvailable: (configuration: CabinetConfiguration) => boolean;
  /** Shown while the selector is disabled. */
  unavailableReason: string;
}

// A selector is enabled only while parts using its slot exist.
const SLOTS: readonly SlotDefinition[] = [
  { slot: "body", label: "Wykończenie korpusu", isAvailable: () => true, unavailableReason: "" },
  {
    slot: "interior",
    label: "Wykończenie wnętrza",
    // Also used by the drawer boxes.
    isAvailable: (c) => isBranch(c.compartments) || c.attachments.some((a) => a.type === "drawer"),
    unavailableReason: "Dostępne po dodaniu półek, przegród lub szuflad.",
  },
  {
    slot: "backPanel",
    label: "Wykończenie pleców",
    isAvailable: (c) => c.backPanel.enabled,
    unavailableReason: "Dostępne po włączeniu pleców.",
  },
  {
    slot: "plinth",
    label: "Wykończenie cokołu",
    isAvailable: (c) => c.plinth.enabled,
    unavailableReason: "Dostępne po włączeniu cokołu.",
  },
  {
    slot: "doorFront",
    label: "Wykończenie drzwi",
    isAvailable: (c) => c.attachments.some((a) => a.type === "door"),
    unavailableReason: "Dostępne po dodaniu drzwi.",
  },
  {
    slot: "drawerFront",
    label: "Wykończenie frontów szuflad",
    isAvailable: (c) => c.attachments.some((a) => a.type === "drawer"),
    unavailableReason: "Dostępne po dodaniu szuflad.",
  },
];

function MaterialSelector({ slot, label, isAvailable, unavailableReason }: SlotDefinition) {
  const selectedId = useConfiguratorStore((state) => state.configuration.materials[slot]);
  const available = useConfiguratorStore((state) => isAvailable(state.configuration));
  const setMaterial = useConfiguratorStore((state) => state.setMaterial);
  const disabled = !available;
  const hintId = `material-${slot}-hint`;

  return (
    <fieldset disabled={disabled} aria-describedby={disabled ? hintId : undefined} className="group space-y-2.5">
      <legend className="flex w-full items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-stone-800 group-disabled:text-stone-400">{label}</span>
        <span className="text-xs text-stone-500 group-disabled:text-stone-400">{getMaterial(selectedId).name}</span>
      </legend>

      <div className="grid grid-cols-4 gap-2">
        {MATERIAL_CATALOG.map((material) => (
          <label
            key={material.id}
            title={material.name}
            // `relative` keeps the absolutely positioned sr-only radio inside the scrolling sidebar.
            className="relative flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border-2 border-transparent p-1.5 text-center transition-colors hover:bg-stone-100 has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-stone-900 group-disabled:cursor-not-allowed group-disabled:opacity-50 group-disabled:hover:bg-transparent group-disabled:has-[:checked]:border-stone-300 group-disabled:has-[:checked]:bg-stone-50"
          >
            <input
              type="radio"
              name={`material-${slot}`}
              value={material.id}
              checked={selectedId === material.id}
              onChange={() => setMaterial(slot, material.id)}
              className="peer sr-only"
            />
            {/* The swatch always keeps the real finish colour; selection is a ring plus a check badge. */}
            <span
              className="relative size-8 rounded-full border border-black/15 shadow-inner peer-checked:ring-2 peer-checked:ring-blue-600 peer-checked:ring-offset-2 group-disabled:peer-checked:ring-stone-400"
              style={{ backgroundColor: material.color }}
              aria-hidden="true"
            >
              {selectedId === material.id && (
                <span className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-blue-600 text-white ring-2 ring-white group-disabled:bg-stone-400">
                  <CheckIcon className="size-3" />
                </span>
              )}
            </span>
            <span className="text-[11px] leading-tight text-stone-700 peer-checked:font-semibold peer-checked:text-blue-900 group-disabled:peer-checked:text-stone-600">
              {material.name}
            </span>
          </label>
        ))}
      </div>

      {disabled && (
        <p id={hintId} className="text-xs text-stone-400">
          {unavailableReason}
        </p>
      )}
    </fieldset>
  );
}

export function MaterialsPanel() {
  return (
    <section aria-labelledby="materials-heading" className="space-y-6">
      <h2 id="materials-heading" className="text-xs font-semibold uppercase tracking-[0.12em] text-stone-500">
        Materiały i kolory
      </h2>
      {SLOTS.map((definition) => (
        <MaterialSelector key={definition.slot} {...definition} />
      ))}
      <p className="text-xs text-stone-400">Kolory są przybliżone i mogą różnić się od rzeczywistego wykończenia.</p>
    </section>
  );
}
