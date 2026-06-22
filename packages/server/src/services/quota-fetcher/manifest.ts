import type { Logger } from "pino";
import type { ProviderApiFetch, ProviderUsageFetcher } from "./provider.js";
import { ClaudeQuotaProvider } from "./providers/claude.js";
import { CodexQuotaProvider } from "./providers/codex.js";
import { CopilotQuotaProvider } from "./providers/copilot.js";
import { CursorQuotaProvider } from "./providers/cursor.js";
import { GrokQuotaProvider } from "./providers/grok.js";
import { KimiQuotaProvider } from "./providers/kimi.js";
import { MiniMaxQuotaProvider } from "./providers/minimax.js";
import { ZaiQuotaProvider } from "./providers/zai.js";
import type { ProviderUsageFetcherManifestEntry } from "./provider.js";

export const PROVIDER_USAGE_FETCHERS: readonly ProviderUsageFetcherManifestEntry[] = [
  {
    baseProviderId: "claude",
    create: (options) =>
      new ClaudeQuotaProvider({
        logger: options.logger,
        fetch: options.fetch,
        context: options.context,
      }),
  },
  {
    baseProviderId: "codex",
    create: (options) =>
      new CodexQuotaProvider({
        logger: options.logger,
        fetch: options.fetch,
        context: options.context,
      }),
  },
  {
    baseProviderId: "copilot",
    create: (options) =>
      new CopilotQuotaProvider({
        logger: options.logger,
        fetch: options.fetch,
        context: options.context,
      }),
  },
  {
    baseProviderId: "cursor",
    create: (options) =>
      new CursorQuotaProvider({
        logger: options.logger,
        fetch: options.fetch,
        context: options.context,
      }),
  },
  {
    baseProviderId: "zai",
    create: (options) =>
      new ZaiQuotaProvider({
        logger: options.logger,
        fetch: options.fetch,
        context: options.context,
      }),
  },
  {
    baseProviderId: "grok",
    create: (options) =>
      new GrokQuotaProvider({
        logger: options.logger,
        fetch: options.fetch,
        context: options.context,
      }),
  },
  {
    baseProviderId: "kimi",
    create: (options) =>
      new KimiQuotaProvider({
        logger: options.logger,
        fetch: options.fetch,
        context: options.context,
      }),
  },
  {
    baseProviderId: "minimax",
    create: (options) => new MiniMaxQuotaProvider({ logger: options.logger, fetch: options.fetch }),
  },
];

const FETCHERS_BY_BASE = new Map(
  PROVIDER_USAGE_FETCHERS.map((entry) => [entry.baseProviderId, entry]),
);

// A concrete provider to fetch usage for: a built-in provider, or a custom
// provider that extends one. `baseProviderId` selects the fetcher; `providerId`
// and `displayName` are the reported identity; `env` carries config overrides
// such as CLAUDE_CONFIG_DIR.
export interface ProviderUsageTarget {
  providerId: string;
  baseProviderId: string;
  displayName?: string;
  env?: Record<string, string>;
}

export interface CreateProviderUsageFetchersOptions {
  logger: Logger;
  fetch?: ProviderApiFetch;
  targets: ProviderUsageTarget[];
}

// Build one fetcher per target whose base provider has a known fetcher. Targets
// for providers without a usage fetcher (e.g. Pi, generic ACP) are skipped.
export function createProviderUsageFetchers(
  options: CreateProviderUsageFetchersOptions,
): ProviderUsageFetcher[] {
  const fetchers: ProviderUsageFetcher[] = [];
  for (const target of options.targets) {
    const entry = FETCHERS_BY_BASE.get(target.baseProviderId);
    if (!entry) continue;
    fetchers.push(
      entry.create({
        logger: options.logger,
        fetch: options.fetch,
        context: {
          providerId: target.providerId,
          displayName: target.displayName,
          env: target.env,
        },
      }),
    );
  }
  return fetchers;
}

// Targets covering every built-in provider with no env overrides. Used when no
// provider registry is wired in (e.g. standalone or tests).
export function defaultProviderUsageTargets(): ProviderUsageTarget[] {
  return PROVIDER_USAGE_FETCHERS.map((entry) => ({
    providerId: entry.baseProviderId,
    baseProviderId: entry.baseProviderId,
  }));
}
