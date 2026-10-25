"use client";

import { useId, useMemo, useState } from "react";
import type { MotionLimit } from "@/domain/attachments/collisions";
import { findCoveringDoor } from "@/domain/attachments/coverage";
import { getAvailableDrawerDepth, layoutDoor, layoutDrawers } from "@/domain/attachments/layout";
import {
  addDoor,
  addDrawers,
  getAttachmentForCompartment,
  getCoveringAttachment,
  getInteriorDrawers,
} from "@/domain/attachments/operations";
import { DOOR_RULES, DRAWER_RULES } from "@/domain/attachments/rules";
import type {
  DoorAttachment,
  DrawerAttachment,
  FrontMounting,
  FurnitureAttachment,
  HandleAlign,
  HandleConfiguration,
} from "@/domain/attachments/types";
import { calculateCompartmentBounds } from "@/domain/compartments/layout";
import type { CompartmentLayout } from "@/domain/compartments/types";
import { validateCabinet, type CabinetValidationError } from "@/domain/constraints/validateCabinet";
import { formatMm } from "@/domain/furniture/format";
import type { CabinetConfiguration, DimensionRange } from "@/domain/furniture/types";
import { buildFurniture, type FurnitureModel } from "@/domain/geometry/buildFurniture";
import { HANDLE_RULES, HANDLE_TYPE_NAMES, HANDLE_TYPES, HARDWARE_FINISHES, type HandleType } from "@/domain/hardware/catalog";
import { useConfiguratorStore, type CommitResult } from "@/store/useConfiguratorStore";
import { usePreviewStore } from "@/store/usePreviewStore";
import { DimensionField } from "./DimensionField";
import { CheckIcon, ErrorList, SectionHeading } from "./SectionHeading";
import { compartmentLabel } from "./StructurePanel";

const MOUNTING_OPTIONS: readonly { value: FrontMounting; label: string }[] = [
  { value: "overlay", label: "Nakładane" },
  { value: "inset", label: "Wpuszczane" },
];

const ALIGN_OPTIONS: readonly { value: HandleAlign; label: string }[] = [
  { value: "top", label: "Góra" },
  { value: "center", label: "Środek" },
  { value: "bottom", label: "Dół" },
];

const HANDLE_OPTIONS = HANDLE_TYPES.map((type) => ({ value: type, label: HANDLE_TYPE_NAMES[type] }));

const NO_ERRORS: readonly CabinetValidationError[] = [];

/** First validation message an action would produce, or null when it is allowed. */
function actionBlocker(
  configuration: CabinetConfiguration,
  run: (configuration: CabinetConfiguration) => { ok: true; configuration: CabinetConfiguration } | { ok: false; error: { message: string } },
): string | null {
  const result = run(configuration);
  if (!result.ok) return result.error.message;
  const validation = validateCabinet(result.configuration);
  return validation.isValid ? null : validation.errors[0].message;
}

interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}

