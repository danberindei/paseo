import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { HighlightStyle } from "@getpaseo/highlight";
import { createPaneFocusContextValue, PaneFocusProvider } from "@/panels/pane-context";
import type { WorkspaceFileLocation } from "@/workspace/file-open";
import type { EditorVisualTheme } from "../editor/extensions.web";
import { FileSourceView } from "./view.web";

interface Mounted {
  root: Root;
  container: HTMLDivElement;
}

const mounted: Mounted[] = [];

const CONTENT = ["one", "two", "three", "four", "five"].join("\n");
// Line 2 and the last line hold no text, so neither can get a drawSelection background.
const CONTENT_WITH_BLANK_LINES = ["one", "", "three", ""].join("\n");
// Line 3 is the interior empty line of a range that spans lines 2 to 5.
const CONTENT_WITH_INTERIOR_BLANK_LINE = ["one", "two", "", "four", "five"].join("\n");
const PANE_FOCUS = createPaneFocusContextValue({
  isWorkspaceFocused: true,
  isPaneFocused: true,
});

const SYNTAX_COLORS: Record<HighlightStyle, string> = {
  keyword: "#000",
  comment: "#000",
  string: "#000",
  number: "#000",
  literal: "#000",
  function: "#000",
  definition: "#000",
  class: "#000",
  type: "#000",
  tag: "#000",
  attribute: "#000",
  property: "#000",
  variable: "#000",
  operator: "#000",
  punctuation: "#000",
  regexp: "#000",
  escape: "#000",
  meta: "#000",
  heading: "#000",
  link: "#000",
};

const THEME: EditorVisualTheme = {
  colorScheme: "light",
  background: "#ffffff",
  foreground: "#000000",
  cursor: "#000000",
  foregroundMuted: "#666666",
  border: "#dddddd",
  selection: "rgba(0, 0, 255, 0.3)",
  monoFont: "monospace",
  codeFontSize: 13,
  syntax: SYNTAX_COLORS,
};

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function mountSource(
  location: WorkspaceFileLocation,
  navigationRevision: number,
  content: string = CONTENT,
): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <PaneFocusProvider value={PANE_FOCUS}>
        <FileSourceView
          content={content}
          filename="sample.ts"
          location={location}
          navigationRevision={navigationRevision}
          presentation="highlighted"
          theme={THEME}
        />
      </PaneFocusProvider>,
    ),
  );
  await nextFrame();
  const entry = { root, container };
  mounted.push(entry);
  return entry;
}

async function rerender(
  entry: Mounted,
  location: WorkspaceFileLocation,
  navigationRevision: number,
  content: string = CONTENT,
) {
  act(() =>
    entry.root.render(
      <PaneFocusProvider value={PANE_FOCUS}>
        <FileSourceView
          content={content}
          filename="sample.ts"
          location={location}
          navigationRevision={navigationRevision}
          presentation="highlighted"
          theme={THEME}
        />
      </PaneFocusProvider>,
    ),
  );
  await nextFrame();
}

function selectionHeight(container: HTMLElement): number {
  const rects = Array.from(container.querySelectorAll<HTMLElement>(".cm-selectionBackground"));
  if (rects.length === 0) return 0;
  const boxes = rects.map((el) => el.getBoundingClientRect());
  const top = Math.min(...boxes.map((box) => box.top));
  const bottom = Math.max(...boxes.map((box) => box.bottom));
  return bottom - top;
}

interface LineHighlight {
  text: string;
  marked: boolean;
  background: string;
  width: number;
  height: number;
}

/** Reads each rendered line, in document order, and how the empty-line mark paints it. */
function lineHighlights(container: HTMLElement): LineHighlight[] {
  return Array.from(container.querySelectorAll<HTMLElement>(".cm-line")).map((element) => {
    const box = element.getBoundingClientRect();
    return {
      text: element.textContent ?? "",
      marked: element.classList.contains("cm-empty-line-highlight"),
      background: window.getComputedStyle(element).backgroundColor,
      width: box.width,
      height: box.height,
    };
  });
}

/**
 * Counts the highlight layers covering a line's row: the empty-line mark plus every visible
 * selection rectangle across it. Two layers of the same translucent color look darker than one.
 */
