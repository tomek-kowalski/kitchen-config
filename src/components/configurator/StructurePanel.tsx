"use client";

import { useMemo, useState } from "react";
import type { CommitResult } from "@/store/useConfiguratorStore";
import { getAttachmentsAffectedBySplitRemoval } from "@/domain/attachments/operations";
import type { FurnitureAttachment } from "@/domain/attachments/types";
import { calculateCompartmentBounds } from "@/domain/compartments/layout";
import { getSplitSizeRange, ratioForFirstSize, type SplitSizeRange } from "@/domain/compartments/splitRange";
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
import { formatMm, pluralPl } from "@/domain/furniture/format";
import type { CabinetConfiguration } from "@/domain/furniture/types";
import { useConfiguratorStore } from "@/store/useConfiguratorStore";
import { ConfirmDialog } from "./ConfirmDialog";
import { CheckIcon, ErrorList, SectionHeading } from "./SectionHeading";

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

export function compartmentLabel(id: CompartmentId, rootId: CompartmentId): string {
  return id === rootId ? "Całe wnętrze" : `Przedział ${id}`;
}

/** Locative form, as in "podziały w przedziale c2". */
function compartmentLocation(id: CompartmentId, rootId: CompartmentId): string {
  return id === rootId ? "w całym wnętrzu" : `w przedziale ${id}`;
}

/** Short tree marker for a compartment's door or drawer assembly. */
export function attachmentLabel(attachment: FurnitureAttachment): string {
  if (attachment.type === "drawer") return `szuflady ×${attachment.configuration.count}`;
  return attachment.configuration.layout === "double" ? "drzwi podwójne" : "drzwi";
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
  markers: ReadonlyMap<CompartmentId, string>;
  rootId: CompartmentId;
  layouts: ReadonlyMap<CompartmentId, CompartmentLayout>;
  selectedId: CompartmentId | null;
  onSelect: (id: CompartmentId) => void;
}

