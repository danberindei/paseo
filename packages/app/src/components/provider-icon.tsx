import { Layers } from "lucide-react-native";
import { useMemo, type ComponentType, type ReactElement } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";

import { resolveProviderBaseIconId } from "./provider-icon-name";
import {
  getProviderIcon,
  providerIconFromName,
  type ProviderIconComponent,
} from "./provider-icons";
import { useProviderBaseIconId } from "@/hooks/use-provider-base-icon-id";
import type { Theme } from "@/styles/theme";

export interface ProviderIconProps {
  /** The provider id to render. */
  provider: string;
  /** Required for the derived-provider badge. Pass `null` to skip the badge. */
  serverId: string | null;
  size: number;
  color: string;
  /** Outer style (e.g. flex layout, padding). The badge is positioned absolutely. */
  style?: StyleProp<ViewStyle>;
  /**
   * If false, skip the live snapshot lookup and never render a badge. Use this
   * for terminal-profile icons (decorative; not bound to a server) and tests.
   * Default: true.
   */
  showDerivedBadge?: boolean;
  /** Test hook for tests/unit-style badge rendering. Overrides the live lookup. */
  derivedFromProviderIdOverride?: string | null;
}

const BADGE_OFFSET = -2;
const BADGE_BORDER_WIDTH = 1;
const BADGE_BORDER_RADIUS_RATIO = 0.5;
const BADGE_INNER_PADDING = 4;

// `Layers` is themed via `withUnistyles` per docs/unistyles.md. The icon color
// comes from the consumer's `color` prop directly on the dynamic provider icon.
const ThemedLayers = withUnistyles(Layers);
const badgeColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * Self-contained provider icon. When `provider` is a derived custom profile
 * (an `extends`-based custom provider whose base id on the live snapshot
 * resolves to a known icon), it renders the base provider's icon (e.g. the
 * Claude logo for a `claude-eng` profile) with a small `Layers` badge in the
 * top-right corner marking it as a derived profile.
 *
 * Otherwise - `serverId` is `null`, `showDerivedBadge` is false, the provider
 * isn't derived, or its base id is unknown - it renders the provider's own
 * `getProviderIcon` component with no badge.
 */
export function ProviderIcon({
  provider,
  serverId,
  size,
  color,
  style,
  showDerivedBadge = true,
  derivedFromProviderIdOverride,
}: ProviderIconProps): ReactElement {
  // Live base id. `derivedFromProviderIdOverride` short-circuits the hook
  // (tests) and is also handy for cases where a caller already has the field
  // on hand - but in practice, prefer the hook so the icon stays reactive.
  const baseIdFromHook = useProviderBaseIconId(
    showDerivedBadge && derivedFromProviderIdOverride === undefined ? serverId : null,
    showDerivedBadge && derivedFromProviderIdOverride === undefined ? provider : null,
  );
  const baseId =
    derivedFromProviderIdOverride !== undefined ? derivedFromProviderIdOverride : baseIdFromHook;

  const baseIconName = resolveProviderBaseIconId(baseId);
  const shouldShowBadge = showDerivedBadge && baseIconName.kind !== "bot";

  if (!shouldShowBadge) {
    const OwnIcon: ProviderIconComponent = getProviderIcon(provider);
    return <OwnIcon size={size} color={color} />;
  }

  return (
    <ProviderIconWithBadge
      Icon={providerIconFromName(baseIconName)}
      provider={provider}
      size={size}
      color={color}
      style={style}
    />
  );
}

/**
 * Binds `ProviderIcon` to a fixed provider + server, producing a
 * `{ size, color }` component. For contexts (e.g. panel tab descriptors) that
 * store an icon component rather than rendering `<ProviderIcon>` inline.
 * Memoize the result so the bound component keeps a stable identity.
 */
export function makeProviderPanelIcon(
  provider: string,
  serverId: string | null,
): ComponentType<{ size: number; color: string }> {
  function BoundProviderIcon({ size, color }: { size: number; color: string }): ReactElement {
    return <ProviderIcon provider={provider} serverId={serverId} size={size} color={color} />;
  }
  BoundProviderIcon.displayName = `ProviderPanelIcon(${provider})`;
  return BoundProviderIcon;
}

interface ProviderIconWithBadgeProps {
  Icon: ProviderIconComponent;
  provider: string;
  size: number;
  color: string;
  style: StyleProp<ViewStyle>;
}

function ProviderIconWithBadge({
  Icon,
  provider,
  size,
  color,
  style,
}: ProviderIconWithBadgeProps): ReactElement {
  const badgeSize = Math.max(8, Math.round(size * 0.45));
  const innerSize = Math.max(6, badgeSize - BADGE_INNER_PADDING);
  const badgeWrapperStyle = useMemo(
    () => [styles.wrapper, { width: size, height: size }, style],
    [size, style],
  );
  const badgeStyle = useMemo(
    () => [
      styles.badge,
      {
        right: BADGE_OFFSET,
        top: BADGE_OFFSET,
        width: badgeSize,
        height: badgeSize,
        borderRadius: badgeSize * BADGE_BORDER_RADIUS_RATIO,
        borderWidth: BADGE_BORDER_WIDTH,
      },
    ],
    [badgeSize],
  );
  return (
    <View
      style={badgeWrapperStyle}
      accessibilityRole="image"
      accessibilityLabel={`${provider} (derived profile)`}
    >
      <Icon size={size} color={color} />
      <View style={badgeStyle} testID={`provider-icon-badge-${provider}`}>
        <ThemedLayers size={innerSize} uniProps={badgeColorMapping} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrapper: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.surface0,
  },
}));
