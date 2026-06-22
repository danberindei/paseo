import type { PluginModelLabelColorContribution } from "@getpaseo/plugin/client";

interface Installation {
  id: string;
  serverId: string;
  lifetime: AbortController;
}

interface Entry {
  installation: Installation;
  contribution: PluginModelLabelColorContribution;
}

export class PluginModelLabelColorStore {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<() => void>();
  private revision = 0;

  constructor(private readonly reportError: (pluginId: string, error: unknown) => void) {}

  getSnapshot = (): number => this.revision;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  add(installation: Installation, contribution: PluginModelLabelColorContribution): () => void {
    if (installation.lifetime.signal.aborted) throw new Error("Plugin has stopped");
    if (!/^[a-z][a-z0-9-]*$/.test(contribution.id)) {
      throw new Error(`Invalid model label color id: ${contribution.id}`);
    }
    if (
      typeof contribution.getColor !== "function" ||
      typeof contribution.subscribe !== "function"
    ) {
      throw new Error(`Model label color ${contribution.id} needs getColor and subscribe`);
    }
    const key = `${installation.serverId}/${installation.id}/${contribution.id}`;
    if (this.entries.has(key)) throw new Error(`Duplicate model label color: ${key}`);
    const entry = { installation, contribution };
    this.entries.set(key, entry);
    let unsubscribe: () => void;
    try {
      unsubscribe = contribution.subscribe(() => this.publish());
      if (typeof unsubscribe !== "function") {
        throw new Error(`Model label color ${contribution.id} subscribe must return cleanup`);
      }
    } catch (error) {
      this.entries.delete(key);
      throw error;
    }
    let active = true;
    const remove = () => {
      if (!active) return;
      active = false;
      this.entries.delete(key);
      installation.lifetime.signal.removeEventListener("abort", remove);
      try {
        unsubscribe();
      } finally {
        this.publish();
      }
    };
    installation.lifetime.signal.addEventListener("abort", remove, { once: true });
    this.publish();
    return remove;
  }

  getColor(
    serverId: string,
    input: Parameters<PluginModelLabelColorContribution["getColor"]>[0],
  ): ReturnType<PluginModelLabelColorContribution["getColor"]> {
    for (const { installation, contribution } of this.entries.values()) {
      if (installation.serverId !== serverId) continue;
      try {
        const color = contribution.getColor(input);
        if (color === "danger") return color;
        if (color !== null) throw new Error(`Invalid model label color: ${String(color)}`);
      } catch (error) {
        this.reportError(installation.id, error);
      }
    }
    return null;
  }

  private publish(): void {
    this.revision++;
    for (const listener of this.listeners) listener();
  }
}
