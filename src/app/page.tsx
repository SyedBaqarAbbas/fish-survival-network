import { EvolutionLab } from "@/components/EvolutionLab/EvolutionLab";
import { getStarterReplaySource } from "@/starter/server";

export default function HomePage() {
  return <EvolutionLab starterReplaySource={getStarterReplaySource()} />;
}
