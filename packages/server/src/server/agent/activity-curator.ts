import type { AgentTimelineItem, ToolCallTimelineItem } from "./agent-sdk-types.js";
import type { AgentMessage } from "@getpaseo/protocol/agent-message";
import type { AgentAttachment } from "@getpaseo/protocol/messages";
import type { AgentTimelineRow } from "./agent-timeline-store-types.js";
import { isLikelyExternalToolName } from "@getpaseo/protocol/tool-name-normalization";
import { buildAgentMessageDisplay } from "@getpaseo/protocol/paseo-tool-presentation/index";
import { buildToolCallDisplayModel } from "@getpaseo/protocol/tool-call-display";
import {
  projectTimelineRows,
  selectItemsByProjectedLimit,
  type TimelineProjectionEntry,
} from "./timeline-projection.js";

const DEFAULT_MAX_ITEMS = 0;
const MAX_TOOL_INPUT_CHARS = 400;
const MAX_TOOL_SUMMARY_CHARS = 200;
const MAX_FORK_CONTEXT_CHARS = 100_000;
const MAX_FORK_METADATA_CHARS = 1_000;
const FORK_HISTORY_OMITTED = "[Earlier chat history omitted]\n";
const FORK_MESSAGE_TRUNCATED = "\n[Message truncated]\n";
const FORK_USER_KINDS: readonly AgentTimelineItem["type"][] = ["user_message"];
const FORK_TURN_KINDS: readonly AgentTimelineItem["type"][] = ["assistant_message", "tool_call"];

interface ActivityCuratorOptions {
  maxItems?: number;
  labelAssistantMessages?: boolean;
  includeKinds?: readonly AgentTimelineItem["type"][];
  includeExternalToolInput?: boolean;
}

interface ActivityEntry {
  text: string;
}

type TextAgentAttachment = Extract<AgentAttachment, { type: "text" }>;

function activityEntry(text: string): ActivityEntry {
  return { text };
}

function appendTextEntry(
  entries: ActivityEntry[],
  item: Extract<AgentTimelineItem, { type: "assistant_message" | "reasoning" }>,
  options?: ActivityCuratorOptions,
) {
  const text = item.text.trim();
  if (!text) return;
  let prefix = options?.labelAssistantMessages ? "[Assistant] " : "";
  if (item.type === "reasoning") prefix = "[Thought] ";
  entries.push(activityEntry(`${prefix}${text}`));
}

function formatToolInputJson(input: unknown): string | null {
  if (input === undefined) {
    return null;
  }
  try {
    const encoded = JSON.stringify(input);
    if (!encoded) {
      return null;
    }
    if (encoded.length <= MAX_TOOL_INPUT_CHARS) {
      return encoded;
    }
    return `${encoded.slice(0, MAX_TOOL_INPUT_CHARS)}...`;
  } catch {
    return null;
  }
}

