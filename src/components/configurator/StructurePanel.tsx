"use client";

import { useMemo } from "react";
import { calculateCompartmentBounds, getSplitRatioRange } from "@/domain/compartments/layout";
import {
  getCompartment,
  getCompartmentPath,
  getLeafCompartments,
  splitCompartment,
} from "@/domain/compartments/tree";
import {
  isBranch,
  type CompartmentBranch,
  type CompartmentId,
  type CompartmentLayout,
  type CompartmentNode,
  type SplitDirection,
} from "@/domain/compartments/types";
import { validateCabinet } from "@/domain/constraints/validateCabinet";
import { CONSTRUCTION_LIMITS } from "@/domain/furniture/defaults";
import { formatMm } from "@/domain/furniture/format";
import type { CabinetConfiguration } from "@/domain/furniture/types";
import { useConfiguratorStore } from "@/store/useConfiguratorStore";
import { ErrorList, SectionHeading } from "./SectionHeading";

interface SplitLabels {
  add: string;
  remove: string;
  panel: string;
  position: string;
  parts: [string, string];
}

const SPLIT_LABELS: Readonly<Record<SplitDirection, SplitLabels>> = {
  horizontal: { add: "Dodaj półkę", remove: "Usuń półkę", panel: "Półka", position: "Położenie półki", parts: ["Dół", "Góra"] },
  vertical: {
    add: "Dodaj przegrodę",
    remove: "Usuń przegrodę",
    panel: "Przegroda",
    position: "Położenie przegrody",
    parts: ["Lewa", "Prawa"],
  },
};

function compartmentLabel(id: CompartmentId, rootId: CompartmentId): string {
  return id === rootId ? "Całe wnętrze" : `Przedział ${id}`;
}

/** Locative form, as in "podziały w przedziale c2". */
function compartmentLocation(id: CompartmentId, rootId: CompartmentId): string {
  return id === rootId ? "w całym wnętrzu" : `w przedziale ${id}`;
}

/** Why a split would be rejected, or null when it is allowed. Runs the real operation + validation. */
function splitBlocker(configuration: CabinetConfiguration, id: CompartmentId, direction: SplitDirection): string | null {
  const result = splitCompartment(configuration.compartments, id, direction);
  if (!result.ok) return result.error.message;
  const validation = validateCabinet({ ...configuration, compartments: result.tree });
  return validation.isValid ? null : validation.errors[0].message;
}

interface TreeItemProps {
  node: CompartmentNode;
  rootId: CompartmentId;
  layouts: ReadonlyMap<CompartmentId, CompartmentLayout>;
  selectedId: CompartmentId | null;
  onSelect: (id: CompartmentId) => void;
}

