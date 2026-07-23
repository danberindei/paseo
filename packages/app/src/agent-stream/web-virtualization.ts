import type { StreamItem } from "@/types/stream";
import { estimateAssistantMessageHeightFromCache } from "@/utils/assistant-message-height-estimate";
import {
  DEFAULT_MOUNTED_RECENT_STREAM_ITEMS,
  findMountedWindowStart,
  getMountedRecentStreamItems,
} from "./history-window";

export const DEFAULT_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD = 100;
export const DEFAULT_WEB_MOUNTED_RECENT_STREAM_ITEMS = DEFAULT_MOUNTED_RECENT_STREAM_ITEMS;
// Hard ceiling on how far the mounted window may grow while rewinding to a
// turn boundary. Without it a single very long turn (no turn boundary between
// the recent cutoff and index 0) mounts the entire transcript. 60 collapsed
// tool rows at about 40px each still cover a desktop viewport.
export const DEFAULT_WEB_MAX_MOUNTED_STREAM_ITEMS = 60;
const COLLAPSED_TOOL_SEQUENCE_ROW_HEIGHT_ESTIMATE = 40;

type BottomAnchorE2ETestGlobals = typeof globalThis & {
  __PASEO_E2E_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD?: unknown;
  __PASEO_E2E_WEB_MAX_MOUNTED_STREAM_ITEMS?: unknown;
};

function readPositiveIntegerOverride(value: unknown): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }
  const normalized = Math.trunc(value as number);
  return normalized > 0 ? normalized : null;
}

export function getWebPartialVirtualizationThreshold(): number {
  const override = readPositiveIntegerOverride(
    (globalThis as BottomAnchorE2ETestGlobals).__PASEO_E2E_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD,
  );
  return override ?? DEFAULT_WEB_PARTIAL_VIRTUALIZATION_THRESHOLD;
}

export function getWebMountedRecentStreamItems(): number {
  return getMountedRecentStreamItems();
}

export function getWebMaxMountedStreamItems(): number {
  const override = readPositiveIntegerOverride(
    (globalThis as BottomAnchorE2ETestGlobals).__PASEO_E2E_WEB_MAX_MOUNTED_STREAM_ITEMS,
  );
  return override ?? DEFAULT_WEB_MAX_MOUNTED_STREAM_ITEMS;
}

export interface IndexedStreamItem {
  item: StreamItem;
  index: number;
}

export interface WebVirtualizedHistoryWindow {
  virtualizedEntries: IndexedStreamItem[];
  mountedEntries: IndexedStreamItem[];
}

interface StreamItemHeightEstimateInput {
  item: StreamItem;
  contentMaxWidth: number;
}

export function estimateStreamItemHeight({
  item,
  contentMaxWidth,
}: StreamItemHeightEstimateInput): number {
  switch (item.kind) {
    case "user_message":
      return item.images && item.images.length > 0 ? 220 : 96;
    case "assistant_message":
      return (
        estimateAssistantMessageHeightFromCache({
          markdown: item.text,
          contentMaxWidth,
        }) ?? 220
      );
    case "tool_call":
      return COLLAPSED_TOOL_SEQUENCE_ROW_HEIGHT_ESTIMATE;
    case "thought":
    case "turn_summary":
      return COLLAPSED_TOOL_SEQUENCE_ROW_HEIGHT_ESTIMATE;
    case "todo_list":
      return 144;
    case "notification":
      return 88;
    case "compaction":
      return 72;
    default:
      return 120;
  }
}

export { findMountedWindowStart };

export function splitWebVirtualizedHistory(input: {
  entries: IndexedStreamItem[];
  minMountedCount: number;
  maxMountedCount?: number;
}): WebVirtualizedHistoryWindow {
  const startIndex = findMountedWindowStart({
    items: input.entries.map((entry) => entry.item),
    minMountedCount: input.minMountedCount,
    maxMountedCount: input.maxMountedCount,
  });
  return {
    virtualizedEntries: input.entries.slice(0, startIndex),
    mountedEntries: input.entries.slice(startIndex),
  };
}
