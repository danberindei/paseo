import {
  BUILTIN_PROVIDER_ICON_NAMES,
  KNOWN_PROVIDER_ICON_NAMES,
} from "@getpaseo/protocol/provider-icon-names";

export type ProviderIconName =
  | { kind: "builtin"; id: string }
  | { kind: "catalog"; id: string }
  | { kind: "bot" };

const BUILTIN_PROVIDER_IDS = new Set(BUILTIN_PROVIDER_ICON_NAMES);
const KNOWN_PROVIDER_IDS = new Set(KNOWN_PROVIDER_ICON_NAMES);

export function resolveProviderIconName(provider: string): ProviderIconName {
  if (BUILTIN_PROVIDER_IDS.has(provider)) {
    return { kind: "builtin", id: provider };
  }
  if (KNOWN_PROVIDER_IDS.has(provider)) {
    return { kind: "catalog", id: provider };
  }
  return { kind: "bot" };
}

/**
 * Resolves the icon of a derived provider's base. The wire carries a single
 * `derivedFromProviderId` hop (the base a profile `extends`), so this is a
 * one-step lookup: if the base id resolves to a known icon, use it; otherwise
 * (no base, or an unknown base) fall back to `{ kind: "bot" }`.
 *
 * Pure function - no snapshot access, no cache. Callers needing reactivity
 * should read `derivedFromProviderId` from the live `useProvidersSnapshot`
 * data and pass it here.
 */
export function resolveProviderBaseIconId(
  derivedFromProviderId: string | null | undefined,
): ProviderIconName {
  if (!derivedFromProviderId) {
    return { kind: "bot" };
  }
  return resolveProviderIconName(derivedFromProviderId);
}
