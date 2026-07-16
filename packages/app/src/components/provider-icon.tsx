import { Layers } from "lucide-react-native";
import { useMemo, type ComponentType, type ReactElement } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";

import { resolveProviderBaseIconId } from "./provider-icon-name";
import {
  providerIconFromName,
  useProviderIcon,
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
  /** Honoured by outline glyphs such as the fallback; brand marks are filled and ignore it. */
  strokeWidth?: number;
  /** Outer style (e.g. flex layout, padding). The badge is positioned absolutely. */
  style?: StyleProp<ViewStyle>;
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
 * Otherwise - `serverId` is `null`, the provider isn't derived, or its base id
 * is unknown - it renders the provider's own
 * icon with no badge.
 */
export function ProviderIcon({
  provider,
  serverId,
  size,
  color,
  strokeWidth,
  style,
}: ProviderIconProps): ReactElement {
  const OwnIcon = useProviderIcon(provider, serverId);
  const baseId = useProviderBaseIconId(serverId, provider);

  const baseIconName = resolveProviderBaseIconId(baseId);
  const shouldShowBadge = baseIconName.kind !== "bot";

  if (!shouldShowBadge) {
    return <OwnIcon size={size} color={color} strokeWidth={strokeWidth} />;
  }

  return (
    <ProviderIconWithBadge
      Icon={providerIconFromName(baseIconName)}
      provider={provider}
      size={size}
      color={color}
      strokeWidth={strokeWidth}
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
): ComponentType<{ size: number; color: string; strokeWidth?: number }> {
  function BoundProviderIcon({
    size,
    color,
    strokeWidth,
  }: {
    size: number;
    color: string;
    strokeWidth?: number;
  }): ReactElement {
    return (
      <ProviderIcon
        provider={provider}
        serverId={serverId}
        size={size}
        color={color}
        strokeWidth={strokeWidth}
      />
    );
  }
  BoundProviderIcon.displayName = `ProviderPanelIcon(${provider})`;
  return BoundProviderIcon;
}

interface ProviderIconWithBadgeProps {
  Icon: ProviderIconComponent;
  provider: string;
  size: number;
  color: string;
  strokeWidth?: number;
  style: StyleProp<ViewStyle>;
}

function ProviderIconWithBadge({
  Icon,
  provider,
  size,
  color,
  strokeWidth,
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
      <Icon size={size} color={color} strokeWidth={strokeWidth} />
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
