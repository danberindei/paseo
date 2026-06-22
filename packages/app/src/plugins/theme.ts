import type { PluginTheme } from "@getpaseo/plugin";
import type { Theme } from "@/styles/theme";

export function toPluginTheme(theme: Theme): PluginTheme {
  return {
    colors: {
      surface0: theme.colors.surface0,
      surface1: theme.colors.surface1,
      surface2: theme.colors.surface2,
      surfaceSidebar: theme.colors.surfaceSidebar,
      surfaceSidebarHover: theme.colors.surfaceSidebarHover,
      border: theme.colors.border,
      foreground: theme.colors.foreground,
      foregroundMuted: theme.colors.foregroundMuted,
      accent: theme.colors.accent,
      accentForeground: theme.colors.accentForeground,
      statusSuccess: theme.colors.statusSuccess,
      statusWarning: theme.colors.statusWarning,
      statusDanger: theme.colors.statusDanger,
      statusMerged: theme.colors.statusMerged,
    },
    spacing: theme.spacing,
    borderRadius: { lg: theme.borderRadius.lg, full: theme.borderRadius.full },
    fontSize: { sm: theme.fontSize.sm },
    fontWeight: { medium: theme.fontWeight.medium },
  };
}
