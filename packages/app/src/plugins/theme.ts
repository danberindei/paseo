import type { PluginTheme } from "@getpaseo/plugin";
import type { Theme } from "@/styles/theme";
import { resolvePluginPlatform } from "./platform";

// Retained web chats can stay frozen during theme changes, so colors must update through CSS.
const WEB_COLORS: PluginTheme["colors"] = {
  surface0: "var(--colors-surface0)",
  surface1: "var(--colors-surface1)",
  surface2: "var(--colors-surface2)",
  surfaceSidebar: "var(--colors-surface-sidebar)",
  surfaceSidebarHover: "var(--colors-surface-sidebar-hover)",
  border: "var(--colors-border)",
  foreground: "var(--colors-foreground)",
  foregroundMuted: "var(--colors-foreground-muted)",
  accent: "var(--colors-accent)",
  accentForeground: "var(--colors-accent-foreground)",
  statusSuccess: "var(--colors-status-success)",
  statusWarning: "var(--colors-status-warning)",
  statusDanger: "var(--colors-status-danger)",
  statusMerged: "var(--colors-status-merged)",
};

export function toPluginTheme(theme: Theme, platform = resolvePluginPlatform()): PluginTheme {
  return {
    colors:
      platform === "web"
        ? WEB_COLORS
        : {
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
    fontSize: { sm: theme.fontSize.sm, content: theme.fontSize.content },
    fontWeight: { medium: theme.fontWeight.medium },
  };
}
