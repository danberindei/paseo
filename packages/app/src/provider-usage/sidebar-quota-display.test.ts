import { describe, expect, it } from "vitest";
import type { ProviderUsage, ProviderUsageBalance, ProviderUsageWindow } from "./types";
import {
  balanceToQuotaWindowView,
  formatWindowValue,
  getCompactWindows,
  getProviderQuotaWindows,
  getWindowTone,
  isWindowStale,
  sortWindows,
  toQuotaWindowView,
} from "./sidebar-quota-display";

const NOW = new Date("2026-06-22T12:00:00Z").getTime();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function iso(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString();
}

function makeWindow(overrides: Partial<ProviderUsageWindow> & { id: string }): ProviderUsageWindow {
  return { label: overrides.id, ...overrides };
}

function view(overrides: Partial<ProviderUsageWindow> & { id: string }) {
  return toQuotaWindowView(makeWindow(overrides));
}

describe("toQuotaWindowView", () => {
  it("maps usedPct to utilization and parses resetsAt", () => {
    const v = view({ id: "five_hour", usedPct: 60, resetsAt: iso(2 * HOUR) });
    expect(v.utilization).toBe(60);
    expect(v.resetsAtMs).toBe(NOW + 2 * HOUR);
    expect(v.isUsingOverage).toBe(false);
  });

  it("derives utilization from remainingPct when usedPct is absent", () => {
    expect(view({ id: "five_hour", remainingPct: 30 }).utilization).toBe(70);
  });

  it("flags overage when shortfallPct is positive", () => {
    expect(view({ id: "five_hour", shortfallPct: 10 }).isUsingOverage).toBe(true);
  });
});

describe("formatWindowValue", () => {
  it("renders a full runway for a fresh window", () => {
    const v = view({ id: "five_hour", usedPct: 0, resetsAt: iso(5 * HOUR) });
    expect(formatWindowValue(v, NOW)).toBe("5/5h");
  });

  it("renders a matching runway when on pace", () => {
    const v = view({ id: "five_hour", usedPct: 50, resetsAt: iso(2.5 * HOUR) });
    expect(formatWindowValue(v, NOW)).toBe("2.5/2.5h");
  });

  it("renders a shorter runway than the window left when overspending", () => {
    const v = view({ id: "five_hour", usedPct: 75, resetsAt: iso(2.5 * HOUR) });
    expect(formatWindowValue(v, NOW)).toBe("1.3/2.5h");
  });

  it("renders a runway past the window left on zero usage", () => {
    const v = view({ id: "five_hour", usedPct: 0, resetsAt: iso(2.5 * HOUR) });
    expect(formatWindowValue(v, NOW)).toBe("5/2.5h");
  });

  it("renders a runway well past the window left when most quota remains right before reset", () => {
    const v = view({ id: "seven_day", usedPct: 5, resetsAt: iso(0.5 * DAY) });
    expect(formatWindowValue(v, NOW)).toBe("6.7/0.5d");
  });

  it("renders the small-number runway for a near-reset window that is on pace", () => {
    const v = view({ id: "five_hour", usedPct: 90, resetsAt: iso(30 * 60 * 1000) });
    expect(formatWindowValue(v, NOW)).toBe("0.5/0.5h");
  });

  it("shows two fractional digits when the runway and remaining window are below 0.1", () => {
    const v = view({ id: "five_hour", usedPct: 99, resetsAt: iso(5.5 * 60 * 1000) });
    expect(formatWindowValue(v, NOW)).toBe("0.05/0.09h");
  });

  it("renders a runway well past the window left for a near-reset window with little usage", () => {
    const v = view({ id: "five_hour", usedPct: 10, resetsAt: iso(30 * 60 * 1000) });
    expect(formatWindowValue(v, NOW)).toBe("4.5/0.5h");
  });

  it("falls back to the absolute percent when the window duration is not inferable", () => {
    const v = view({ id: "quarterly", label: "Quarterly", usedPct: 50, resetsAt: iso(5 * DAY) });
    expect(formatWindowValue(v, NOW).startsWith("Quarterly 50% ↻")).toBe(true);
  });

  it("marks stale windows that are past their reset", () => {
    const v = view({ id: "five_hour", usedPct: 60, resetsAt: iso(-HOUR) });
    expect(formatWindowValue(v, NOW).startsWith("5h ? ")).toBe(true);
  });

  it("marks overage windows", () => {
    const v = view({ id: "five_hour", shortfallPct: 5, resetsAt: iso(2 * HOUR) });
    expect(formatWindowValue(v, NOW).startsWith("5h $ ")).toBe(true);
  });

  it("renders a runway for the weekly window", () => {
    const v = view({ id: "weekly", label: "Weekly", usedPct: 50, resetsAt: iso(3.5 * DAY) });
    expect(formatWindowValue(v, NOW)).toBe("3.5/3.5d");
  });

  it("renders a runway for the session window", () => {
    const v = view({ id: "session", label: "Session", usedPct: 50, resetsAt: iso(2.5 * HOUR) });
    expect(formatWindowValue(v, NOW)).toBe("2.5/2.5h");
  });

  it("drops the label for per-model weekly variants", () => {
    const v = view({
      id: "weekly_omelette",
      label: "Weekly · Omelette",
      usedPct: 50,
      resetsAt: iso(3.5 * DAY),
    });
    expect(formatWindowValue(v, NOW)).toBe("3.5/3.5d");
  });
});

