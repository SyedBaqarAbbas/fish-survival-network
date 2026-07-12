import { act, render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReplaySource } from "@/replay";

const fakes = vi.hoisted(() => {
  class FakeReplayClient {
    disposed = false;
    loaded = false;
    loadedSourceIds: string[] = [];
    operations: string[] = [];
    played = false;

    constructor() {
      fakes.clients.push(this);
    }

    subscribe() {
      return () => undefined;
    }

    subscribeSnapshots() {
      return () => undefined;
    }

    load(source: ReplaySource) {
      this.loaded = true;
      this.loadedSourceIds.push(source.sourceId);
      this.operations.push(`load:${source.sourceId}`);
    }

    play() {
      this.played = true;
    }

    pause() {}
    restart() {
      this.operations.push("restart");
    }
    select() {}
    setSpeed() {}

    dispose() {
      this.disposed = true;
    }
  }

  class FakeRenderer {
    destroyed = false;

    constructor() {
      fakes.renderers.push(this);
    }

    async init(host: HTMLElement) {
      const canvas = document.createElement("canvas");
      canvas.dataset.ready = "true";
      canvas.setAttribute("aria-label", "Fish survival replay");
      canvas.setAttribute("role", "img");
      host.replaceChildren(canvas);
    }

    pushMapping() {}
    pushSnapshot() {}
    handleCatch() {}
    setSelectedIndex() {}
    setPlaying() {}
    setSpeed() {}
    setEffectsEnabled() {}

    destroy() {
      this.destroyed = true;
    }
  }

  return {
    clients: [] as FakeReplayClient[],
    renderers: [] as FakeRenderer[],
    FakeReplayClient,
    FakeRenderer,
  };
});

vi.mock("@/replay", () => ({
  REPLAY_FISH_COUNT: 48,
  ReplayClient: fakes.FakeReplayClient,
}));

vi.mock("@/rendering", () => ({
  PixiReplayRenderer: fakes.FakeRenderer,
}));

import { ReplayTank, type ReplayTankHandle } from "./ReplayTank";

const source = {
  sourceId: "test-source",
} as ReplaySource;

describe("ReplayTank", () => {
  afterEach(() => {
    fakes.clients.length = 0;
    fakes.renderers.length = 0;
    vi.unstubAllGlobals();
  });

  it("owns one worker and canvas across unmount and remount", async () => {
    vi.stubGlobal("Worker", class WorkerMock {});
    const first = render(<ReplayTank source={source} />);

    await waitFor(() => expect(first.getByRole("img")).toBeInTheDocument());
    expect(fakes.clients).toHaveLength(1);
    expect(fakes.clients[0]).toMatchObject({ loaded: true, played: true });
    first.unmount();
    expect(fakes.clients[0].disposed).toBe(true);
    expect(fakes.renderers[0].destroyed).toBe(true);

    const second = render(<ReplayTank source={source} />);
    await waitFor(() => expect(second.getByRole("img")).toBeInTheDocument());
    expect(document.querySelectorAll('canvas[aria-label="Fish survival replay"]')).toHaveLength(1);
    expect(fakes.clients).toHaveLength(2);
    second.unmount();
    expect(fakes.clients[1].disposed).toBe(true);
    expect(fakes.renderers[1].destroyed).toBe(true);
  });

  it("defers startup and loads only the source available when enabled", async () => {
    vi.stubGlobal("Worker", class WorkerMock {});
    const restoredSource = {
      sourceId: "restored-source",
    } as ReplaySource;
    const view = render(<ReplayTank enabled={false} source={source} />);

    expect(fakes.clients).toHaveLength(0);
    view.rerender(<ReplayTank enabled source={restoredSource} />);

    await waitFor(() => expect(view.getByRole("img")).toBeInTheDocument());
    expect(fakes.clients).toHaveLength(1);
    expect(fakes.clients[0].loadedSourceIds).toEqual([restoredSource.sourceId]);
  });

  it("loads the current source before an imperative restart", async () => {
    vi.stubGlobal("Worker", class WorkerMock {});
    const mutableSource = { sourceId: "first-source" } as ReplaySource;
    const ref = createRef<ReplayTankHandle>();
    const view = render(<ReplayTank ref={ref} source={mutableSource} />);
    await waitFor(() => expect(view.getByRole("img")).toBeInTheDocument());
    const client = fakes.clients[0];
    client.operations.length = 0;

    mutableSource.sourceId = "prepared-source";
    act(() => ref.current?.restart());

    expect(client.operations).toEqual(["load:prepared-source", "restart"]);
  });
});
