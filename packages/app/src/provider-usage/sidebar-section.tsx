// Persistent at-a-glance quota surface for the left sidebar.
//
// Compact mode is a wrapping row of per-provider pills, each showing one terse
// burn-rate value per window class (5h 38.5%/h); expanding the section drops a
// per-window detail list under every pill. Sourced from useProviderUsage;
// display logic lives in sidebar-quota-display.ts.
import { ChevronDown, ChevronUp } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, type PressableStateCallbackType, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ProviderIcon } from "@/components/provider-icon";
import type { Theme } from "@/styles/theme";
import {
  balanceValueText,
  filterVisibleProviders,
  hasDisplayableBalance,
} from "./sidebar-section-utils";
import {
  balanceToQuotaWindowView,
  formatWindowValue,
  getCompactGroup,
  getCompactWindows,
  getExpandedWindowPieces,
  getProviderQuotaWindows,
  getProviderUsageTone,
  getWindowTone,
  isWindowStale,
  type QuotaWindowView,
  sortWindows,
  type WindowTone,
  worstTone,
} from "./sidebar-quota-display";
import type { ProviderUsage } from "./types";
import { useProviderUsage } from "./use-provider-usage";

const TONE_STYLE: Record<
  WindowTone,
  "toneRed" | "toneAmber" | "tonePurple" | "toneMuted" | "toneNeutral"
> = {
  red: "toneRed",
  amber: "toneAmber",
  purple: "tonePurple",
  muted: "toneMuted",
  neutral: "toneNeutral",
};

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronUp = withUnistyles(ChevronUp);

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const warningColorMapping = (theme: Theme) => ({ color: theme.colors.statusWarning });

// `withUnistyles` keeps the icon color theme-reactive (per docs/unistyles.md);
// `color` is supplied via `uniProps`, the rest of the props are passed through.
const ThemedProviderIcon = withUnistyles(ProviderIcon);

function QuotaWindow({
  window,
  now,
  compact,
  toneOverride,
}: {
  window: QuotaWindowView;
  now: number;
  compact?: boolean;
  toneOverride?: WindowTone;
}) {
  const windowTone = getWindowTone(window, now);
  const tone = toneOverride ? worstTone(windowTone, toneOverride) : windowTone;
  const textStyle = useMemo(() => [styles.windowValue, styles[TONE_STYLE[tone]]], [tone]);
  if (compact) {
    return (
      <View style={styles.compactWindow}>
        <Text style={textStyle} numberOfLines={1}>
          {formatWindowValue(window, now)}
        </Text>
      </View>
    );
  }

  const pieces = getExpandedWindowPieces(window, now);
  return (
    <View style={styles.secondaryWindow}>
      <Text style={textStyle}>{pieces.label}</Text>
      <Text style={textStyle}>{pieces.reset}</Text>
      {pieces.used != null && <Text style={textStyle}>{pieces.used}</Text>}
      {pieces.remaining != null && <Text style={textStyle}>{pieces.remaining}</Text>}
    </View>
  );
}

function SectionToggle({ isExpanded, onToggle }: { isExpanded: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const sectionToggleStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.sectionToggle,
      hovered && styles.sectionToggleHovered,
      pressed && styles.sectionTogglePressed,
    ],
    [],
  );
  const accessibilityState = useMemo(() => ({ expanded: isExpanded }), [isExpanded]);

  return (
    <Pressable
      style={sectionToggleStyle}
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={t("sidebar.providerUsage.toggleLabel")}
      accessibilityState={accessibilityState}
    >
      {({ hovered }: PressableStateCallbackType & { hovered?: boolean }) =>
        isExpanded ? (
          <ThemedChevronDown
            size={14}
            uniProps={hovered ? foregroundColorMapping : foregroundMutedColorMapping}
          />
        ) : (
          <ThemedChevronUp
            size={14}
            uniProps={hovered ? foregroundColorMapping : foregroundMutedColorMapping}
          />
        )
      }
    </Pressable>
  );
}