function formatToolSummary(summary: string | undefined): string | null {
  if (typeof summary !== "string") {
    return null;
  }
  const normalized = summary.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length <= MAX_TOOL_SUMMARY_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_TOOL_SUMMARY_CHARS - 3)}...`;
}

function inputFromUnknownDetail(
  detail: Extract<AgentTimelineItem, { type: "tool_call" }>["detail"],
): unknown {
  return detail.type === "unknown" ? detail.input : null;
}

function projectForCuration(items: readonly AgentTimelineItem[]): AgentTimelineItem[] {
  const rows = items.map((item, index) => ({
    seq: index + 1,
    timestamp: "",
    item,
  }));
  return projectTimelineRows({ rows, mode: "projected" }).map((entry) => entry.item);
}

function shouldIncludeItem(item: AgentTimelineItem, options?: ActivityCuratorOptions): boolean {
  if (!options?.includeKinds) {
    return true;
  }
  return options.includeKinds.includes(item.type);
}

function formatToolCallEntry(
  item: Extract<AgentTimelineItem, { type: "tool_call" }>,
  options?: ActivityCuratorOptions,
): ActivityEntry {
  const inputJson = formatToolInputJson(inputFromUnknownDetail(item.detail));
  const display = buildToolCallDisplayModel({
    name: item.name,
    status: item.status,
    error: item.error,
    detail: item.detail,
    metadata: item.metadata,
  });
  const displayName = display.displayName;
  const summary = formatToolSummary(display.summary);
  if (
    (options?.includeExternalToolInput ?? true) &&
    isLikelyExternalToolName(item.name) &&
    inputJson
  ) {
    return activityEntry(`[${displayName}] ${inputJson}`);
  }
  return activityEntry(summary ? `[${displayName}] ${summary}` : `[${displayName}]`);
}

function appendAgentMessageEntries(entries: ActivityEntry[], message: AgentMessage) {
  const display = buildAgentMessageDisplay(message);
  entries.push(
    activityEntry(
      display.summary ? `[${display.displayName}] ${display.summary}` : `[${display.displayName}]`,
    ),
  );
  const body = message.text.trim();
  if (body) entries.push(activityEntry(body));
}

function curateProjectedActivityEntries(
  items: readonly AgentTimelineItem[],
  options?: ActivityCuratorOptions,
): ActivityEntry[] {
  if (items.length === 0) {
    return [];
  }

  const maxItems = options?.maxItems ?? DEFAULT_MAX_ITEMS;
  const recentItems = maxItems > 0 && items.length > maxItems ? items.slice(-maxItems) : items;

  const entries: ActivityEntry[] = [];

  for (const item of recentItems) {
    if (!shouldIncludeItem(item, options)) {
      continue;
    }

    switch (item.type) {
      case "user_message":
        entries.push(activityEntry(`[User] ${item.text.trim()}`));
        break;
      case "assistant_message":
      case "reasoning":
        appendTextEntry(entries, item, options);
        break;
      case "tool_call": {
        if (item.agentMessage) {
          appendAgentMessageEntries(entries, item.agentMessage);
          break;
        }
        entries.push(formatToolCallEntry(item, options));
        break;
      }
      case "todo":
        entries.push(activityEntry("[Tasks]"));
        for (const entry of item.items) {
          const checkbox = entry.completed ? "[x]" : "[ ]";
          const text = `- ${checkbox} ${entry.text}`;
          entries.push(activityEntry(text));
        }
        break;
      case "error":
        entries.push(activityEntry(`[Error] ${item.message}`));
        break;
      case "compaction":
        entries.push(activityEntry("[Compacted]"));
        break;
    }
  }

  return entries;
}

function curateAgentActivityEntries(
  timeline: AgentTimelineItem[],
  options?: ActivityCuratorOptions,
): ActivityEntry[] {
  const collapsed = projectForCuration(timeline);
  return curateProjectedActivityEntries(collapsed, options);
}

/**
 * Convert normalized agent timeline items into a concise text summary.
 */
export function curateAgentActivity(
  timeline: AgentTimelineItem[],
  options?: ActivityCuratorOptions,
): string {
  const entries = curateAgentActivityEntries(timeline, options);
  return entries.length > 0
    ? entries.map((entry) => entry.text).join("\n")
    : "No activity to display.";
}

export function summarizeAgentActivity(timeline: AgentTimelineItem[], limit?: number) {
  const selection = selectItemsByProjectedLimit({
    items: timeline,
    direction: "tail",
    limit: limit ?? 0,
  });
  const { totalProjected, shownProjected } = selection;
  const noun = totalProjected === 1 ? "activity" : "activities";
  const countHeader =
    limit && shownProjected < totalProjected
      ? `Showing ${shownProjected} of ${totalProjected} ${noun} (limited to ${limit})`
      : `Showing all ${totalProjected} ${noun}`;
  return {
    updateCount: timeline.length,
    content: `${countHeader}\n\n${curateAgentActivity(selection.items)}`,
  };
}

interface ForkCursorBoundary {
  timelineEpoch: string;
  cursor: { epoch: string; seq: number };
}

function findTurnStartIndex(rows: readonly TimelineProjectionEntry[], endIndex: number): number {
  for (let index = endIndex; index >= 0; index--) {
    if (rows[index].item.type === "user_message") {
      return index + 1;
    }
  }
  return 0;
}

function selectForkContextRows(input: {
  rows: readonly AgentTimelineRow[];
  cursorBoundary?: ForkCursorBoundary | null;
  boundaryMessageId?: string | null;
}): {
  precedingUserItems: AgentTimelineItem[];
  items: AgentTimelineItem[];
  boundaryCursor: { epoch: string; seq: number } | null;
  boundaryMessageId: string | null;
} {
  const projectedRows = projectTimelineRows({ rows: input.rows, mode: "projected" });
  const boundaryCursor = input.cursorBoundary?.cursor ?? null;
  const boundaryMessageId = input.boundaryMessageId?.trim() || null;
  const resolveBoundaryIndex = (): number => {
    if (boundaryCursor) {
      if (
        input.cursorBoundary &&
        input.cursorBoundary.cursor.epoch !== input.cursorBoundary.timelineEpoch
      ) {
        throw new Error("Selected timeline position is no longer available.");
      }
      const index = projectedRows.findIndex((row) => row.seqEnd === boundaryCursor.seq);
      if (index < 0) {
        throw new Error("Selected timeline position is no longer available.");
      }
      return index;
    }
    if (boundaryMessageId) {
      const index = projectedRows.findLastIndex(
        (row) => row.item.type === "assistant_message" && row.item.messageId === boundaryMessageId,
      );
      if (index < 0) {
        throw new Error("Selected assistant message is no longer available.");
      }
      return index;
    }
    return projectedRows.length - 1;
  };

  const boundaryIndex = resolveBoundaryIndex();
  if (boundaryIndex < 0) {
    return { precedingUserItems: [], items: [], boundaryCursor: null, boundaryMessageId: null };
  }
  const boundaryRow = projectedRows[boundaryIndex];
  if (boundaryCursor && boundaryMessageId) {
    const selectedMessageId =
      boundaryRow.item.type === "assistant_message" ? boundaryRow.item.messageId : undefined;
    if (selectedMessageId !== boundaryMessageId) {
      throw new Error("Selected assistant message does not match timeline position.");
    }
  }
  const boundarySeq = boundaryRow.seqEnd;
  const turnStartIndex = findTurnStartIndex(projectedRows, boundaryIndex);
  const precedingUserItems = projectedRows
    .slice(0, turnStartIndex)
    .map((entry) => entry.item)
    .filter((item) => item.type === "user_message");
  // Only tool calls and plugin cards fold later updates into an earlier row, and a fork doesn't
  // copy plugin cards. So the only row that spans the checkpoint and still reaches the fork is a
  // tool call.
  const items = projectedRows.slice(turnStartIndex, boundaryIndex + 1).flatMap((row) => {
    if (row.seqEnd <= boundarySeq) return [row.item];
    if (row.seqStart > boundarySeq || row.item.type !== "tool_call") return [];
    return [toolCallAtCheckpoint(row.item)];
  });

  return {
    precedingUserItems,
    items,
    boundaryCursor,
    boundaryMessageId,
  };
}

/**
 * A tool call that started before the checkpoint and changed after it, such as background work
 * that outlives a reply. The projection keeps only its latest payload, so the fork copies it as
 * still running.
 */
function toolCallAtCheckpoint(item: ToolCallTimelineItem): ToolCallTimelineItem {
  return { ...item, status: "running", error: null };
}

function trimContextMetadata(value: string | null | undefined, maxChars?: number): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, maxChars) : null;
}

function buildForkContextText(input: {
  body: string;
  agentId?: string | null;
  agentTitle?: string | null;
  cwd?: string | null;
  transcriptPath?: string | null;
  transcriptBoundaryMessageId?: string | null;
}): string {
  const header = ["Chat history from a previous Paseo agent."];
  const agentId = trimContextMetadata(input.agentId);
  const agentTitle = trimContextMetadata(input.agentTitle, MAX_FORK_METADATA_CHARS);
  const cwd = trimContextMetadata(input.cwd, MAX_FORK_METADATA_CHARS);
  if (agentTitle) {
    header.push(`Source agent: ${agentTitle}`);
  }
  if (agentId) {
    header.push(`Source agent id: ${agentId}`);
  }
  if (cwd) {
    header.push(`Source directory: ${cwd}`);
  }
  const sections = [header.join("\n"), input.body];
  const transcriptPath = trimContextMetadata(input.transcriptPath);
  if (transcriptPath) {
    const transcriptBoundaryMessageId = trimContextMetadata(input.transcriptBoundaryMessageId);
    sections.push(
      [
        "This summary is condensed: it drops tool inputs, tool output, reasoning, and earlier-turn assistant messages such as review findings.",
        `The source agent's full session transcript is at ${transcriptPath}.`,
        transcriptBoundaryMessageId
          ? `Read only through assistant message ID ${transcriptBoundaryMessageId}. Do not read or use transcript entries after that message.`
          : "Read only transcript content represented by the summary above. Do not read or use later content, including anything appended after this fork context was created.",
        "Read within that boundary when you need detail this summary omits.",
      ].join("\n"),
    );
  }
  return `<chat-history-summary>\n${sections.join("\n\n")}\n</chat-history-summary>`;
}

