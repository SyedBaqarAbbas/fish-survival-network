export interface SimulationPreparationSample {
  completedGenomes: number;
  elapsedMilliseconds: number;
  previousDurationMilliseconds?: number;
  totalGenomes: number;
}

function isNonnegativeFinite(value: number) {
  return Number.isFinite(value) && value >= 0;
}

export function estimateSimulationRemainingMilliseconds({
  completedGenomes,
  elapsedMilliseconds,
  previousDurationMilliseconds,
  totalGenomes,
}: Readonly<SimulationPreparationSample>): number | null {
  if (
    !Number.isSafeInteger(completedGenomes) ||
    !Number.isSafeInteger(totalGenomes) ||
    completedGenomes < 0 ||
    totalGenomes <= 0 ||
    completedGenomes > totalGenomes ||
    !isNonnegativeFinite(elapsedMilliseconds)
  ) {
    return null;
  }
  if (completedGenomes === totalGenomes) return 0;
  if (completedGenomes > 0 && elapsedMilliseconds > 0) {
    return (
      (elapsedMilliseconds * (totalGenomes - completedGenomes)) /
      completedGenomes
    );
  }
  if (
    previousDurationMilliseconds !== undefined &&
    isNonnegativeFinite(previousDurationMilliseconds) &&
    previousDurationMilliseconds > 0
  ) {
    return (
      (previousDurationMilliseconds * (totalGenomes - completedGenomes)) /
      totalGenomes
    );
  }
  return null;
}

export function formatSimulationEta(milliseconds: number | null) {
  if (milliseconds === null || !isNonnegativeFinite(milliseconds)) {
    return "Estimating";
  }
  if (milliseconds < 1_000) return "< 1 sec";

  const seconds = Math.ceil(milliseconds / 1_000);
  if (seconds < 60) return `${seconds} sec`;

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds === 0
    ? `${minutes} min`
    : `${minutes} min ${remainingSeconds} sec`;
}
