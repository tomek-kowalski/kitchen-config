"use client";

import { useRef, useState } from "react";
import { exportCabinetJson, importCabinetJson, type CabinetImportIssue } from "@/domain/serialization/cabinetJson";
import { useConfiguratorStore } from "@/store/useConfiguratorStore";
import { ErrorList, SectionHeading } from "./SectionHeading";

const MAX_FILE_BYTES = 1_000_000;
const EXPORT_FILE_NAME = "konfiguracja-szafki.json";

type ImportStatus =
  | { kind: "success"; message: string }
  | { kind: "error"; issues: readonly CabinetImportIssue[] }
  | null;

function downloadJson(json: string) {
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = EXPORT_FILE_NAME;
  link.click();
  URL.revokeObjectURL(url);
}

export function ConfigurationFilePanel() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<ImportStatus>(null);

  const importFile = async (file: File) => {
    if (file.size > MAX_FILE_BYTES) {
      setStatus({ kind: "error", issues: [{ path: "", message: "Plik jest zbyt duży, aby mógł być konfiguracją." }] });
      return;
    }
    const result = importCabinetJson(await file.text());
    if (!result.ok) {
      setStatus({ kind: "error", issues: result.issues });
      return;
    }
    // Replacement is all-or-nothing: on failure the current configuration stays untouched.
    const commit = useConfiguratorStore.getState().replaceConfiguration(result.configuration);
    setStatus(
      commit.ok
        ? {
            kind: "success",
            message: `Zaimportowano plik ${file.name}${result.migratedFrom ? ` (zaktualizowano z wersji formatu ${result.migratedFrom})` : ""}.`,
          }
        : { kind: "error", issues: commit.errors.map((e) => ({ path: e.field, message: e.message })) },
    );
  };

  return (
    <section aria-labelledby="file-heading" className="space-y-3">
      <SectionHeading id="file-heading">Plik konfiguracji</SectionHeading>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => {
            downloadJson(exportCabinetJson(useConfiguratorStore.getState().configuration));
            setStatus(null);
          }}
          className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-800 transition-colors hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-800"
        >
          Eksportuj JSON
        </button>
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          className="rounded-lg border border-stone-300 px-3 py-2 text-sm font-medium text-stone-800 transition-colors hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-800"
        >
          Importuj JSON
        </button>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        aria-label="Plik konfiguracji do zaimportowania"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Reset so that selecting the same file again triggers another import.
          event.target.value = "";
          if (file) void importFile(file);
        }}
      />
      {status?.kind === "success" && (
        <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          {status.message}
        </p>
      )}
      {status?.kind === "error" && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-red-700">Import nie powiódł się — zachowano bieżącą konfigurację.</p>
          <ErrorList errors={status.issues.map((i) => ({ message: i.path ? `${i.path}: ${i.message}` : i.message }))} />
        </div>
      )}
    </section>
  );
}
