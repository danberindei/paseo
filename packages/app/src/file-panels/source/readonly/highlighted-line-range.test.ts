import { describe, expect, it } from "vitest";
import { computeHighlightedLineRange } from "./highlighted-line-range";

describe("computeHighlightedLineRange", () => {
  it("returns no range when there is no line target", () => {
    expect(computeHighlightedLineRange(undefined, undefined, 10)).toBeNull();
  });

  it("highlights exactly the single targeted line", () => {
    expect(computeHighlightedLineRange(3, undefined, 10)).toEqual({ start: 3, end: 3 });
  });

  it("highlights the full line range", () => {
    expect(computeHighlightedLineRange(2, 4, 10)).toEqual({ start: 2, end: 4 });
  });

  it("clamps a line target past the end of the file to the last line", () => {
    expect(computeHighlightedLineRange(100, undefined, 5)).toEqual({ start: 5, end: 5 });
    expect(computeHighlightedLineRange(2, 100, 5)).toEqual({ start: 2, end: 5 });
  });
});
