import type { MarkdownStyle } from "react-native-enriched-markdown";
import type { Theme } from "@/styles/theme";
import { isWeb } from "@/constants/platform";

// iOS Safari needs the prefix to override the gesture host's selection suppression.
const WEB_CONTAINER = { userSelect: "text", WebkitUserSelect: "text" } as const;

// Retained web chats can stay frozen across theme changes, so their colors must
// resolve in CSS without a React render or a per-component theme notification.
const WEB_COLORS = {
  foreground: "var(--colors-foreground)",
  foregroundMuted: "var(--colors-foreground-muted)",
  surface0: "var(--colors-surface0)",
  surface1: "var(--colors-surface1)",
  surface2: "var(--colors-surface2)",
  border: "var(--colors-border)",
  accent: "var(--colors-accent)",
  accentBright: "var(--colors-accent-bright)",
  accentForeground: "var(--colors-accent-foreground)",
  statusSuccess: "var(--colors-status-success)",
  statusMerged: "var(--colors-status-merged)",
  statusWarning: "var(--colors-status-warning)",
  statusDanger: "var(--colors-status-danger)",
  terminal: { selectionBackground: "var(--colors-terminal-selection-background)" },
};

export function createMarkdownStyles(
  theme: Theme,
  {
    compact = false,
    muted = false,
    blockGap,
  }: { compact?: boolean; muted?: boolean; blockGap: number },
): { markdownStyle: MarkdownStyle; selectionColor: string; containerStyle?: typeof WEB_CONTAINER } {
  const colors = isWeb ? WEB_COLORS : theme.colors;
  const quoteColor = isWeb
    ? "color-mix(in srgb, var(--colors-foreground) 80%, transparent)"
    : `${colors.foreground}cc`;
  const fontSize = compact ? theme.fontSize.base : theme.fontSize.content;
  // Every block is followed by the same gap; the library drops it after the last block.
  const block = { marginTop: 0, marginBottom: blockGap };
  const paragraph = {
    fontSize,
    fontFamily: theme.fontFamily.ui,
    lineHeight: Math.round(fontSize * 1.4),
    color: muted ? colors.foregroundMuted : colors.foreground,
    ...block,
  };
  const heading = (scale: number) => ({
    ...paragraph,
    fontSize: Math.round(fontSize * scale),
    lineHeight: Math.round(fontSize * scale * 1.3),
    fontWeight: "bold",
  });
  return {
    containerStyle: isWeb ? WEB_CONTAINER : undefined,
    selectionColor: colors.terminal.selectionBackground,
    markdownStyle: {
      paragraph,
      h1: heading(1.6),
      h2: heading(1.4),
      h3: heading(1.2),
      h4: heading(1.1),
      h5: heading(1),
      h6: { ...heading(1), color: colors.foregroundMuted },
      list: {
        ...paragraph,
        bulletColor: colors.foregroundMuted,
        markerColor: colors.foregroundMuted,
        gapWidth: 7,
        itemSpacing: 4,
        marginLeft: 20,
      },
      blockquote: {
        ...paragraph,
        color: quoteColor,
        backgroundColor: colors.surface1,
        borderColor: colors.surface2,
        borderWidth: 3,
        padding: 12,
        gapWidth: 8,
        admonitions: {
          note: { color: colors.accentBright, backgroundColor: colors.surface2 },
          tip: { color: colors.statusSuccess, backgroundColor: colors.surface2 },
          important: { color: colors.statusMerged, backgroundColor: colors.surface2 },
          warning: { color: colors.statusWarning, backgroundColor: colors.surface2 },
          caution: { color: colors.statusDanger, backgroundColor: colors.surface2 },
        },
      },
      link: { color: colors.accentBright, underline: false },
      linkVariants: {
        "^(?!https?://).+": {
          color: colors.accentBright,
        },
      },
      code: {
        fontFamily: theme.fontFamily.mono === "ui-monospace" && !isWeb ? "" : theme.fontFamily.mono,
        fontScale: theme.fontSize.code / fontSize,
        color: colors.foreground,
        backgroundColor: colors.surface2,
        borderColor: "transparent",
      },
      codeBlock: {
        ...paragraph,
        fontFamily: theme.fontFamily.mono === "ui-monospace" && !isWeb ? "" : theme.fontFamily.mono,
        fontSize: theme.fontSize.code,
        backgroundColor: colors.surface2,
        borderColor: colors.border,
        borderRadius: 8,
        padding: 12,
      },
      table: {
        ...paragraph,
        borderColor: colors.border,
        headerBackgroundColor: colors.surface2,
        headerTextColor: colors.foreground,
        rowEvenBackgroundColor: colors.surface0,
        rowOddBackgroundColor: colors.surface1,
      },
      taskList: {
        checkedTextColor: colors.foregroundMuted,
        checkedColor: colors.accent,
        checkmarkColor: colors.accentForeground,
        borderColor: colors.foregroundMuted,
      },
      inlineImage: { size: paragraph.lineHeight },
      image: { ...block, height: 320, resizeMode: "contain", borderRadius: 8 },
      thematicBreak: { ...block, color: colors.border, height: 1 },
    },
  };
}
