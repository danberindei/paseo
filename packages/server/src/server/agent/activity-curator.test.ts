import { describe, expect, it } from "vitest";
import { buildAgentForkContextAttachment, curateAgentActivity } from "./activity-curator.js";
import type { AgentTimelineItem } from "./agent-sdk-types.js";
import type { AgentTimelineRow } from "./agent-timeline-store-types.js";
import { formatAgentMessage, projectAgentMessages } from "./agent-messages/index.js";
import { InMemoryAgentTimelineStore } from "./agent-timeline-store.js";

function toolCallItem(params: {
  callId: string;
  name: string;
  status?: "running" | "completed" | "failed" | "canceled";
  input?: unknown;
  output?: unknown;
  error?: unknown;
  metadata?: Record<string, unknown>;
  detail?: Extract<AgentTimelineItem, { type: "tool_call" }>["detail"];
}): Extract<AgentTimelineItem, { type: "tool_call" }> {
  const status = params.status ?? "completed";
  const detail = params.detail ?? {
    type: "unknown" as const,
    input: params.input ?? null,
    output: params.output ?? null,
  };
  return {
    type: "tool_call",
    callId: params.callId,
    name: params.name,
    status,
    detail,
    error: status === "failed" ? (params.error ?? { message: "failed" }) : null,
    metadata: params.metadata,
  };
}

function row(seq: number, item: AgentTimelineItem): AgentTimelineRow {
  return {
    seq,
    timestamp: `2026-06-28T00:00:${String(seq).padStart(2, "0")}.000Z`,
    item,
  };
}

/** Rows as the daemon hands them to a fork: projected by the timeline store. */
function storeTimeline(items: readonly AgentTimelineItem[]) {
  const store = new InMemoryAgentTimelineStore();
  store.initialize("agent-1");
  for (const item of items) store.append("agent-1", item);
  const { epoch, rows } = store.fetch("agent-1", { limit: 0 });
  return { epoch, rows };
}

function backgroundTaskItem(input: { status: "running" | "completed"; log: string }) {
  return toolCallItem({
    callId: "background-task",
    name: "Task",
    status: input.status,
    detail: {
      type: "sub_agent",
      subAgentType: "Explore",
      description: "Audit the migrations",
      log: input.log,
    },
  });
}