function TreeItem({ node, rootId, layouts, selectedId, onSelect }: TreeItemProps) {
  const layout = layouts.get(node.id);
  const selected = node.id === selectedId;
  const size = layout ? `${formatMm(layout.bounds.dimensions.width)} × ${formatMm(layout.bounds.dimensions.height)}` : "";

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(node.id)}
        aria-current={selected ? "true" : undefined}
        className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors focus-visible:outline-2 focus-visible:outline-blue-600 ${
          selected ? "bg-blue-50 font-medium text-blue-800 ring-1 ring-blue-300" : "text-stone-700 hover:bg-stone-100"
        }`}
      >
        <span className="truncate">
          {compartmentLabel(node.id, rootId)}
          {isBranch(node) && (
            <span className="ml-1.5 text-stone-400">· {SPLIT_LABELS[node.split.direction].panel.toLowerCase()}</span>
          )}
        </span>
        <span className="shrink-0 tabular-nums text-stone-400">{size} mm</span>
      </button>
      {isBranch(node) && (
        <ul className="ml-3 border-l border-stone-200 pl-2">
          {node.children.map((child) => (
            <TreeItem
              key={child.id}
              node={child}
              rootId={rootId}
              layouts={layouts}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function StructurePanel() {
  const configuration = useConfiguratorStore((state) => state.configuration);
  const selectedId = useConfiguratorStore((state) => state.selectedCompartmentId);
  const rejection = useConfiguratorStore((state) => (state.rejection?.source === "structure" ? state.rejection : null));
  const select = useConfiguratorStore((state) => state.selectCompartment);
  const split = useConfiguratorStore((state) => state.splitCompartment);
  const remove = useConfiguratorStore((state) => state.removeSplit);
  const setRatio = useConfiguratorStore((state) => state.setSplitRatio);

  const tree = configuration.compartments;
  const layouts = useMemo(
    () => new Map(calculateCompartmentBounds(configuration).map((layout) => [layout.id, layout])),
    [configuration],
  );
  const leafCount = useMemo(() => getLeafCompartments(tree).length, [tree]);

  const path = selectedId ? getCompartmentPath(tree, selectedId) : null;
  const selected = path?.at(-1) ?? null;
  const selectedLayout = selected ? layouts.get(selected.id) : undefined;
  // The split a selection controls: its own for a subdivided compartment, otherwise its parent's.
  const owner = selected && isBranch(selected) ? selected : path && path.length > 1 ? path.at(-2) : undefined;
  const ownerSplit = owner && isBranch(owner) ? owner : null;
  const ownerLayout = ownerSplit ? layouts.get(ownerSplit.id) : undefined;

  const blockers = useMemo(() => {
    const node = selectedId ? getCompartment(configuration.compartments, selectedId) : null;
    if (!node || isBranch(node)) return null;
    return {
      horizontal: splitBlocker(configuration, node.id, "horizontal"),
      vertical: splitBlocker(configuration, node.id, "vertical"),
    };
  }, [configuration, selectedId]);

  const ratioRange = ownerSplit ? getSplitRatioRange(configuration, ownerSplit.id) : null;

  return (
    <section aria-labelledby="structure-heading" className="space-y-4">
      <div className="flex items-baseline justify-between">
        <SectionHeading id="structure-heading">Struktura</SectionHeading>
        <span className="text-xs tabular-nums text-stone-500">
          Przedziały: {leafCount} / {CONSTRUCTION_LIMITS.maxLeafCompartments}
        </span>
      </div>

      <ul aria-label="Przedziały" className="max-h-56 overflow-y-auto rounded-lg border border-stone-200 p-1">
        <TreeItem node={tree} rootId={tree.id} layouts={layouts} selectedId={selectedId} onSelect={select} />
      </ul>

      {!selected || !selectedLayout ? (
        <p className="text-xs text-stone-500">Zaznacz przedział w widoku 3D lub na liście powyżej, aby go edytować.</p>
      ) : (
        <div className="space-y-4 rounded-lg border border-blue-200 bg-blue-50/40 p-3">
          <div>
            <p className="text-sm font-medium text-stone-900">{compartmentLabel(selected.id, tree.id)}</p>
            <p className="text-xs tabular-nums text-stone-600">
              {formatMm(selectedLayout.bounds.dimensions.width)} × {formatMm(selectedLayout.bounds.dimensions.height)} ×{" "}
              {formatMm(selectedLayout.bounds.dimensions.depth)} mm (szer. × wys. × gł.)
            </p>
          </div>

          {blockers && (
            <div className="grid grid-cols-2 gap-2">
              {(["horizontal", "vertical"] as const).map((direction) => (
                <button
                  key={direction}
                  type="button"
                  disabled={blockers[direction] !== null}
                  title={blockers[direction] ?? undefined}
                  onClick={() => split(selected.id, direction)}
                  className="rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900 disabled:cursor-not-allowed disabled:bg-stone-300"
                >
                  {SPLIT_LABELS[direction].add}
                </button>
              ))}
              {blockers.horizontal && blockers.vertical && (
                <p className="col-span-2 text-xs text-stone-500">Ten przedział jest za mały, aby go dalej dzielić.</p>
              )}
            </div>
          )}

          {ownerSplit && ownerLayout && (
            <SplitControls
              owner={ownerSplit}
              ownerLocation={compartmentLocation(ownerSplit.id, tree.id)}
              isOwnSplit={ownerSplit.id === selected.id}
              layout={ownerLayout}
              panelThickness={configuration.panelThickness}
              ratioRange={ratioRange}
              onRatio={(ratio) => setRatio(ownerSplit.id, ratio)}
              onRemove={() => remove(ownerSplit.id)}
            />
          )}
        </div>
      )}

      {rejection && <ErrorList errors={rejection.errors} />}
    </section>
  );
}

interface SplitControlsProps {
  owner: CompartmentBranch;
  ownerLocation: string;
  isOwnSplit: boolean;
  layout: CompartmentLayout;
  panelThickness: number;
  ratioRange: { min: number; max: number } | null;
  onRatio: (ratio: number) => void;
  onRemove: () => void;
}

function SplitControls({ owner, ownerLocation, isOwnSplit, layout, panelThickness, ratioRange, onRatio, onRemove }: SplitControlsProps) {
  const { direction, ratio } = owner.split;
  const labels = SPLIT_LABELS[direction];
  const size = direction === "horizontal" ? layout.bounds.dimensions.height : layout.bounds.dimensions.width;
  const usable = size - panelThickness;
  const first = usable * ratio;
  const sliderId = `split-${owner.id}`;
  const removesNested = owner.children.some(isBranch);

  return (
    <div className="space-y-2 border-t border-blue-200 pt-3">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={sliderId} className="text-sm font-medium text-stone-800">
          {labels.position}
        </label>
        {!isOwnSplit && <span className="text-xs text-stone-500">{ownerLocation}</span>}
      </div>
      <input
        id={sliderId}
        type="range"
        min={ratioRange ? Math.ceil(ratioRange.min * usable) : first}
        max={ratioRange ? Math.floor(ratioRange.max * usable) : first}
        step={1}
        value={Math.round(first)}
        disabled={!ratioRange}
        onChange={(event) => onRatio(Number(event.target.value) / usable)}
        aria-valuetext={`${labels.parts[0]} ${formatMm(first)} mm, ${labels.parts[1]} ${formatMm(usable - first)} mm`}
        className="h-1.5 w-full cursor-pointer accent-blue-700 disabled:cursor-not-allowed"
      />
      <p className="flex justify-between text-xs tabular-nums text-stone-600">
        <span>
          {labels.parts[0]}: {formatMm(first)} mm
        </span>
        <span>{Math.round(ratio * 100)}%</span>
        <span>
          {labels.parts[1]}: {formatMm(usable - first)} mm
        </span>
      </p>
      <button
        type="button"
        onClick={onRemove}
        className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-800 transition-colors hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-800"
      >
        {labels.remove}
      </button>
      {removesNested && (
        <p className="text-xs text-stone-500">Usunięcie usunie także wszystkie podziały {ownerLocation}.</p>
      )}
    </div>
  );
}
