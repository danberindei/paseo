import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { StateEffect, StateField, type Text } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  drawSelection,
  highlightActiveLine,
  keymap,
  lineNumbers,
  type DecorationSet,
} from "@codemirror/view";
import { createCodeMirrorHighlightStyle, type HighlightStyle } from "@getpaseo/highlight";

export interface EditorVisualTheme {
  colorScheme: "light" | "dark";
  background: string;
  foreground: string;
  cursor: string;
  foregroundMuted: string;
  border: string;
  selection: string;
  monoFont: string;
  codeFontSize: number;
  syntax: Record<HighlightStyle, string>;
}

export function editorBaseExtensions(onSave: () => void) {
  return [
    lineNumbers(),
    history(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    highlightActiveLine(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    emptyLineHighlightExtension,
    keymap.of([
      { key: "Mod-s", preventDefault: true, run: () => (onSave(), true) },
      indentWithTab,
      ...defaultKeymap,
      ...historyKeymap,
    ]),
  ];
}

export function editorTheme(theme: EditorVisualTheme) {
  return [
    EditorView.theme(
      {
        "&": {
          height: "100%",
          backgroundColor: theme.background,
          color: theme.foreground,
          fontFamily: theme.monoFont,
          fontSize: `${theme.codeFontSize}px`,
        },
        ".cm-scroller": {
          overflow: "auto",
          fontFamily: theme.monoFont,
          lineHeight: "1.45",
        },
        ".cm-panels": { backgroundColor: theme.background, color: theme.foreground },
        ".cm-panels-top": { borderBottom: "none" },
        ".cm-searchMatch": { backgroundColor: theme.selection },
        ".cm-searchMatch-selected": {
          backgroundColor: theme.selection,
          outline: `1px solid ${theme.cursor}`,
        },
        ".cm-content": { caretColor: theme.foreground, padding: "16px 0" },
        ".cm-cursor, .cm-dropCursor": { borderLeftColor: theme.cursor },
        ".cm-gutters": {
          backgroundColor: theme.background,
          color: theme.foregroundMuted,
          borderRight: `1px solid ${theme.border}`,
        },
        ".cm-activeLine": { backgroundColor: "transparent" },
        ".cm-activeLineGutter": { backgroundColor: "transparent", color: theme.foreground },
        "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
          backgroundColor: theme.selection,
        },
        ".cm-selectionBackground, ::selection": {
          backgroundColor: theme.selection,
        },
        ".cm-empty-line-highlight": { backgroundColor: theme.selection },
        "&.cm-focused": { outline: "none" },
      },
      { dark: theme.colorScheme === "dark" },
    ),
    syntaxHighlighting(createCodeMirrorHighlightStyle(theme.syntax)),
  ];
}

export function highlightLocation(
  view: EditorView,
  lineStart: number | undefined,
  lineEnd: number | undefined,
) {
  if (!lineStart) {
    // A navigation without a line target leaves the text selection alone but must drop the mark an
    // earlier navigation left behind.
    view.dispatch({ effects: highlightLines.of(null) });
    return;
  }
  const clampedLineStart = Math.min(lineStart, view.state.doc.lines);
  const clampedLineEnd = Math.min(lineEnd ?? clampedLineStart, view.state.doc.lines);
  const lineRange = { start: clampedLineStart, end: Math.max(clampedLineStart, clampedLineEnd) };
  const from = view.state.doc.line(lineRange.start).from;
  const to = view.state.doc.line(lineRange.end).to;
  view.dispatch({
    // Keep whole-line selection in editable views too; it highlights the navigation target.
    selection: { anchor: from, head: to },
    effects: [EditorView.scrollIntoView(from, { y: "center" }), highlightLines.of(lineRange)],
  });
}

/** Carries the lines a navigation highlight covers. */
const highlightLines = StateEffect.define<{ start: number; end: number } | null>();

const emptyLineDecoration = Decoration.line({ class: "cm-empty-line-highlight" });

/**
 * Paints the highlighted range's last line when it holds no text.
 * drawSelection's last rectangle runs from that line's start to the range's end, so it has zero
 * width there: an empty target line draws no selection at all, and an empty final line of a range
 * draws none on its own row. Every earlier row of the range is covered by a full-width rectangle.
 */
export const emptyLineHighlightExtension = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(highlightLines)) return emptyLineDecorations(transaction.newDoc, effect.value);
    }
    // The mark follows a navigation target, not the cursor: a user selection change drops it.
    if (transaction.selection) return Decoration.none;
    return transaction.docChanged ? decorations.map(transaction.changes) : decorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function emptyLineDecorations(
  doc: Text,
  range: { start: number; end: number } | null,
): DecorationSet {
  if (!range) return Decoration.none;
  const line = doc.line(Math.min(range.end, doc.lines));
  if (line.from !== line.to) return Decoration.none;
  return Decoration.set([emptyLineDecoration.range(line.from)]);
}
