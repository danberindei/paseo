/** @vitest-environment jsdom */
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDraftProviderOptions } from "./use-draft-provider-options";

const { asyncStorage } = vi.hoisted(() => ({
  asyncStorage: new Map<string, string>(),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => asyncStorage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      asyncStorage.set(key, value);
    },
    removeItem: async (key: string) => {
      asyncStorage.delete(key);
    },
  },
}));

const hostRuntime = vi.hoisted(() => ({
  client: null as { listProviderControls: (request: unknown) => Promise<unknown> } | null,
  isConnected: true,
}));

vi.mock("@/runtime/host-runtime", () => ({
  useHostRuntimeClient: () => hostRuntime.client,
  useHostRuntimeIsConnected: () => hostRuntime.isConnected,
}));

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  value: true,
  configurable: true,
});

const mountedRoots = new Set<Root>();

afterEach(async () => {
  await act(async () => {
    for (const root of mountedRoots) root.unmount();
    mountedRoots.clear();
  });
});

describe("useDraftProviderOptions loading", () => {
  beforeEach(() => {
    asyncStorage.clear();
    localStorage.clear();
    document.body.innerHTML = "<div id='root'></div>";
    hostRuntime.client = null;
    hostRuntime.isConnected = true;
  });

  it("is loading for a new request while the previous answer is still shown", async () => {
    const pending: Array<(payload: unknown) => void> = [];
    hostRuntime.client = {
      listProviderControls: () =>
        new Promise((resolve) => {
          pending.push(resolve);
        }),
    };

    let latest: ReturnType<typeof useDraftProviderOptions> | null = null;
    function Probe({ modelId }: { modelId: string }) {
      latest = useDraftProviderOptions({
        serverId: "host-1",
        provider: "codex",
        getProvider: () => "codex",
        cwd: "/repo",
        modeId: "auto",
        modelId,
        thinkingOptionId: "high",
      });
      return null;
    }
    const getLatest = (): ReturnType<typeof useDraftProviderOptions> => {
      if (!latest) throw new Error("Expected hook result");
      return latest;
    };
    const isLoading = () => getLatest().isLoading;
    const requestCount = () => pending.length;
    const drawnControlCount = () => getLatest().optionControls?.controls.length ?? -1;

    const container = document.getElementById("root");
    if (!container) throw new Error("Missing root container");
    const root = createRoot(container);
    mountedRoots.add(root);
    const client = new QueryClient();
    const render = (modelId: string) => (
      <QueryClientProvider client={client}>
        <Probe modelId={modelId} />
      </QueryClientProvider>
    );

    await act(async () => {
      root.render(render("gpt-5.4"));
    });
    await act(async () => {
      await expect.poll(isLoading).toBe(true);
    });
    await act(async () => {
      await expect.poll(requestCount).toBe(1);
    });
    await act(async () => {
      pending[0]?.({
        controls: [{ type: "toggle", key: "fast_mode", label: "Fast" }],
        options: { fast_mode: false },
      });
      await expect.poll(isLoading).toBe(false);
    });
    await act(async () => {
      await expect.poll(drawnControlCount).toBe(1);
    });
    expect(getLatest().drawnOptionKeys).toEqual(["fast_mode"]);

    // The same provider answers for the new model, but that answer has not arrived yet.
    await act(async () => {
      root.render(render("gpt-5.4-mini"));
    });
    await act(async () => {
      await expect.poll(isLoading).toBe(true);
    });
    await act(async () => {
      await expect.poll(requestCount).toBe(2);
    });
    // The previous answer is still the drawn view, so a view-derived flag would say "not loading".
    expect(getLatest().optionControls).toBeDefined();
    // The selection's keys come from the current answer, not the previous model's view.
    expect(getLatest().drawnOptionKeys).toEqual([]);

    await act(async () => {
      pending[1]?.({
        controls: [{ type: "toggle", key: "web_search", label: "Web search" }],
        options: {},
      });
      await expect.poll(isLoading).toBe(false);
    });
    await act(async () => {
      await expect.poll(drawnControlCount).toBe(1);
    });
    expect(getLatest().drawnOptionKeys).toEqual(["web_search"]);
  });
});
