import type { Logger } from "pino";
import type { ProviderUsage } from "../../server/messages.js";

export type ProviderApiFetch = typeof fetch;

export interface ProviderUsageFetcher {
  readonly providerId: string;
  readonly displayName: string;
  fetchUsage(): Promise<ProviderUsage>;
}

// Identity and config for a concrete provider instance. A built-in provider
// (e.g. "claude") and a custom provider that extends it (e.g. "claude-5x" with
// its own CLAUDE_CONFIG_DIR) share the same base fetcher but report under their
// own id/label and read credentials from their own env.
export interface ProviderUsageFetcherContext {
  providerId?: string;
  displayName?: string;
  env?: Record<string, string>;
}

export interface ProviderUsageFetcherFactoryOptions {
  logger: Logger;
  fetch?: ProviderApiFetch;
  context?: ProviderUsageFetcherContext;
}

export interface ProviderUsageFetcherManifestEntry {
  // The built-in provider id this fetcher implements. Custom providers map to
  // it through their `extends` chain.
  readonly baseProviderId: string;
  create(options: ProviderUsageFetcherFactoryOptions): ProviderUsageFetcher;
}
