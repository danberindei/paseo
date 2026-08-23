import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { emptyLineHighlightExtension, highlightLocation } from "./extensions.web";

interface MountedView {
  view: EditorView;
  container: HTMLDivElement;
}

const mounted: MountedView[] = [];

function createView(content: string): EditorView {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const view = new EditorView({
    parent: container,
    state: EditorState.create({ doc: content, extensions: [emptyLineHighlightExtension] }),
  });
  mounted.push({ view, container });
  return view;
}

afterEach(() => {
  for (const { view, container } of mounted.splice(0)) {
    view.destroy();
    container.remove();
  }
});

const FIVE_LINES = ["one", "two", "three", "four", "five"].join("\n");

function markedLines(view: EditorView): number[] {
  const decorations = view.state.field(emptyLineHighlightExtension);
  const numbers: number[] = [];
  decorations.between(0, view.state.doc.length, (from) => {
    numbers.push(view.state.doc.lineAt(from).number);
  });
  return numbers;
}

describe("highlightLocation", () => {
  it("selects exactly the single targeted line", () => {
    const view = createView(FIVE_LINES);
    highlightLocation(view, 3, undefined);
    const line = view.state.doc.line(3);
    expect(view.state.selection.main.from).toBe(line.from);
    expect(view.state.selection.main.to).toBe(line.to);
  });

  it("selects the full line range", () => {
    const view = createView(FIVE_LINES);
    highlightLocation(view, 2, 4);
    expect(view.state.selection.main.from).toBe(view.state.doc.line(2).from);
    expect(view.state.selection.main.to).toBe(view.state.doc.line(4).to);
  });

  it("clamps a line target past the end of the file to the last line", () => {
    const view = createView(FIVE_LINES);
    highlightLocation(view, 100, undefined);
    const lastLine = view.state.doc.line(5);
    expect(view.state.selection.main.from).toBe(lastLine.from);
    expect(view.state.selection.main.to).toBe(lastLine.to);
  });

  it("leaves the selection untouched when there is no line target", () => {
    const view = createView(FIVE_LINES);
    highlightLocation(view, undefined, undefined);
    expect(view.state.selection.main.from).toBe(0);
    expect(view.state.selection.main.to).toBe(0);
    expect(markedLines(view)).toEqual([]);
  });

  it("clears an earlier empty-line mark when the file is navigated again without a line", () => {
    const view = createView(["one", "", "three"].join("\n"));
    highlightLocation(view, 2, undefined);
    expect(markedLines(view)).toEqual([2]);
    highlightLocation(view, undefined, undefined);
    expect(markedLines(view)).toEqual([]);
  });

  it("marks an empty target line, whose selection is empty", () => {
    const view = createView(["one", "", "three"].join("\n"));
    highlightLocation(view, 2, undefined);
    const emptyLine = view.state.doc.line(2);
    expect(view.state.selection.main.from).toBe(emptyLine.from);
    expect(view.state.selection.main.to).toBe(emptyLine.to);
    expect(markedLines(view)).toEqual([2]);
  });

  it("marks an empty final line of a range", () => {
    const view = createView(["one", "two", ""].join("\n"));
    highlightLocation(view, 2, 3);
    expect(view.state.selection.main.to).toBe(view.state.doc.line(3).from);
    expect(markedLines(view)).toEqual([3]);
  });

  // drawSelection covers every row of a range but its last one with a full-width rectangle, so a
  // line decoration there would stack a second layer of the same translucent color.
  it("leaves an interior empty line of a range to the selection rectangle", () => {
    const view = createView(["one", "", "three", "four"].join("\n"));
    highlightLocation(view, 2, 4);
    expect(markedLines(view)).toEqual([]);
  });

  it("marks only the empty final line when a range also has an interior empty line", () => {
    const view = createView(["one", "two", "", ""].join("\n"));
    highlightLocation(view, 2, 4);
    expect(markedLines(view)).toEqual([4]);
  });

  it("drops the empty-line mark when the selection moves away", () => {
    const view = createView(["one", "", "three"].join("\n"));
    highlightLocation(view, 2, undefined);
    view.dispatch({ selection: { anchor: 0 } });
    expect(markedLines(view)).toEqual([]);
  });
});
