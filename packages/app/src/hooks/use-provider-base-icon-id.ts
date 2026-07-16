import { useMemo } from "react";

import { useProvidersSnapshot } from "./use-providers-snapshot";

/**
 * Reactive lookup of a provider's `derivedFromProviderId` (the base provider
 * id of an `extends`-based custom profile) from the live providers snapshot.
 *
 * Returns `null` when the provider isn't found in the snapshot, when the
 * server is disconnected, when the server doesn't support the providers
 * snapshot feature, or when the provider isn't derived.
 *
 * Never reads from a stale cache - subscribes to live `providers_snapshot_update`
 * pushes via `useProvidersSnapshot`, so an icon re-renders as soon as the
 * snapshot reflects a config edit (new base id, provider removed, etc.).
 *
 * `serverId` is required: providers are server-scoped (a `claude-eng` on host A
 * may extend a different base than `claude-eng` on host B), and the snapshot
 * is keyed by `serverId`. Passing `null` returns `null` and opts out of the
 * subscription.
 */
export function useProviderBaseIconId(
  serverId: string | null,
  provider: string | null | undefined,
): string | null {
  const { entries } = useProvidersSnapshot(serverId, { cwd: null });

  return useMemo(() => {
    if (!serverId || !provider) {
      return null;
    }
    const entry = entries?.find((candidate) => candidate.provider === provider);
    return entry?.derivedFromProviderId ?? null;
  }, [entries, provider, serverId]);
}
