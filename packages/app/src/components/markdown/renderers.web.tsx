import { Text } from "react-native";
import {
  forwardRef,
  useCallback,
  useMemo,
  useState,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
} from "react";
import type {
  BlockquoteRendererProps,
  CodeBlockRendererProps,
  LinkRendererProps,
  MarkdownRenderers,
} from "react-native-enriched-markdown";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { useAssistantFileLinkEnvironment, useFileLink } from "@/assistant-file-links";
import { MARKDOWN_COPY_RECOGNIZED_LINK_ATTRIBUTE } from "@/assistant-selection-copy/markup";
import { FileActionsContextMenuContent } from "@/components/file-actions-menu";
import { CopyButton } from "@/components/markdown/copy-button";
import { ContextMenu, useContextMenu } from "@/components/ui/context-menu";
import { useForgeShorthand } from "@/git/forge-shorthand";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { HighlightedCodeBlock } from "@/components/highlighted-code-block";
import { useIsCompactFormFactor } from "@/constants/layout";
import type { Theme } from "@/styles/theme";
import { MermaidFence } from "./fence/mermaid";
import { astNodesToMarkdown } from "./serialize-markdown";
import { isRecognizedLink, markdownLinkSource } from "./source";

const ThemedCodeBlock = withUnistyles(HighlightedCodeBlock);
const codeStyle = (theme: Theme) => ({
  inheritedStyles: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.code,
  },
  textStyle: { backgroundColor: theme.colors.surface2, padding: 12, borderRadius: 8 },
});
function WebCodeBlock({ code, language }: CodeBlockRendererProps) {
  if (language?.toLowerCase() === "mermaid") return <MermaidFence code={code} />;
  return <ThemedCodeBlock code={code} language={language} uniProps={codeStyle} />;
}

function WebBlockquote({ node, style, children }: BlockquoteRendererProps) {
  const { t } = useTranslation();
  const isCompact = useIsCompactFormFactor();
  const [hovered, setHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setHovered(true), []);
  const handlePointerLeave = useCallback(() => setHovered(false), []);
  const quoteStyle = useMemo(() => ({ ...style, position: "relative" as const }), [style]);
  // The quote body without its markers: nested quotes keep their own prefix.
  const getText = useCallback(() => astNodesToMarkdown(node.children ?? []), [node]);
  return (
    <blockquote
      style={quoteStyle}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      {children}
      <CopyButton
        getText={getText}
        visible={hovered || isCompact}
        copyLabel={t("message.actions.copyQuote")}
      />
    </blockquote>
  );
}

// The library styles links inline, so a stylesheet :hover rule cannot underline them.
const LINK_HOVER_STYLE = { textDecoration: "underline" } as const;

interface FileLinkAnchorProps {
  anchorProps: ComponentProps<"a">;
  /** Resolved forge web URL; overrides the shorthand href the library passed in. */
  href?: string | null;
  tooltip: string | null;
  onHoverIn: () => void;
  onContextMenu?: (event: MouseEvent<HTMLAnchorElement>) => void;
  children: ReactNode;
}

function FileLinkAnchor({
  anchorProps,
  href,
  tooltip,
  onHoverIn,
  onContextMenu,
  children,
}: FileLinkAnchorProps) {
  const [hovered, setHovered] = useState(false);
  const handleMouseEnter = useCallback(() => setHovered(true), []);
  const handleMouseLeave = useCallback(() => setHovered(false), []);
  const anchorStyle = useMemo(
    () => ({
      ...anchorProps.style,
      overflowWrap: "anywhere" as const,
      ...(hovered ? LINK_HOVER_STYLE : null),
    }),
    [anchorProps.style, hovered],
  );
  const anchor = (
    <a
      {...anchorProps}
      href={href ?? anchorProps.href}
      style={anchorStyle}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onContextMenu={onContextMenu}
    >
      {children}
    </a>
  );
  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger asChild onHoverIn={onHoverIn}>
        <InlineLinkTrigger>{anchor}</InlineLinkTrigger>
      </TooltipTrigger>
      {tooltip ? (
        <TooltipContent side="top" align="start" maxWidth={520}>
          <Text selectable={false} style={styles.tooltipPath}>
            {tooltip}
          </Text>
        </TooltipContent>
      ) : null}
    </Tooltip>
  );
}

