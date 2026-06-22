import { useMemo, useSyncExternalStore } from "react";
import type { PluginModelLabelColorContribution } from "@getpaseo/plugin/client";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { pluginModelLabelColorStore } from "./store";

export function useModelLabelColor(
  serverId: string | null,
): PluginModelLabelColorContribution["getColor"] {
  const revision = useSyncExternalStore(
    pluginModelLabelColorStore.subscribe,
    pluginModelLabelColorStore.getSnapshot,
    pluginModelLabelColorStore.getSnapshot,
  );
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  return useMemo(
    () => (input) => {
      if (serverId === null || !isConnected) return null;
      return pluginModelLabelColorStore.getColor(serverId, input);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Cached model rows must receive a new resolver when a contribution changes.
    [serverId, isConnected, revision],
  );
}
