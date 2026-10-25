import type { Metadata } from "next";
import { Configurator } from "@/components/configurator/Configurator";

export const metadata: Metadata = {
  title: "Konfigurator szafki",
  description: "Skonfiguruj wymiary, podział wnętrza i wykończenie szafki modułowej w 3D.",
};

export default function ConfiguratorPage() {
  return <Configurator />;
}