function fitForkContextEntries(entries: ActivityEntry[], budget: number): string {
  const length = entries.reduce((total, entry) => total + entry.text.length + 1, -1);
  if (length <= budget) {
    return entries.map((entry) => entry.text).join("\n");
  }

  const selected: string[] = [];
  let remaining = budget - FORK_HISTORY_OMITTED.length;
  for (let index = entries.length - 1; index >= 0; index--) {
    const text = entries[index].text;
    const size = text.length + (selected.length > 0 ? 1 : 0);
    if (size <= remaining) {
      selected.push(text);
      remaining -= size;
      continue;
    }
    if (selected.length === 0) {
      const available = remaining - FORK_MESSAGE_TRUNCATED.length;
      const head = Math.ceil(available / 2);
      const tail = available - head;
      selected.push(text.slice(0, head) + FORK_MESSAGE_TRUNCATED + text.slice(text.length - tail));
    }
    break;
  }
  return FORK_HISTORY_OMITTED + selected.toReversed().join("\n");
}

const CHAT_HISTORY_SUMMARY_BLOCK = /<chat-history-summary>[\s\S]*?<\/chat-history-summary>/g;

function stripNestedChatHistorySummaries(items: AgentTimelineItem[]): AgentTimelineItem[] {
  const result: AgentTimelineItem[] = [];
  for (const item of items) {
    if (item.type !== "user_message") {
      result.push(item);
      continue;
    }
    const stripped = item.text.replace(CHAT_HISTORY_SUMMARY_BLOCK, "").trim();
    if (stripped) {
      result.push({ ...item, text: stripped });
    }
  }
  return result;
}