function highlightLayers(container: HTMLElement, index: number): number {
  const lines = Array.from(container.querySelectorAll<HTMLElement>(".cm-line"));
  const line = lines[index];
  const box = line.getBoundingClientRect();
  // drawSelection tiles a range's rows with rectangles that abut at the text height, a little
  // shorter than the line, so the row's middle identifies the rectangle that covers it.
  const middle = (box.top + box.bottom) / 2;
  const rectangles = Array.from(
    container.querySelectorAll<HTMLElement>(".cm-selectionBackground"),
  ).filter((element) => {
    const rectangle = element.getBoundingClientRect();
    return rectangle.width > 0 && rectangle.top < middle && rectangle.bottom > middle;
  });
  return rectangles.length + (line.classList.contains("cm-empty-line-highlight") ? 1 : 0);
}

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

describe("FileSourceView", () => {
  it("draws a visible selection for the targeted line", async () => {
    const { container } = await mountSource({ path: "/sample.ts", lineStart: 2, lineEnd: 2 }, 0);
    expect(selectionHeight(container)).toBeGreaterThan(0);
  });

  it("grows the selection when the line range widens, even with the same lineStart", async () => {
    const entry = await mountSource({ path: "/sample.ts", lineStart: 2, lineEnd: 2 }, 0);
    const singleLineHeight = selectionHeight(entry.container);

    await rerender(entry, { path: "/sample.ts", lineStart: 2, lineEnd: 4 }, 0);
    const rangeHeight = selectionHeight(entry.container);

    expect(rangeHeight).toBeGreaterThan(singleLineHeight);
  });

  it("draws a visible highlight on a target line with no text", async () => {
    const { container } = await mountSource(
      { path: "/sample.ts", lineStart: 2, lineEnd: 2 },
      0,
      CONTENT_WITH_BLANK_LINES,
    );

    const lines = lineHighlights(container);
    expect(lines.map((line) => line.marked)).toEqual([false, true, false, false]);
    expect(lines[1].width).toBeGreaterThan(0);
    expect(lines[1].height).toBeGreaterThan(0);
    expect(lines[1].background).toBe("rgba(0, 0, 255, 0.3)");
  });

  it("includes a last line with no text in the range highlight", async () => {
    const { container } = await mountSource(
      { path: "/sample.ts", lineStart: 3, lineEnd: 4 },
      0,
      CONTENT_WITH_BLANK_LINES,
    );

    const lines = lineHighlights(container);
    expect(lines.map((line) => line.marked)).toEqual([false, false, false, true]);
    expect(lines[3].width).toBeGreaterThan(0);
    expect(lines[3].height).toBeGreaterThan(0);
    expect(lines[3].background).toBe("rgba(0, 0, 255, 0.3)");
    expect(selectionHeight(container)).toBeGreaterThan(0);
  });

  it("drops the empty-line highlight when the same file is navigated without a line", async () => {
    const entry = await mountSource(
      { path: "/sample.ts", lineStart: 2, lineEnd: 2 },
      0,
      CONTENT_WITH_BLANK_LINES,
    );
    expect(lineHighlights(entry.container).map((line) => line.marked)).toEqual([
      false,
      true,
      false,
      false,
    ]);

    await rerender(entry, { path: "/sample.ts" }, 1, CONTENT_WITH_BLANK_LINES);

    expect(lineHighlights(entry.container).map((line) => line.marked)).toEqual([
      false,
      false,
      false,
      false,
    ]);
  });

  it("paints an interior empty line of a range with a single highlight layer", async () => {
    const { container } = await mountSource(
      { path: "/sample.ts", lineStart: 2, lineEnd: 5 },
      0,
      CONTENT_WITH_INTERIOR_BLANK_LINE,
    );

    const lines = lineHighlights(container);
    expect(lines.map((line) => line.marked)).toEqual([false, false, false, false, false]);
    expect(lines[2].background).toBe("rgba(0, 0, 0, 0)");
    expect(highlightLayers(container, 2)).toBe(1);
    expect(highlightLayers(container, 1)).toBe(1);
    expect(highlightLayers(container, 4)).toBe(1);
  });
});
