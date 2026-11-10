import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolvePaseoHome } from "@getpaseo/server";

export interface PersistedWindow {
  spaceId: string | null;
}

function getPaseoHome(env: NodeJS.ProcessEnv = process.env): string {
  return resolvePaseoHome(env);
}

export function getWindowsFilePath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(getPaseoHome(env), "windows.json");
}

function readPersistedWindow(input: unknown): PersistedWindow | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const candidate = input as { spaceId?: unknown };
  if (candidate.spaceId === null) {
    return { spaceId: null };
  }
  if (typeof candidate.spaceId === "string") {
    return { spaceId: candidate.spaceId };
  }

  return null;
}

export function readPersistedWindows(env: NodeJS.ProcessEnv = process.env): PersistedWindow[] {
  try {
    const raw = readFileSync(getWindowsFilePath(env), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map(readPersistedWindow)
      .filter((value): value is PersistedWindow => value !== null);
  } catch {
    return [];
  }
}

export function writePersistedWindows(
  windows: PersistedWindow[],
  env: NodeJS.ProcessEnv = process.env,
): void {
  const filePath = getWindowsFilePath(env);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(windows, null, 2)}\n`, "utf8");
}
