"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import {
  ReplayClient,
  REPLAY_FISH_COUNT,
  type ReplayActivationEvent,
  type ReplayEpisodeEndEvent,
  type ReplayMappingEvent,
  type ReplaySource,
  type ReplaySpeed,
} from "@/replay";

import styles from "./ReplayTank.module.css";

type ReplayTankStatus = "error" | "loading" | "paused" | "playing";

export interface ReplayTankHandle {
  pause: () => void;
  play: () => void;
  restart: () => void;
  select: (fishIndex: number | null) => void;
  setEffectsEnabled: (enabled: boolean) => void;
  setSpeed: (speed: ReplaySpeed) => void;
}

export interface ReplayTankProps {
  enabled?: boolean;
  effectsEnabled?: boolean;
  onActivation?: (event: Readonly<ReplayActivationEvent>) => void;
  onAliveCountChange?: (aliveCount: number) => void;
  onEpisodeEnd?: (event: Readonly<ReplayEpisodeEndEvent>) => void;
  onError?: (error: Error) => void;
  onMapping?: (event: Readonly<ReplayMappingEvent>) => void;
  onSelectionChange?: (fishIndex: number, genomeId: string) => void;
  playing?: boolean;
  replaySeed?: number;
  source: ReplaySource;
  speed?: ReplaySpeed;
}

function errorFrom(value: unknown) {
  return value instanceof Error ? value : new Error(String(value));
}

