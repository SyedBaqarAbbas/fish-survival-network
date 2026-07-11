"use client";

import { useTrainerWorker } from "@/workers/useTrainerWorker";

import styles from "./EvolutionLab.module.css";

const INPUT_NODES = 11;
const HIDDEN_NODES = 8;
const OUTPUT_NODES = 2;

const statusLabels = {
  error: "Error",
  ready: "Ready",
  starting: "Starting",
  unsupported: "Unavailable",
} as const;

function distributeNodes(count: number, height: number) {
  return Array.from({ length: count }, (_, index) =>
    count === 1 ? height / 2 : 28 + (index * (height - 56)) / (count - 1),
  );
}

function NetworkScaffold() {
  const height = 220;
  const inputY = distributeNodes(INPUT_NODES, height);
  const hiddenY = distributeNodes(HIDDEN_NODES, height);
  const outputY = distributeNodes(OUTPUT_NODES, height);

  return (
    <svg
      aria-label="Eleven input, eight hidden, and two output neuron topology"
      className={styles.network}
      role="img"
      viewBox={`0 0 720 ${height}`}
    >
      <g className={styles.edges}>
        {inputY.flatMap((sourceY, inputIndex) =>
          hiddenY.map((targetY, hiddenIndex) => (
            <line
              key={`ih-${inputIndex}-${hiddenIndex}`}
              x1="92"
              x2="360"
              y1={sourceY}
              y2={targetY}
            />
          )),
        )}
        {hiddenY.flatMap((sourceY, hiddenIndex) =>
          outputY.map((targetY, outputIndex) => (
            <line
              key={`ho-${hiddenIndex}-${outputIndex}`}
              x1="360"
              x2="628"
              y1={sourceY}
              y2={targetY}
            />
          )),
        )}
      </g>
      <g className={styles.nodes}>
        {inputY.map((y, index) => (
          <circle cx="92" cy={y} key={`input-${index}`} r="5" />
        ))}
        {hiddenY.map((y, index) => (
          <circle cx="360" cy={y} key={`hidden-${index}`} r="5" />
        ))}
        {outputY.map((y, index) => (
          <circle cx="628" cy={y} key={`output-${index}`} r="7" />
        ))}
      </g>
      <g className={styles.networkLabels}>
        <text x="16" y="18">inputs</text>
        <text x="330" y="18">hidden</text>
        <text x="645" y="18">steering</text>
      </g>
    </svg>
  );
}

export function EvolutionLab() {
  const worker = useTrainerWorker();

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Neuroevolution lab</p>
          <h1>Fish Survival Network</h1>
        </div>
        <div
          aria-live="polite"
          className={styles.workerStatus}
          data-state={worker.status}
          data-testid="worker-status"
          title={worker.error}
        >
          <span aria-hidden="true" className={styles.statusDot} />
          <span>
            <small>Training worker</small>
            <strong>{statusLabels[worker.status]}</strong>
          </span>
        </div>
      </header>

      <section aria-labelledby="network-heading" className={styles.networkPanel}>
        <header className={styles.sectionHeader}>
          <h2 id="network-heading">Neural policy</h2>
          <span>11 → 8 → 2</span>
        </header>
        <NetworkScaffold />
      </section>

      <div className={styles.levelBand}>
        <span>Level</span>
        <strong>0 / 6</strong>
        <span>Bias only</span>
      </div>

      <section aria-labelledby="tank-heading" className={styles.tank}>
        <header className={styles.tankHeader}>
          <h2 id="tank-heading">Replay</h2>
          <span>
            <strong>0</strong> / 48 fish left
          </span>
        </header>
        <div className={styles.tankBody}>
          <div aria-hidden="true" className={styles.fishMark} />
          <p>Simulation idle</p>
        </div>
      </section>

      <footer className={styles.metrics}>
        <span>Generation <strong>—</strong></span>
        <span>Best <strong>—</strong></span>
        <span>Mean <strong>—</strong></span>
      </footer>
    </main>
  );
}