describe("curateAgentActivity", () => {
  it("keeps reasoning before the assistant text that followed it", () => {
    const timeline: AgentTimelineItem[] = [
      { type: "reasoning", text: "Check the commands first." },
      { type: "assistant_message", text: "I will list the commands." },
      toolCallItem({
        callId: "shell-order",
        name: "Bash",
        detail: {
          type: "shell",
          command: "ls packages/cli/src/commands/agent/",
          output: "",
          exitCode: 0,
        },
      }),
    ];

    expect(curateAgentActivity(timeline)).toBe(
      "[Thought] Check the commands first.\nI will list the commands.\n[Shell] ls packages/cli/src/commands/agent/",
    );
  });

  it("preserves alternating text kinds, labels, and fragment concatenation", () => {
    const timeline: AgentTimelineItem[] = [
      { type: "assistant_message", text: "First message." },
      { type: "reasoning", text: "First " },
      { type: "reasoning", text: "thought." },
      { type: "assistant_message", text: "Second " },
      { type: "assistant_message", text: "message." },
      { type: "reasoning", text: "Second thought." },
    ];

    expect(curateAgentActivity(timeline, { labelAssistantMessages: true })).toBe(
      "[Assistant] First message.\n[Thought] First thought.\n[Assistant] Second message.\n[Thought] Second thought.",
    );
    expect(curateAgentActivity(timeline, { maxItems: 2 })).toBe(
      "Second message.\n[Thought] Second thought.",
    );
  });

  it("renders delivered agent messages with their event, sender, and body", () => {
    const delivered = (source: Parameters<typeof formatAgentMessage>[0]["source"], text: string) =>
      projectAgentMessages({
        type: "user_message",
        text: formatAgentMessage({ id: `msg-${text.length}`, source, text }),
      })[0]!;
    const timeline: AgentTimelineItem[] = [
      delivered(
        { kind: "agent-message", agentId: "agt_lead", title: "CI lead" },
        "Take ownership.\nRead the handoff.",
      ),
      delivered(
        { kind: "agent-notification", agentId: "agt_child", event: "finished" },
        "Child is done.",
      ),
    ];

    expect(curateAgentActivity(timeline)).toBe(
      "[Message received] CI lead\nTake ownership.\nRead the handoff.\n[Agent finished] agt_child\nChild is done.",
    );
  });

  it("renders user/assistant/reasoning entries", () => {
    const timeline: AgentTimelineItem[] = [
      { type: "user_message", text: "Hello" },
      { type: "assistant_message", text: "Hi" },
      { type: "reasoning", text: "Thinking" },
    ];

    const result = curateAgentActivity(timeline);

    expect(result).toContain("[User] Hello");
    expect(result).toContain("Hi");
    expect(result).toContain("[Thought] Thinking");
  });

  it("uses detail enrichment for tool summaries", () => {
    const timeline: AgentTimelineItem[] = [
      toolCallItem({
        callId: "read-1",
        name: "read_file",
        detail: {
          type: "read",
          filePath: "src/index.ts",
          content: "console.log('hi')",
        },
      }),
      toolCallItem({
        callId: "shell-1",
        name: "shell",
        detail: {
          type: "shell",
          command: "npm test",
          output: "ok",
          exitCode: 0,
        },
      }),
    ];

    const result = curateAgentActivity(timeline);

    expect(result).toContain("[Read] src/index.ts");
    expect(result).toContain("[Shell] npm test");
  });

  it("renders terminal tool calls as one-line command summaries", () => {
    const timeline: AgentTimelineItem[] = [
      toolCallItem({
        callId: "terminal-1",
        name: "terminal",
        detail: {
          type: "plain_text",
          label: `skills/paseo-chat/bin/chat.sh post --room storage-revamp --body $'first line

second line'`,
          icon: "square_terminal",
        },
      }),
    ];

    const result = curateAgentActivity(timeline);

    expect(result).toContain(
      "[Terminal] skills/paseo-chat/bin/chat.sh post --room storage-revamp --body $'first line second line'",
    );
    expect(result).not.toContain("[Interacted with terminal]");
  });

  it("does not infer summary from raw input when detail is missing", () => {
    const timeline: AgentTimelineItem[] = [
      toolCallItem({
        callId: "shell-no-detail",
        name: "exec_command",
        status: "running",
        input: { command: "npm run lint" },
      }),
      toolCallItem({
        callId: "read-no-detail",
        name: "read_file",
        status: "running",
        input: { path: "src/index.ts" },
      }),
      toolCallItem({
        callId: "search-no-detail",
        name: "web_search",
        status: "running",
        input: { query: "zod union" },
      }),
    ];

    const result = curateAgentActivity(timeline);

    expect(result).toContain("[Exec command]");
    expect(result).toContain("[Read file]");
    expect(result).toContain("[Web search]");
    expect(result).not.toContain("npm run lint");
    expect(result).not.toContain("src/index.ts");
    expect(result).not.toContain("zod union");
  });

  it("falls back to input json for likely external tools", () => {
    const timeline: AgentTimelineItem[] = [
      toolCallItem({
        callId: "mcp-1",
        name: "paseo__create_agent",
        input: { cwd: "/tmp/repo", initialPrompt: "do the thing" },
      }),
    ];

    const result = curateAgentActivity(timeline);

    expect(result).toBe('[paseo__create_agent] {"cwd":"/tmp/repo","initialPrompt":"do the thing"}');
  });

  it("collapses repeated tool updates by callId", () => {
    const timeline: AgentTimelineItem[] = [
      toolCallItem({
        callId: "task-1",
        name: "Task",
        status: "running",
        detail: {
          type: "sub_agent",
          subAgentType: "Explore",
          description: "Investigate repository",
          log: "[Read] README.md",
        },
      }),
      toolCallItem({
        callId: "task-1",
        name: "Task",
        status: "running",
        detail: {
          type: "sub_agent",
          subAgentType: "Explore",
          description: "Investigate repository",
          log: "[Read] README.md\n[Bash] ls",
        },
      }),
    ];

    const result = curateAgentActivity(timeline);
    const lines = result.split("\n");

    expect(lines.filter((line) => line.startsWith("[Explore]"))).toEqual([
      "[Explore] Investigate repository",
    ]);
  });

  it("lists each sub-agent as its launch marker", () => {
    const timeline: AgentTimelineItem[] = [
      { type: "assistant_message", text: "Before first child." },
      toolCallItem({
        callId: "child-1",
        name: "Sub-agent",
        detail: {
          type: "sub_agent",
          subAgentType: "Child one",
          description: "First investigation",
          log: "",
        },
      }),
      { type: "assistant_message", text: "Between children." },
      toolCallItem({
        callId: "child-2",
        name: "Sub-agent",
        detail: {
          type: "sub_agent",
          subAgentType: "Child two",
          description: "Second investigation",
          log: "",
        },
      }),
      { type: "assistant_message", text: "After second child." },
    ];

    const result = curateAgentActivity(timeline, { labelAssistantMessages: true });

    expect(result.split("\n")).toEqual([
      "[Assistant] Before first child.",
      "[Child one] First investigation",
      "[Assistant] Between children.",
      "[Child two] Second investigation",
      "[Assistant] After second child.",
    ]);
  });

  it("renders todo/error/compaction entries", () => {
    const timeline: AgentTimelineItem[] = [
      {
        type: "todo",
        items: [
          { text: "One", completed: false },
          { text: "Two", completed: true },
        ],
      },
      { type: "error", message: "boom" },
      { type: "compaction", status: "completed", trigger: "auto" },
    ];

    const result = curateAgentActivity(timeline);

    expect(result).toContain("[Tasks]");
    expect(result).toContain("- [ ] One");
    expect(result).toContain("- [x] Two");
    expect(result).toContain("[Error] boom");
    expect(result).toContain("[Compacted]");
  });

  it("truncates to maxItems", () => {
    const timeline: AgentTimelineItem[] = [
      { type: "user_message", text: "Message 1" },
      { type: "user_message", text: "Message 2" },
      { type: "user_message", text: "Message 3" },
      { type: "user_message", text: "Message 4" },
    ];

    const result = curateAgentActivity(timeline, { maxItems: 2 });

    expect(result).not.toContain("Message 1");
    expect(result).not.toContain("Message 2");
    expect(result).toContain("Message 3");
    expect(result).toContain("Message 4");
  });

  it("returns a default message when timeline is empty", () => {
    expect(curateAgentActivity([])).toBe("No activity to display.");
  });

  it("carries every user message and the boundary turn's assistant and tool summaries", () => {
    const result = buildAgentForkContextAttachment({
      agentId: "agent-1234",
      agentTitle: "Source Agent",
      cwd: "/repo",
      boundaryMessageId: "assistant-2",
      rows: [
        row(1, { type: "user_message", text: "Earlier task", messageId: "user-0" }),
        row(2, { type: "assistant_message", text: "Earlier answer.", messageId: "assistant-1" }),
        row(3, { type: "user_message", text: "Ship the thing", messageId: "user-1" }),
        row(4, { type: "reasoning", text: "private chain of thought" }),
        row(
          5,
          toolCallItem({
            callId: "read-1",
            name: "read_file",
            detail: {
              type: "read",
              filePath: "src/index.ts",
              content: "console.log('hi')",
            },
          }),
        ),
        row(
          6,
          toolCallItem({
            callId: "external-1",
            name: "paseo__create_agent",
            input: { initialPrompt: "do not include raw external tool input" },
          }),
        ),
        row(7, {
          type: "assistant_message",
          text: "Done.",
          messageId: "assistant-2",
        }),
        row(8, {
          type: "assistant_message",
          text: "Later answer.",
          messageId: "assistant-3",
        }),
      ],
    });

    expect(result.boundaryMessageId).toBe("assistant-2");
    expect(result.attachment).toMatchObject({
      type: "text",
      mimeType: "text/plain",
      contextKind: "chat_history",
      title: "Source Agent",
    });
    expect(result.attachment.text).toMatch(/^<chat-history-summary>\n/);
    expect(result.attachment.text).toMatch(/\n<\/chat-history-summary>$/);
    expect(result.attachment.text).toContain("Source agent: Source Agent");
    expect(result.attachment.text).toContain("Source agent id: agent-1234");
    expect(result.attachment.text).toContain("Source directory: /repo");
    expect(result.attachment.text).toContain("[Read] src/index.ts");
    expect(result.attachment.text).toContain("[paseo__create_agent]");
    expect(result.attachment.text).toContain("[Assistant] Done.");
    expect(result.attachment.text).toContain("[User] Earlier task");
    expect(result.attachment.text).toContain("[User] Ship the thing");
    expect(result.attachment.text).not.toContain("Earlier answer.");
    expect(result.attachment.text).not.toContain("private chain of thought");
    expect(result.attachment.text).not.toContain("do not include raw external tool input");
    expect(result.attachment.text).not.toContain("Later answer.");
  });

  it("points the fork target at the source transcript when a path is given", () => {
    const result = buildAgentForkContextAttachment({
      agentId: "agent-1234",
      cwd: "/repo",
      transcriptPath: "/home/dev/.claude/projects/-repo/session-1.jsonl",
      boundaryMessageId: "assistant-1",
      rows: [
        row(1, { type: "user_message", text: "Go", messageId: "user-1" }),
        row(2, { type: "assistant_message", text: "Done.", messageId: "assistant-1" }),
        row(3, { type: "user_message", text: "Later task", messageId: "user-2" }),
        row(4, { type: "assistant_message", text: "Later answer.", messageId: "assistant-2" }),
      ],
    });

    expect(result.attachment.text).toContain(
      "The source agent's full session transcript is at /home/dev/.claude/projects/-repo/session-1.jsonl.",
    );
    expect(result.attachment.text).toContain(
      "Read only through assistant message ID assistant-1. Do not read or use transcript entries after that message.",
    );
    expect(result.attachment.text).toContain("Read within that boundary");
    expect(result.attachment.text).not.toContain("Later task");
    expect(result.attachment.text).not.toContain("Later answer.");
    expect(result.attachment.text).toMatch(/\n<\/chat-history-summary>$/);
  });

  it("bounds fork history while preserving recent messages and transcript guidance", () => {
    const result = buildAgentForkContextAttachment({
      agentId: "agent-1234",
      agentTitle: "Source Agent",
      cwd: "/repo",
      transcriptPath: "/home/dev/.codex/sessions/rollout-session-1.jsonl",
      boundaryMessageId: "checkpoint",
      rows: [
        row(1, { type: "user_message", text: "Old task " + "x".repeat(1_100_000) }),
        row(2, { type: "assistant_message", text: "Old answer." }),
        row(3, { type: "user_message", text: "Recent task" }),
        row(4, { type: "assistant_message", text: "Recent answer." }),
        row(5, { type: "user_message", text: "Continue the task" }),
        row(6, { type: "assistant_message", text: "Latest answer.", messageId: "checkpoint" }),
        row(7, { type: "user_message", text: "Beyond the selected checkpoint." }),
      ],
    });

    expect(result.attachment.text.length).toBeLessThanOrEqual(100_000);
    expect(result.attachment.text).toContain(
      "[Earlier chat history omitted]\n[User] Recent task\n[User] Continue the task\n[Assistant] Latest answer.",
    );
    expect(result.attachment.text).not.toContain("Old task");
    expect(result.attachment.text).not.toContain("Beyond the selected checkpoint.");
    expect(result.attachment.text).toContain(
      "The source agent's full session transcript is at /home/dev/.codex/sessions/rollout-session-1.jsonl.",
    );
    expect(result.attachment.text).toContain(
      "Read only through assistant message ID checkpoint. Do not read or use transcript entries after that message.",
    );
    expect(result.attachment.text).toMatch(/^<chat-history-summary>\n/);
    expect(result.attachment.text).toMatch(/\n<\/chat-history-summary>$/);
    expect(result.boundaryMessageId).toBe("checkpoint");
  });

  it("bounds one oversized fork message and display metadata while retaining its beginning and end", () => {
    const result = buildAgentForkContextAttachment({
      agentTitle: "T".repeat(200_000),
      cwd: "/" + "p".repeat(200_000),
      transcriptPath: "/home/dev/.codex/sessions/rollout-session-1.jsonl",
      rows: [
        row(1, {
          type: "assistant_message",
          text: "Beginning. " + "x".repeat(1_100_000) + " The end.",
        }),
      ],
    });

    expect(result.attachment.text.length).toBe(100_000);
    expect(result.attachment.title).toBe("T".repeat(1_000));
    expect(result.attachment.text).toContain("Source directory: /" + "p".repeat(999) + "\n");
    expect(result.attachment.text).toContain("[Assistant] Beginning.");
    expect(result.attachment.text).toContain("\n[Message truncated]\n");
    expect(result.attachment.text).toContain("The end.");
    expect(result.attachment.text).toContain(
      "The source agent's full session transcript is at /home/dev/.codex/sessions/rollout-session-1.jsonl.",
    );
    expect(result.attachment.text).toContain(
      "Read only transcript content represented by the summary above. Do not read or use later content, including anything appended after this fork context was created.",
    );
    expect(result.attachment.text).toMatch(/^<chat-history-summary>\n/);
    expect(result.attachment.text).toMatch(/\n<\/chat-history-summary>$/);
  });

  it("bounds accumulated user prompts even when each prompt fits individually", () => {
    const oldest = "Old task " + "x".repeat(60_000);
    const recent = "Recent task " + "y".repeat(60_000);
    const result = buildAgentForkContextAttachment({
      rows: [
        row(1, { type: "user_message", text: oldest }),
        row(2, { type: "assistant_message", text: "Old answer." }),
        row(3, { type: "user_message", text: recent }),
        row(4, { type: "assistant_message", text: "Latest answer." }),
      ],
    });

    expect(result.attachment.text).toBe(
      `<chat-history-summary>\nChat history from a previous Paseo agent.\n\n[Earlier chat history omitted]\n[User] ${recent}\n[Assistant] Latest answer.\n</chat-history-summary>`,
    );
    expect(result.attachment.text.length).toBeLessThanOrEqual(100_000);
  });

  it("preserves fork history that exactly fits the character budget", () => {
    const prefix = "<chat-history-summary>\nChat history from a previous Paseo agent.\n\n[User] ";
    const suffix = "\n</chat-history-summary>";
    const text = "x".repeat(100_000 - prefix.length - suffix.length);
    const result = buildAgentForkContextAttachment({
      rows: [row(1, { type: "user_message", text })],
    });

    expect(result.attachment.text).toBe(prefix + text + suffix);
    expect(result.attachment.text.length).toBe(100_000);
  });

  it("preserves transcript paths and boundary identifiers longer than the display metadata limit", () => {
    const transcriptPath = "/sessions/" + "segment/".repeat(150) + "rollout.jsonl";
    const boundaryMessageId = "message-" + "x".repeat(1_100);
    const result = buildAgentForkContextAttachment({
      transcriptPath,
      boundaryMessageId,
      rows: [
        row(1, {
          type: "assistant_message",
          text: "Beginning. " + "x".repeat(200_000) + " The end.",
          messageId: boundaryMessageId,
        }),
      ],
    });

    expect(result.attachment.text.length).toBe(100_000);
    expect(result.attachment.text).toContain(
      `The source agent's full session transcript is at ${transcriptPath}.`,
    );
    expect(result.attachment.text).toContain(
      `Read only through assistant message ID ${boundaryMessageId}. Do not read or use transcript entries after that message.`,
    );
    expect(result.boundaryMessageId).toBe(boundaryMessageId);
  });

  it("rejects metadata that cannot fit without truncating the transcript path", () => {
    expect(() =>
      buildAgentForkContextAttachment({
        transcriptPath: "/sessions/" + "segment/".repeat(12_500) + "rollout.jsonl",
        rows: [],
      }),
    ).toThrow("Fork context metadata exceeds the character limit.");
  });

  it("limits an in-flight fork to transcript content represented by the summary", () => {
    const result = buildAgentForkContextAttachment({
      transcriptPath: "/home/dev/.codex/sessions/rollout-session-1.jsonl",
      rows: [
        row(1, { type: "user_message", text: "Go", messageId: "user-1" }),
        row(2, { type: "assistant_message", text: "Still working" }),
      ],
    });

    expect(result.attachment.text).toContain(
      "Read only transcript content represented by the summary above. Do not read or use later content, including anything appended after this fork context was created.",
    );
  });

  it("omits the transcript guidance when no path is given", () => {
    const result = buildAgentForkContextAttachment({
      agentId: "agent-1234",
      cwd: "/repo",
      boundaryMessageId: "assistant-1",
      rows: [
        row(1, { type: "user_message", text: "Go", messageId: "user-1" }),
        row(2, { type: "assistant_message", text: "Done.", messageId: "assistant-1" }),
      ],
    });

    expect(result.attachment.text).not.toContain("full session transcript");
  });

  it("keeps the sub-agent launch marker of the forked turn", () => {
    const result = buildAgentForkContextAttachment({
      boundaryMessageId: "assistant-1",
      rows: [
        row(1, { type: "user_message", text: "Investigate", messageId: "user-1" }),
        row(
          2,
          toolCallItem({
            callId: "task-1",
            name: "Task",
            detail: {
              type: "sub_agent",
              subAgentType: "Explore",
              description: "Investigate repository",
              log: "",
            },
          }),
        ),
        row(3, { type: "assistant_message", text: "Done.", messageId: "assistant-1" }),
      ],
    });

    expect(result.attachment.title).toBe("Chat history");
    expect(result.attachment.text).toContain("[Explore] Investigate repository");
    expect(result.attachment.text).toContain("[Assistant] Done.");
  });

  it("does not cap a long turn to the generic recent activity limit", () => {
    const toolRows = Array.from({ length: 30 }, (_, index) =>
      row(index + 2, {
        ...toolCallItem({
          callId: `read-${index}`,
          name: "read_file",
          detail: {
            type: "read",
            filePath: `file-${index}.ts`,
            content: "x",
          },
        }),
      }),
    );
    const result = buildAgentForkContextAttachment({
      boundaryMessageId: "assistant-1",
      rows: [
        row(1, { type: "user_message", text: "Go", messageId: "user-1" }),
        ...toolRows,
        row(32, {
          type: "assistant_message",
          text: "Done.",
          messageId: "assistant-1",
        }),
      ],
    });

    expect(result.itemCount).toBe(32);
    expect(result.attachment.text).toContain("[User] Go");
    expect(result.attachment.text).toContain("[Read] file-0.ts");
    expect(result.attachment.text).toContain("[Read] file-29.ts");
    expect(result.attachment.text).toContain("[Assistant] Done.");
  });

  it("forks at a response that background work outlives, by message id", () => {
    const { rows } = storeTimeline([
      { type: "user_message", text: "Audit in the background", messageId: "user-1" },
      backgroundTaskItem({ status: "running", log: "scanning" }),
      { type: "assistant_message", text: "Audit started.", messageId: "assistant-1" },
      backgroundTaskItem({ status: "completed", log: "FINAL REPORT after the response" }),
      { type: "user_message", text: "Any findings?", messageId: "user-2" },
    ]);
    expect(rows[1]).toMatchObject({ seqStart: 2, seqEnd: 4 });

    const result = buildAgentForkContextAttachment({ boundaryMessageId: "assistant-1", rows });

    expect(result.itemCount).toBe(3);
    expect(result.boundaryMessageId).toBe("assistant-1");
    expect(result.attachment.text).toContain(
      "[User] Audit in the background\n[Explore] Audit the migrations\n[Assistant] Audit started.\n",
    );
    expect(result.attachment.text).not.toContain("FINAL REPORT");
    expect(result.attachment.text).not.toContain("Any findings?");
  });

  it("forks at a response that background work outlives, by timeline cursor", () => {
    const { epoch, rows } = storeTimeline([
      { type: "user_message", text: "Audit in the background", messageId: "user-1" },
      backgroundTaskItem({ status: "running", log: "scanning" }),
      { type: "assistant_message", text: "Audit started." },
      backgroundTaskItem({ status: "completed", log: "FINAL REPORT after the response" }),
      { type: "assistant_message", text: "The audit finished." },
    ]);

    const result = buildAgentForkContextAttachment({
      cursorBoundary: { timelineEpoch: epoch, cursor: { epoch, seq: 3 } },
      rows,
    });

    expect(result.boundaryCursor).toEqual({ epoch, seq: 3 });
    expect(result.itemCount).toBe(3);
    expect(result.attachment.text).toContain(
      "[User] Audit in the background\n[Explore] Audit the migrations\n[Assistant] Audit started.\n",
    );
    expect(result.attachment.text).not.toContain("FINAL REPORT");
    expect(result.attachment.text).not.toContain("The audit finished.");
  });

  it("forks from a checkpoint when a plugin card was updated after it", () => {
    const card = (seq: number, turns: number) =>
      row(seq, {
        type: "plugin",
        id: "memory-receipt",
        pluginId: "memorise",
        kind: "memory-receipt",
        version: 1,
        data: { turns },
      });
    const result = buildAgentForkContextAttachment({
      boundaryMessageId: "assistant-1",
      rows: [
        row(1, { type: "user_message", text: "First question", messageId: "user-1" }),
        card(2, 1),
        row(3, { type: "assistant_message", text: "First answer.", messageId: "assistant-1" }),
        row(4, { type: "user_message", text: "Second question", messageId: "user-2" }),
        row(5, { type: "assistant_message", text: "Second answer.", messageId: "assistant-2" }),
        card(6, 2),
      ],
    });

    expect(result.attachment.text).toContain("[User] First question");
    expect(result.attachment.text).toContain("[Assistant] First answer.");
    expect(result.attachment.text).not.toContain("Second question");
    expect(result.attachment.text).not.toContain("memory-receipt");
  });

  it("selects a synthetic assistant error by its timeline cursor", () => {
    const result = buildAgentForkContextAttachment({
      cursorBoundary: {
        timelineEpoch: "timeline-1",
        cursor: { epoch: "timeline-1", seq: 2 },
      },
      rows: [
        row(1, { type: "user_message", text: "Try the task", messageId: "user-1" }),
        row(2, { type: "assistant_message", text: "[System Error] provider failed" }),
        row(3, {
          type: "assistant_message",
          text: "This belongs to a later turn.",
          messageId: "assistant-2",
        }),
      ],
    });

    expect(result.boundaryCursor).toEqual({ epoch: "timeline-1", seq: 2 });
    expect(result.boundaryMessageId).toBeNull();
    expect(result.attachment.text).toContain("[System Error] provider failed");
    expect(result.attachment.text).not.toContain("This belongs to a later turn.");
  });

  it("rejects a transcript message id that is later than the selected timeline cursor", () => {
    expect(() =>
      buildAgentForkContextAttachment({
        transcriptPath: "/home/dev/.codex/sessions/rollout-session-1.jsonl",
        cursorBoundary: {
          timelineEpoch: "timeline-1",
          cursor: { epoch: "timeline-1", seq: 2 },
        },
        boundaryMessageId: "assistant-2",
        rows: [
          row(1, { type: "user_message", text: "Go", messageId: "user-1" }),
          row(2, { type: "assistant_message", text: "Selected answer.", messageId: "assistant-1" }),
          row(3, { type: "user_message", text: "Later task", messageId: "user-2" }),
          row(4, { type: "assistant_message", text: "Later answer.", messageId: "assistant-2" }),
        ],
      }),
    ).toThrow("Selected assistant message does not match timeline position.");
  });

  it("uses a matching transcript message id with its timeline cursor", () => {
    const result = buildAgentForkContextAttachment({
      transcriptPath: "/home/dev/.codex/sessions/rollout-session-1.jsonl",
      cursorBoundary: {
        timelineEpoch: "timeline-1",
        cursor: { epoch: "timeline-1", seq: 2 },
      },
      boundaryMessageId: "assistant-1",
      rows: [
        row(1, { type: "user_message", text: "Go", messageId: "user-1" }),
        row(2, { type: "assistant_message", text: "Selected answer.", messageId: "assistant-1" }),
        row(3, { type: "user_message", text: "Later task", messageId: "user-2" }),
        row(4, { type: "assistant_message", text: "Later answer.", messageId: "assistant-2" }),
      ],
    });

    expect(result.boundaryCursor).toEqual({ epoch: "timeline-1", seq: 2 });
    expect(result.boundaryMessageId).toBe("assistant-1");
    expect(result.attachment.text).toContain(
      "Read only through assistant message ID assistant-1. Do not read or use transcript entries after that message.",
    );
    expect(result.attachment.text).not.toContain("Later task");
    expect(result.attachment.text).not.toContain("Later answer.");
  });

  it("rejects a cursor from a previous timeline epoch", () => {
    expect(() =>
      buildAgentForkContextAttachment({
        cursorBoundary: {
          timelineEpoch: "timeline-2",
          cursor: { epoch: "timeline-1", seq: 2 },
        },
        rows: [row(2, { type: "assistant_message", text: "Stale result." })],
      }),
    ).toThrow("Selected timeline position is no longer available.");
  });

  it("rejects missing assistant boundaries instead of silently using the wrong context", () => {
    expect(() =>
      buildAgentForkContextAttachment({
        boundaryMessageId: "missing",
        rows: [row(1, { type: "assistant_message", text: "Done.", messageId: "assistant-1" })],
      }),
    ).toThrow("Selected assistant message is no longer available.");
  });

  it("returns an empty context for an empty timeline with no boundary", () => {
    const result = buildAgentForkContextAttachment({ rows: [] });

    expect(result.itemCount).toBe(0);
    expect(result.boundaryCursor).toBeNull();
    expect(result.boundaryMessageId).toBeNull();
    expect(result.attachment.text).toContain("No chat history to display.");
  });

  it("strips a nested chat-history-summary from a preceding user message", () => {
    const nested = [
      "<chat-history-summary>",
      "Chat history from a previous Paseo agent.",
      "Source agent id: old-agent-id",
      "Source directory: /home/user/worklog",
      "",
      "[Read] docs/old.md",
      "</chat-history-summary>",
    ].join("\n");
    const result = buildAgentForkContextAttachment({
      boundaryMessageId: "assistant-1",
      rows: [
        row(1, { type: "user_message", text: nested, messageId: "user-1" }),
        row(2, { type: "user_message", text: "Continue the work", messageId: "user-2" }),
        row(3, { type: "assistant_message", text: "Working.", messageId: "assistant-1" }),
      ],
    });

    expect((result.attachment.text.match(/<chat-history-summary>/g) ?? []).length).toBe(1);
    expect(result.attachment.text).toContain("[User] Continue the work");
    expect(result.attachment.text).not.toContain("old-agent-id");
    expect(result.attachment.text).not.toContain("[Read] docs/old.md");
  });
});

