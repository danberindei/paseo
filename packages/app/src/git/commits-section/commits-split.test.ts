import { describe, expect, it } from "vitest";
import {
  clampCommitsSplitRatio,
  computeCommitsSplitRatio,
  DEFAULT_COMMITS_SPLIT_RATIO,
  MAX_COMMITS_SPLIT_RATIO,
  MIN_COMMITS_SPLIT_RATIO,
} from "./commits-split";

describe("clampCommitsSplitRatio", () => {
  it("keeps in-range ratios", () => {
    expect(clampCommitsSplitRatio(0.42)).toBe(0.42);
  });

  it("clamps to the ratio bounds", () => {
    expect(clampCommitsSplitRatio(0)).toBe(MIN_COMMITS_SPLIT_RATIO);
    expect(clampCommitsSplitRatio(5)).toBe(MAX_COMMITS_SPLIT_RATIO);
  });

  it("falls back to the default for non-finite input", () => {
    expect(clampCommitsSplitRatio(Number.NaN)).toBe(DEFAULT_COMMITS_SPLIT_RATIO);
  });
});

describe("computeCommitsSplitRatio", () => {
  it("grows the commits pane when the handle is dragged up", () => {
    expect(
      computeCommitsSplitRatio({ startRatio: 0.3, translationY: -100, containerHeight: 1000 }),
    ).toBeCloseTo(0.4);
  });

  it("shrinks the commits pane when the handle is dragged down", () => {
    expect(
      computeCommitsSplitRatio({ startRatio: 0.3, translationY: 100, containerHeight: 1000 }),
    ).toBeCloseTo(0.2);
  });

  it("leaves the minimum pane height for the changes list", () => {
    const ratio = computeCommitsSplitRatio({
      startRatio: 0.5,
      translationY: -1000,
      containerHeight: 400,
    });

    expect(ratio * 400).toBeCloseTo(400 - 72);
  });

  it("leaves the minimum pane height for the commits list", () => {
    const ratio = computeCommitsSplitRatio({
      startRatio: 0.5,
      translationY: 1000,
      containerHeight: 400,
    });

    expect(ratio * 400).toBeCloseTo(72);
  });

  it("keeps the starting ratio when the container is too short to split", () => {
    expect(
      computeCommitsSplitRatio({ startRatio: 0.5, translationY: -50, containerHeight: 100 }),
    ).toBe(0.5);
  });

  it("keeps the starting ratio before the container has been measured", () => {
    expect(
      computeCommitsSplitRatio({ startRatio: 0.5, translationY: -50, containerHeight: 0 }),
    ).toBe(0.5);
  });
});
