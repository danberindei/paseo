// Quota display logic for the sidebar: each usage window renders as a terse
// runway fraction (2.5/2.5h) - numerator is the remaining quota expressed
// in average-pace time (remaining % of the window's full duration),
// denominator is the time actually left in the window.
//
// ProviderUsageWindow.id is the window class (five_hour, seven_day, monthly,
// ...). The label, the window's duration, and the runway/tone heuristic are
// all looked up from it. An id with no mapping uses the server-provided label
// and shows a plain percentage instead of a fraction.
//
// A ProviderUsageBalance with a limit (used/total, e.g. Cursor plan spend or
// Grok monthly credits) is a usage window in absolute units, so
// balanceToQuotaWindowView turns it into a percentage and it renders through
// the same path. A balance with no limit stays a raw amount, handled by the
// section.
import type { ProviderUsage, ProviderUsageBalance, ProviderUsageWindow } from "./types";

export type WindowTone = "neutral" | "purple" | "amber" | "red" | "muted";

export const TONE_SEVERITY: Record<WindowTone, number> = {
  purple: 0,
  neutral: 0,
  // Stale windows rank just above neutral/purple so a muted window wins over a
  // plain neutral seed, but they still lose to amber/red attention tones.
  muted: 0.5,
  amber: 1,
  red: 2,
};

export function worstTone(a: WindowTone, b: WindowTone): WindowTone {
  return TONE_SEVERITY[a] >= TONE_SEVERITY[b] ? a : b;
}

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_WEEK_MS = 7 * ONE_DAY_MS;

// Normalized view of a window for the formatting and tone helpers below.
export interface QuotaWindowView {
  // The protocol window id (five_hour, seven_day, monthly, ...) doubles as the
  // window-class discriminator used for labels, durations, and ordering.
  id: string;
  serverLabel: string;
  utilization: number | null;
  resetsAtMs: number | null;
  isUsingOverage: boolean;
}