it("bounds fork history to 100,000 characters while preserving the newest messages", () => {
  const result = buildAgentForkContextAttachment({
    rows: [
      row(1, { type: "user_message", text: "old-message " + "x".repeat(1_100_000) }),
      row(2, { type: "assistant_message", messageId: "checkpoint", text: "Latest answer." }),
      row(3, { type: "user_message", text: "Beyond the selected checkpoint." }),
    ],
    boundaryMessageId: "checkpoint",
  });
  expect(result.attachment.text.length).toBeLessThanOrEqual(100_000);
  expect(result.attachment.text).toContain("[Earlier chat history omitted]");
  expect(result.attachment.text).toContain("[Assistant] Latest answer.");
  expect(result.attachment.text).not.toContain("old-message");
  expect(result.attachment.text).not.toContain("Beyond the selected checkpoint.");
  expect(result.attachment.text).toMatch(/^<chat-history-summary>\n/);
  expect(result.attachment.text).toMatch(/\n<\/chat-history-summary>$/);
});

it("bounds one oversized fork message and metadata without losing its beginning and end", () => {
  const result = buildAgentForkContextAttachment({
    rows: [
      row(1, {
        type: "assistant_message",
        text: "Beginning. " + "x".repeat(1_100_000) + " The end.",
      }),
    ],
    agentTitle: "T".repeat(200_000),
    cwd: "/" + "p".repeat(200_000),
  });
  expect(result.attachment.text.length).toBe(100_000);
  expect(result.attachment.text).toContain("[Assistant] Beginning.");
  expect(result.attachment.text).toContain("[Message truncated]");
  expect(result.attachment.text).toContain("The end.");
  expect(result.attachment.text).toMatch(/\n<\/chat-history-summary>$/);
});

it("preserves every message in fork history below the character budget", () => {
  const text = "Complete conversation " + "x".repeat(90_000);
  const result = buildAgentForkContextAttachment({
    rows: [row(1, { type: "user_message", text })],
  });
  expect(result.attachment.text).toBe(
    `<chat-history-summary>\nChat history from a previous Paseo agent.\n\n[User] ${text}\n</chat-history-summary>`,
  );
});