function TreeItem({ node, markers, rootId, layouts, selectedId, onSelect }: TreeItemProps) {
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
          selected ? "bg-blue-50 font-medium text-blue-900 ring-2 ring-blue-600" : "text-stone-700 hover:bg-stone-100"
        }`}
      >
        <span className="flex min-w-0 items-center gap-1 truncate">
          {selected && <CheckIcon className="size-3.5 shrink-0 text-blue-600" />}
          {compartmentLabel(node.id, rootId)}
          {isBranch(node) && (
            <span className="ml-1.5 text-stone-400">· {SPLIT_LABELS[node.split.direction].panel.toLowerCase()}</span>
          )}
          {markers.has(node.id) && <span className="ml-1.5 text-amber-700">· {markers.get(node.id)}</span>}
        </span>
        <span className="shrink-0 tabular-nums text-stone-400">{size} mm</span>
      </button>
      {isBranch(node) && (
        <ul className="ml-3 border-l border-stone-200 pl-2">
          {node.children.map((child) => (
            <TreeItem
              key={child.id}
              node={child}
              markers={markers}
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
  const [pendingRemoval, setPendingRemoval] = useState<{
    readonly id: CompartmentId;
    readonly attachments: readonly FurnitureAttachment[];
  } | null>(null);

  const requestRemoval = (id: CompartmentId) => {
    const affected = getAttachmentsAffectedBySplitRemoval(configuration, id);
    if (affected.length === 0) remove(id);
    else setPendingRemoval({ id, attachments: affected });
  };
  const setRatio = useConfiguratorStore((state) => state.setSplitRatio);

  const tree = configuration.compartments;
  const layouts = useMemo(
    () => new Map(calculateCompartmentBounds(configuration).map((layout) => [layout.id, layout])),
    [configuration],
  );
  const leafCount = useMemo(() => getLeafCompartments(tree).length, [tree]);
  const markers = useMemo(
    () => new Map(configuration.attachments.map((a) => [a.compartmentId, attachmentLabel(a)])),
    [configuration.attachments],
  );

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

  // Range from the complete validation (compartments, fronts, drawers, handles); validation still decides on commit.
  const sizeRange = useMemo(
    () => (ownerSplit ? getSplitSizeRange(configuration, ownerSplit.id) : null),
    [configuration, ownerSplit],
  );

  return (
    <section aria-labelledby="structure-heading" className="space-y-4">
      <div className="flex items-baseline justify-between">
        <SectionHeading id="structure-heading">Struktura</SectionHeading>
        <span className="text-xs tabular-nums text-stone-500">
          Przedziały: {leafCount} / {CONSTRUCTION_LIMITS.maxLeafCompartments}
        </span>
      </div>

      <ul aria-label="Przedziały" className="max-h-56 overflow-y-auto rounded-lg border border-stone-200 p-1">
        <TreeItem node={tree} markers={markers} rootId={tree.id} layouts={layouts} selectedId={selectedId} onSelect={select} />
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
              sizeRange={sizeRange}
              onRatio={(ratio) => setRatio(ownerSplit.id, ratio)}
              onRemove={() => requestRemoval(ownerSplit.id)}
            />
          )}
        </div>
      )}

      {rejection && <ErrorList errors={rejection.errors} />}

      <ConfirmDialog
        open={pendingRemoval !== null}
        title="Usunąć podział razem z frontami?"
        confirmLabel="Usuń podział i fronty"
        onCancel={() => setPendingRemoval(null)}
        onConfirm={() => {
          if (pendingRemoval) remove(pendingRemoval.id, { removeAttachments: true });
          setPendingRemoval(null);
        }}
      >
        {pendingRemoval && (
          <>
            <p>
              W usuwanych przedziałach są zamontowane {pendingRemoval.attachments.length}{" "}
              {pluralPl(pendingRemoval.attachments.length, { one: "zestaw", few: "zestawy", many: "zestawów" })} drzwi
              lub szuflad. Zostaną usunięte razem z podziałem:
            </p>
            <ul className="mt-2 list-disc space-y-0.5 pl-5">
              {pendingRemoval.attachments.map((a) => (
                <li key={a.id}>
                  {attachmentLabel(a)} „{a.id}” w przedziale {a.compartmentId}
                </li>
              ))}
            </ul>
          </>
        )}
      </ConfirmDialog>
    </section>
  );
}

interface SplitControlsProps {
  owner: CompartmentBranch;
  ownerLocation: string;
  isOwnSplit: boolean;
  layout: CompartmentLayout;
  panelThickness: number;
  sizeRange: SplitSizeRange | null;
  onRatio: (ratio: number) => CommitResult;
  onRemove: () => void;
}

/**
 * Exact size of one child in mm, committed on Enter or blur. The split ratio is recalculated from it
 * (ratio = first child / usable space), so the other child gets the rest exactly.
 */
function ExactSizeInput({
  id,
  label,
  value,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  onCommit: (size: number) => CommitResult;
}) {
  const shown = formatMm(value).replace(",", ".");
  const [text, setText] = useState(shown);
  const [synced, setSynced] = useState(shown);
  const [errors, setErrors] = useState<readonly { message: string }[]>([]);
  if (shown !== synced) {
    setSynced(shown);
    setText(shown);
  }
  const commit = () => {
    const size = Number(text);
    if (text.trim() === "" || !Number.isFinite(size)) {
      setErrors([{ message: "Podaj wymiar w milimetrach." }]);
      return;
    }
    const result = onCommit(size);
    setErrors(result.ok ? [] : result.errors);
  };
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs text-stone-600">
        {label}
      </label>
      <div className="flex items-center rounded-md border border-stone-300 bg-white focus-within:ring-2 focus-within:ring-stone-200">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          step={0.1}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
          }}
          aria-invalid={errors.length > 0}
          className="w-full min-w-0 bg-transparent px-2 py-1 text-sm tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        />
        <span className="pr-2 text-xs text-stone-500" aria-hidden="true">
          mm
        </span>
      </div>
      <ErrorList errors={errors} />
    </div>
  );
}

function SplitControls({ owner, ownerLocation, isOwnSplit, layout, panelThickness, sizeRange, onRatio, onRemove }: SplitControlsProps) {
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
        min={sizeRange ? Math.ceil(sizeRange.min) : first}
        max={sizeRange ? Math.floor(sizeRange.max) : first}
        step={1}
        value={Math.round(first)}
        disabled={!sizeRange || Math.ceil(sizeRange.min) >= Math.floor(sizeRange.max)}
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
      {sizeRange && (
        <p className="text-xs tabular-nums text-stone-500">
          Dozwolone: {labels.parts[0].toLowerCase()} {formatMm(sizeRange.min)}–{formatMm(sizeRange.max)} mm
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <ExactSizeInput
          id={`${sliderId}-first`}
          label={`${labels.parts[0]} (dokładnie)`}
          value={first}
          onCommit={(size) => onRatio(ratioForFirstSize({ usable }, size))}
        />
        <ExactSizeInput
          id={`${sliderId}-second`}
          label={`${labels.parts[1]} (dokładnie)`}
          value={usable - first}
          onCommit={(size) => onRatio(ratioForFirstSize({ usable }, usable - size))}
        />
      </div>
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