describe("getWindowTone", () => {
  it("returns muted for stale windows", () => {
    const v = view({ id: "five_hour", usedPct: 10, resetsAt: iso(-HOUR) });
    expect(getWindowTone(v, NOW)).toBe("muted");
  });

  it("returns red when the pace score is far below the expected pace", () => {
    const v = view({ id: "five_hour", usedPct: 90, resetsAt: iso(2.5 * HOUR) });
    expect(getWindowTone(v, NOW)).toBe("red");
  });

  it("returns amber when the score is over pace but not yet red", () => {
    const v = view({ id: "five_hour", usedPct: 69, resetsAt: iso(2.5 * HOUR) });
    expect(getWindowTone(v, NOW)).toBe("amber");
  });

  it("returns purple when a long window is well under pace", () => {
    const v = view({ id: "seven_day", usedPct: 0, resetsAt: iso(DAY) });
    expect(getWindowTone(v, NOW)).toBe("purple");
  });

  it("stays neutral when the score is near one", () => {
    const v = view({ id: "five_hour", usedPct: 50, resetsAt: iso(2.5 * HOUR) });
    expect(getWindowTone(v, NOW)).toBe("neutral");
  });

  it("stays neutral when there is no utilization data to grade", () => {
    const v = view({ id: "five_hour", tone: "warning", resetsAt: iso(2 * HOUR) });
    expect(getWindowTone(v, NOW)).toBe("neutral");
  });
});

describe("getProviderQuotaWindows", () => {
  function makeProvider(
    windows: ProviderUsageWindow[],
    balances: ProviderUsageBalance[] = [],
  ): ProviderUsage {
    return {
      providerId: "codex-eng",
      displayName: "Codex Eng",
      status: "available",
      planLabel: null,
      windows,
      balances,
    };
  }

  it("keeps usage windows and limit-bearing balances, drops limitless balances", () => {
    const provider = makeProvider(
      [makeWindow({ id: "five_hour", usedPct: 20, resetsAt: iso(HOUR) })],
      [
        {
          id: "monthly_credits",
          label: "Monthly credits",
          unit: "credits",
          used: 20,
          limit: 100,
          resetsAt: iso(5 * DAY),
        },
        { id: "credits", label: "Credits", unit: "usd", remaining: 5.5 },
      ],
    );

    expect(getProviderQuotaWindows(provider).map((window) => window.id)).toEqual([
      "five_hour",
      "monthly_credits",
    ]);
  });

  it("reports staleness across windows and balances", () => {
    const staleWindow = makeProvider([
      makeWindow({ id: "five_hour", usedPct: 20, resetsAt: iso(-3 * 60 * 1000) }),
      makeWindow({ id: "seven_day", usedPct: 20, resetsAt: iso(5 * DAY) }),
    ]);
    const staleBalance = makeProvider(
      [],
      [
        {
          id: "monthly_credits",
          label: "Monthly credits",
          unit: "credits",
          used: 20,
          limit: 100,
          resetsAt: iso(-3 * 60 * 1000),
        },
      ],
    );
    const fresh = makeProvider([
      makeWindow({ id: "five_hour", usedPct: 20, resetsAt: iso(HOUR) }),
      makeWindow({ id: "seven_day", usedPct: 20, resetsAt: iso(5 * DAY) }),
    ]);

    const hasStale = (provider: ProviderUsage) =>
      getProviderQuotaWindows(provider).some((window) => isWindowStale(window, NOW));

    expect(hasStale(staleWindow)).toBe(true);
    expect(hasStale(staleBalance)).toBe(true);
    expect(hasStale(fresh)).toBe(false);
  });
});

describe("balanceToQuotaWindowView", () => {
  function makeBalance(overrides: Partial<ProviderUsageBalance> = {}): ProviderUsageBalance {
    return { id: "plan_usage", label: "Plan usage", unit: "usd", ...overrides };
  }

  it("converts a used/limit balance into a percentage window", () => {
    const v = balanceToQuotaWindowView(makeBalance({ used: 12.5, limit: 25 }));
    expect(v?.utilization).toBe(50);
  });

  it("derives utilization from remaining when used is absent", () => {
    const v = balanceToQuotaWindowView(makeBalance({ remaining: 5, limit: 20 }));
    expect(v?.utilization).toBe(75);
  });

  it("renders like a window once converted", () => {
    const v = balanceToQuotaWindowView(
      makeBalance({ id: "monthly_credits", label: "Monthly credits", used: 50, limit: 100 }),
    );
    expect(v && formatWindowValue(v, NOW)).toBe("Monthly credits 50%");
  });

  it("returns null when there is no limit to form a percentage", () => {
    expect(balanceToQuotaWindowView(makeBalance({ remaining: 5.5 }))).toBeNull();
  });

  it("returns null when the limit is zero", () => {
    expect(balanceToQuotaWindowView(makeBalance({ used: 1, limit: 0 }))).toBeNull();
  });
});

describe("getCompactWindows", () => {
  it("collapses per-model seven_day variants into a single group", () => {
    const windows = [
      view({ id: "seven_day_opus", usedPct: 10, resetsAt: iso(5 * DAY) }),
      view({ id: "seven_day_sonnet", usedPct: 90, resetsAt: iso(DAY) }),
    ];
    const compact = getCompactWindows(windows, NOW);
    expect(compact).toHaveLength(1);
    // The worse (sonnet) window wins the shared slot.
    expect(compact[0]?.id).toBe("seven_day_sonnet");
  });

  it("orders groups five_hour before seven_day before monthly", () => {
    const windows = sortWindows([
      view({ id: "monthly", usedPct: 10, resetsAt: iso(20 * DAY) }),
      view({ id: "seven_day", usedPct: 10, resetsAt: iso(5 * DAY) }),
      view({ id: "five_hour", usedPct: 10, resetsAt: iso(2 * HOUR) }),
    ]);
    expect(windows.map((w) => w.id)).toEqual(["five_hour", "seven_day", "monthly"]);
  });
});