/** A labelled group of native radio buttons styled as segments: arrow keys move the selection. */
function SegmentedControl<T extends string>({ label, value, options, onChange }: SegmentedControlProps<T>) {
  const name = useId();
  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium text-stone-800">{label}</legend>
      <div className="grid grid-flow-col auto-cols-fr gap-1.5">
        {options.map((option) => (
          <label
            key={option.value}
            className="relative flex cursor-pointer items-center justify-center gap-1 rounded-lg border-2 border-stone-200 bg-white px-2 py-1.5 text-center text-sm text-stone-700 transition-colors hover:border-stone-300 hover:bg-stone-50 has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50 has-[:checked]:font-medium has-[:checked]:text-blue-900 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-stone-900"
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {value === option.value && <CheckIcon className="size-3.5 shrink-0 text-blue-600" />}
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

interface ConfigNumberFieldProps {
  field: string;
  label: string;
  value: number;
  range: DimensionRange;
  step: number;
  unit?: string;
  onCommit: (value: number) => CommitResult;
}

/** Number input (plus slider) for an attachment setting; a rejected value stays visible with its errors. */
function ConfigNumberField({ field, label, value, range, step, unit, onCommit }: ConfigNumberFieldProps) {
  const [pending, setPending] = useState<{ value: number; errors: readonly CabinetValidationError[] } | null>(null);
  return (
    <DimensionField
      field={field}
      label={label}
      value={pending ? pending.value : value}
      range={range}
      sliderStep={step}
      unit={unit}
      errors={pending?.errors ?? NO_ERRORS}
      onChange={(_, next) => {
        const result = onCommit(next);
        setPending(result.ok ? null : { value: next, errors: result.errors });
      }}
    />
  );
}

function limitsOf(model: FurnitureModel, attachmentId: string): MotionLimit[] {
  return [...model.motion.values()].filter((limit) => limit.attachmentId === attachmentId);
}

/** Explains collision limits of an attachment's moving parts, if any. */
function RestrictionNote({ limits }: { limits: readonly MotionLimit[] }) {
  const restricted = limits.filter((l) => l.allowed < l.requested - 1e-6);
  if (restricted.length === 0) return null;
  const blockers = [...new Set(restricted.flatMap((l) => l.blockedBy))].map((id) => `„${id}”`).join(", ");
  const smallest = Math.min(...restricted.map((l) => l.allowed));
  const text =
    restricted[0].kind === "hinge"
      ? `Kąt otwarcia ograniczony do ${formatMm(smallest)}° (z ${formatMm(restricted[0].requested)}°), aby nie uderzyć w ${blockers}.`
      : `Wysuw ograniczony do ${formatMm(smallest)} mm (z ${formatMm(restricted[0].requested)} mm) przez ${blockers}.`;
  return (
    <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
      {text}
    </p>
  );
}

function PreviewToggle({ attachment, model }: { attachment: FurnitureAttachment; model: FurnitureModel }) {
  const open = usePreviewStore((state) => state.openAttachmentIds.has(attachment.id));
  const setOpen = usePreviewStore((state) => state.setOpen);
  const limits = limitsOf(model, attachment.id);
  const requiresOpen = limits.find((l) => l.requiresOpen)?.requiresOpen ?? null;
  const doorOpen = usePreviewStore((state) => (requiresOpen ? state.openAttachmentIds.has(requiresOpen) : true));
  // Interior drawers behind this door close together with it (the door waits until they are in).
  const dependents = [...model.motion.values()].filter((l) => l.requiresOpen === attachment.id).map((l) => l.attachmentId);
  const blocked = !open && !doorOpen;
  const verb = attachment.type === "door" ? (open ? "Zamknij drzwi" : "Otwórz drzwi") : open ? "Zamknij szuflady" : "Otwórz szuflady";

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        aria-pressed={open}
        disabled={blocked}
        aria-describedby={blocked ? `blocked-${attachment.id}` : undefined}
        onClick={() => {
          if (open) setOpen([attachment.id, ...dependents], false);
          else setOpen([attachment.id], true);
        }}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border-2 border-stone-900 bg-stone-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900 disabled:cursor-not-allowed disabled:border-stone-300 disabled:bg-stone-300 aria-pressed:border-blue-600 aria-pressed:bg-blue-50 aria-pressed:text-blue-900 aria-pressed:hover:bg-blue-100"
      >
        {open && <CheckIcon className="size-3.5 text-blue-600" />}
        {verb} (podgląd)
      </button>
      {blocked && requiresOpen && (
        <p id={`blocked-${attachment.id}`} className="text-xs text-stone-500">
          Najpierw otwórz drzwi „{requiresOpen}” — szuflady wewnętrzne nie mogą przejść przez zamknięte drzwi.
        </p>
      )}
      {attachment.type === "door" && dependents.length > 0 && open && (
        <p className="text-xs text-stone-500">Zamknięcie drzwi najpierw wsunie szuflady wewnętrzne.</p>
      )}
      <RestrictionNote limits={limits} />
    </div>
  );
}

function RemoveButton({ attachment }: { attachment: FurnitureAttachment }) {
  const remove = useConfiguratorStore((state) => state.removeAttachment);
  const setOpen = usePreviewStore((state) => state.setOpen);
  return (
    <button
      type="button"
      onClick={() => {
        setOpen([attachment.id], false);
        remove(attachment.id);
      }}
      className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-800 transition-colors hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-800"
    >
      {attachment.type === "door" ? "Usuń drzwi" : "Usuń szuflady"}
    </button>
  );
}

function HandleEditor({
  idPrefix,
  handle,
  isDoor,
  onChange,
}: {
  idPrefix: string;
  handle: HandleConfiguration;
  isDoor: boolean;
  onChange: (patch: Partial<HandleConfiguration>) => CommitResult;
}) {
  const [errors, setErrors] = useState<readonly CabinetValidationError[]>(NO_ERRORS);
  const finishName = useId();
  const apply = (patch: Partial<HandleConfiguration>) => {
    const result = onChange(patch);
    setErrors(result.ok ? NO_ERRORS : result.errors);
    return result;
  };

  return (
    <div className="space-y-3 rounded-md border border-stone-200 p-2.5">
      <SegmentedControl<HandleType> label="Uchwyt" value={handle.type} options={HANDLE_OPTIONS} onChange={(type) => apply({ type })} />
      {handle.type !== "none" && (
        <>
          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium text-stone-800">Wykończenie uchwytu</legend>
            <div className="grid grid-cols-5 gap-1.5">
              {HARDWARE_FINISHES.map((finish) => (
                <label
                  key={finish.id}
                  title={finish.name}
                  className="relative flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-transparent p-1 text-center hover:bg-stone-100 has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-stone-900"
                >
                  <input
                    type="radio"
                    name={finishName}
                    value={finish.id}
                    checked={handle.finish === finish.id}
                    onChange={() => apply({ finish: finish.id })}
                    className="peer sr-only"
                  />
                  <span
                    className="relative size-6 rounded-full border border-black/15 shadow-inner peer-checked:ring-2 peer-checked:ring-blue-600 peer-checked:ring-offset-1"
                    style={{ backgroundColor: finish.color }}
                    aria-hidden="true"
                  >
                    {handle.finish === finish.id && (
                      <span className="absolute -right-1.5 -top-1.5 flex size-3.5 items-center justify-center rounded-full bg-blue-600 text-white ring-2 ring-white">
                        <CheckIcon className="size-2.5" />
                      </span>
                    )}
                  </span>
                  <span className="text-[10px] leading-tight text-stone-700 peer-checked:font-semibold peer-checked:text-blue-900">
                    {finish.name}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <SegmentedControl<HandleAlign> label="Położenie w pionie" value={handle.align} options={ALIGN_OPTIONS} onChange={(align) => apply({ align })} />
          {isDoor && (
            <ConfigNumberField
              field={`${idPrefix}-handle-edge`}
              label="Odległość od krawędzi"
              value={handle.edgeOffset}
              range={HANDLE_RULES.edgeOffset}
              step={5}
              onCommit={(edgeOffset) => apply({ edgeOffset })}
            />
          )}
          {handle.align !== "center" && (
            <ConfigNumberField
              field={`${idPrefix}-handle-align`}
              label={handle.align === "top" ? "Odległość od góry" : "Odległość od dołu"}
              value={handle.alignOffset}
              range={HANDLE_RULES.alignOffset}
              step={5}
              onCommit={(alignOffset) => apply({ alignOffset })}
            />
          )}
        </>
      )}
      <ErrorList errors={errors} />
    </div>
  );
}

function DoorEditor({
  door,
  layout,
  configuration,
  model,
}: {
  door: DoorAttachment;
  layout: CompartmentLayout;
  configuration: CabinetConfiguration;
  model: FurnitureModel;
}) {
  const update = useConfiguratorStore((state) => state.updateDoor);
  const [errors, setErrors] = useState<readonly CabinetValidationError[]>(NO_ERRORS);
  const apply = (patch: Partial<DoorAttachment["configuration"]>) => {
    const result = update(door.id, patch);
    setErrors(result.ok ? NO_ERRORS : result.errors);
    return result;
  };
  const c = door.configuration;
  const leaves = layoutDoor(configuration, layout.bounds, door);

  return (
    <div className="space-y-4">
      <SegmentedControl
        label="Rodzaj"
        value={c.layout}
        options={[
          { value: "single", label: "Pojedyncze" },
          { value: "double", label: "Podwójne" },
        ]}
        onChange={(value) => apply({ layout: value })}
      />
      <SegmentedControl label="Montaż" value={c.mounting} options={MOUNTING_OPTIONS} onChange={(value) => apply({ mounting: value })} />
      {c.layout === "single" ? (
        <SegmentedControl
          label="Zawiasy"
          value={c.hinge}
          options={[
            { value: "left", label: "Lewe" },
            { value: "right", label: "Prawe" },
          ]}
          onChange={(value) => apply({ hinge: value })}
        />
      ) : (
        <p className="text-xs text-stone-500">Skrzydła podwójnych drzwi mają zawiasy po lewej i po prawej stronie.</p>
      )}
      <ErrorList errors={errors} />
      <ConfigNumberField
        field={`door-${door.id}-gap`}
        label="Szczelina obwodowa"
        value={c.gap}
        range={DOOR_RULES.gap}
        step={1}
        onCommit={(gap) => apply({ gap })}
      />
      {c.layout === "double" && (
        <ConfigNumberField
          field={`door-${door.id}-center-gap`}
          label="Szczelina między skrzydłami"
          value={c.centerGap}
          range={DOOR_RULES.centerGap}
          step={1}
          onCommit={(centerGap) => apply({ centerGap })}
        />
      )}
      <ConfigNumberField
        field={`door-${door.id}-angle`}
        label="Maksymalny kąt otwarcia"
        value={c.maxOpenAngle}
        range={DOOR_RULES.openAngle}
        step={5}
        unit="°"
        onCommit={(maxOpenAngle) => apply({ maxOpenAngle })}
      />
      <p className="text-xs tabular-nums text-stone-600">
        {c.layout === "double" ? "Skrzydło" : "Drzwi"}: {formatMm(leaves[0].box.dimensions.width)} ×{" "}
        {formatMm(leaves[0].box.dimensions.height)} mm
        {c.layout === "double" && " (×2)"}
      </p>
      <HandleEditor
        idPrefix={`door-${door.id}`}
        handle={c.handle}
        isDoor
        onChange={(patch) => update(door.id, { handle: { ...c.handle, ...patch } })}
      />
      <PreviewToggle attachment={door} model={model} />
      <RemoveButton attachment={door} />
    </div>
  );
}

function DrawerHeights({ drawer, frontHeights }: { drawer: DrawerAttachment; frontHeights: readonly number[] }) {
  const update = useConfiguratorStore((state) => state.updateDrawers);
  const setHeight = useConfiguratorStore((state) => state.setDrawerFrontHeight);
  const custom = drawer.configuration.heightRatios !== null;
  const total = frontHeights.reduce((a, b) => a + b, 0);
  const maxHeight = Math.max(DRAWER_RULES.minFrontHeight, Math.floor(total - (frontHeights.length - 1) * DRAWER_RULES.minFrontHeight));

  return (
    <div className="space-y-3">
      <SegmentedControl
        label="Wysokości frontów"
        value={custom ? "custom" : "equal"}
        options={[
          { value: "equal", label: "Równe" },
          { value: "custom", label: "Własne" },
        ]}
        onChange={(mode) =>
          update(drawer.id, {
            // Custom mode starts from the current (equal) heights as weights.
            heightRatios: mode === "equal" ? null : frontHeights.map((h) => Math.round(h * 100) / 100),
          })
        }
      />
      {custom && (
        <div className="space-y-3">
          <p className="text-xs text-stone-500">
            Różnicę przejmuje górna szuflada (przy zmianie górnej — szuflada pod nią), więc wpisuj wysokości od dołu. Łącznie: {formatMm(total)} mm.
          </p>
          {[...frontHeights.keys()].reverse().map((index) => (
            <ConfigNumberField
              key={index}
              field={`drawer-${drawer.id}-height-${index}`}
              label={`Szuflada ${index + 1}${index === 0 ? " (dół)" : index === frontHeights.length - 1 ? " (góra)" : ""}`}
              value={Math.round(frontHeights[index] * 10) / 10}
              range={{ min: DRAWER_RULES.minFrontHeight, max: maxHeight }}
              step={1}
              onCommit={(height) => setHeight(drawer.id, index, height)}
            />
          ))}
          <button
            type="button"
            onClick={() => update(drawer.id, { heightRatios: null })}
            className="w-full rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-800 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-800"
          >
            Wyrównaj wysokości
          </button>
        </div>
      )}
    </div>
  );
}

function DrawerEditor({
  drawer,
  layout,
  configuration,
  model,
}: {
  drawer: DrawerAttachment;
  layout: CompartmentLayout;
  configuration: CabinetConfiguration;
  model: FurnitureModel;
}) {
  const update = useConfiguratorStore((state) => state.updateDrawers);
  const [errors, setErrors] = useState<readonly CabinetValidationError[]>(NO_ERRORS);
  const c = drawer.configuration;
  const context = { coveringDoor: findCoveringDoor(configuration, drawer.compartmentId) };
  const available = Math.floor(getAvailableDrawerDepth(configuration, layout.bounds, c, context));
  const drawers = layoutDrawers(configuration, layout.bounds, drawer, context);
  const interior = c.placement === "interior";

  return (
    <div className="space-y-4">
      {interior ? (
        <p className="text-xs text-stone-500">
          Szuflady wewnętrzne stoją za drzwiami „{context.coveringDoor?.id}”, z frontami wpuszczanymi i luzem na zawiasy.
        </p>
      ) : (
        <SegmentedControl
          label="Montaż frontów"
          value={c.mounting}
          options={MOUNTING_OPTIONS}
          onChange={(mounting) => {
            const result = update(drawer.id, { mounting });
            setErrors(result.ok ? NO_ERRORS : result.errors);
          }}
        />
      )}
      <ErrorList errors={errors} />
      <ConfigNumberField
        field={`drawer-${drawer.id}-count`}
        label="Liczba szuflad"
        value={c.count}
        range={{ min: DRAWER_RULES.minCount, max: DRAWER_RULES.maxCount }}
        step={1}
        unit="szt."
        onCommit={(count) => update(drawer.id, { count })}
      />
      <DrawerHeights drawer={drawer} frontHeights={drawers.map((d) => d.front.dimensions.height)} />
      <ConfigNumberField
        field={`drawer-${drawer.id}-gap`}
        label="Szczelina frontów"
        value={c.frontGap}
        range={DRAWER_RULES.frontGap}
        step={1}
        onCommit={(frontGap) => update(drawer.id, { frontGap })}
      />
      <ConfigNumberField
        field={`drawer-${drawer.id}-depth`}
        label="Głębokość szuflady"
        value={c.depth}
        range={{ min: DRAWER_RULES.minDepth, max: Math.max(DRAWER_RULES.minDepth, available) }}
        step={10}
        onCommit={(depth) => update(drawer.id, { depth })}
      />
      <ul className="space-y-0.5 text-xs tabular-nums text-stone-600">
        {[...drawers].reverse().map((d) => (
          <li key={d.index}>
            Front {d.index}: {formatMm(d.front.dimensions.width)} × {formatMm(d.front.dimensions.height)} mm · skrzynka{" "}
            {formatMm(d.box.dimensions.width)} × {formatMm(d.box.dimensions.height)} × {formatMm(d.box.dimensions.depth)} mm
          </li>
        ))}
      </ul>
      <HandleEditor
        idPrefix={`drawer-${drawer.id}`}
        handle={c.handle}
        isDoor={false}
        onChange={(patch) => update(drawer.id, { handle: { ...c.handle, ...patch } })}
      />
      <PreviewToggle attachment={drawer} model={model} />
      <RemoveButton attachment={drawer} />
    </div>
  );
}

function ActionButton({ label, blocker, onClick }: { label: string; blocker: string | null; onClick: () => void }) {
  return (
    <div>
      <button
        type="button"
        disabled={blocker !== null}
        onClick={onClick}
        className="w-full rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-stone-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-900 disabled:cursor-not-allowed disabled:bg-stone-300"
      >
        {label}
      </button>
      {blocker && <p className="mt-1 text-xs text-stone-500">{blocker}</p>}
    </div>
  );
}

function AddExteriorButtons({ configuration, compartmentId }: { configuration: CabinetConfiguration; compartmentId: string }) {
  const addDoorAction = useConfiguratorStore((state) => state.addDoor);
  const addDrawersAction = useConfiguratorStore((state) => state.addDrawers);
  const blockers = useMemo(
    () => ({
      single: actionBlocker(configuration, (c) => addDoor(c, compartmentId, "single")),
      double: actionBlocker(configuration, (c) => addDoor(c, compartmentId, "double")),
      drawers: actionBlocker(configuration, (c) => addDrawers(c, compartmentId, "exterior")),
    }),
    [configuration, compartmentId],
  );
  return (
    <div className="space-y-2">
      <ActionButton label="Dodaj drzwi pojedyncze" blocker={blockers.single} onClick={() => addDoorAction(compartmentId, "single")} />
      <ActionButton label="Dodaj drzwi podwójne" blocker={blockers.double} onClick={() => addDoorAction(compartmentId, "double")} />
      <ActionButton label="Dodaj szuflady" blocker={blockers.drawers} onClick={() => addDrawersAction(compartmentId, "exterior")} />
    </div>
  );
}

function InteriorDrawersSection({
  configuration,
  layout,
  model,
}: {
  configuration: CabinetConfiguration;
  layout: CompartmentLayout;
  model: FurnitureModel;
}) {
  const addDrawersAction = useConfiguratorStore((state) => state.addDrawers);
  const interior = getInteriorDrawers(configuration, layout.id);
  const blocker = useMemo(
    () => (interior ? null : actionBlocker(configuration, (c) => addDrawers(c, layout.id, "interior"))),
    [configuration, layout.id, interior],
  );
  return (
    <div className="space-y-3 border-t border-stone-200 pt-3">
      <p className="text-sm font-medium text-stone-900">Szuflady wewnętrzne</p>
      {interior ? (
        <DrawerEditor key={interior.id} drawer={interior} layout={layout} configuration={configuration} model={model} />
      ) : (
        <ActionButton label="Dodaj szuflady wewnętrzne" blocker={blocker} onClick={() => addDrawersAction(layout.id, "interior")} />
      )}
    </div>
  );
}

export function AttachmentsPanel() {
  const configuration = useConfiguratorStore((state) => state.configuration);
  const selectedId = useConfiguratorStore((state) => state.selectedCompartmentId);
  const rejection = useConfiguratorStore((state) => (state.rejection?.source === "attachments" ? state.rejection : null));
  const openCount = usePreviewStore((state) => state.openAttachmentIds.size);
  const setOpen = usePreviewStore((state) => state.setOpen);
  const closeAll = usePreviewStore((state) => state.closeAll);
  const select = useConfiguratorStore((state) => state.selectCompartment);
  const model = useMemo(() => buildFurniture(configuration), [configuration]);

  const layout = useMemo(
    () => (selectedId ? calculateCompartmentBounds(configuration).find((l) => l.id === selectedId) : undefined),
    [configuration, selectedId],
  );
  const attachment = selectedId ? getAttachmentForCompartment(configuration, selectedId) : null;
  // An exterior front on an enclosing compartment covers this one (and everything inside it).
  const covering = selectedId && !attachment ? getCoveringAttachment(configuration, selectedId) : null;
  const coveringDoor = selectedId ? findCoveringDoor(configuration, selectedId) : null;
  const rootId = configuration.compartments.id;
  // Interior drawers are possible in an undivided compartment behind a door (not behind exterior drawers).
  const interiorPossible = layout?.isLeaf && coveringDoor !== null && attachment?.type !== "drawer";
  const allIds = configuration.attachments.map((a) => a.id);

  return (
    <section aria-labelledby="attachments-heading" className="space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <SectionHeading id="attachments-heading">Drzwi i szuflady</SectionHeading>
        {allIds.length > 0 && (
          <button
            type="button"
            onClick={() => (openCount > 0 ? closeAll() : setOpen(allIds, true))}
            className="text-xs font-medium text-stone-600 underline underline-offset-2 hover:text-stone-900"
          >
            {openCount > 0 ? "Zamknij wszystkie" : "Otwórz wszystkie"}
          </button>
        )}
      </div>

      {!layout ? (
        <p className="text-xs text-stone-500">Zaznacz przedział, aby dodać drzwi lub szuflady.</p>
      ) : (
        <div className="space-y-4 rounded-lg border border-stone-200 p-3">
          <div>
            <p className="text-sm font-medium text-stone-900">{compartmentLabel(layout.id, rootId)}</p>
            <p className="text-xs tabular-nums text-stone-600">
              Otwór: {formatMm(layout.bounds.dimensions.width)} × {formatMm(layout.bounds.dimensions.height)} ×{" "}
              {formatMm(layout.bounds.dimensions.depth)} mm
              {!layout.isLeaf && " · z półkami lub przegrodami"}
            </p>
          </div>
          {covering && (
            <div className="space-y-2 rounded-md bg-stone-50 p-2 text-xs text-stone-600">
              <p>
                Ten przedział jest za {covering.type === "door" ? "drzwiami" : "frontem"} „{covering.id}”, które zakrywają{" "}
                {compartmentLabel(covering.compartmentId, rootId).toLowerCase()}. Półki, przegrody i szuflady wewnętrzne można tu
                dodawać normalnie.
              </p>
              <button
                type="button"
                onClick={() => select(covering.compartmentId)}
                className="font-medium text-stone-800 underline underline-offset-2 hover:text-stone-950"
              >
                Edytuj drzwi „{covering.id}”
              </button>
            </div>
          )}
          {!attachment && !covering && <AddExteriorButtons configuration={configuration} compartmentId={layout.id} />}
          {attachment?.type === "door" && (
            <DoorEditor key={attachment.id} door={attachment} layout={layout} configuration={configuration} model={model} />
          )}
          {attachment?.type === "drawer" && (
            <DrawerEditor key={attachment.id} drawer={attachment} layout={layout} configuration={configuration} model={model} />
          )}
          {interiorPossible && <InteriorDrawersSection configuration={configuration} layout={layout} model={model} />}
        </div>
      )}

      {rejection && <ErrorList errors={rejection.errors} />}
    </section>
  );
}