function parseIsoMs(iso: string | null | undefined): number | null {
  if (!iso) {
    return null;
  }
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function toQuotaWindowView(window: ProviderUsageWindow): QuotaWindowView {
  let utilization: number | null = null;
  if (window.usedPct != null) {
    utilization = window.usedPct;
  } else if (window.remainingPct != null) {
    utilization = 100 - window.remainingPct;
  }
  return {
    id: window.id,
    serverLabel: window.label,
    utilization,
    resetsAtMs: parseIsoMs(window.resetsAt),
    isUsingOverage: window.shortfallPct != null && window.shortfallPct > 0,
  };
}

// A balance that carries a limit (used/total) is structurally a usage window -
// the only difference from ProviderUsageWindow is that the amounts are absolute
// (dollars, credits) rather than a native percentage. Convert it so it renders
// with the same burn-rate UI. Balances with no limit (no total to form a
// percentage from) return null and are shown as a raw amount instead.
export function balanceToQuotaWindowView(balance: ProviderUsageBalance): QuotaWindowView | null {
  const { limit, used, remaining } = balance;
  if (limit == null || limit <= 0) {
    return null;
  }
  let usedAmount: number | null = null;
  if (used != null) {
    usedAmount = used;
  } else if (remaining != null) {
    usedAmount = limit - remaining;
  }
  if (usedAmount == null) {
    return null;
  }
  return {
    id: balance.id,
    serverLabel: balance.label,
    utilization: Math.max(0, Math.min(100, (usedAmount / limit) * 100)),
    resetsAtMs: parseIsoMs(balance.resetsAt),
    isUsingOverage: false,
  };
}

// Variant windows (per-model splits) collapse onto their base for the compact
// row so a provider shows one value per real window class.
export function getCompactGroup(id: string): string {
  if (id.startsWith("seven_day")) {
    return "seven_day";
  }
  if (id.startsWith("weekly")) {
    return "weekly";
  }
  return id;
}

const WINDOW_ORDER = ["five_hour", "session", "seven_day", "weekly", "overage", "monthly"] as const;

const COMPACT_GROUP_ORDER = ["five_hour", "session", "seven_day", "weekly", "overage", "monthly"];

export function sortWindows(windows: QuotaWindowView[]): QuotaWindowView[] {
  return [...windows].sort((left, right) => {
    const leftIndex = WINDOW_ORDER.indexOf(left.id as (typeof WINDOW_ORDER)[number]);
    const rightIndex = WINDOW_ORDER.indexOf(right.id as (typeof WINDOW_ORDER)[number]);
    if (leftIndex !== rightIndex) {
      return (
        (leftIndex === -1 ? WINDOW_ORDER.length : leftIndex) -
        (rightIndex === -1 ? WINDOW_ORDER.length : rightIndex)
      );
    }
    return left.id.localeCompare(right.id);
  });
}

export function getCompactWindows(windows: QuotaWindowView[], now: number): QuotaWindowView[] {
  const groups = new Map<string, QuotaWindowView>();
  for (const w of windows) {
    const group = getCompactGroup(w.id);
    const existing = groups.get(group);
    if (!existing) {
      groups.set(group, w);
      continue;
    }
    const existingTone = getWindowTone(existing, now);
    const candidateTone = getWindowTone(w, now);
    if (TONE_SEVERITY[candidateTone] > TONE_SEVERITY[existingTone]) {
      groups.set(group, w);
      continue;
    }
    if (TONE_SEVERITY[candidateTone] === TONE_SEVERITY[existingTone]) {
      const existingRemaining = getWindowRemainingPercent(existing) ?? 100;
      const candidateRemaining = getWindowRemainingPercent(w) ?? 100;
      if (candidateRemaining < existingRemaining) {
        groups.set(group, w);
      }
    }
  }
  const ordered = COMPACT_GROUP_ORDER.filter((g) => groups.has(g));
  const extras = [...groups.keys()].filter((g) => !COMPACT_GROUP_ORDER.includes(g));
  return [...ordered, ...extras].map((g) => groups.get(g)!);
}

function getWindowDurationMs(window: QuotaWindowView): number | null {
  const { id } = window;
  if (id === "five_hour" || id === "session") {
    return 5 * ONE_HOUR_MS;
  }
  if (id.startsWith("weekly") || id.startsWith("seven_day")) {
    return ONE_WEEK_MS;
  }
  if (id === "monthly" || id === "monthly_credits") {
    return 31 * ONE_DAY_MS;
  }
  return null;
}

function getExpandedDurationUnit(
  window: QuotaWindowView,
): { unitMs: number; suffix: "h" | "d" } | null {
  const { id } = window;
  if (id === "five_hour" || id === "session") {
    return { unitMs: ONE_HOUR_MS, suffix: "h" };
  }
  if (
    id.startsWith("weekly") ||
    id.startsWith("seven_day") ||
    id === "monthly" ||
    id === "monthly_credits"
  ) {
    return { unitMs: ONE_DAY_MS, suffix: "d" };
  }
  return null;
}

interface WindowRunway {
  // Remaining quota expressed in average-pace time.
  numeratorMs: number;
  // Time actually left in the window.
  denominatorMs: number;
}

// Runway numerator = remaining quota expressed in average-pace time: the
// fraction of quota left times the window's full duration. Denominator is
// the time actually left in the window.
function getWindowRunway(window: QuotaWindowView, now: number): WindowRunway | null {
  if (typeof window.utilization !== "number" || window.resetsAtMs == null) {
    return null;
  }
  const durationMs = getWindowDurationMs(window);
  if (!durationMs) {
    return null;
  }
  const remainingMs = Math.max(0, window.resetsAtMs - now);
  const remainingPct = Math.max(0, 100 - window.utilization);
  return {
    numeratorMs: (remainingPct / 100) * durationMs,
    denominatorMs: remainingMs,
  };
}

// Runway fraction, e.g. "2.5/2.5h" - the unit suffix appears once, on the
// denominator, since both sides always share it. The numerator tops out at
// the window's full duration (remainingPct = 100), so it never diverges the
// way a pace-based projection would.
function formatRunwayFraction(
  runway: WindowRunway,
  unit: { unitMs: number; suffix: "h" | "d" },
): string {
  const numeratorStr = formatUnitValue(runway.numeratorMs, unit.unitMs);
  const denominatorStr = formatUnitValue(runway.denominatorMs, unit.unitMs);
  return `${numeratorStr}/${denominatorStr}${unit.suffix}`;
}

function formatUnitValue(ms: number, unitMs: number): string {
  const value = ms / unitMs;
  if (value > 0 && value < 0.1) {
    const rounded = Math.round(value * 100) / 100;
    return rounded.toFixed(2);
  }
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
}

function formatRemainingDuration(ms: number): string {
  if (ms >= ONE_DAY_MS) {
    const d = ms / ONE_DAY_MS;
    const r = Math.round(d * 10) / 10;
    return `${Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1)}d`;
  }
  if (ms >= ONE_HOUR_MS) {
    const h = ms / ONE_HOUR_MS;
    const r = Math.round(h * 10) / 10;
    return `${Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1)}h`;
  }
  return `${Math.max(1, Math.ceil(ms / (60 * 1000)))}m`;
}

export function isWindowStale(window: QuotaWindowView, now: number): boolean {
  return window.resetsAtMs != null && now > window.resetsAtMs;
}

// A provider's usage windows plus its limit-bearing balances, which render
// through the same path. Balances with no limit are dropped here and shown as a
// raw amount by the caller.
export function getProviderQuotaWindows(usage: ProviderUsage): QuotaWindowView[] {
  const balanceWindows = (usage.balances ?? [])
    .map(balanceToQuotaWindowView)
    .filter((window): window is QuotaWindowView => window !== null);
  return [...usage.windows.map(toQuotaWindowView), ...balanceWindows];
}

function getWindowRemainingPercent(window: QuotaWindowView): number | null {
  if (typeof window.utilization !== "number") {
    return null;
  }
  return Math.max(0, Math.min(100, 100 - window.utilization));
}

function getElapsedFraction(window: QuotaWindowView, now: number): number | null {
  const durationMs = getWindowDurationMs(window);
  if (!durationMs || window.resetsAtMs == null) {
    return null;
  }
  const elapsedMs = Math.max(0, durationMs - Math.max(0, window.resetsAtMs - now));
  const elapsedFraction = elapsedMs / durationMs;
  return elapsedFraction > 0 ? elapsedFraction : null;
}

// Tone boundary curve: the used-fraction threshold at elapsed fraction t for a
// given leak e. Linear-fractional form through (0, e), (TONE_MID_T, e + TONE_MID_T),
// (1, 1), so every tone shares one shape and differs only by e.
const TONE_MID_T = 0.9;
function toneBoundary(t: number, e: number): number {
  const c = e / (1 - TONE_MID_T - e);
  const a = c + 1 - e;
  return (a * t + e) / (c * t + 1);
}

// Tone compares the used fraction u against the boundary curves at elapsed
// fraction t: at or above the red curve (e = 0.06) is red, else at or above the
// amber curve (e = 0.03) is amber, else at or below the purple curve (e = -0.12)
// is purple. Past its reset a window is stale (muted); before any time has
// elapsed or without the data to place it (utilization, duration, reset) it
// stays neutral.
// (ProviderUsageWindow.tone is ignored: providers derive it from usedPct, so it
// adds nothing here.)
export function getWindowTone(window: QuotaWindowView, now: number): WindowTone {
  if (isWindowStale(window, now)) {
    return "muted";
  }

  const t = getElapsedFraction(window, now);
  if (t == null || typeof window.utilization !== "number") {
    return "neutral";
  }

  const u = window.utilization / 100;
  if (u >= toneBoundary(t, 0.06)) {
    return "red";
  }
  if (u >= toneBoundary(t, 0.03)) {
    return "amber";
  }
  if (u <= toneBoundary(t, -0.12)) {
    return "purple";
  }
  return "neutral";
}

// The worst tone across all of a provider's windows and limit-bearing
// balances - the single attention level for the whole provider. Used both for
// the sidebar pill's compact tone override and to tint a provider's models in
// the model selector.
export function getProviderUsageTone(usage: ProviderUsage, now: number): WindowTone {
  return getProviderQuotaWindows(usage).reduce(
    (worst, w) => worstTone(worst, getWindowTone(w, now)),
    "neutral" as WindowTone,
  );
}

const TERSE_LABEL: Record<string, string> = {
  five_hour: "5h",
  session: "5h",
  weekly: "7d",
  seven_day: "7d",
  monthly: "1M",
  overage: "Overage",
};

// Per-model windows (weekly_opus, weekly_omelette, and the legacy seven_day_*
// ids) render as "7d <Model>", so a new model codename needs no map entry.
function weeklyVariantLabel(id: string): string | null {
  let prefix: string | null = null;
  if (id.startsWith("weekly_")) {
    prefix = "weekly_";
  } else if (id.startsWith("seven_day_")) {
    prefix = "seven_day_";
  }
  if (!prefix) {
    return null;
  }
  const model = id.slice(prefix.length);
  return model ? `7d ${model.charAt(0).toUpperCase()}${model.slice(1)}` : "7d";
}

function formatWindowLabel(window: QuotaWindowView): string {
  return TERSE_LABEL[window.id] ?? weeklyVariantLabel(window.id) ?? window.serverLabel ?? window.id;
}

function formatResetLabel(window: QuotaWindowView, now: number): string {
  if (window.resetsAtMs == null) {
    return "—";
  }
  const resetDate = new Date(window.resetsAtMs);
  const hours = `${resetDate.getHours()}`.padStart(2, "0");
  const minutes = `${resetDate.getMinutes()}`.padStart(2, "0");
  const timeLabel = `${hours}:${minutes}`;
  const remainingMs = window.resetsAtMs - now;
  const dayLabel = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][resetDate.getDay()];

  if (window.id === "monthly" || window.id === "monthly_credits") {
    if (remainingMs < ONE_DAY_MS) {
      return timeLabel;
    }
    if (remainingMs < ONE_WEEK_MS) {
      return `${dayLabel} ${timeLabel}`;
    }
    const month = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ][resetDate.getMonth()];
    return `${month} ${resetDate.getDate()} ${timeLabel}`;
  }

  if (window.id === "five_hour" || window.id === "session") {
    return timeLabel;
  }

  if (remainingMs <= ONE_DAY_MS) {
    return `${dayLabel} ${timeLabel}`;
  }
  return dayLabel;
}

