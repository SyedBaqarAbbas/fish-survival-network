"use client";

import { X } from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import styles from "./LabSettings.module.css";

export interface LabSettingsValue {
  runSeed: number;
  populationSize: 64 | 128 | 256;
  episodesPerGenome: 4 | 8;
  mutationProbability: number;
  mutationStandardDeviation: number;
  automaticCurriculum: boolean;
  manualLevel: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  reducedEffects: boolean;
}

export interface LabSettingsProps {
  open: boolean;
  value: Readonly<LabSettingsValue>;
  onApply: (value: LabSettingsValue) => void;
  onClose: () => void;
}

const POPULATION_OPTIONS = [64, 128, 256] as const;
const EPISODE_OPTIONS = [4, 8] as const;
const LEVEL_OPTIONS = [0, 1, 2, 3, 4, 5, 6] as const;

type SettingsDialogProps = Omit<LabSettingsProps, "open">;

function SettingsDialog({ value, onApply, onClose }: SettingsDialogProps) {
  const [draft, setDraft] = useState<LabSettingsValue>(() => ({ ...value }));
  const [runSeedInput, setRunSeedInput] = useState(() => String(value.runSeed));
  const drawerRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement;
    closeButtonRef.current?.focus();

    return () => {
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, []);

  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    }

    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab") return;
    const focusable = drawerRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const runSeed = Number(runSeedInput);
    if (!Number.isSafeInteger(runSeed) || runSeed < 0 || runSeed > 0xffff_ffff) return;
    onApply({ ...draft, runSeed });
  }

  return (
    <div
      className={styles.overlay}
      data-testid="lab-settings-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        aria-labelledby="lab-settings-title"
        aria-modal="true"
        className={styles.drawer}
        onKeyDown={handleDialogKeyDown}
        ref={drawerRef}
        role="dialog"
      >
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Lab controls</p>
            <h2 id="lab-settings-title">Settings</h2>
          </div>
          <button
            aria-label="Close settings"
            className={styles.iconButton}
            onClick={onClose}
            ref={closeButtonRef}
            title="Close settings"
            type="button"
          >
            <X aria-hidden="true" size={19} strokeWidth={1.8} />
          </button>
        </header>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.formBody}>
            <fieldset className={styles.group}>
              <legend>Training run</legend>

              <div className={styles.field}>
                <label htmlFor="lab-run-seed">Run seed</label>
                <input
                  id="lab-run-seed"
                  max={0xffff_ffff}
                  min={0}
                  onChange={(event) => setRunSeedInput(event.currentTarget.value)}
                  required
                  step={1}
                  type="number"
                  value={runSeedInput}
                />
              </div>

              <div className={styles.fieldGrid}>
                <div className={styles.field}>
                  <label htmlFor="lab-population-size">Population</label>
                  <select
                    id="lab-population-size"
                    onChange={(event) => {
                      const populationSize = Number(event.currentTarget.value) as
                        | 64
                        | 128
                        | 256;
                      setDraft((current) => ({
                        ...current,
                        populationSize,
                      }));
                    }}
                    value={draft.populationSize}
                  >
                    {POPULATION_OPTIONS.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.field}>
                  <label htmlFor="lab-episode-count">Episodes</label>
                  <select
                    id="lab-episode-count"
                    onChange={(event) => {
                      const episodesPerGenome = Number(event.currentTarget.value) as 4 | 8;
                      setDraft((current) => ({
                        ...current,
                        episodesPerGenome,
                      }));
                    }}
                    value={draft.episodesPerGenome}
                  >
                    {EPISODE_OPTIONS.map((count) => (
                      <option key={count} value={count}>
                        {count}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className={styles.field}>
                <div className={styles.labelRow}>
                  <label htmlFor="lab-mutation-probability">
                    Mutation probability
                  </label>
                  <output
                    aria-live="polite"
                    htmlFor="lab-mutation-probability"
                  >
                    {draft.mutationProbability.toFixed(2)}
                  </output>
                </div>
                <input
                  className={styles.range}
                  id="lab-mutation-probability"
                  max={1}
                  min={0}
                  onChange={(event) => {
                    const mutationProbability = event.currentTarget.valueAsNumber;
                    setDraft((current) => ({
                      ...current,
                      mutationProbability,
                    }));
                  }}
                  step={0.01}
                  type="range"
                  value={draft.mutationProbability}
                />
              </div>

              <div className={styles.field}>
                <div className={styles.labelRow}>
                  <label htmlFor="lab-mutation-deviation">
                    Mutation deviation
                  </label>
                  <output
                    aria-live="polite"
                    htmlFor="lab-mutation-deviation"
                  >
                    {draft.mutationStandardDeviation.toFixed(2)}
                  </output>
                </div>
                <input
                  className={styles.range}
                  id="lab-mutation-deviation"
                  max={1}
                  min={0}
                  onChange={(event) => {
                    const mutationStandardDeviation = event.currentTarget.valueAsNumber;
                    setDraft((current) => ({
                      ...current,
                      mutationStandardDeviation,
                    }));
                  }}
                  step={0.01}
                  type="range"
                  value={draft.mutationStandardDeviation}
                />
              </div>

              <div className={styles.switchRow}>
                <label htmlFor="lab-automatic-curriculum">
                  Automatic curriculum
                </label>
                <input
                  checked={draft.automaticCurriculum}
                  className={styles.switch}
                  id="lab-automatic-curriculum"
                  onChange={(event) => {
                    const automaticCurriculum = event.currentTarget.checked;
                    setDraft((current) => ({
                      ...current,
                      automaticCurriculum,
                    }));
                  }}
                  role="switch"
                  type="checkbox"
                />
              </div>

              <div className={styles.field}>
                <label htmlFor="lab-manual-level">Manual level</label>
                <select
                  disabled={draft.automaticCurriculum}
                  id="lab-manual-level"
                  onChange={(event) => {
                    const manualLevel = Number(event.currentTarget.value) as
                      | 0
                      | 1
                      | 2
                      | 3
                      | 4
                      | 5
                      | 6;
                    setDraft((current) => ({
                      ...current,
                      manualLevel,
                    }));
                  }}
                  value={draft.manualLevel}
                >
                  {LEVEL_OPTIONS.map((level) => (
                    <option key={level} value={level}>
                      Level {level}
                    </option>
                  ))}
                </select>
              </div>
            </fieldset>

            <fieldset className={styles.group}>
              <legend>Replay</legend>
              <div className={styles.switchRow}>
                <label htmlFor="lab-reduced-effects">Reduced effects</label>
                <input
                  checked={draft.reducedEffects}
                  className={styles.switch}
                  id="lab-reduced-effects"
                  onChange={(event) => {
                    const reducedEffects = event.currentTarget.checked;
                    setDraft((current) => ({
                      ...current,
                      reducedEffects,
                    }));
                  }}
                  role="switch"
                  type="checkbox"
                />
              </div>
            </fieldset>
          </div>

          <footer className={styles.actions}>
            <button className={styles.secondaryButton} onClick={onClose} type="button">
              Cancel
            </button>
            <button className={styles.primaryButton} type="submit">
              Apply
            </button>
          </footer>
        </form>
      </aside>
    </div>
  );
}

export function LabSettings({ open, value, onApply, onClose }: LabSettingsProps) {
  if (!open) return null;
  return <SettingsDialog onApply={onApply} onClose={onClose} value={value} />;
}