export function buildAgentForkContextAttachment(input: {
  rows: readonly AgentTimelineRow[];
  cursorBoundary?: ForkCursorBoundary | null;
  boundaryMessageId?: string | null;
  agentId?: string | null;
  agentTitle?: string | null;
  cwd?: string | null;
  transcriptPath?: string | null;
}): {
  attachment: TextAgentAttachment;
  itemCount: number;
  boundaryCursor: { epoch: string; seq: number } | null;
  boundaryMessageId: string | null;
} {
  const selected = selectForkContextRows({
    rows: input.rows,
    cursorBoundary: input.cursorBoundary,
    boundaryMessageId: input.boundaryMessageId,
  });
  const userEntries = curateProjectedActivityEntries(
    stripNestedChatHistorySummaries(selected.precedingUserItems),
    {
      maxItems: 0,
      includeKinds: FORK_USER_KINDS,
    },
  );
  const turnEntries = curateProjectedActivityEntries(selected.items, {
    maxItems: 0,
    labelAssistantMessages: true,
    includeKinds: FORK_TURN_KINDS,
    includeExternalToolInput: false,
  });
  const entries = [...userEntries, ...turnEntries];
  const metadata = {
    agentId: input.agentId,
    agentTitle: input.agentTitle,
    cwd: input.cwd,
    transcriptPath: input.transcriptPath,
    transcriptBoundaryMessageId: selected.boundaryMessageId,
  };
  const budget = MAX_FORK_CONTEXT_CHARS - buildForkContextText({ body: "", ...metadata }).length;
  if (budget < FORK_HISTORY_OMITTED.length + FORK_MESSAGE_TRUNCATED.length) {
    throw new Error("Fork context metadata exceeds the character limit.");
  }
  const body =
    entries.length > 0 ? fitForkContextEntries(entries, budget) : "No chat history to display.";
  return {
    attachment: {
      type: "text",
      mimeType: "text/plain",
      contextKind: "chat_history",
      title: trimContextMetadata(input.agentTitle, MAX_FORK_METADATA_CHARS) ?? "Chat history",
      text: buildForkContextText({ body, ...metadata }),
    },
    itemCount: selected.precedingUserItems.length + selected.items.length,
    boundaryCursor: selected.boundaryCursor,
    boundaryMessageId: selected.boundaryMessageId,
  };
}
