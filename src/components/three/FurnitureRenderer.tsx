"use client";

import { useMemo } from "react";
import { buildCabinet } from "@/domain/geometry/buildCabinet";
import { useConfiguratorStore } from "@/store/useConfiguratorStore";
import { CompartmentRegions } from "./CompartmentRegions";
import { PanelMesh } from "./PanelMesh";
import { mmToM } from "./units";

/**
 * Renders the committed configuration. Rejected user input never reaches the store's
 * configuration, so the model stays intact while the form shows errors.
 */
export function FurnitureRenderer() {
  const configuration = useConfiguratorStore((state) => state.configuration);
  const panels = useMemo(() => buildCabinet(configuration), [configuration]);

  return (
    // Domain origin is the lower-left-back corner; center the cabinet on the floor origin.
    <group position={[-mmToM(configuration.width) / 2, 0, -mmToM(configuration.depth) / 2]}>
      {panels.map((panel) => (
        <PanelMesh key={panel.id} panel={panel} />
      ))}
      <CompartmentRegions />
    </group>
  );
}
