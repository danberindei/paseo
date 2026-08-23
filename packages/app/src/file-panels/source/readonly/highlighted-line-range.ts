export function computeHighlightedLineRange(
  lineStart: number | undefined,
  lineEnd: number | undefined,
  totalLines: number,
): { start: number; end: number } | null {
  if (!lineStart || totalLines <= 0) {
    return null;
  }
  const clampedStart = Math.min(lineStart, totalLines);
  const clampedEnd = Math.min(lineEnd ?? clampedStart, totalLines);
  return { start: Math.min(clampedStart, clampedEnd), end: Math.max(clampedStart, clampedEnd) };
}
