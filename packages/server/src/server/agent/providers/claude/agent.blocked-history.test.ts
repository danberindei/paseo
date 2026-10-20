import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import type { AgentPersistenceHandle, AgentStreamEvent } from "../../agent-sdk-types.js";
import { createTestLogger } from "../../../../test-utils/test-logger.js";
import { ClaudeAgentClient } from "./agent.js";
import { claudeProjectDirSync } from "./project-dir.js";

const SESSION_ID = "blocked-prompt-session";
const BLOCKED_TEXT =
  "UserPromptSubmit operation blocked by hook:\nMessage blocked: quota pace is red.\n\nOriginal prompt: keep going";

describe("ClaudeAgentSession blocked prompt history", () => {
  let tempRoot: string;
  let cwd: string;
  let configDir: string;
  let previousClaudeConfigDir: string | undefined;

  function writeTranscript(entries: unknown[]): void {
    const historyDir = claudeProjectDirSync(cwd, { configDir });
    mkdirSync(historyDir, { recursive: true });
    writeFileSync(
      path.join(historyDir, `${SESSION_ID}.jsonl`),
      entries.map((entry) => JSON.stringify(entry)).join("\n"),
      "utf8",
    );
  }

  async function readHistory(): Promise<AgentStreamEvent[]> {
    const client = new ClaudeAgentClient({
      logger: createTestLogger(),
      queryFactory: vi.fn(() => {
        throw new Error("history replay must not start a query");
      }),
      resolveBinary: async () => "/test/claude/bin",
    });
    const handle: AgentPersistenceHandle = {
      provider: "claude",
      sessionId: SESSION_ID,
      nativeHandle: SESSION_ID,
      metadata: { provider: "claude", cwd },
    };
    const session = await client.resumeSession(handle, { cwd });
    const events: AgentStreamEvent[] = [];
    try {
      for await (const event of session.streamHistory()) {
        events.push(event);
      }
    } finally {
      await session.close();
    }
    return events;
  }

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(os.tmpdir(), "claude-blocked-history-"));
    cwd = path.join(tempRoot, "repo");
    configDir = path.join(tempRoot, "claude-config");
    mkdirSync(cwd, { recursive: true });
    previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = configDir;
  });

  afterEach(() => {
    if (previousClaudeConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR;
    } else {
      process.env.CLAUDE_CONFIG_DIR = previousClaudeConfigDir;
    }
    rmSync(tempRoot, { recursive: true, force: true });
  });

  test("replays a hook block banner as an assistant message", async () => {
    writeTranscript([
      { type: "queue-operation", operation: "enqueue", sessionId: SESSION_ID },
      { type: "queue-operation", operation: "dequeue", sessionId: SESSION_ID },
      {
        type: "system",
        subtype: "informational",
        content: BLOCKED_TEXT,
        level: "warning",
        preventContinuation: true,
        uuid: "blocked-banner-uuid",
        timestamp: "2026-10-20T06:28:07.359Z",
        sessionId: SESSION_ID,
        cwd,
      },
    ]);

    const events = await readHistory();

    expect(events).toContainEqual({
      type: "timeline",
      provider: "claude",
      timestamp: "2026-10-20T06:28:07.359Z",
      item: {
        type: "assistant_message",
        text: BLOCKED_TEXT,
        messageId: "blocked-banner-uuid",
      },
    });
  });

  test("does not replay informational banners that did not stop the turn", async () => {
    writeTranscript([
      {
        type: "system",
        subtype: "informational",
        content: "Set model to claude-opus-4-6",
        level: "notice",
        uuid: "banner-uuid",
        timestamp: "2026-10-20T06:28:07.359Z",
        sessionId: SESSION_ID,
        cwd,
      },
    ]);

    expect(await readHistory()).toEqual([]);
  });
});
