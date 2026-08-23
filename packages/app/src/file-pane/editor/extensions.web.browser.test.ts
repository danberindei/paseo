import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { highlightLocation } from "./extensions.web";

interface MountedView {
  view: EditorView;
  container: HTMLDivElement;
}

const mounted: MountedView[] = [];

function createView(content: string): EditorView {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const view = new EditorView({ parent: container, state: EditorState.create({ doc: content }) });
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
  });
});
