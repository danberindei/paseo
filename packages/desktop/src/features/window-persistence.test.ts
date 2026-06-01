import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getWindowsFilePath,
  readPersistedWindows,
  writePersistedWindows,
} from "./window-persistence";

describe("window-persistence", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  it("round-trips persisted window bindings", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "paseo-windows-"));
    tempDirs.push(tempDir);
    const env = { ...process.env, PASEO_HOME: tempDir };

    writePersistedWindows([{ spaceId: null }, { spaceId: "space-1" }], env);

    expect(getWindowsFilePath(env)).toBe(path.join(tempDir, "windows.json"));
    expect(JSON.parse(readFileSync(getWindowsFilePath(env), "utf8"))).toEqual([
      { spaceId: null },
      { spaceId: "space-1" },
    ]);
    expect(readPersistedWindows(env)).toEqual([{ spaceId: null }, { spaceId: "space-1" }]);
  });

  it("returns an empty list for missing or invalid files", () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), "paseo-windows-"));
    tempDirs.push(tempDir);
    const env = { ...process.env, PASEO_HOME: tempDir };

    expect(readPersistedWindows(env)).toEqual([]);
  });
});
