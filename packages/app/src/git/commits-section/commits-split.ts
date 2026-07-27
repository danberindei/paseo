export const DEFAULT_COMMITS_SPLIT_RATIO = 0.35;
export const MIN_COMMITS_SPLIT_RATIO = 0.1;
export const MAX_COMMITS_SPLIT_RATIO = 0.9;

/** Keeps both panes tall enough to show their header row while dragging. */
export const MIN_COMMITS_SPLIT_PANE_HEIGHT = 72;

export function clampCommitsSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) {
    return DEFAULT_COMMITS_SPLIT_RATIO;
  }
  return Math.min(MAX_COMMITS_SPLIT_RATIO, Math.max(MIN_COMMITS_SPLIT_RATIO, ratio));
}

interface ComputeCommitsSplitRatioInput {
  /** Ratio when the drag started. */
  startRatio: number;
  /** Pan translation since the drag started; positive is downward. */
  translationY: number;
  /** Height of the changes + commits stack. */
  containerHeight: number;
}

export function computeCommitsSplitRatio({
  startRatio,
  translationY,
  containerHeight,
}: ComputeCommitsSplitRatioInput): number {
  const clampedStart = clampCommitsSplitRatio(startRatio);
  if (!Number.isFinite(containerHeight) || containerHeight <= 0) {
    return clampedStart;
  }
  if (!Number.isFinite(translationY)) {
    return clampedStart;
  }

  const paneMinRatio = MIN_COMMITS_SPLIT_PANE_HEIGHT / containerHeight;
  const minRatio = Math.max(MIN_COMMITS_SPLIT_RATIO, paneMinRatio);
  const maxRatio = Math.min(MAX_COMMITS_SPLIT_RATIO, 1 - paneMinRatio);
  if (minRatio > maxRatio) {
    return clampedStart;
  }

  const next = clampedStart - translationY / containerHeight;
  return Math.min(maxRatio, Math.max(minRatio, next));
}
