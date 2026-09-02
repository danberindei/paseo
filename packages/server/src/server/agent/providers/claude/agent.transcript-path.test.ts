import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { ClaudeAgentClient } from "./agent.js";
import { claudeProjectDirSync } from "./project-dir.js";

function createClient(configDir: string): ClaudeAgentClient {
  return new ClaudeAgentClient({
    logger: createTestLogger(),
    resolveBinary: async () => "/test/claude/bin",
    runtimeSettings: { env: { CLAUDE_CONFIG_DIR: configDir } },
  });
}

test("resolves the session transcript path from the per-provider CLAUDE_CONFIG_DIR", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "claude-transcript-"));
  const sessionId = "01a051ef-8ede-7402-8df9-8f6630a93837";
  const cwd = "/repo";
  const projectDir = claudeProjectDirSync(cwd, { configDir: tempDir });
  mkdirSync(projectDir, { recursive: true });
  const transcriptPath = path.join(projectDir, `${sessionId}.jsonl`);
  writeFileSync(transcriptPath, "{}\n");

  try {
    await expect(
      createClient(tempDir).resolveSessionTranscriptPath({
        handle: { provider: "claude", sessionId },
        cwd,
      }),
    ).resolves.toBe(transcriptPath);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("returns null when the transcript file is absent", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "claude-transcript-"));

  try {
    await expect(
      createClient(tempDir).resolveSessionTranscriptPath({
        handle: { provider: "claude", sessionId: "missing-session" },
        cwd: "/repo",
      }),
    ).resolves.toBeNull();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("returns null when the handle has no session id", async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), "claude-transcript-"));

  try {
    await expect(
      createClient(tempDir).resolveSessionTranscriptPath({
        handle: { provider: "claude", sessionId: "" },
        cwd: "/repo",
      }),
    ).resolves.toBeNull();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
