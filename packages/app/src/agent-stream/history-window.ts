import type { StreamItem } from "@/types/stream";

export const DEFAULT_MOUNTED_RECENT_STREAM_ITEMS = 20;

type MountedRecentStreamItemsE2ETestGlobals = typeof globalThis & {
  __PASEO_E2E_WEB_MOUNTED_RECENT_STREAM_ITEMS?: unknown;
};

function readPositiveIntegerOverride(value: unknown): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }
  const normalized = Math.trunc(value as number);
  return normalized > 0 ? normalized : null;
}

export function getMountedRecentStreamItems(): number {
  const override = readPositiveIntegerOverride(
    (globalThis as MountedRecentStreamItemsE2ETestGlobals)
      .__PASEO_E2E_WEB_MOUNTED_RECENT_STREAM_ITEMS,
  );
  return override ?? DEFAULT_MOUNTED_RECENT_STREAM_ITEMS;
}

export function findMountedWindowStart(input: {
  items: StreamItem[];
  minMountedCount: number;
  maxMountedCount?: number;
}): number {
  const { items, minMountedCount } = input;
  const maxMountedCount = Math.max(input.maxMountedCount ?? minMountedCount * 2, minMountedCount);
  if (items.length <= minMountedCount) {
    return 0;
  }

  // Stop the user-message rewind here so the mounted window never exceeds
  // maxMountedCount items, even on a turn with no earlier user_message.
  const floorIndex = Math.max(items.length - maxMountedCount, 0);
  let startIndex = Math.max(items.length - minMountedCount, 0);
  while (startIndex > floorIndex && items[startIndex]?.kind !== "user_message") {
    startIndex -= 1;
  }
  return startIndex;
}
