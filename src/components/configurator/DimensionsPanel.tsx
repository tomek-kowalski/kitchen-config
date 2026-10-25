"use client";

import type { CabinetDimensionKey } from "@/domain/furniture/types";
import { useConfiguratorStore } from "@/store/useConfiguratorStore";
import { NumericFieldControl } from "./DimensionField";
import { SectionHeading } from "./SectionHeading";

const FIELDS: readonly { key: CabinetDimensionKey; label: string; sliderStep: number }[] = [
  { key: "width", label: "Szerokość", sliderStep: 10 },
  { key: "height", label: "Wysokość", sliderStep: 10 },
  { key: "depth", label: "Głębokość", sliderStep: 10 },
  { key: "panelThickness", label: "Grubość płyty", sliderStep: 1 },
];

export function DimensionsPanel() {
  const hasPendingInputs = useConfiguratorStore((state) => Object.keys(state.pendingInputs).length > 0);

  return (
    <section aria-labelledby="dimensions-heading" className="space-y-5">
      <SectionHeading id="dimensions-heading">Wymiary</SectionHeading>

      {hasPendingInputs && (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Niektóre wartości nie zostały zastosowane. Podgląd pokazuje ostatnią poprawną konfigurację.
        </p>
      )}

      {FIELDS.map(({ key, label, sliderStep }) => (
        <NumericFieldControl key={key} field={key} label={label} sliderStep={sliderStep} />
      ))}
    </section>
  );
}
