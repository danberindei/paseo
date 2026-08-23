import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { HighlightStyle } from "@getpaseo/highlight";
import type { WorkspaceFileLocation } from "@/workspace/file-open";
import type { EditorVisualTheme } from "../editor/extensions.web";
import { FileSourceView } from "./view.web";

interface Mounted {
  root: Root;
  container: HTMLDivElement;
}

const mounted: Mounted[] = [];

const CONTENT = ["one", "two", "three", "four", "five"].join("\n");

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
): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <FileSourceView
        content={CONTENT}
        filename="sample.ts"
        location={location}
        navigationRevision={navigationRevision}
        size={CONTENT.length}
        theme={THEME}
        tooLargeMessage="Too large"
      />,
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
) {
  act(() =>
    entry.root.render(
      <FileSourceView
        content={CONTENT}
        filename="sample.ts"
        location={location}
        navigationRevision={navigationRevision}
        size={CONTENT.length}
        theme={THEME}
        tooLargeMessage="Too large"
      />,
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
});
