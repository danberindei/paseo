import { existsSync, promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Logger } from "pino";
import { z } from "zod";
import type {
  ProviderUsage,
  ProviderUsageBalance,
  ProviderUsageWindow,
} from "../../../server/messages.js";
import type {
  ProviderApiFetch,
  ProviderUsageFetcher,
  ProviderUsageFetcherContext,
} from "../provider.js";
import {
  ApiNumberSchema,
  balanceToneFromRemaining,
  toneFromUsedPct,
  fetchProviderApi,
  resolveProviderEnv,
  unavailableUsage,
  windowFromUsedPct,
} from "../usage.js";

const CodexAuthSchema = z.object({
  tokens: z
    .object({
      access_token: z.string().optional(),
      refresh_token: z.string().optional(),
      account_id: z.string().optional(),
    })
    .optional(),
});

const CodexWindowSchema = z.object({
  used_percent: ApiNumberSchema.optional(),
  reset_at: ApiNumberSchema.optional(),
  limit_window_seconds: ApiNumberSchema.optional(),
});

const CodexUsageResponseSchema = z.object({
  plan_type: z.string().optional(),
  email: z.string().optional(),
  rate_limit: z
    .object({
      primary_window: CodexWindowSchema.nullish(),
      secondary_window: CodexWindowSchema.nullish(),
    })
    .nullish(),
  code_review_rate_limit: z
    .object({
      primary_window: CodexWindowSchema.nullish(),
    })
    .nullish(),
  credits: z
    .object({
      has_credits: z.boolean().optional(),
      unlimited: z.boolean().optional(),
      balance: ApiNumberSchema.optional(),
    })
    .nullish(),
});

type CodexAuth = z.infer<typeof CodexAuthSchema>;
type CodexWindow = z.infer<typeof CodexWindowSchema>;
type CodexUsageResponse = z.infer<typeof CodexUsageResponseSchema>;

interface CodexQuotaProviderOptions {
  logger: Logger;
  codexHome?: string;
  fetch?: ProviderApiFetch;
  context?: ProviderUsageFetcherContext;
}

function codexWindow(
  window: CodexWindow | null | undefined,
): { usedPct: number; resetsAt: string | null } | null {
  if (!window) return null;
  return {
    usedPct: window.used_percent ?? 0,
    resetsAt: window.reset_at != null ? new Date(window.reset_at * 1000).toISOString() : null,
  };
}

interface CodexWindowKind {
  id: string;
  label: string;
  seconds: number;
}

// OpenAI reports each rate-limit window's span in limit_window_seconds. We map
// the span to a stable window id/label the app knows how to render ("session"
// -> 5h, "weekly" -> 7d) instead of assuming the primary slot is always 5h and
// the secondary always 7d. This keeps the mapping correct no matter which slot
// a window arrives in, or when only one window is present (OpenAI dropped the
// 5h window, so the lone primary window now carries the 7d limit).
const CODEX_WINDOW_KINDS: CodexWindowKind[] = [
  { id: "session", label: "Session", seconds: 5 * 60 * 60 },
  { id: "weekly", label: "Weekly", seconds: 7 * 24 * 60 * 60 },
];

// Build a rendered window from a raw Codex window, choosing its kind by the
// reported span. When the span is missing (or unrecognized) we fall back to the
// slot's historical kind so older/unknown responses still map sensibly.
function codexRateLimitWindow(
  window: CodexWindow | null | undefined,
  fallback: CodexWindowKind,
): ProviderUsageWindow | null {
  const normalized = codexWindow(window);
  if (!normalized) return null;
  const seconds = window?.limit_window_seconds;
  const kind =
    (seconds != null ? CODEX_WINDOW_KINDS.find((k) => k.seconds === seconds) : undefined) ??
    fallback;
  return windowFromUsedPct({
    id: kind.id,
    label: kind.label,
    utilizationPct: normalized.usedPct,
    resetsAt: normalized.resetsAt,
    tone: toneFromUsedPct(normalized.usedPct),
  });
}

export class CodexQuotaProvider implements ProviderUsageFetcher {
  readonly providerId: string;
  readonly displayName: string;

  private readonly codexHome: string;
  private readonly fetchApi: ProviderApiFetch;
  private readonly env: Record<string, string> | undefined;
  private readonly logger: Logger;

