import { describe, expect, it } from "vitest";
import type { PluginModelLabelColorContribution } from "@getpaseo/plugin/client";
import { PluginModelLabelColorStore } from "./model";

function installation(serverId = "host-a", id = "quota") {
  return { serverId, id, lifetime: new AbortController() };
}

function colorSource(id = "quota") {
  let color: "danger" | null = null;
  const listeners = new Set<() => void>();
  const contribution: PluginModelLabelColorContribution = {
    id,
    getColor: ({ provider }) => (provider === "claude" ? color : null),
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    contribution,
    listenerCount: () => listeners.size,
    setColor(value: "danger" | null) {
      color = value;
      for (const listener of listeners) listener();
    },
  };
}

const MODEL = { provider: "claude", modelId: "sonnet" };

describe("PluginModelLabelColorStore", () => {
  it("scopes colors to the host and model and updates without sidebar UI", () => {
    const store = new PluginModelLabelColorStore(() => {});
    const source = colorSource();
    store.add(installation(), source.contribution);
    let updates = 0;
    const stop = store.subscribe(() => updates++);
    const before = store.getSnapshot();
    expect(store.getColor("host-a", MODEL)).toBeNull();
    source.setColor("danger");
    expect(store.getSnapshot()).toBeGreaterThan(before);
    expect(updates).toBe(1);
    expect(store.getColor("host-a", MODEL)).toBe("danger");
    expect(store.getColor("host-b", MODEL)).toBeNull();
    expect(store.getColor("host-a", { provider: "codex", modelId: "gpt" })).toBeNull();
    stop();
    source.setColor(null);
    expect(updates).toBe(1);
  });

  it("releases subscriptions on unload and permits replacement", () => {
    const store = new PluginModelLabelColorStore(() => {});
    const plugin = installation();
    const source = colorSource();
    source.setColor("danger");
    const remove = store.add(plugin, source.contribution);
    expect(source.listenerCount()).toBe(1);
    plugin.lifetime.abort();
    remove();
    expect(source.listenerCount()).toBe(0);
    expect(store.getColor("host-a", MODEL)).toBeNull();
    store.add(installation(), source.contribution);
    expect(source.listenerCount()).toBe(1);
    expect(store.getColor("host-a", MODEL)).toBe("danger");
  });

  it("rejects duplicates, invalid IDs, and stopped installations", () => {
    const store = new PluginModelLabelColorStore(() => {});
    const source = colorSource();
    store.add(installation(), source.contribution);
    expect(() => store.add(installation(), source.contribution)).toThrow("Duplicate");
    expect(() => store.add(installation(), colorSource("INVALID").contribution)).toThrow("Invalid");
    const stopped = installation("host-b");
    stopped.lifetime.abort();
    expect(() => store.add(stopped, source.contribution)).toThrow("Plugin has stopped");
  });

  it("rolls back a failed subscription so the same registration can be retried", () => {
    const store = new PluginModelLabelColorStore(() => {});
    const source = colorSource();
    const failed = {
      ...source.contribution,
      subscribe() {
        throw new Error("Subscription failed");
      },
    };
    expect(() => store.add(installation(), failed)).toThrow("Subscription failed");
    store.add(installation(), source.contribution);
    expect(source.listenerCount()).toBe(1);
  });

  it("reports a failing plugin and still resolves another contribution", () => {
    const failures: unknown[] = [];
    const store = new PluginModelLabelColorStore((_id, error) => failures.push(error));
    const broken = colorSource();
    store.add(installation(), {
      ...broken.contribution,
      getColor() {
        throw new Error("Color failed");
      },
    });
    const working = colorSource();
    working.setColor("danger");
    store.add(installation("host-a", "other"), working.contribution);
    expect(store.getColor("host-a", MODEL)).toBe("danger");
    expect(failures).toHaveLength(1);
  });
});
