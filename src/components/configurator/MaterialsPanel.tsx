"use client";

import { isBranch } from "@/domain/compartments/types";
import { getMaterial, MATERIAL_CATALOG, type MaterialSlot } from "@/domain/furniture/materials";
import type { CabinetConfiguration } from "@/domain/furniture/types";
import { useConfiguratorStore } from "@/store/useConfiguratorStore";

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
    isAvailable: (c) => isBranch(c.compartments),
    unavailableReason: "Dostępne po dodaniu półek lub przegród.",
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
            className="relative flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border border-transparent p-1.5 text-center transition-colors hover:bg-stone-100 has-[:checked]:border-stone-800 has-[:checked]:bg-stone-50 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-stone-800 group-disabled:cursor-not-allowed group-disabled:opacity-40 group-disabled:hover:bg-transparent"
          >
            <input
              type="radio"
              name={`material-${slot}`}
              value={material.id}
              checked={selectedId === material.id}
              onChange={() => setMaterial(slot, material.id)}
              className="sr-only"
            />
            <span
              className="size-8 rounded-full border border-black/15 shadow-inner"
              style={{ backgroundColor: material.color }}
              aria-hidden="true"
            />
            <span className="text-[11px] leading-tight text-stone-700">{material.name}</span>
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
