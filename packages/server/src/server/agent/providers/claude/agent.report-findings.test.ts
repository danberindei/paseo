import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { expect, test } from "vitest";

import { createTestLogger } from "../../../../test-utils/test-logger.js";
import type { AgentStreamEvent, AgentTimelineItem } from "../../agent-sdk-types.js";
import { ClaudeAgentClient } from "./agent.js";

interface ClaudeReportFindingsTestSession {
  translateMessageToEvents(message: SDKMessage): AgentStreamEvent[];
}

async function createSession(): Promise<ClaudeReportFindingsTestSession> {
  const client = new ClaudeAgentClient({
    logger: createTestLogger(),
    resolveBinary: async () => "/test/claude/bin",
  });
  const session = await client.createSession({ provider: "claude", cwd: process.cwd() });
  return session as unknown as ClaudeReportFindingsTestSession;
}

function timelineItems(events: AgentStreamEvent[]): AgentTimelineItem[] {
  return events
    .filter((event) => event.type === "timeline")
    .map((event) => (event as { item: AgentTimelineItem }).item);
}

test("renders ReportFindings from the tool-use input when the tool result is a summary", async () => {
  const session = await createSession();
  const toolUseId = "toolu_review";

  session.translateMessageToEvents({
    type: "assistant",
    uuid: "assistant-review",
    session_id: "session-review",
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: toolUseId,
          name: "ReportFindings",
          input: {
            level: "high",
            findings: [
              {
                file: "src/index.ts",
                line: 42,
                category: "Null pointer",
                short_summary: "Missing null check",
              },
            ],
          },
        },
      ],
    },
  } as unknown as SDKMessage);

  const events = session.translateMessageToEvents({
    type: "user",
    uuid: "user-review-result",
    session_id: "session-review",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: toolUseId,
          tool_name: "ReportFindings",
          content: "1 finding reported.",
        },
      ],
    },
  } as unknown as SDKMessage);

  expect(timelineItems(events)).toContainEqual({
    type: "review_result",
    text: `### Review findings (high)

1. **src/index.ts:42** — Null pointer

   **Summary:** Missing null check`,
  });
});
