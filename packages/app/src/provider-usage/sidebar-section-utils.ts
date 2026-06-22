import { formatAmount } from "./format";
import type { ProviderUsage, ProviderUsageBalance } from "./types";

// A balance is worth a line only when it carries a positive amount. A zero or
// empty balance (e.g. Codex reporting $0.00 credits for a plan that has none)
// would render as a worthless "Credits $0.00" row, so it is hidden.
export function hasDisplayableBalance(balance: ProviderUsageBalance): boolean {
  const { used, remaining, limit } = balance;
  return (
    (limit != null && limit > 0) ||
    (remaining != null && remaining > 0) ||
    (used != null && used > 0)
  );
}

export function filterVisibleProviders(providers: ProviderUsage[]): ProviderUsage[] {
  return providers.filter(
    (usage) =>
      usage.status === "available" &&
      (usage.windows.length > 0 || (usage.balances ?? []).some(hasDisplayableBalance)),
  );
}

export function balanceValueText(balance: ProviderUsageBalance): string {
  const { used, remaining, limit, unit } = balance;
  if (limit != null && limit > 0) {
    const usedAmount = used ?? (remaining != null ? limit - remaining : null);
    return usedAmount != null
      ? `${formatAmount(usedAmount, unit)} / ${formatAmount(limit, unit)}`
      : "--";
  }
  if (remaining != null) return `${formatAmount(remaining, unit)} left`;
  if (used != null) return formatAmount(used, unit);
  return "--";
}
