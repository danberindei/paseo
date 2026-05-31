import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { Query } from "@anthropic-ai/claude-agent-sdk";

import {
  realClaudeRewindSdk,
  revertClaudeConversation,
  revertClaudeConversationAndFiles,
  revertClaudeFiles,
} from "./rewind.js";
import { FakeClaudeSdk } from "./test-rewind-claude-sdk.js";

describe("Claude rewind", () => {
  test("passes configDir to forkSession for custom provider config dirs", async () => {
    const claude = new FakeClaudeSdk();
    let sessionId = "original-session";

    await revertClaudeConversation({
      sdk: claude,
      sessionId,
      messageId: "user-message-1",
      configDir: "/custom/.claude",
      setSessionId: (nextSessionId) => {
        sessionId = nextSessionId;
      },
    });

    expect(claude.recordedForks).toEqual([
      { upToMessageId: "user-message-1", configDir: "/custom/.claude" },
    ]);
  });

  test("forks the conversation up to the user message", async () => {
    const claude = new FakeClaudeSdk();
    let sessionId = "original-session";

    await revertClaudeConversation({
      sdk: claude,
      sessionId,
      messageId: "user-message-1",
      setSessionId: (nextSessionId) => {
        sessionId = nextSessionId;
      },
    });

    expect(claude.recordedForks).toEqual([
      { upToMessageId: "user-message-1", configDir: undefined },
    ]);
    expect(sessionId).toBe("forked-session-1");
  });

  test("translates Paseo timeline message ids before forking", async () => {
    const claude = new FakeClaudeSdk();
    let sessionId = "original-session";

    await revertClaudeConversation({
      sdk: claude,
      sessionId,
      messageId: "timeline-message-1",
      resolveMessageId: () => "claude-jsonl-message-1",
      setSessionId: (nextSessionId) => {
        sessionId = nextSessionId;
      },
    });

    expect(claude.recordedForks).toEqual([
      { upToMessageId: "claude-jsonl-message-1", configDir: undefined },
    ]);
    expect(sessionId).toBe("forked-session-1");
  });

  test("rewinds tracked files to the user message", async () => {
    const claude = new FakeClaudeSdk();

    await revertClaudeFiles({
      query: claude.createQuery() as Query,
      messageId: "user-message-1",
    });

    expect(claude.recordedFileRewinds).toEqual([{ userMessageId: "user-message-1" }]);
  });

  test("translates Paseo timeline message ids before rewinding files", async () => {
    const claude = new FakeClaudeSdk();

    await revertClaudeFiles({
      query: claude.createQuery() as Query,
      messageId: "timeline-message-1",
      resolveMessageId: () => "claude-jsonl-message-1",
    });

    expect(claude.recordedFileRewinds).toEqual([{ userMessageId: "claude-jsonl-message-1" }]);
  });

  test("rebinds the Claude session before composed rewind returns for rehydrate", async () => {
    const claude = new FakeClaudeSdk();
    claude.setNextSessionId("forked-before-rehydrate");
    let sessionId = "original-session";

    await revertClaudeConversationAndFiles({
      sdk: claude,
      query: claude.createQuery() as Query,
      sessionId,
      messageId: "user-message-1",
      setSessionId: (nextSessionId) => {
        sessionId = nextSessionId;
      },
    });

    expect(claude.recordedFileRewinds).toEqual([{ userMessageId: "user-message-1" }]);
    expect(claude.recordedForks).toEqual([
      { upToMessageId: "user-message-1", configDir: undefined },
    ]);
    expect(sessionId).toBe("forked-before-rehydrate");
  });
});

describe("Claude rewind config dir isolation", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function writeSession(configDir: string): { sessionId: string; firstMessageId: string } {
    const cwd = "/tmp/paseo-rewind-isolation-project";
    const projectKey = cwd.replace(/[^a-zA-Z0-9]/g, "-");
    const projectDir = path.join(configDir, "projects", projectKey);
    fs.mkdirSync(projectDir, { recursive: true });
    const sessionId = "11111111-1111-4111-8111-111111111111";
    const firstMessageId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
    const entries = [
      {
        type: "user",
        uuid: firstMessageId,
        sessionId,
        cwd,
        message: { role: "user", content: "hi" },
        timestamp: new Date().toISOString(),
      },
      {
        type: "assistant",
        uuid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
        sessionId,
        cwd,
        message: { role: "assistant", content: "hello" },
        timestamp: new Date().toISOString(),
      },
    ];
    fs.writeFileSync(
      path.join(projectDir, `${sessionId}.jsonl`),
      `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    );
    return { sessionId, firstMessageId };
  }

  test("forks under the custom config dir without mutating the daemon env", async () => {
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "paseo-fork-config-"));
    tempDirs.push(configDir);
    const { sessionId, firstMessageId } = writeSession(configDir);
    const daemonConfigDir = process.env.CLAUDE_CONFIG_DIR;

    const fork = await realClaudeRewindSdk.forkSession(sessionId, {
      upToMessageId: firstMessageId,
      configDir,
    });

    expect(fork.sessionId).not.toBe(sessionId);
    const projectKey = "/tmp/paseo-rewind-isolation-project".replace(/[^a-zA-Z0-9]/g, "-");
    const forkedFile = path.join(configDir, "projects", projectKey, `${fork.sessionId}.jsonl`);
    expect(fs.existsSync(forkedFile)).toBe(true);
    expect(process.env.CLAUDE_CONFIG_DIR).toBe(daemonConfigDir);
  });
});
