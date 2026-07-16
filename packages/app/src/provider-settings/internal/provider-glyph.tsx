import { StyleSheet } from "react-native-unistyles";
import { ProviderIcon } from "@/components/provider-icon";
import { ICON_SIZE } from "@/styles/theme";

/** A provider's icon at row size, drawn in the foreground colour. */
export function ProviderGlyph({ serverId, provider }: { serverId: string; provider: string }) {
  return (
    <ProviderIcon
      provider={provider}
      serverId={serverId}
      size={ICON_SIZE.md}
      color={styles.glyph.color}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  glyph: { color: theme.colors.foreground },
}));