export const ReplayTank = forwardRef<ReplayTankHandle, ReplayTankProps>(
  function ReplayTank(
    {
      enabled = true,
      effectsEnabled = true,
      onActivation,
      onAliveCountChange,
      onEpisodeEnd,
      onError,
      onMapping,
      onSelectionChange,
      playing = true,
      replaySeed = 42,
      source,
      speed = 1,
    },
    ref,
  ) {
    const hostRef = useRef<HTMLDivElement>(null);
    const clientRef = useRef<ReplayClient | undefined>(undefined);
    const rendererRef = useRef<
      import("@/rendering").PixiReplayRenderer | undefined
    >(undefined);
    const sourceRef = useRef(source);
    const replaySeedRef = useRef(replaySeed);
    const playingRef = useRef(playing);
    const speedRef = useRef(speed);
    const effectsEnabledRef = useRef(effectsEnabled);
    const loadedSourceKeyRef = useRef<string | undefined>(undefined);
    const aliveCountRef = useRef<number>(REPLAY_FISH_COUNT);
    const callbacksRef = useRef({
      onActivation,
      onAliveCountChange,
      onEpisodeEnd,
      onError,
      onMapping,
      onSelectionChange,
    });
    const [status, setStatus] = useState<ReplayTankStatus>("loading");
    const [error, setError] = useState<string | undefined>(undefined);

    callbacksRef.current = {
      onActivation,
      onAliveCountChange,
      onEpisodeEnd,
      onError,
      onMapping,
      onSelectionChange,
    };
    sourceRef.current = source;
    replaySeedRef.current = replaySeed;

    const reportError = useCallback((value: unknown) => {
      const nextError = errorFrom(value);
      setError(nextError.message);
      setStatus("error");
      callbacksRef.current.onError?.(nextError);
    }, []);

    const loadCurrentSource = useCallback((client: ReplayClient) => {
      const currentSource = sourceRef.current;
      const currentSeed = replaySeedRef.current;
      const key = `${currentSource.sourceId}:${currentSeed}`;
      if (loadedSourceKeyRef.current === key) return;
      loadedSourceKeyRef.current = key;
      client.load(currentSource, currentSeed);
      if (playingRef.current) client.play();
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        pause() {
          playingRef.current = false;
          rendererRef.current?.setPlaying(false);
          clientRef.current?.pause();
          setStatus((current) => (current === "error" ? current : "paused"));
        },
        play() {
          playingRef.current = true;
          rendererRef.current?.setPlaying(true);
          clientRef.current?.play();
          setStatus((current) => (current === "error" ? current : "playing"));
        },
        restart() {
          const client = clientRef.current;
          if (!client) return;
          loadCurrentSource(client);
          client.restart();
        },
        select(fishIndex) {
          rendererRef.current?.setSelectedIndex(fishIndex);
          clientRef.current?.select(fishIndex);
        },
        setEffectsEnabled(enabled) {
          effectsEnabledRef.current = enabled;
          rendererRef.current?.setEffectsEnabled(enabled);
        },
        setSpeed(nextSpeed) {
          speedRef.current = nextSpeed;
          rendererRef.current?.setSpeed(nextSpeed);
          clientRef.current?.setSpeed(nextSpeed);
        },
      }),
      [loadCurrentSource],
    );

    useEffect(() => {
      if (!enabled) return;

      let cancelled = false;
      let client: ReplayClient | undefined;
      let renderer: import("@/rendering").PixiReplayRenderer | undefined;
      let unsubscribeEvents: (() => void) | undefined;
      let unsubscribeSnapshots: (() => void) | undefined;

      async function initialize() {
        const host = hostRef.current;
        if (!host) return;
        if (typeof Worker === "undefined") {
          reportError(new Error("Replay workers are unavailable in this browser."));
          return;
        }

        try {
          const { PixiReplayRenderer } = await import("@/rendering");
          if (cancelled) return;

          renderer = new PixiReplayRenderer({
            effectsEnabled: effectsEnabledRef.current,
            onError: reportError,
            onSelect: (fishIndex, genomeId) => {
              client?.select(fishIndex);
              callbacksRef.current.onSelectionChange?.(fishIndex, genomeId);
            },
          });
          rendererRef.current = renderer;
          await renderer.init(host);
          if (cancelled) {
            renderer.destroy();
            return;
          }

          client = new ReplayClient();
          clientRef.current = client;
          unsubscribeEvents = client.subscribe((event) => {
            if (cancelled || event.type === "SNAPSHOT") return;
            switch (event.type) {
              case "MAPPING":
                aliveCountRef.current = REPLAY_FISH_COUNT;
                renderer?.pushMapping(event);
                renderer?.setPlaying(playingRef.current);
                renderer?.setSpeed(speedRef.current);
                renderer?.setEffectsEnabled(effectsEnabledRef.current);
                setError(undefined);
                setStatus(playingRef.current ? "playing" : "paused");
                callbacksRef.current.onAliveCountChange?.(REPLAY_FISH_COUNT);
                callbacksRef.current.onMapping?.(event);
                break;
              case "CATCH":
                renderer?.handleCatch(event);
                break;
              case "ACTIVATION":
                callbacksRef.current.onActivation?.(event);
                break;
              case "EPISODE_END":
                aliveCountRef.current = event.survivors;
                callbacksRef.current.onAliveCountChange?.(event.survivors);
                callbacksRef.current.onEpisodeEnd?.(event);
                break;
              case "ERROR": {
                const replayError = new Error(event.message);
                if (event.recoverable) {
                  callbacksRef.current.onError?.(replayError);
                } else {
                  reportError(replayError);
                }
                break;
              }
            }
          });
          unsubscribeSnapshots = client.subscribeSnapshots((snapshot) => {
            if (cancelled) return;
            renderer?.pushSnapshot(snapshot);
            let aliveCount = 0;
            for (const alive of snapshot.alive) aliveCount += alive;
            if (aliveCount !== aliveCountRef.current) {
              aliveCountRef.current = aliveCount;
              callbacksRef.current.onAliveCountChange?.(aliveCount);
            }
          });

          client.setSpeed(speedRef.current);
          loadCurrentSource(client);
        } catch (caught) {
          if (!cancelled) reportError(caught);
        }
      }

      void initialize();

      return () => {
        cancelled = true;
        unsubscribeEvents?.();
        unsubscribeSnapshots?.();
        client?.dispose();
        renderer?.destroy();
        if (clientRef.current === client) clientRef.current = undefined;
        if (rendererRef.current === renderer) rendererRef.current = undefined;
        loadedSourceKeyRef.current = undefined;
      };
    }, [enabled, loadCurrentSource, reportError]);

    useEffect(() => {
      const client = clientRef.current;
      if (client) loadCurrentSource(client);
    }, [loadCurrentSource, source, replaySeed]);

    useEffect(() => {
      playingRef.current = playing;
      rendererRef.current?.setPlaying(playing);
      if (playing) {
        clientRef.current?.play();
      } else {
        clientRef.current?.pause();
      }
      setStatus((current) =>
        current === "loading" || current === "error"
          ? current
          : playing
            ? "playing"
            : "paused",
      );
    }, [playing]);

    useEffect(() => {
      speedRef.current = speed;
      rendererRef.current?.setSpeed(speed);
      clientRef.current?.setSpeed(speed);
    }, [speed]);

    useEffect(() => {
      effectsEnabledRef.current = effectsEnabled;
      rendererRef.current?.setEffectsEnabled(effectsEnabled);
    }, [effectsEnabled]);

    return (
      <div className={styles.root} data-replay-state={status}>
        <div className={styles.canvasHost} data-testid="replay-canvas-host" ref={hostRef} />
        {status === "loading" ? (
          <div aria-label="Loading replay" className={styles.loading} role="status" />
        ) : null}
        {status === "error" ? (
          <p className={styles.error} role="alert" title={error}>
            Replay unavailable
          </p>
        ) : null}
      </div>
    );
  },
);
