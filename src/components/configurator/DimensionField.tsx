"use client";

import { useState } from "react";
import type { CabinetValidationError } from "@/domain/constraints/validateCabinet";
import { getNumericField, getNumericFieldRange } from "@/domain/furniture/fields";
import type { DimensionRange, NumericField } from "@/domain/furniture/types";
import { useConfiguratorStore } from "@/store/useConfiguratorStore";

interface DimensionFieldProps<F extends string> {
  /** Identifies the value; also used to derive the input id. */
  field: F;
  label: string;
  value: number;
  range: DimensionRange;
  sliderStep: number;
  errors: readonly CabinetValidationError[];
  onChange: (field: F, value: number) => void;
  /** Slider step; integers only when 1. */
  inputStep?: number;
  /** Unit shown after the value and the range; millimeters by default. */
  unit?: string;
}

const NO_ERRORS: readonly CabinetValidationError[] = [];

function parseMillimeters(text: string): number {
  return text.trim() === "" ? Number.NaN : Number(text);
}

function formatMillimeters(value: number): string {
  return Number.isFinite(value) ? String(value) : "";
}

export function DimensionField<F extends string>({
  field,
  label,
  value,
  range,
  sliderStep,
  errors,
  onChange,
  inputStep = 1,
  unit = "mm",
}: DimensionFieldProps<F>) {
  const inputId = `dimension-${field.replaceAll(".", "-")}`;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const invalid = errors.length > 0;

  // Keep the raw text locally so partial input ("", "1.") can be typed freely,
  // and resync it when the value changes from outside (slider, reset, import).
  const [text, setText] = useState(() => formatMillimeters(value));
  const [syncedValue, setSyncedValue] = useState(value);
  if (!Object.is(value, syncedValue)) {
    setSyncedValue(value);
    if (!Object.is(parseMillimeters(text), value)) setText(formatMillimeters(value));
  }

  // The slider is only a visual control; out-of-range values are shown as errors, not clamped.
  const sliderValue = Number.isFinite(value) ? Math.min(Math.max(value, range.min), range.max) : range.min;

  return (
    <div className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={inputId} className="text-sm font-medium text-stone-800">
          {label}
        </label>
        <span id={hintId} className="text-xs tabular-nums text-stone-500">
          {range.min}–{range.max} {unit}
        </span>
      </div>

      <div
        className={`flex items-center rounded-lg border bg-white transition-colors focus-within:ring-2 ${
          invalid
            ? "border-red-400 focus-within:ring-red-200"
            : "border-stone-300 focus-within:border-stone-500 focus-within:ring-stone-200"
        }`}
      >
        <input
          id={inputId}
          type="number"
          inputMode="decimal"
          min={range.min}
          max={range.max}
          step={inputStep}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            onChange(field, parseMillimeters(event.target.value));
          }}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${hintId} ${errorId}` : hintId}
          className="w-full min-w-0 bg-transparent px-3 py-2 text-base tabular-nums text-stone-900 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <span className="select-none pr-3 text-sm text-stone-500" aria-hidden="true">
          {unit}
        </span>
      </div>

      <input
        type="range"
        min={range.min}
        max={range.max}
        step={sliderStep}
        value={sliderValue}
        onChange={(event) => onChange(field, Number(event.target.value))}
        aria-label={`${label} – suwak`}
        className="h-1.5 w-full cursor-pointer accent-stone-800"
      />

      {invalid && (
        <ul id={errorId} className="space-y-0.5 text-xs text-red-600" aria-live="polite">
          {errors.map((error, index) => (
            <li key={`${error.code}-${index}`}>{error.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * A DimensionField bound to the store: shows the rejected value with its errors while one is
 * pending, otherwise the committed value. Subscribes only to its own field.
 */
export function NumericFieldControl({ field, label, sliderStep }: { field: NumericField; label: string; sliderStep: number }) {
  const committed = useConfiguratorStore((state) => getNumericField(state.configuration, field));
  const pending = useConfiguratorStore((state) => state.pendingInputs[field]);
  const setNumericField = useConfiguratorStore((state) => state.setNumericField);

  return (
    <DimensionField
      field={field}
      label={label}
      value={pending ? pending.value : committed}
      range={getNumericFieldRange(field)}
      sliderStep={sliderStep}
      errors={pending?.errors ?? NO_ERRORS}
      onChange={setNumericField}
    />
  );
}
