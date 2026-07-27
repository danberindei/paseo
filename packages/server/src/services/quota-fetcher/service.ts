import type { Logger } from "pino";
import type { ProviderUsage, ProviderUsageBalance } from "../../server/messages.js";
import { createProviderUsageFetchers, defaultProviderUsageTargets } from "./manifest.js";
import type { ProviderApiFetch, ProviderUsageFetcher } from "./provider.js";
import { ProviderApiHttpError, unavailableUsage } from "./usage.js";

function hasPositiveBalance(balance: ProviderUsageBalance): boolean {
  const { used, remaining, limit } = balance;
  return (
    (limit != null && limit > 0) ||
    (remaining != null && remaining > 0) ||
    (used != null && used > 0)
  );
}

// A usage result is worth keeping as a fallback only when it actually carries
// something to show. Mirrors the client's visibility rule (filterVisibleProviders)
// so we retain exactly the results that would otherwise disappear from the UI.
function isUsableUsage(usage: ProviderUsage): boolean {
  return (
    usage.status === "available" &&
    (usage.windows.length > 0 || (usage.balances ?? []).some(hasPositiveBalance))
  );
}

export interface ProviderUsageServiceOptions {
  logger: Logger;
  // A fixed set of fetchers. Mainly for tests; prefer `resolveFetchers` so the
  // service tracks live provider config (custom providers, env overrides).
  fetchers?: ProviderUsageFetcher[];
  // Rebuilds fetchers on each fresh fetch. Lets the service pick up provider
  // config changes (added/removed/derived providers) without being recreated.
  resolveFetchers?: () => ProviderUsageFetcher[];
  fetch?: ProviderApiFetch;
  cacheTtlMs?: number;
  now?: () => number;
}

export interface ProviderUsageListResult {
  fetchedAt: string;
  providers: ProviderUsage[];
}

const DEFAULT_PROVIDER_USAGE_CACHE_TTL_MS = 5 * 60 * 1000;

// How long the same unresolved failure stays quiet after it has been warned about. A
// forced refresh bypasses the cache, so a provider stuck at 429 would otherwise write a
// warning per refresh.
const PROVIDER_FETCH_FAILURE_WARN_INTERVAL_MS = 15 * 60 * 1000;

// The last failure logged for a provider, so a repeat can be recognized as one. Cleared
// on the provider's next successful fetch.
interface ProviderFetchFailure {
  signature: string;
  warnedAtMs: number;
  repeats: number;
}

export class ProviderUsageService {
  private readonly logger: Logger;
  private readonly resolveFetchers: () => ProviderUsageFetcher[];
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private cached: { fetchedAtMs: number; result: ProviderUsageListResult } | null = null;
  private inFlight: Promise<ProviderUsageListResult> | null = null;
  // Last result per provider that actually carried data, with the time it was
  // fetched. Used to keep a provider visible across a transient fetch failure
  // (e.g. an expired token that briefly fails to refresh) instead of letting it
  // vanish from the sidebar.
  private readonly lastKnownGood = new Map<string, { usage: ProviderUsage; fetchedAt: string }>();
  private readonly lastFailure = new Map<string, ProviderFetchFailure>();