// Compact value, e.g. "2.5/2.5h" / "1M ? ↻ Fri".
export function formatWindowValue(window: QuotaWindowView, now: number): string {
  const label = formatWindowLabel(window);

  if (isWindowStale(window, now)) {
    return `${label} ? ↻ ${formatResetLabel(window, now)}`;
  }

  if (typeof window.utilization === "number" && window.resetsAtMs != null) {
    const remainingPct = Math.max(0, Math.round(100 - window.utilization));
    const expandedDurationUnit = getExpandedDurationUnit(window);
    const runway = getWindowRunway(window, now);

    if (expandedDurationUnit && runway) {
      return formatRunwayFraction(runway, expandedDurationUnit);
    }
    return `${label} ${remainingPct}% ↻ ${formatResetLabel(window, now)}`;
  }

  if (window.isUsingOverage) {
    return `${label} $ ↻ ${formatResetLabel(window, now)}`;
  }
  if (typeof window.utilization === "number") {
    return `${label} ${Math.max(0, Math.round(100 - window.utilization))}%`;
  }
  return `${label} ? ↻ ${formatResetLabel(window, now)}`;
}

export interface ExpandedWindowPieces {
  label: string;
  reset: string;
  used: string | null;
  remaining: string | null;
}

// Expanded row, e.g. "5h  ↻ 18:20  used 55%/4.5h  left 45%/30m".
export function getExpandedWindowPieces(
  window: QuotaWindowView,
  now: number,
): ExpandedWindowPieces {
  const label = formatWindowLabel(window);

  if (isWindowStale(window, now)) {
    return {
      label,
      reset: `↻ ${formatResetLabel(window, now)}`,
      used: "used ?",
      remaining: "left ?",
    };
  }

  const resetStr = `↻ ${formatResetLabel(window, now)}`;

  if (typeof window.utilization === "number") {
    const usedPct = Math.round(window.utilization);
    const remainingPct = Math.max(0, Math.round(100 - window.utilization));

    if (window.resetsAtMs == null) {
      return {
        label,
        reset: "↻ —",
        used: `used ${usedPct}%`,
        remaining: `left ${remainingPct}%`,
      };
    }

    const remainingMs = Math.max(0, window.resetsAtMs - now);
    const durationMs = getWindowDurationMs(window);
    const elapsedMs = durationMs != null ? Math.max(0, durationMs - remainingMs) : null;

    return {
      label,
      reset: resetStr,
      used:
        elapsedMs != null
          ? `used ${usedPct}%/${formatRemainingDuration(elapsedMs)}`
          : `used ${usedPct}%`,
      remaining: `left ${remainingPct}%/${formatRemainingDuration(remainingMs)}`,
    };
  }

  if (window.isUsingOverage) {
    return {
      label,
      reset: `↻ ${formatResetLabel(window, now)}`,
      used: "$",
      remaining: "$",
    };
  }
  return {
    label,
    reset: `↻ ${formatResetLabel(window, now)}`,
    used: "used ?",
    remaining: "left ?",
  };
}