  constructor(options: CodexQuotaProviderOptions) {
    this.providerId = options.context?.providerId ?? "codex";
    this.displayName = options.context?.displayName ?? "Codex";
    this.env = options.context?.env;
    this.logger = options.logger.child({ module: "codex-quota-provider" });
    this.codexHome =
      options.codexHome ||
      resolveProviderEnv(this.env, ["CODEX_HOME"]) ||
      join(homedir(), ".codex");
    this.fetchApi = options.fetch ?? fetch;
  }

  async fetchUsage(): Promise<ProviderUsage> {
    const auth = await this.readCodexAuth();
    const accessToken = auth?.tokens?.access_token;
    if (!auth || !accessToken) {
      return unavailableUsage(this);
    }

    const { account_id } = auth.tokens ?? {};
    const resp = await this.callCodexApi(accessToken, account_id);

    if (resp === "NEEDS_AUTH") {
      // Read-only on credentials; the Codex CLI owns refresh. See docs/providers.md.
      return unavailableUsage(this);
    }

    return this.toUsage(resp);
  }

  private toUsage(resp: CodexUsageResponse): ProviderUsage {
    // Log the raw rate-limit shape so we can observe which windows OpenAI
    // actually returns (e.g. whether the 5h primary window is present).
    this.logger.debug(
      {
        providerId: this.providerId,
        primaryWindow: resp.rate_limit?.primary_window ?? null,
        secondaryWindow: resp.rate_limit?.secondary_window ?? null,
        codeReviewWindow: resp.code_review_rate_limit?.primary_window ?? null,
      },
      "Codex usage windows",
    );
    const [sessionKind, weeklyKind] = CODEX_WINDOW_KINDS;
    // Classify each window by its reported span, falling back to the slot's
    // historical kind. Deduplicate by id so two windows can never collide on
    // the same rendered slot (e.g. if both reported the same span).
    const windows: ProviderUsageWindow[] = [];
    const seenIds = new Set<string>();
    for (const built of [
      codexRateLimitWindow(resp.rate_limit?.primary_window, sessionKind),
      codexRateLimitWindow(resp.rate_limit?.secondary_window, weeklyKind),
    ]) {
      if (built && !seenIds.has(built.id)) {
        seenIds.add(built.id);
        windows.push(built);
      }
    }

    const codeReview = codexWindow(resp.code_review_rate_limit?.primary_window);
    if (codeReview) {
      windows.push(
        windowFromUsedPct({
          id: "code_review",
          label: "Code review",
          utilizationPct: codeReview.usedPct,
          resetsAt: codeReview.resetsAt,
          tone: toneFromUsedPct(codeReview.usedPct),
        }),
      );
    }

    const balances: ProviderUsageBalance[] = [];
    if (resp.credits?.balance !== undefined) {
      balances.push({
        id: "credits",
        label: "Credits",
        remaining: resp.credits.balance,
        unit: "usd",
        tone: balanceToneFromRemaining(resp.credits.balance),
      });
    }

    return {
      providerId: this.providerId,
      displayName: this.displayName,
      status: "available",
      planLabel: resp.plan_type ?? null,
      windows,
      balances,
      details: [],
      error: null,
    };
  }

  private async readCodexAuth(): Promise<CodexAuth | null> {
    const codexHomeEnv = resolveProviderEnv(this.env, ["CODEX_HOME"]);
    const candidates = [
      ...(codexHomeEnv ? [join(codexHomeEnv, "auth.json")] : []),
      join(homedir(), ".config", "codex", "auth.json"),
      join(this.codexHome, "auth.json"),
    ];
    for (const path of candidates) {
      if (!existsSync(path)) continue;
      try {
        const auth = CodexAuthSchema.parse(JSON.parse(await fs.readFile(path, "utf8")));
        if (auth.tokens?.access_token) return auth;
      } catch {
        continue;
      }
    }
    return null;
  }

  private async callCodexApi(
    token: string,
    accountId?: string,
  ): Promise<CodexUsageResponse | "NEEDS_AUTH"> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    };
    if (accountId) headers["ChatGPT-Account-Id"] = accountId;

    const res = await fetchProviderApi(
      this.fetchApi,
      "https://chatgpt.com/backend-api/wham/usage",
      {
        headers,
      },
    );
    if (res.status === 401 || res.status === 403) return "NEEDS_AUTH";
    if (!res.ok) throw new Error(`Codex usage API returned ${res.status}`);
    const text = await res.text();
    if (text.trim().startsWith("<")) return "NEEDS_AUTH";
    return CodexUsageResponseSchema.parse(JSON.parse(text));
  }
}
