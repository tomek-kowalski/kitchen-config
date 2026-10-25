import { CABINET_LIMITS, CONSTRUCTION_LIMITS } from "./defaults";
import type { CabinetConfiguration, DimensionRange, NumericField } from "./types";

export function getNumericField(configuration: CabinetConfiguration, field: NumericField): number {
  switch (field) {
    case "backPanel.thickness":
      return configuration.backPanel.thickness;
    case "plinth.height":
      return configuration.plinth.height;
    case "plinth.setback":
      return configuration.plinth.setback;
    default:
      return configuration[field];
  }
}

/** Returns a new configuration with one numeric value replaced; the input is never mutated. */
export function setNumericField(
  configuration: CabinetConfiguration,
  field: NumericField,
  value: number,
): CabinetConfiguration {
  switch (field) {
    case "backPanel.thickness":
      return { ...configuration, backPanel: { ...configuration.backPanel, thickness: value } };
    case "plinth.height":
      return { ...configuration, plinth: { ...configuration.plinth, height: value } };
    case "plinth.setback":
      return { ...configuration, plinth: { ...configuration.plinth, setback: value } };
    default:
      return { ...configuration, [field]: value };
  }
}

export function getNumericFieldRange(field: NumericField): DimensionRange {
  switch (field) {
    case "backPanel.thickness":
      return CONSTRUCTION_LIMITS.backPanelThickness;
    case "plinth.height":
      return CONSTRUCTION_LIMITS.plinthHeight;
    case "plinth.setback":
      return CONSTRUCTION_LIMITS.plinthSetback;
    default:
      return CABINET_LIMITS[field];
  }
}
