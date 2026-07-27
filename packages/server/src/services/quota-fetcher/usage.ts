import type { Logger } from "pino";
import { z } from "zod";
import type {
  ProviderUsage,
  ProviderUsageBalance,
  ProviderUsageTone,
  ProviderUsageWindow,
} from "../../server/messages.js";
import type { ProviderApiFetch } from "./provider.js";

const PROVIDER_HTTP_TIMEOUT_MS = 15_000;

export const ApiNumberSchema = z.coerce.number().finite();
export const ApiNullableNumberSchema = z.preprocess(
  (value) => (value == null ? null : value),
  ApiNumberSchema.nullable(),
);
export const ApiOptionalStringSchema = z.preprocess(
  (value) => (value == null ? undefined : value),
  z.coerce.string().optional(),
);

// Resolve the first non-empty value for any of `keys`, preferring the
// per-provider env (so a custom provider that sets CLAUDE_CONFIG_DIR/ZAI_API_KEY
// in its config is honored) and falling back to the daemon's process env.
export function resolveProviderEnv(
  env: Record<string, string> | undefined,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = env?.[key];
    if (value) return value;
  }
  for (const key of keys) {
    const value = process.env[key];
    if (value) return value;
  }
  return undefined;
}

export function fetchProviderApi(
  fetchApi: ProviderApiFetch,
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  return fetchApi(input, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(PROVIDER_HTTP_TIMEOUT_MS),
  });
}

/**
 * Whether a failing status is the expected shape of "no usable session for this provider".
 *
 * The daemon reads credentials it does not own: the env may hold a token for a different
 * product, and a token on disk may be waiting for its CLI to refresh it. Those states are
 * routine and must stay quiet. Every other failing status is a real failure that nothing
 * else reports.
 */
export function isExpectedAuthFailureStatus(status: number): boolean {
  return status === 401 || status === 403;
}

/**
 * A provider usage API answered with a failing HTTP status.
 *
 * Carries the status and `Retry-After` so the failure stays diagnosable after it leaves
 * the provider: a 429 is the one failure a user has no other way to see, and the service
 * that catches this is the only place that knows whether cached data still covers it.
 */
export class ProviderApiHttpError extends Error {
  readonly status: number;
  readonly retryAfter: string | null;

  constructor(input: { displayName: string; status: number; retryAfter: string | null }) {
    super(`${input.displayName} usage API returned ${input.status}`);
    this.name = "ProviderApiHttpError";
    this.status = input.status;
    this.retryAfter = input.retryAfter;
  }
}

export function providerApiHttpError(
  provider: { displayName: string },
  res: Response,
): ProviderApiHttpError {
  return new ProviderApiHttpError({
    displayName: provider.displayName,
    status: res.status,
    retryAfter: res.headers.get("retry-after"),
  });
}

/**
 * Log a failed provider usage response and return the quiet `unavailable` result, for
 * providers that absorb an HTTP failure rather than throwing it.
 *
 * The level is the point: file logging defaults to `info`, so an HTTP failure logged at
 * `debug` is retained nowhere and cannot be diagnosed after the fact. Expected
 * authentication failures stay at `debug`; anything else warns with the provider, the
 * status, and `Retry-After`.
 */
export function logUnavailableHttpFailure(
  logger: Logger,
  provider: { providerId: string; displayName: string },
  res: Response,
): ProviderUsage {
  const details = {
    providerId: provider.providerId,
    status: res.status,
    retryAfter: res.headers.get("retry-after"),
  };
  const message = `${provider.displayName} usage fetch failed`;
  if (isExpectedAuthFailureStatus(res.status)) {
    logger.debug(details, message);
  } else {
    logger.warn(details, message);
  }
  return unavailableUsage(provider);
}

export function unavailableUsage(provider: {
  providerId: string;
  displayName: string;
  error?: string | null;
}): ProviderUsage {
  return {
    providerId: provider.providerId,
    displayName: provider.displayName,
    status: provider.error ? "error" : "unavailable",
    planLabel: null,
    windows: [],
    balances: [],
    details: [],
    error: provider.error ?? null,
  };
}

export function windowFromUsedPct(input: {
  id: string;
  label: string;
  utilizationPct: number | null | undefined;
  resetsAt?: string | null;
  tone?: ProviderUsageWindow["tone"];
}): ProviderUsageWindow {
  const usedPct = typeof input.utilizationPct === "number" ? input.utilizationPct : null;
  const window: ProviderUsageWindow = {
    id: input.id,
    label: input.label,
    usedPct,
    remainingPct: usedPct === null ? null : Math.max(0, 100 - usedPct),
    resetsAt: input.resetsAt ?? null,
  };
  if (input.tone) {
    window.tone = input.tone;
  }
  return window;
}

/**
 * The tone scale for anything measured against a known limit, windows and balances alike.
 *
 * Thresholds match `deriveTone` in the app's provider-usage/tone.ts, which is what the
 * client falls back to when a window arrives without a tone. Healthy is "ok" rather than
 * "default" because that is what every provider setting a tone has always sent, and it is
 * what the bars render today below their thresholds.
 */
export function toneFromUsedPct(usedPct: number | null | undefined): ProviderUsageTone {
  if (typeof usedPct !== "number") return "default";
  if (usedPct > 90) return "danger";
  if (usedPct >= 70) return "warning";
  return "ok";
}

/**
 * Tone for a balance with no known limit, where a percentage cannot be computed and the
 * only signal is whether anything is left. Prefer `toneFromUsedPct` when a limit exists:
 * this one stays "ok" until the balance is completely spent.
 */
export function balanceToneFromRemaining(
  remaining: number | null | undefined,
): ProviderUsageBalance["tone"] {
  if (typeof remaining !== "number") return "default";
  if (remaining <= 0) return "danger";
  return "ok";
}

/** Percentage of a limit consumed, or null when either side is unknown. */
export function usedPctOf(
  used: number | null | undefined,
  limit: number | null | undefined,
): number | null {
  if (typeof used !== "number" || typeof limit !== "number" || limit <= 0) return null;
  return (used / limit) * 100;
}

export function toIsoStringOrNull(timestampMs: number): string | null {
  const date = new Date(timestampMs);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
