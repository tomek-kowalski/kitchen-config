"use client";

import { useMemo } from "react";
import { getInteriorBounds } from "@/domain/compartments/layout";
import { getLeafCompartments } from "@/domain/compartments/tree";
import { formatMm } from "@/domain/furniture/format";
import { getMaterial } from "@/domain/furniture/materials";
import { buildCabinet } from "@/domain/geometry/buildCabinet";
import { useConfiguratorStore } from "@/store/useConfiguratorStore";
import { ConfigurationFilePanel } from "./ConfigurationFilePanel";
import { ConstructionPanel } from "./ConstructionPanel";
import { DimensionsPanel } from "./DimensionsPanel";
import { MaterialsPanel } from "./MaterialsPanel";
import { SectionHeading } from "./SectionHeading";
import { StructurePanel } from "./StructurePanel";
import { AttachmentsPanel } from "./AttachmentsPanel";
import { usePreviewStore } from "@/store/usePreviewStore";

function CabinetSummary() {
  const configuration = useConfiguratorStore((state) => state.configuration);
  const { width, height, depth, panelThickness: t, backPanel, plinth } = configuration;
  const material = getMaterial(configuration.materials.body);
  const partCount = useMemo(() => buildCabinet(configuration).length, [configuration]);
  const doorLeaves = configuration.attachments.reduce(
    (sum, a) => sum + (a.type === "door" ? (a.configuration.layout === "double" ? 2 : 1) : 0),
    0,
  );
  const drawerCount = configuration.attachments.reduce((sum, a) => sum + (a.type === "drawer" ? a.configuration.count : 0), 0);
  const interior = getInteriorBounds(configuration).dimensions;

  const rows: readonly [string, string][] = [
    ["Wymiary zewnętrzne", `${width} × ${height} × ${depth} mm`],
    ["Wnętrze", `${formatMm(interior.width)} × ${formatMm(interior.height)} × ${formatMm(interior.depth)} mm`],
    ["Przedziały", String(getLeafCompartments(configuration.compartments).length)],
    ["Plecy", backPanel.enabled ? `${backPanel.thickness} mm` : "Brak"],
    ["Cokół", plinth.enabled ? `${plinth.height} mm, cofnięcie ${plinth.setback} mm` : "Brak"],
    ["Skrzydła drzwi", String(doorLeaves)],
    ["Szuflady", String(drawerCount)],
    ["Elementy", `${partCount} (płyty ${t} mm)`],
  ];

  return (
    <section aria-labelledby="summary-heading" className="space-y-3">
      <SectionHeading id="summary-heading">Podsumowanie</SectionHeading>
      <dl className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-stone-50 text-sm">
        <div className="flex items-center justify-between gap-4 px-3 py-2">
          <dt className="text-stone-500">Wykończenie korpusu</dt>
          <dd className="flex items-center gap-2 font-medium text-stone-800">
            <span
              className="size-3.5 rounded-full border border-black/10"
              style={{ backgroundColor: material.color }}
              aria-hidden="true"
            />
            {material.name}
          </dd>
        </div>
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4 px-3 py-2">
            <dt className="text-stone-500">{label}</dt>
            <dd className="text-right font-medium tabular-nums text-stone-800">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function ConfiguratorSidebar() {
  const resetConfiguration = useConfiguratorStore((state) => state.reset);
  const closeAll = usePreviewStore((state) => state.closeAll);
  const reset = () => {
    closeAll();
    resetConfiguration();
  };

  return (
    <aside className="flex w-full flex-col border-t border-stone-200 bg-white lg:h-full lg:w-[380px] lg:shrink-0 lg:border-l lg:border-t-0">
      <header className="border-b border-stone-200 px-6 py-5">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-stone-500">Konfigurator</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight text-stone-900">Szafka modułowa</h1>
      </header>

      <div className="flex-1 space-y-8 px-6 py-6 lg:overflow-y-auto">
        <DimensionsPanel />
        <StructurePanel />
        <AttachmentsPanel />
        <ConstructionPanel />
        <MaterialsPanel />
        <CabinetSummary />
        <ConfigurationFilePanel />
      </div>

      <footer className="border-t border-stone-200 px-6 py-4">
        <button
          type="button"
          onClick={reset}
          className="w-full rounded-lg border border-stone-300 px-4 py-2.5 text-sm font-medium text-stone-800 transition-colors hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-800"
        >
          Przywróć domyślne
        </button>
      </footer>
    </aside>
  );
}