function QuotaProviderRow({
  usage,
  serverId,
  isExpanded,
  now,
}: {
  usage: ProviderUsage;
  serverId: string | null;
  isExpanded: boolean;
  now: number;
}) {
  const sortedWindows = useMemo(() => sortWindows(getProviderQuotaWindows(usage)), [usage]);
  const compactWindows = useMemo(() => getCompactWindows(sortedWindows, now), [sortedWindows, now]);
  const compactToneOverride = useMemo(() => getProviderUsageTone(usage, now), [usage, now]);
  const hasStaleWindow = useMemo(
    () => sortedWindows.some((window) => isWindowStale(window, now)),
    [sortedWindows, now],
  );
  const providerRowStyle = useMemo(
    () => [styles.providerRow, hasStaleWindow && styles.providerRowStale],
    [hasStaleWindow],
  );

  // Limitless balances (a remaining credit amount with no total) keep their
  // native amount, e.g. "Credits $5.50 left".
  const amountBalanceLines = useMemo(
    () =>
      (usage.balances ?? [])
        .filter(
          (balance) => balanceToQuotaWindowView(balance) === null && hasDisplayableBalance(balance),
        )
        .map((balance) => `${balance.label} ${balanceValueText(balance)}`),
    [usage.balances],
  );

  return (
    <View style={providerRowStyle}>
      <View style={styles.providerRowContent}>
        <View style={styles.providerMainRow}>
          <View style={styles.providerMainRowContent}>
            <View style={styles.providerIcon}>
              <ThemedProviderIcon
                provider={usage.providerId}
                serverId={serverId}
                size={16}
                uniProps={hasStaleWindow ? warningColorMapping : foregroundMutedColorMapping}
              />
            </View>
            {compactWindows.map((window) => (
              <QuotaWindow
                key={getCompactGroup(window.id)}
                window={window}
                now={now}
                compact
                toneOverride={compactToneOverride}
              />
            ))}
            {amountBalanceLines.map((line) => (
              <Text key={line} style={styles.balanceValue} numberOfLines={1}>
                {line}
              </Text>
            ))}
          </View>
        </View>
        {isExpanded && sortedWindows.length > 0 ? (
          <View style={styles.secondaryWindowList}>
            {sortedWindows.map((window) => (
              <QuotaWindow key={window.id} window={window} now={now} />
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export interface ProviderUsageSidebarSectionProps {
  serverId: string | null;
}

export function ProviderUsageSidebarSection({ serverId }: ProviderUsageSidebarSectionProps) {
  const { view } = useProviderUsage(serverId);
  const [isExpanded, setIsExpanded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const handleToggle = useCallback(() => {
    setIsExpanded((value) => !value);
  }, []);
  const sectionContentStyle = useMemo(
    () => [styles.sectionContent, isExpanded && styles.sectionContentExpanded],
    [isExpanded],
  );

  useEffect(() => {
    setIsExpanded(false);
  }, [serverId]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 30_000);
    return () => clearInterval(timer);
  }, []);

  const visible = useMemo(() => {
    const providers = view.kind === "ready" ? view.payload.providers : [];
    return filterVisibleProviders(providers);
  }, [view]);

  // The sidebar surface stays out of the way until there is something to show.
  if (visible.length === 0) {
    return null;
  }

  return (
    <View style={styles.section}>
      <View style={sectionContentStyle}>
        {visible.map((usage) => (
          <QuotaProviderRow
            key={usage.providerId}
            usage={usage}
            serverId={serverId}
            isExpanded={isExpanded}
            now={now}
          />
        ))}
      </View>
      <SectionToggle isExpanded={isExpanded} onToggle={handleToggle} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  section: {
    gap: theme.spacing[1],
    position: "relative",
  },
  sectionToggle: {
    position: "absolute",
    top: 0,
    right: 0,
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.full,
  },
  sectionToggleHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  sectionTogglePressed: {
    opacity: 0.85,
  },
  sectionContent: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[1],
  },
  sectionContentExpanded: {
    flexDirection: "column",
    flexWrap: "nowrap",
  },
  providerRow: {
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: "transparent",
    backgroundColor: theme.colors.surfaceSidebar,
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
  },
  providerRowStale: {
    borderColor: theme.colors.statusWarning,
  },
  providerRowContent: {
    gap: theme.spacing[1],
  },
  providerMainRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "nowrap",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    width: "100%",
    minWidth: 0,
  },
  providerMainRowContent: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 1,
    gap: theme.spacing[2],
    minWidth: 0,
  },
  providerIcon: {
    flexShrink: 0,
  },
  compactWindow: {
    flexShrink: 0,
  },
  secondaryWindowList: {
    gap: theme.spacing[1],
  },
  secondaryWindow: {
    flexDirection: "row",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  windowValue: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  balanceValue: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  toneRed: {
    color: theme.colors.statusDanger,
  },
  toneAmber: {
    color: theme.colors.statusWarning,
  },
  tonePurple: {
    color: theme.colors.statusMerged,
  },
  toneMuted: {
    color: theme.colors.foregroundMuted,
    opacity: 0.6,
  },
  toneNeutral: {
    color: theme.colors.foreground,
  },
}));
