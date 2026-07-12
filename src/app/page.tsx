import { EvolutionLab } from "@/components/EvolutionLab/EvolutionLab";
import {
  getStarterMetricHistory,
  getStarterReplaySource,
} from "@/starter/server";

export default function HomePage() {
  return (
    <EvolutionLab
      starterMetricHistory={getStarterMetricHistory()}
      starterReplaySource={getStarterReplaySource()}
    />
  );
}