// The library renders each link inside a prose paragraph, so the anchor itself has to be the
// menu trigger: a wrapper element there would break the inline flow.
function FileLinkContextMenuAnchor({
  anchorProps,
  href,
  tooltip,
  onHoverIn,
  children,
}: Omit<FileLinkAnchorProps, "onContextMenu">) {
  const menu = useContextMenu();
  const handleContextMenu = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      event.stopPropagation();
      menu.setAnchorRect({ x: event.pageX, y: event.pageY, width: 0, height: 0 });
      menu.setOpen(true);
    },
    [menu],
  );
  return (
    <FileLinkAnchor
      anchorProps={anchorProps}
      href={href}
      tooltip={tooltip}
      onHoverIn={onHoverIn}
      onContextMenu={handleContextMenu}
    >
      {children}
    </FileLinkAnchor>
  );
}

function WebLink({ link, anchorProps, children }: LinkRendererProps) {
  const environment = useAssistantFileLinkEnvironment();
  const forgeShorthand = useForgeShorthand();
  // A forge reference like `#12` carries its web URL so hover, copy and new-tab opens work.
  const forgeUrl = link.sourceType === "text" ? forgeShorthand?.resolve(link.url) : null;
  // Selection copy pastes a link Paseo recognized as the text the reply showed.
  const recognized = isRecognizedLink(link);
  const copyAnchorProps = useMemo(
    () =>
      recognized
        ? { ...anchorProps, [MARKDOWN_COPY_RECOGNIZED_LINK_ATTRIBUTE]: "true" }
        : anchorProps,
    [anchorProps, recognized],
  );
  const { target, candidateTarget, tooltipPath, onHoverIn } = useFileLink(
    forgeUrl ? markdownLinkSource(forgeUrl) : markdownLinkSource(link.url, link.sourceType),
  );
  const tooltip = forgeUrl ?? tooltipPath;
  const copyPathValue = candidateTarget?.path;
  const onCopyPath = environment.onCopyPath;
  const onOpenInEditor = environment.canOpenInEditor ? environment.onOpenInEditor : undefined;
  // Opening needs the file confirmed; copying only needs the path the link names.
  const canCopy = Boolean(copyPathValue && onCopyPath);
  const canOpen = Boolean(target && onOpenInEditor);
  const copyPath = useCallback(() => {
    if (copyPathValue) onCopyPath?.(copyPathValue);
  }, [onCopyPath, copyPathValue]);
  const openInEditor = useCallback(() => {
    if (target) onOpenInEditor?.(target.path);
  }, [onOpenInEditor, target]);

  if (!canCopy && !canOpen) {
    return (
      <FileLinkAnchor
        anchorProps={copyAnchorProps}
        href={forgeUrl}
        tooltip={tooltip}
        onHoverIn={onHoverIn}
      >
        {children}
      </FileLinkAnchor>
    );
  }

  return (
    <ContextMenu>
      <FileLinkContextMenuAnchor
        anchorProps={copyAnchorProps}
        href={forgeUrl}
        tooltip={tooltip}
        onHoverIn={onHoverIn}
      >
        {children}
      </FileLinkContextMenuAnchor>
      <FileActionsContextMenuContent
        fileKind="file"
        fileExists={Boolean(target)}
        testIDPrefix="file-link"
        onCopyPath={canCopy ? copyPath : undefined}
        onOpenInEditor={canOpen ? openInEditor : undefined}
      />
    </ContextMenu>
  );
}

// TooltipTrigger also supplies native Pressable handlers; forward only DOM events.
// A View renders a div, which is invalid inside the library's prose paragraphs.
const InlineLinkTrigger = forwardRef<HTMLSpanElement, ComponentProps<"span">>(
  function InlineLinkTrigger({ children, onMouseEnter, onMouseLeave, onFocus, onBlur }, ref) {
    return (
      <span
        ref={ref}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        onFocus={onFocus}
        onBlur={onBlur}
      >
        {children}
      </span>
    );
  },
);
const styles = StyleSheet.create((theme) => ({
  tooltipPath: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.normal,
  },
}));

export const WEB_RENDERERS: MarkdownRenderers = { codeBlock: WebCodeBlock, link: WebLink };

export const WEB_CHAT_RENDERERS: MarkdownRenderers = {
  ...WEB_RENDERERS,
  blockquote: WebBlockquote,
};
