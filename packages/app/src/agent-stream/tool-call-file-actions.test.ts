import { describe, expect, it } from "vitest";
import { resolveToolCallCopyPath, resolveToolCallEditorOpenInput } from "./tool-call-file-actions";

describe("resolveToolCallCopyPath", () => {
  it("resolves a workspace-relative path to an absolute path", () => {
    expect(resolveToolCallCopyPath("src/index.ts", "/workspace/root")).toBe(
      "/workspace/root/src/index.ts",
    );
  });

  it("falls back to the raw path when it cannot be resolved against the workspace root", () => {
    expect(resolveToolCallCopyPath("~/notes.txt", "/workspace/root")).toBe("~/notes.txt");
  });

  it("falls back to the raw path when there is no workspace root", () => {
    expect(resolveToolCallCopyPath("src/index.ts", "")).toBe("src/index.ts");
  });
});

describe("resolveToolCallEditorOpenInput", () => {
  it("builds the open-target input when a preferred editor and resolvable path exist", () => {
    expect(
      resolveToolCallEditorOpenInput({
        filePath: "src/index.ts",
        workspaceRoot: "/workspace/root",
        editorId: "vscode",
      }),
    ).toEqual({
      editorId: "vscode",
      workspacePath: "/workspace/root",
      filePath: "/workspace/root/src/index.ts",
    });
  });

  it("returns null when there is no preferred editor", () => {
    expect(
      resolveToolCallEditorOpenInput({
        filePath: "src/index.ts",
        workspaceRoot: "/workspace/root",
        editorId: null,
      }),
    ).toBeNull();
  });

  it("returns null when the path cannot be resolved against the workspace root", () => {
    expect(
      resolveToolCallEditorOpenInput({
        filePath: "~/notes.txt",
        workspaceRoot: "/workspace/root",
        editorId: "vscode",
      }),
    ).toBeNull();
  });
});
