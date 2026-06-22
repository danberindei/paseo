import { describe, expect, it } from "vitest";
import type { ProviderUsage, ProviderUsageBalance } from "./types";
import { balanceValueText, filterVisibleProviders } from "./sidebar-section-utils";

function makeProvider(
  providerId: string,
  overrides: Partial<Omit<ProviderUsage, "providerId">> = {},
): ProviderUsage {
  return {
    providerId,
    displayName: providerId,
    status: "available",
    planLabel: null,
    windows: [],
    ...overrides,
  };
}

function makeBalance(overrides: Partial<ProviderUsageBalance> = {}): ProviderUsageBalance {
  return {
    id: "b1",
    label: "Credits",
    unit: "usd",
    ...overrides,
  };
}

describe("filterVisibleProviders", () => {
  it("includes available providers with windows", () => {
    const provider = makeProvider("claude", {
      windows: [{ id: "w1", label: "Monthly", usedPct: 50 }],
    });
    expect(filterVisibleProviders([provider])).toEqual([provider]);
  });

  it("includes available providers with balances and no windows", () => {
    const provider = makeProvider("cursor", {
      balances: [makeBalance({ remaining: 5.0 })],
    });
    expect(filterVisibleProviders([provider])).toEqual([provider]);
  });

  it("includes available providers with both windows and balances", () => {
    const provider = makeProvider("openai", {
      windows: [{ id: "w1", label: "Daily", usedPct: 10 }],
      balances: [makeBalance()],
    });
    expect(filterVisibleProviders([provider])).toEqual([provider]);
  });

  it("excludes available providers with no windows and no balances", () => {
    const provider = makeProvider("empty");
    expect(filterVisibleProviders([provider])).toEqual([]);
  });

  it("excludes providers whose only balance has no positive amount", () => {
    const zeroCredits = makeProvider("codex", {
      balances: [makeBalance({ remaining: 0 })],
    });
    expect(filterVisibleProviders([zeroCredits])).toEqual([]);
  });

  it("excludes unavailable providers even with windows", () => {
    const provider = makeProvider("offline", {
      status: "unavailable",
      windows: [{ id: "w1", label: "Monthly", usedPct: 50 }],
    });
    expect(filterVisibleProviders([provider])).toEqual([]);
  });

  it("excludes error-status providers even with balances", () => {
    const provider = makeProvider("broken", {
      status: "error",
      balances: [makeBalance()],
    });
    expect(filterVisibleProviders([provider])).toEqual([]);
  });

  it("returns only the matching providers from a mixed list", () => {
    const withWindows = makeProvider("claude", {
      windows: [{ id: "w1", label: "Monthly", usedPct: 50 }],
    });
    const withBalances = makeProvider("cursor", {
      balances: [makeBalance({ remaining: 5.0 })],
    });
    const empty = makeProvider("empty");
    const offline = makeProvider("offline", { status: "unavailable" });
    const result = filterVisibleProviders([withWindows, withBalances, empty, offline]);
    expect(result).toEqual([withWindows, withBalances]);
  });

  it("returns an empty array for an empty input", () => {
    expect(filterVisibleProviders([])).toEqual([]);
  });
});

describe("balanceValueText", () => {
  it("formats used / limit with usd unit", () => {
    const balance = makeBalance({ used: 12.5, limit: 25, unit: "usd" });
    expect(balanceValueText(balance)).toBe("$12.50 / $25.00");
  });

  it("derives used from limit - remaining when used is absent", () => {
    const balance = makeBalance({ remaining: 8, limit: 20, unit: "usd" });
    expect(balanceValueText(balance)).toBe("$12.00 / $20.00");
  });

  it("falls back to -- when limit is set but used and remaining are both absent", () => {
    const balance = makeBalance({ limit: 10, unit: "usd" });
    expect(balanceValueText(balance)).toBe("--");
  });

  it("formats remaining with 'left' suffix when there is no limit", () => {
    const balance = makeBalance({ remaining: 5.5, unit: "usd" });
    expect(balanceValueText(balance)).toBe("$5.50 left");
  });

  it("formats used amount alone when there is no limit or remaining", () => {
    const balance = makeBalance({ used: 3.0, unit: "usd" });
    expect(balanceValueText(balance)).toBe("$3.00");
  });

  it("returns -- when all amount fields are absent", () => {
    const balance = makeBalance({ unit: "usd" });
    expect(balanceValueText(balance)).toBe("--");
  });

  it("formats credits unit", () => {
    const balance = makeBalance({ remaining: 1500, unit: "credits" });
    expect(balanceValueText(balance)).toBe("1,500 left");
  });

  it("treats a limit of zero as no limit", () => {
    const balance = makeBalance({ remaining: 5, limit: 0, unit: "usd" });
    expect(balanceValueText(balance)).toBe("$5.00 left");
  });
});