  constructor(options: ProviderUsageServiceOptions) {
    this.logger = options.logger.child({ module: "provider-usage-service" });
    if (options.fetchers) {
      const fetchers = options.fetchers;
      this.resolveFetchers = () => fetchers;
    } else if (options.resolveFetchers) {
      this.resolveFetchers = options.resolveFetchers;
    } else {
      this.resolveFetchers = () =>
        createProviderUsageFetchers({
          logger: this.logger,
          fetch: options.fetch,
          targets: defaultProviderUsageTargets(),
        });
    }
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_PROVIDER_USAGE_CACHE_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  async listUsage(options?: { forceRefresh?: boolean }): Promise<ProviderUsageListResult> {
    const nowMs = this.now();
    if (
      !options?.forceRefresh &&
      this.cached &&
      nowMs - this.cached.fetchedAtMs < this.cacheTtlMs
    ) {
      return this.cached.result;
    }

    if (this.inFlight) {
      return this.inFlight;
    }

    const request = this.fetchFreshUsage(nowMs);
    this.inFlight = request;
    try {
      return await request;
    } finally {
      if (this.inFlight === request) {
        this.inFlight = null;
      }
    }
  }

  private async fetchFreshUsage(nowMs: number): Promise<ProviderUsageListResult> {
    const fetchedAt = new Date(nowMs).toISOString();
    const fetchers = this.resolveFetchers();
    const settled = await Promise.allSettled(fetchers.map((fetcher) => fetcher.fetchUsage()));
    const providers = settled.map((result, index) => {
      const fetcher = fetchers[index];
      if (result.status === "fulfilled") {
        this.lastFailure.delete(fetcher.providerId);
        return this.applyLastKnownGood(result.value, fetchedAt);
      }
      this.logFetchFailure({
        fetcher,
        reason: result.reason,
        nowMs,
        servedFromCache: this.lastKnownGood.has(fetcher.providerId),
      });
      return this.applyLastKnownGood(
        unavailableUsage({
          providerId: fetcher.providerId,
          displayName: fetcher.displayName,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        }),
        fetchedAt,
      );
    });

    const result = { fetchedAt, providers };
    this.cached = { fetchedAtMs: nowMs, result };
    return result;
  }

  /**
   * Record a provider fetch failure at a level that matches what it costs the user.
   *
   * File logging defaults to `info`, so the previous `debug` line retained nothing: a 429
   * from a provider's usage API left no trace anywhere and could not be diagnosed after
   * the fact. A failure that is new, or that leaves the provider with nothing to show,
   * warns with the provider, the status, and `Retry-After`. A repeat that last-known-good
   * data still covers stays at `debug`, and an uncovered repeat warns at most once per
   * interval, so a persistently failing provider cannot flood the log.
   */
  private logFetchFailure(input: {
    fetcher: ProviderUsageFetcher;
    reason: unknown;
    nowMs: number;
    servedFromCache: boolean;
  }): void {
    const { fetcher, reason, nowMs, servedFromCache } = input;
    const httpError = reason instanceof ProviderApiHttpError ? reason : null;
    const message = reason instanceof Error ? reason.message : String(reason);
    const signature = `${httpError?.status ?? "none"}:${message}`;
    const previous = this.lastFailure.get(fetcher.providerId);
    const repeated = previous?.signature === signature ? previous : null;
    const shouldWarn =
      !repeated ||
      (!servedFromCache && nowMs - repeated.warnedAtMs >= PROVIDER_FETCH_FAILURE_WARN_INTERVAL_MS);
    const repeats = repeated ? repeated.repeats + 1 : 0;
    this.lastFailure.set(fetcher.providerId, {
      signature,
      warnedAtMs: repeated && !shouldWarn ? repeated.warnedAtMs : nowMs,
      repeats,
    });

    const details = {
      err: reason,
      providerId: fetcher.providerId,
      status: httpError?.status ?? null,
      retryAfter: httpError?.retryAfter ?? null,
      servedFromCache,
      repeats,
    };
    if (shouldWarn) {
      this.logger.warn(details, "Provider usage fetch failed");
      return;
    }
    this.logger.debug(details, "Provider usage fetch failed");
  }

  // Stamp every successful result with its fetch time, and keep a copy as a
  // fallback. On a failed or empty fetch, the last recorded result is returned
  // with its original fetchedAt so consumers can see the data is stale.
  private applyLastKnownGood(current: ProviderUsage, fetchedAt: string): ProviderUsage {
    if (isUsableUsage(current)) {
      const stamped = { ...current, fetchedAt };
      this.lastKnownGood.set(current.providerId, { usage: stamped, fetchedAt });
      return stamped;
    }
    const previous = this.lastKnownGood.get(current.providerId);
    if (!previous) {
      return current;
    }
    return { ...previous.usage, fetchedAt: previous.fetchedAt };
  }
}
