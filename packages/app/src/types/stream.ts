import type { AgentMessage } from "@getpaseo/protocol/agent-message";
import type {
  AgentProvider,
  AgentTimelineItem,
  JsonValue,
  ToolCallDetail,
} from "@getpaseo/protocol/agent-types";
import { timelineItemIdentity } from "@getpaseo/protocol/timeline-identity";
import type { AgentAttachment, AgentStreamEventPayload } from "@getpaseo/protocol/messages";
import type { AttachmentMetadata } from "@/attachments/types";
import type { OverviewSummary } from "@/tool-calls/detail-level/overview/model";
import { extractTaskEntriesFromToolCall } from "../utils/tool-call-parsers";

/**
 * Simple hash function for deterministic ID generation
 */

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Generate a simple unique ID (timestamp + random)
 */
export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

function createTimelineId(prefix: string, text: string, timestamp: Date): string {
  return `${prefix}_${timestamp.getTime()}_${simpleHash(text)}`;
}

function createUniqueTimelineId(
  state: StreamItem[],
  prefix: string,
  text: string,
  timestamp: Date,
): string {
  const base = createTimelineId(prefix, text, timestamp);
  // We only ever append new timeline items, and we incorporate the current
  // length as a monotonic suffix, so uniqueness is guaranteed without an O(n)
  // collision scan (important for large hydration snapshots).
  const suffixSeed = state.length;
  return `${base}_${suffixSeed.toString(36)}`;
}

function createAssistantItemId(
  state: StreamItem[],
  messageId: string | undefined,
  text: string,
  timestamp: Date,
  mutable: MutableFlag,
  reservedItemIds?: ReadonlySet<string>,
): string {
  if (!messageId) {
    return createUniqueTimelineId(state, "assistant", text, timestamp);
  }

  const isOccupied = (id: string) =>
    reservedItemIds?.has(id) === true || findRowIdIndex(state, id, mutable) >= 0;
  if (!isOccupied(messageId)) {
    return messageId;
  }

  const segmentId = `${messageId}:segment:${timestamp.getTime().toString(36)}`;
  if (!isOccupied(segmentId)) {
    return segmentId;
  }

  let suffix = 1;
  while (isOccupied(`${segmentId}:${suffix.toString(36)}`)) {
    suffix += 1;
  }
  return `${segmentId}:${suffix.toString(36)}`;
}

export type StreamItem =
  | UserMessageItem
  | AssistantMessageItem
  | ThoughtItem
  | ToolCallItem
  | TodoListItem
  | NotificationItem
  | CompactionItem
  | PluginTimelineStreamItem
  | TurnSummaryItem;

export type UserMessageImageAttachment = AttachmentMetadata;

export interface UserMessageItem {
  /** Attribution added by presentation for received agent messages. */
  sender?: AgentMessage["sender"];
  kind: "user_message";
  id: string;
  clientMessageId?: string;
  messageId?: string;
  turnId?: string;
  timelineCursor?: TimelinePosition;
  text: string;
  timestamp: Date;
  images?: UserMessageImageAttachment[];
  attachments?: AgentAttachment[];
}

export interface UserMessageInput {
  id?: string;
  clientMessageId?: string;
  messageId?: string;
  turnId?: string;
  timelineCursor?: TimelinePosition;
  text: string;
  timestamp: Date;
  images?: UserMessageImageAttachment[];
  attachments?: AgentAttachment[];
}

export function createUserMessage(input: UserMessageInput): UserMessageItem {
  const id = input.id ?? input.clientMessageId ?? input.messageId;
  if (!id) {
    throw new Error("User message identity is required");
  }
  return {
    kind: "user_message",
    id,
    ...(input.clientMessageId ? { clientMessageId: input.clientMessageId } : {}),
    ...(input.messageId ? { messageId: input.messageId } : {}),
    ...(input.turnId ? { turnId: input.turnId } : {}),
    ...(input.timelineCursor ? { timelineCursor: input.timelineCursor } : {}),
    text: input.text,
    timestamp: input.timestamp,
    ...(input.images && input.images.length > 0 ? { images: input.images } : {}),
    ...(input.attachments && input.attachments.length > 0
      ? { attachments: input.attachments }
      : {}),
  };
}

export function isUnreconciledLocalUserMessage(message: UserMessageItem): boolean {
  return (
    message.clientMessageId !== undefined &&
    message.messageId === undefined &&
    message.timelineCursor === undefined
  );
}

export function appendSubmittedUserMessage(input: {
  tail: StreamItem[];
  head: StreamItem[];
  message: UserMessageItem;
}): { tail: StreamItem[]; head: StreamItem[] } {
  const clientMessageId = input.message.clientMessageId;
  if (!clientMessageId) {
    throw new Error("Submitted user message requires client identity");
  }
  const alreadyExists = [...input.tail, ...input.head].some(
    (item) => item.kind === "user_message" && item.clientMessageId === clientMessageId,
  );
  if (alreadyExists) {
    throw new Error(`Submitted user message already exists: ${clientMessageId}`);
  }
  return input.head.length > 0
    ? { tail: input.tail, head: [...input.head, input.message] }
    : { tail: [...input.tail, input.message], head: input.head };
}

export function removeSubmittedUserMessage(input: {
  tail: StreamItem[];
  head: StreamItem[];
  clientMessageId: string;
}): { tail: StreamItem[]; head: StreamItem[] } {
  const remove = (items: StreamItem[]) => {
    const next = items.filter(
      (item) =>
        item.kind !== "user_message" ||
        item.clientMessageId !== input.clientMessageId ||
        !isUnreconciledLocalUserMessage(item),
    );
    return next.length === items.length ? items : next;
  };
  return { tail: remove(input.tail), head: remove(input.head) };
}

// COMPAT(userMessageClientId): added in v0.2.0, remove after 2027-01-20 once the
// supported daemon floor emits clientMessageId on submitted user messages. Until then a
// locally submitted row (clientMessageId, no messageId) and its canonical twin from an
// old daemon (messageId, no clientMessageId) share no identifier, so canonical ingestion
// may match an explicit local candidate by the id supplied over the wire or by text.
function matchesLegacyCanonicalUserMessage(
  submitted: UserMessageItem,
  canonical: UserMessageItem,
): boolean {
  if (submitted.clientMessageId === undefined || submitted.messageId !== undefined) return false;
  if (canonical.messageId === undefined) return false;
  return canonical.messageId === submitted.clientMessageId || canonical.text === submitted.text;
}

type UserMessageMatchPolicy = "canonical-incoming" | "handoff";

function matchesUserMessage(
  existing: UserMessageItem,
  incoming: UserMessageItem,
  policy: UserMessageMatchPolicy,
): boolean {
  if (existing.clientMessageId && incoming.clientMessageId) {
    return existing.clientMessageId === incoming.clientMessageId;
  }
  if (existing.messageId && incoming.messageId) {
    return existing.messageId === incoming.messageId;
  }
  if (matchesLegacyCanonicalUserMessage(existing, incoming)) return true;
  return policy === "handoff" && matchesLegacyCanonicalUserMessage(incoming, existing);
}

export function upsertUserMessage(
  items: StreamItem[],
  incoming: UserMessageItem,
  insertAt = items.length,
): StreamItem[] {
  return produceUserMessage(items, incoming, insertAt, "existing").items;
}

type UserMessagePresentationPolicy = "existing" | "incoming";

interface UserMessageProductionResult {
  items: StreamItem[];
  index: number;
  message: UserMessageItem;
  matched: boolean;
}

function produceUserMessage(
  items: StreamItem[],
  incoming: UserMessageItem,
  insertAt: number | null,
  presentationPolicy: UserMessagePresentationPolicy,
  matchPolicy: UserMessageMatchPolicy = "canonical-incoming",
  mutable: MutableFlag = false,
): UserMessageProductionResult {
  const index = findUserMessageMatchIndex(items, incoming, matchPolicy, mutable);
  if (index < 0) {
    if (insertAt === null) {
      return { items, index: -1, message: incoming, matched: false };
    }
    return {
      items: [...items.slice(0, insertAt), incoming, ...items.slice(insertAt)],
      index: insertAt,
      message: incoming,
      matched: false,
    };
  }

  const existing = items[index];
  if (!existing || existing.kind !== "user_message") {
    throw new Error("User message upsert matched a non-user row");
  }
  const presentation = presentationPolicy === "incoming" ? incoming : existing;
  const merged = createUserMessage({
    ...presentation,
    clientMessageId: incoming.clientMessageId ?? existing.clientMessageId,
    messageId: incoming.messageId ?? existing.messageId,
    timelineCursor: incoming.timelineCursor ?? existing.timelineCursor,
  });
  if (
    existing.id === merged.id &&
    existing.clientMessageId === merged.clientMessageId &&
    existing.messageId === merged.messageId &&
    existing.timelineCursor === merged.timelineCursor &&
    existing.text === merged.text &&
    existing.timestamp === merged.timestamp &&
    existing.images === merged.images &&
    existing.attachments === merged.attachments
  ) {
    return { items, index, message: existing, matched: true };
  }
  return {
    items: replaceAtMaybe(items, index, merged, mutable),
    index,
    message: merged,
    matched: true,
  };
}

export interface UserMessageStreamUpsertInput {
  tail: StreamItem[];
  head: StreamItem[];
  message: UserMessageItem;
  insert: "tail" | "head" | "prepend-tail" | "none";
  presentation: UserMessagePresentationPolicy;
  matchPolicy?: UserMessageMatchPolicy;
}

export interface UserMessageStreamUpsertResult extends ApplyStreamEventResult {
  location: {
    lane: "tail" | "head";
    index: number;
    message: UserMessageItem;
    matched: boolean;
  } | null;
}

export function upsertUserMessageAcrossStream(
  input: UserMessageStreamUpsertInput,
): UserMessageStreamUpsertResult {
  const tailResult = produceUserMessage(
    input.tail,
    input.message,
    null,
    input.presentation,
    input.matchPolicy,
  );
  if (tailResult.matched) {
    return {
      tail: tailResult.items,
      head: input.head,
      changedTail: tailResult.items !== input.tail,
      changedHead: false,
      location: {
        lane: "tail",
        index: tailResult.index,
        message: tailResult.message,
        matched: true,
      },
    };
  }
  const headResult = produceUserMessage(
    input.head,
    input.message,
    null,
    input.presentation,
    input.matchPolicy,
  );
  if (headResult.matched) {
    return {
      tail: input.tail,
      head: headResult.items,
      changedTail: false,
      changedHead: headResult.items !== input.head,
      location: {
        lane: "head",
        index: headResult.index,
        message: headResult.message,
        matched: true,
      },
    };
  }
  if (input.insert === "none") {
    return {
      tail: input.tail,
      head: input.head,
      changedTail: false,
      changedHead: false,
      location: null,
    };
  }
  if (input.insert === "head") {
    const inserted = produceUserMessage(
      input.head,
      input.message,
      input.head.length,
      input.presentation,
      input.matchPolicy,
    );
    return {
      tail: input.tail,
      head: inserted.items,
      changedTail: false,
      changedHead: true,
      location: {
        lane: "head",
        index: inserted.index,
        message: inserted.message,
        matched: false,
      },
    };
  }
  const inserted = produceUserMessage(
    input.tail,
    input.message,
    input.insert === "prepend-tail" ? 0 : input.tail.length,
    input.presentation,
    input.matchPolicy,
  );
  return {
    tail: inserted.items,
    head: input.head,
    changedTail: true,
    changedHead: false,
    location: {
      lane: "tail",
      index: inserted.index,
      message: inserted.message,
      matched: false,
    },
  };
}

function placeCanonicalUserMessageAtTail(
  tail: StreamItem[],
  message: UserMessageItem,
  insertWhenUnmatched: boolean,
): Pick<UserMessageProductionResult, "items" | "message" | "matched"> {
  const produced = produceUserMessage(tail, message, null, "existing");
  if (!produced.matched && !insertWhenUnmatched) {
    return produced;
  }
  const preceding = produced.matched
    ? [...produced.items.slice(0, produced.index), ...produced.items.slice(produced.index + 1)]
    : produced.items;
  return {
    items: [...preceding, produced.message],
    message: produced.message,
    matched: produced.matched,
  };
}

export interface CanonicalStreamReplacementInput {
  canonical: StreamItem[];
  previousTail: StreamItem[];
  previousHead: StreamItem[];
  sendingClientMessageIds: readonly string[];
  preserveContinuity: boolean;
  canonicalCoverage: { epoch: string; endSeq: number | null };
}

export interface CanonicalStreamReplacementResult {
  tail: StreamItem[];
  head: StreamItem[];
  acknowledgedClientMessageIds: string[];
}

function isAfterCanonicalCoverage(
  position: TimelinePosition,
  coverage: CanonicalStreamReplacementInput["canonicalCoverage"],
): boolean {
  return (
    position.epoch === coverage.epoch &&
    (coverage.endSeq === null || position.seq > coverage.endSeq)
  );
}

function removeUserMessageAt(items: UserMessageItem[], index: number): UserMessageItem[] {
  return [...items.slice(0, index), ...items.slice(index + 1)];
}

function mergeRetainedLifecycleItem(tail: StreamItem[], retained: StreamItem): StreamItem[] | null {
  if (retained.kind === "plugin") {
    return replaceTimelineIdentityItem(tail, retained);
  }
  if (!retained.timelineCursor) {
    return null;
  }
  if (isAgentToolCallItem(retained)) {
    const identity = agentToolCallIdentity({
      callId: retained.payload.data.callId,
      turnId: retained.turnId,
    });
    const tailIndex = findExistingTimelineIdentityIndex(tail, identity);
    const existing = tail[tailIndex];
    if (tailIndex < 0 || !existing || !isAgentToolCallItem(existing)) {
      return null;
    }
    const next = [...tail];
    next[tailIndex] = mergeAgentToolCallItem(
      existing,
      retained.payload.data,
      retained.timestamp,
      retained.timelineCursor,
    );
    return next;
  }
  if (retained.kind === "todo_list") {
    const tailIndex = tail.length - 1;
    const existing = tail[tailIndex];
    if (!existing || existing.kind !== "todo_list" || existing.provider !== retained.provider) {
      return null;
    }
    const next = [...tail];
    next[tailIndex] = {
      ...existing,
      timelineCursor: retained.timelineCursor,
      timestamp: retained.timestamp,
      items: retained.items,
    };
    return next;
  }
  if (retained.kind === "compaction" && retained.status === "completed") {
    const tailIndex = tail.findIndex(
      (item) => item.kind === "compaction" && item.status === "loading",
    );
    const existing = tail[tailIndex];
    if (tailIndex < 0 || !existing || existing.kind !== "compaction") {
      return null;
    }
    const next = [...tail];
    next[tailIndex] = {
      ...existing,
      timelineCursor: retained.timelineCursor,
      status: "completed",
      trigger: retained.trigger ?? existing.trigger,
      preTokens: retained.preTokens ?? existing.preTokens,
    };
    return next;
  }
  return null;
}

function replaceTimelineIdentityItem(
  items: StreamItem[],
  retained: PluginTimelineStreamItem,
): StreamItem[] | null {
  const identity = streamTimelineItemIdentity(retained);
  if (identity === null) return null;
  const index = findExistingTimelineIdentityIndex(items, identity);
  const existing = items[index];
  if (index < 0 || !existing || existing.kind !== "plugin") return null;
  const next = [...items];
  next[index] = retained;
  return next;
}

function reconcileReplacementHeadAgainstTail(
  tail: StreamItem[],
  retainedHead: StreamItem[],
): { tail: StreamItem[]; head: StreamItem[] } {
  let reconciledTail = tail;
  const reconciledHeadIndexes = new Set<number>();
  for (const [headIndex, item] of retainedHead.entries()) {
    const nextTail = mergeRetainedLifecycleItem(reconciledTail, item);
    if (!nextTail) {
      continue;
    }
    reconciledTail = nextTail;
    reconciledHeadIndexes.add(headIndex);
  }

  const tailIds = new Set(reconciledTail.map((item) => item.id));
  return {
    tail: reconciledTail,
    head: retainedHead.filter(
      (item, index) =>
        !reconciledHeadIndexes.has(index) &&
        (item.kind === "assistant_message" || !tailIds.has(item.id)),
    ),
  };
}

function preserveReplacementHead(
  tail: StreamItem[],
  currentHead: StreamItem[],
  preserveContinuity: boolean,
  sendingClientMessageIds: ReadonlySet<string>,
  canonicalCoverage: CanonicalStreamReplacementInput["canonicalCoverage"],
): CanonicalStreamReplacementResult {
  const canonicalTailAssistant = tail.at(-1);
  const retainedHead = preserveContinuity
    ? currentHead.filter(
        (item) =>
          !item.timelineCursor ||
          isAfterCanonicalCoverage(item.timelineCursor, canonicalCoverage) ||
          (item.kind === "assistant_message" &&
            canonicalTailAssistant?.kind === "assistant_message" &&
            item.text.startsWith(canonicalTailAssistant.text)),
      )
    : currentHead.filter(
        (item) =>
          item.kind === "user_message" &&
          item.clientMessageId !== undefined &&
          sendingClientMessageIds.has(item.clientMessageId),
      );
  const { tail: reconciledTail, head: unreconciledHead } = reconcileReplacementHeadAgainstTail(
    tail,
    retainedHead,
  );
  const liveAssistantIndex = unreconciledHead[0]?.kind === "assistant_message" ? 0 : -1;
  if (liveAssistantIndex < 0) {
    return { tail: reconciledTail, head: unreconciledHead, acknowledgedClientMessageIds: [] };
  }

  const liveAssistant = unreconciledHead[liveAssistantIndex];
  const tailAssistant = reconciledTail.at(-1);
  if (
    liveAssistant.kind !== "assistant_message" ||
    !tailAssistant ||
    tailAssistant.kind !== "assistant_message"
  ) {
    return { tail: reconciledTail, head: unreconciledHead, acknowledgedClientMessageIds: [] };
  }

  const hasNewerCursor =
    liveAssistant.timelineCursor !== undefined &&
    tailAssistant.timelineCursor !== undefined &&
    liveAssistant.timelineCursor.epoch === tailAssistant.timelineCursor.epoch &&
    liveAssistant.timelineCursor.seq > tailAssistant.timelineCursor.seq;
  const hasMatchingProviderMessageId =
    liveAssistant.messageId !== undefined && liveAssistant.messageId === tailAssistant.messageId;
  const hasIdlessTextContinuation =
    liveAssistant.messageId === undefined &&
    tailAssistant.messageId === undefined &&
    liveAssistant.text.startsWith(tailAssistant.text);
  const isNewerContinuation =
    hasNewerCursor && (hasMatchingProviderMessageId || hasIdlessTextContinuation);
  if (isNewerContinuation) {
    const text = liveAssistant.text.startsWith(tailAssistant.text)
      ? liveAssistant.text
      : `${tailAssistant.text}${liveAssistant.text}`;
    const head = [
      ...unreconciledHead.slice(0, liveAssistantIndex),
      { ...liveAssistant, text },
      ...unreconciledHead.slice(liveAssistantIndex + 1),
    ];
    return {
      tail: reconciledTail.slice(0, -1),
      head,
      acknowledgedClientMessageIds: [],
    };
  }
  if (!liveAssistant.text.startsWith(tailAssistant.text)) {
    return { tail: reconciledTail, head: unreconciledHead, acknowledgedClientMessageIds: [] };
  }

  const head = [
    ...unreconciledHead.slice(0, liveAssistantIndex),
    { ...liveAssistant, text: tailAssistant.text },
    ...unreconciledHead.slice(liveAssistantIndex + 1),
  ];
  return {
    tail: reconciledTail.slice(0, -1),
    head,
    acknowledgedClientMessageIds: [],
  };
}

export function replaceWithCanonicalStream(
  input: CanonicalStreamReplacementInput,
): CanonicalStreamReplacementResult {
  const sendingClientMessageIds = new Set(input.sendingClientMessageIds);
  let unmatchedTailMessages = input.previousTail.filter(
    (item): item is UserMessageItem =>
      item.kind === "user_message" && item.clientMessageId !== undefined,
  );
  let nextHead = input.previousHead;
  const nextTail: StreamItem[] = [];
  const acknowledgedClientMessageIds = new Set<string>();

  for (const item of input.canonical) {
    if (item.kind !== "user_message") {
      nextTail.push(item);
      continue;
    }

    const tailResult = produceUserMessage(unmatchedTailMessages, item, null, "existing");
    if (tailResult.matched) {
      unmatchedTailMessages = removeUserMessageAt(unmatchedTailMessages, tailResult.index);
      nextTail.push(tailResult.message);
      if (tailResult.message.clientMessageId) {
        acknowledgedClientMessageIds.add(tailResult.message.clientMessageId);
      }
      continue;
    }

    const headResult = produceUserMessage(nextHead, item, null, "existing");
    if (headResult.matched) {
      nextHead = [
        ...headResult.items.slice(0, headResult.index),
        ...headResult.items.slice(headResult.index + 1),
      ];
      nextTail.push(headResult.message);
      if (headResult.message.clientMessageId) {
        acknowledgedClientMessageIds.add(headResult.message.clientMessageId);
      }
      continue;
    }

    nextTail.push(item);
  }

  const retainedTailMessages: UserMessageItem[] = [];
  for (const local of unmatchedTailMessages) {
    const preserveLocal = input.preserveContinuity
      ? isUnreconciledLocalUserMessage(local)
      : local.clientMessageId !== undefined && sendingClientMessageIds.has(local.clientMessageId);
    if (preserveLocal) {
      nextTail.push(local);
    } else if (
      input.preserveContinuity &&
      local.timelineCursor &&
      isAfterCanonicalCoverage(local.timelineCursor, input.canonicalCoverage)
    ) {
      retainedTailMessages.push(local);
    }
  }
  nextHead = [...retainedTailMessages, ...nextHead];

  const replacement = preserveReplacementHead(
    nextTail,
    nextHead,
    input.preserveContinuity,
    sendingClientMessageIds,
    input.canonicalCoverage,
  );
  return {
    ...replacement,
    acknowledgedClientMessageIds: [...acknowledgedClientMessageIds],
  };
}

export interface AssistantMessageItem {
  kind: "assistant_message";
  id: string;
  messageId?: string;
  turnId?: string;
  timelineCursor?: TimelinePosition;
  text: string;
  timestamp: Date;
  /** Display-only fields, assigned after source-item plugin transforms. */
}

export interface TimelinePosition {
  epoch: string;
  seq: number;
}

export type ThoughtStatus = "loading" | "ready";

export interface ThoughtItem {
  kind: "thought";
  id: string;
  timelineCursor?: TimelinePosition;
  turnId?: string;
  text: string;
  timestamp: Date;
  status: ThoughtStatus;
}

export type OrchestratorToolCallStatus = "executing" | "completed" | "failed";
export type AgentToolCallStatus = "running" | "completed" | "failed" | "canceled";

interface OrchestratorToolCallData {
  toolCallId: string;
  toolName: string;
  arguments: unknown;
  result?: unknown;
  error?: unknown;
  status: OrchestratorToolCallStatus;
}

export interface AgentToolCallData {
  agentMessage?: AgentMessage;
  provider: AgentProvider;
  callId: string;
  name: string;
  status: AgentToolCallStatus;
  error: unknown;
  detail: ToolCallDetail;
  metadata?: Record<string, unknown>;
}

export type ToolCallPayload =
  | { source: "agent"; data: AgentToolCallData }
  | { source: "orchestrator"; data: OrchestratorToolCallData };

export interface ToolCallItem {
  kind: "tool_call";
  id: string;
  timelineCursor?: TimelinePosition;
  turnId?: string;
  timestamp: Date;
  payload: ToolCallPayload;
}

export type AgentToolCallItem = ToolCallItem & {
  payload: { source: "agent"; data: AgentToolCallData };
};

/** Find and scrolling address a plugin row by the source it replaces. */
export function getStreamItemMessageId(item: StreamItem): string {
  if (item.kind === "plugin") return item.sourceId ?? item.id;
  return item.id;
}

export function isAgentToolCallItem(item: StreamItem): item is AgentToolCallItem {
  return item.kind === "tool_call" && item.payload.source === "agent";
}

type NotificationLevel = "info" | "warning" | "error";

export interface NotificationItem {
  kind: "notification";
  sourceType: "error" | "notification";
  id: string;
  timelineCursor?: TimelinePosition;
  turnId?: string;
  timestamp: Date;
  level: NotificationLevel;
  message: string;
}

export interface CompactionItem {
  kind: "compaction";
  id: string;
  timelineCursor?: TimelinePosition;
  turnId?: string;
  timestamp: Date;
  status: "loading" | "completed";
  trigger?: "auto" | "manual";
  preTokens?: number;
}

export interface PluginTimelineStreamItem {
  kind: "plugin";
  id: string;
  /** The id of the stream item a timeline transformer replaced; set only by projection. */
  sourceId?: string;
  /** The original row kind, retained by projection for turn folding. */
  sourceKind?: StreamItem["kind"];
  timelineCursor?: TimelinePosition;
  turnId?: string;
  timestamp: Date;
  pluginId: string;
  pluginItemId: string;
  itemKind: string;
  version: number;
  data: JsonValue;
}

/**
 * The row a folded turn leaves between its host and its reply, standing in for the work it
 * hides. Turn collapse produces it from the loaded rows; it is never stored.
 */
export interface TurnSummaryItem {
  kind: "turn_summary";
  id: string;
  timelineCursor?: TimelinePosition;
  turnId?: string;
  timestamp: Date;
  /**
   * The prompt the turn folds under, or its first loaded tool call when the prompt is above the
   * loaded history. Keys the reader's expanded turns.
   */
  hostId: string;
  expanded: boolean;
  tools: OverviewSummary;
}

export interface TodoEntry {
  text: string;
  completed: boolean;
  id?: string;
  status?: "pending" | "in_progress" | "completed";
  activeForm?: string;
}

export type TaskActivity =
  | { type: "created"; count: number }
  | { type: "added" | "started" | "completed"; task: string };

export interface TodoListItem {
  kind: "todo_list";
  id: string;
  timelineCursor?: TimelinePosition;
  turnId?: string;
  timestamp: Date;
  provider: AgentProvider;
  items: TodoEntry[];
  activity: TaskActivity;
}

export type StreamUpdateSource = "live" | "canonical";

interface StreamUpdateOptions {
  source?: StreamUpdateSource;
  reservedItemIds?: ReadonlySet<string>;
  timelineCursor?: TimelinePosition;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeChunk(text: string): { chunk: string; hasContent: boolean } {
  if (!text) {
    return { chunk: "", hasContent: false };
  }
  const chunk = text.replace(/\r/g, "");
  if (!chunk) {
    return { chunk: "", hasContent: false };
  }
  return { chunk, hasContent: /\S/.test(chunk) };
}

function markThoughtReady(item: ThoughtItem): ThoughtItem {
  if (item.status === "ready") {
    return item;
  }
  return {
    ...item,
    status: "ready",
  };
}

export function handoffCreatedAgentUserMessageToStream(params: {
  tail: StreamItem[];
  head: StreamItem[];
  message: UserMessageItem;
}): ApplyStreamEventResult {
  return upsertUserMessageAcrossStream({
    ...params,
    insert: "tail",
    presentation: "incoming",
    matchPolicy: "handoff",
  });
}

function appendUserMessage(
  state: StreamItem[],
  text: string,
  timestamp: Date,
  _source: StreamUpdateSource,
  mutable: MutableFlag,
  messageId?: string,
  clientMessageId?: string,
  timelineCursor?: TimelinePosition,
  turnId?: string,
): StreamItem[] {
  const { chunk, hasContent } = normalizeChunk(text);
  if (!hasContent) {
    return state;
  }

  const chunkSeed = chunk.trim() || chunk;
  const nextItem = createUserMessage({
    id: messageId ?? createUniqueTimelineId(state, "user", chunkSeed, timestamp),
    clientMessageId,
    messageId,
    timelineCursor,
    turnId,
    text: chunk,
    timestamp,
  });

  if (!mutable) {
    return upsertUserMessage(state, nextItem);
  }
  // An unchanged canonical row returns the accumulator untouched, so the event
  // does not own that row and must not claim turn membership for it.
  const upserted = produceUserMessage(
    state,
    nextItem,
    null,
    "existing",
    "canonical-incoming",
    mutable,
  );
  return upserted.matched ? upserted.items : pushMaybe(state, nextItem, mutable);
}

/**
 * Row positions by lookup key for the hydration accumulator. A row is registered
 * under its current keys on every write. Legacy text membership is removed when
 * reconciliation makes it ineligible. Other keys may retain stale positions, so
 * lookups verify each candidate against the current row.
 */
type RowIndex = Map<string, Set<number>>;

/**
 * In-place accumulator used by hydrateStreamState. `written` holds the row indices
 * each event created or replaced, so turn membership can be assigned without copying
 * the whole array per event. `index` is built on the first indexed lookup and updated
 * by every later write.
 */
interface MutableTimeline {
  written: number[];
  index: RowIndex | null;
}

/** False keeps the immutable, copy-on-write path used by live updates. */
type MutableFlag = MutableTimeline | false;

function legacyUserMessageTextKey(row: StreamItem): string | null {
  if (
    row.kind !== "user_message" ||
    row.clientMessageId === undefined ||
    row.messageId !== undefined
  ) {
    return null;
  }
  return `text:${row.text}`;
}

function rowLookupKeys(row: StreamItem): string[] {
  const keys = [`id:${row.id}`];
  if (row.kind === "user_message") {
    if (row.clientMessageId) keys.push(`client:${row.clientMessageId}`);
    if (row.messageId) keys.push(`message:${row.messageId}`);
    // Only unreconciled submitted rows can match canonical ingestion by text.
    const textKey = legacyUserMessageTextKey(row);
    if (textKey !== null) keys.push(textKey);
  } else if (row.kind === "todo_list") {
    keys.push(`todo:${row.provider}`);
  } else if (row.kind === "compaction" && row.status === "loading") {
    keys.push("compaction:loading");
  }
  const identity = streamTimelineItemIdentity(row);
  if (identity !== null) keys.push(`identity:${identity}`);
  return keys;
}

/** Registers row `at` under its current keys, once the index exists. */
function indexRow(
  state: StreamItem[],
  mutable: MutableTimeline,
  at: number,
  previous?: StreamItem,
): void {
  const index = mutable.index;
  const row = state[at];
  if (!index || !row) return;
  const previousTextKey = previous ? legacyUserMessageTextKey(previous) : null;
  if (previousTextKey !== null && previousTextKey !== legacyUserMessageTextKey(row)) {
    const entry = index.get(previousTextKey);
    entry?.delete(at);
    if (entry?.size === 0) index.delete(previousTextKey);
  }
  for (const key of rowLookupKeys(row)) {
    const entry = index.get(key);
    if (entry) {
      entry.add(at);
    } else {
      index.set(key, new Set([at]));
    }
  }
}

function ensureRowIndex(state: StreamItem[], mutable: MutableTimeline): RowIndex {
  if (!mutable.index) {
    mutable.index = new Map();
    for (let at = 0; at < state.length; at += 1) indexRow(state, mutable, at);
  }
  return mutable.index;
}

/**
 * Finds the row a scan over the accumulated rows would return: the first, or the
 * last with `fromEnd`, row registered under one of `keys` that `matches` accepts.
 * Live updates have no index and fall back to the scan itself.
 */
function findRow(
  state: StreamItem[],
  mutable: MutableFlag,
  keys: readonly string[],
  matches: (row: StreamItem) => boolean,
  fromEnd = false,
): number {
  if (!mutable) {
    return fromEnd ? state.findLastIndex(matches) : state.findIndex(matches);
  }
  const index = ensureRowIndex(state, mutable);
  let selected = -1;
  for (const key of keys) {
    const positions = index.get(key);
    if (!positions) continue;
    for (const at of positions) {
      // Writes can register an earlier row after a later one under the same key.
      if (selected >= 0 && (fromEnd ? at <= selected : at >= selected)) continue;
      const row = state[at];
      if (row && matches(row)) selected = at;
    }
  }
  return selected;
}

function findUserMessageMatchIndex(
  items: StreamItem[],
  incoming: UserMessageItem,
  matchPolicy: UserMessageMatchPolicy,
  mutable: MutableFlag,
): number {
  const keys = [`text:${incoming.text}`];
  if (incoming.clientMessageId) {
    keys.push(`client:${incoming.clientMessageId}`, `message:${incoming.clientMessageId}`);
  }
  if (incoming.messageId) {
    keys.push(`message:${incoming.messageId}`, `client:${incoming.messageId}`);
  }
  return findRow(
    items,
    mutable,
    keys,
    (row) => row.kind === "user_message" && matchesUserMessage(row, incoming, matchPolicy),
  );
}

function findRowIdIndex(state: StreamItem[], id: string, mutable: MutableFlag = false): number {
  return findRow(state, mutable, [`id:${id}`], (row) => row.id === id);
}

function pushMaybe(state: StreamItem[], item: StreamItem, mutable: MutableFlag): StreamItem[] {
  if (!mutable) {
    return [...state, item];
  }
  state.push(item);
  mutable.written.push(state.length - 1);
  indexRow(state, mutable, state.length - 1);
  return state;
}

function replaceAtMaybe(
  state: StreamItem[],
  index: number,
  item: StreamItem,
  mutable: MutableFlag,
): StreamItem[] {
  if (!mutable) {
    const next = [...state];
    next[index] = item;
    return next;
  }
  const previous = state[index];
  state[index] = item;
  mutable.written.push(index);
  indexRow(state, mutable, index, previous);
  return state;
}

function spliceReplaceMaybe(
  state: StreamItem[],
  startIndex: number,
  deleteCount: number,
  insertItems: StreamItem[],
  mutable: MutableFlag,
): StreamItem[] {
  if (!mutable) {
    return [
      ...state.slice(0, startIndex),
      ...insertItems,
      ...state.slice(startIndex + deleteCount),
    ];
  }
  state.splice(startIndex, deleteCount, ...insertItems);
  // A splice can move every following row, so the next lookup rebuilds the index.
  mutable.index = null;
  for (let at = startIndex; at < startIndex + insertItems.length; at += 1) {
    mutable.written.push(at);
  }
  return state;
}

function appendAssistantMessage(
  state: StreamItem[],
  text: string,
  timestamp: Date,
  source: StreamUpdateSource,
  mutable: MutableFlag,
  messageId?: string,
  reservedItemIds?: ReadonlySet<string>,
  timelineCursor?: TimelinePosition,
): StreamItem[] {
  const { chunk, hasContent } = normalizeChunk(text);
  if (!chunk) {
    return state;
  }

  const last = state[state.length - 1];
  const shouldAppendToLast =
    last &&
    last.kind === "assistant_message" &&
    (messageId === undefined || last.messageId === messageId);
  if (shouldAppendToLast) {
    const updated: AssistantMessageItem = {
      ...last,
      text: `${last.text}${chunk}`,
      timestamp,
      ...(timelineCursor ? { timelineCursor } : {}),
    };
    return replaceAtMaybe(state, state.length - 1, updated, mutable);
  }

  // A submitted user row can follow the streaming assistant during interrupt.
  // In that case, look one row further back for the assistant to extend.
  const secondLast = state[state.length - 2];
  if (
    source === "live" &&
    last?.kind === "user_message" &&
    secondLast?.kind === "assistant_message" &&
    (messageId === undefined || secondLast.messageId === messageId)
  ) {
    const updated: AssistantMessageItem = {
      ...secondLast,
      text: `${secondLast.text}${chunk}`,
      timestamp,
      ...(timelineCursor ? { timelineCursor } : {}),
    };
    return replaceAtMaybe(state, state.length - 2, updated, mutable);
  }

  if (!hasContent) {
    return state;
  }

  const idSeed = chunk.trim() || chunk;
  const entryId = createAssistantItemId(
    state,
    messageId,
    idSeed,
    timestamp,
    mutable,
    reservedItemIds,
  );
  const item: AssistantMessageItem = {
    kind: "assistant_message",
    id: entryId,
    ...(messageId ? { messageId } : {}),
    ...(timelineCursor ? { timelineCursor } : {}),
    text: chunk,
    timestamp,
  };
  return pushMaybe(state, item, mutable);
}

function appendThought(
  state: StreamItem[],
  text: string,
  timestamp: Date,
  mutable: MutableFlag,
  timelineCursor?: TimelinePosition,
  turnId?: string,
): StreamItem[] {
  const { chunk, hasContent } = normalizeChunk(text);
  if (!chunk) {
    return state;
  }

  const last = state[state.length - 1];
  if (last && last.kind === "thought" && last.turnId === turnId) {
    const updated: ThoughtItem = {
      ...last,
      ...(timelineCursor ? { timelineCursor } : {}),
      text: `${last.text}${chunk}`,
      timestamp,
      status: "loading",
    };
    return replaceAtMaybe(state, state.length - 1, updated, mutable);
  }

  if (!hasContent) {
    return state;
  }

  const idSeed = chunk.trim() || chunk;
  const item: ThoughtItem = {
    kind: "thought",
    id: createUniqueTimelineId(state, "thought", idSeed, timestamp),
    ...(timelineCursor ? { timelineCursor } : {}),
    text: chunk,
    timestamp,
    status: "loading",
  };
  return pushMaybe(state, item, mutable);
}

function finalizeActiveThoughts(state: StreamItem[], mutable: MutableFlag): StreamItem[] {
  if (mutable) {
    for (let i = 0; i < state.length; i += 1) {
      const entry = state[i];
      if (entry.kind === "thought" && entry.status !== "ready") {
        state[i] = markThoughtReady(entry);
      }
    }
    return state;
  }

  let mutated = false;
  const nextState = state.map((entry) => {
    if (entry.kind === "thought" && entry.status !== "ready") {
      mutated = true;
      return markThoughtReady(entry);
    }
    return entry;
  });

  return mutated ? nextState : state;
}

export function streamTimelineItemIdentity(item: StreamItem): string | null {
  if (isAgentToolCallItem(item)) {
    return agentToolCallIdentity({
      callId: item.payload.data.callId,
      turnId: item.turnId,
    });
  }
  if (item.kind === "plugin") return `${item.pluginId}/${item.pluginItemId}`;
  return null;
}

interface AgentToolCallIdentityInput {
  callId: string;
  turnId?: string;
}

function agentToolCallIdentity(input: AgentToolCallIdentityInput): string {
  if (!input.turnId) return input.callId;
  return `turn:${encodeURIComponent(input.turnId)}/${encodeURIComponent(input.callId)}`;
}

function findExistingTimelineIdentityIndex(
  state: StreamItem[],
  identity: string,
  mutable: MutableFlag = false,
): number {
  return findRow(
    state,
    mutable,
    [`identity:${identity}`],
    (row) => streamTimelineItemIdentity(row) === identity,
  );
}

function hasNonEmptyObject(value: unknown): boolean {
  return isRecord(value) && Object.keys(value).length > 0;
}

function mergeUnknownValue(existing: unknown, incoming: unknown): unknown {
  if (incoming === null) {
    return existing;
  }

  if (!hasNonEmptyObject(incoming) && hasNonEmptyObject(existing)) {
    return existing;
  }

  return incoming;
}

function hasSameIncomingFields<T extends Record<string, unknown>>(
  existing: T,
  incoming: T,
): boolean {
  return Object.entries(incoming).every(([key, value]) => existing[key] === value);
}

function mergeToolCallMetadata(
  existing: Record<string, unknown> | undefined,
  incoming: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!incoming) {
    return existing;
  }

  if (!existing) {
    return incoming;
  }

  if (hasSameIncomingFields(existing, incoming)) {
    return existing;
  }

  return { ...existing, ...incoming };
}

export function mergeToolCallDetail(
  existing: ToolCallDetail,
  incoming: ToolCallDetail,
): ToolCallDetail {
  if (existing.type === "unknown" && incoming.type !== "unknown") {
    return incoming;
  }

  if (incoming.type === "unknown" && existing.type !== "unknown") {
    return existing;
  }

  if (existing.type === "unknown" && incoming.type === "unknown") {
    const input = mergeUnknownValue(existing.input, incoming.input);
    const output = mergeUnknownValue(existing.output, incoming.output);
    if (input === existing.input && output === existing.output) {
      return existing;
    }

    return {
      type: "unknown",
      input,
      output,
    };
  }

  if (existing.type === incoming.type) {
    if (hasSameIncomingFields(existing, incoming)) {
      return existing;
    }

    return { ...existing, ...incoming } as ToolCallDetail;
  }

  return incoming;
}

function inputFromUnknownDetail(detail: ToolCallDetail): unknown {
  return detail.type === "unknown" ? detail.input : null;
}

function mergeAgentToolCallStatus(
  existing: AgentToolCallStatus,
  incoming: AgentToolCallStatus,
): AgentToolCallStatus {
  if (existing === "failed" || incoming === "failed") {
    return "failed";
  }
  if (existing === "canceled") {
    return "canceled";
  }
  if (incoming === "canceled") {
    return existing === "completed" ? "completed" : "canceled";
  }
  if (existing === "completed" || incoming === "completed") {
    return "completed";
  }
  return "running";
}

export function mergeAgentToolCallItem(
  existing: AgentToolCallItem,
  data: AgentToolCallData,
  timestamp: Date,
  timelineCursor?: TimelinePosition,
): AgentToolCallItem {
  const mergedStatus = mergeAgentToolCallStatus(existing.payload.data.status, data.status);
  const mergedError =
    mergedStatus === "failed"
      ? (data.error ?? existing.payload.data.error ?? { message: "Tool call failed" })
      : null;
  const mergedMetadata = mergeToolCallMetadata(existing.payload.data.metadata, data.metadata);
  const mergedDetail = mergeToolCallDetail(existing.payload.data.detail, data.detail);

  return {
    ...existing,
    ...(timelineCursor ? { timelineCursor } : {}),
    timestamp,
    payload: {
      source: "agent",
      data: {
        ...existing.payload.data,
        ...data,
        status: mergedStatus,
        error: mergedError,
        detail: mergedDetail,
        metadata: mergedMetadata,
      },
    },
  };
}

interface AppendAgentToolCallInput {
  state: StreamItem[];
  data: AgentToolCallData;
  timestamp: Date;
  mutable: MutableFlag;
  turnId?: string;
  timelineCursor?: TimelinePosition;
}

function appendAgentToolCall(input: AppendAgentToolCallInput): StreamItem[] {
  const { state, data, timestamp, mutable, turnId, timelineCursor } = input;
  const identity = agentToolCallIdentity({ callId: data.callId, turnId });
  const existingIndex = findExistingTimelineIdentityIndex(state, identity, mutable);

  if (existingIndex >= 0) {
    const existing = state[existingIndex];
    if (!existing || !isAgentToolCallItem(existing)) {
      return state;
    }
    const merged = mergeAgentToolCallItem(existing, data, timestamp, timelineCursor);

    if (
      merged.payload.data.provider === existing.payload.data.provider &&
      merged.payload.data.callId === existing.payload.data.callId &&
      merged.payload.data.name === existing.payload.data.name &&
      merged.payload.data.status === existing.payload.data.status &&
      merged.payload.data.error === existing.payload.data.error &&
      merged.payload.data.detail === existing.payload.data.detail &&
      merged.payload.data.metadata === existing.payload.data.metadata &&
      merged.timelineCursor === existing.timelineCursor
    ) {
      return state;
    }

    return replaceAtMaybe(state, existingIndex, merged, mutable);
  }

  const item: ToolCallItem = {
    kind: "tool_call",
    id: `agent_tool_${identity}`,
    ...(timelineCursor ? { timelineCursor } : {}),
    ...(turnId ? { turnId } : {}),
    timestamp,
    payload: {
      source: "agent",
      data: {
        ...data,
        error: data.status === "failed" ? data.error : null,
      },
    },
  };

  return pushMaybe(state, item, mutable);
}

function appendNotification(
  state: StreamItem[],
  entry: NotificationItem,
  mutable: MutableFlag,
): StreamItem[] {
  const index = findRowIdIndex(state, entry.id, mutable);
  if (index >= 0) {
    return replaceAtMaybe(state, index, entry, mutable);
  }
  return pushMaybe(state, entry, mutable);
}

function appendPluginTimelineItem(
  state: StreamItem[],
  item: Extract<AgentTimelineItem, { type: "plugin" }>,
  timestamp: Date,
  mutable: MutableFlag,
  timelineCursor?: TimelinePosition,
): StreamItem[] {
  const identity = timelineItemIdentity(item);
  if (identity === null) return state;
  const nextItem: PluginTimelineStreamItem = {
    kind: "plugin",
    id: identity,
    pluginId: item.pluginId,
    pluginItemId: item.id,
    itemKind: item.kind,
    version: item.version,
    data: item.data,
    timestamp,
    ...(timelineCursor ? { timelineCursor } : {}),
  };
  const existingIndex = findExistingTimelineIdentityIndex(state, identity, mutable);
  if (existingIndex < 0) return pushMaybe(state, nextItem, mutable);
  const existing = state[existingIndex];
  if (!existing || existing.kind !== "plugin") return state;
  return replaceAtMaybe(state, existingIndex, { ...nextItem, id: existing.id }, mutable);
}

function appendTodoList(
  state: StreamItem[],
  provider: AgentProvider,
  items: TodoEntry[],
  timestamp: Date,
  mutable: MutableFlag,
  timelineCursor?: TimelinePosition,
): StreamItem[] {
  const normalizedItems = items.map((item) => ({
    text: item.text,
    completed: item.completed,
    ...(item.id ? { id: item.id } : {}),
    ...(item.status ? { status: item.status } : {}),
    ...(item.activeForm ? { activeForm: item.activeForm } : {}),
  }));

  const previousIndex = findRow(
    state,
    mutable,
    [`todo:${provider}`],
    (row) => row.kind === "todo_list" && row.provider === provider,
    true,
  );
  const previous = state[previousIndex];
  const previousItems = previous?.kind === "todo_list" ? previous.items : [];
  const activities = deriveTaskActivities(previousItems, normalizedItems);

  if (activities.length === 0) {
    if (!previous || previous.kind !== "todo_list") return state;
    const updated: TodoListItem = {
      ...previous,
      ...(timelineCursor ? { timelineCursor } : {}),
      items: normalizedItems,
      timestamp,
    };
    return replaceAtMaybe(state, previousIndex, updated, mutable);
  }

  const lastItem = state[state.length - 1];
  if (
    activities.length === 1 &&
    activities[0]?.type === "added" &&
    lastItem?.kind === "todo_list" &&
    lastItem.provider === provider &&
    lastItem.activity.type === "created" &&
    normalizedItems.every((item) => taskStatus(item) === "pending")
  ) {
    const updated: TodoListItem = {
      ...lastItem,
      ...(timelineCursor ? { timelineCursor } : {}),
      items: normalizedItems,
      activity: { type: "created", count: normalizedItems.length },
      timestamp,
    };
    return replaceAtMaybe(state, state.length - 1, updated, mutable);
  }

  const next = mutable ? state : [...state];
  for (const activity of activities) {
    const idSeed = `${provider}:${JSON.stringify(activity)}:${JSON.stringify(normalizedItems)}`;
    const row: TodoListItem = {
      kind: "todo_list",
      id: createUniqueTimelineId(next, "todo", idSeed, timestamp),
      ...(timelineCursor ? { timelineCursor } : {}),
      timestamp,
      provider,
      items: normalizedItems,
      activity,
    };
    if (mutable) {
      pushMaybe(next, row, mutable);
    } else {
      next.push(row);
    }
  }
  return next;
}

function taskStatus(task: TodoEntry): NonNullable<TodoEntry["status"]> {
  if (task.completed || task.status === "completed") return "completed";
  return task.status === "in_progress" ? "in_progress" : "pending";
}

function taskKey(task: TodoEntry, index: number): string {
  return task.id ?? `${index}:${task.text}`;
}

function deriveTaskActivities(
  previous: readonly TodoEntry[],
  current: readonly TodoEntry[],
): TaskActivity[] {
  if (previous.length === 0) {
    return current.length > 0 ? [{ type: "created", count: current.length }] : [];
  }

  const previousByKey = new Map(previous.map((task, index) => [taskKey(task, index), task]));
  const activities: TaskActivity[] = [];
  for (const [index, task] of current.entries()) {
    const prior = previousByKey.get(taskKey(task, index));
    if (!prior) {
      activities.push({ type: "added", task: task.text });
      continue;
    }
    const before = taskStatus(prior);
    const after = taskStatus(task);
    if (before === after) continue;
    if (after === "completed") {
      activities.push({ type: "completed", task: task.text });
    } else if (after === "in_progress") {
      activities.push({ type: "started", task: task.text });
    }
  }
  return activities;
}

function reduceTimelineToolCall(
  state: StreamItem[],
  event: Extract<AgentStreamEventPayload, { type: "timeline" }>,
  item: Extract<
    Extract<AgentStreamEventPayload, { type: "timeline" }>["item"],
    { type: "tool_call" }
  >,
  timestamp: Date,
  mutable: MutableFlag,
  timelineCursor?: TimelinePosition,
): StreamItem[] {
  const normalizedToolName = item.name
    .trim()
    .replace(/[.\s-]+/g, "_")
    .toLowerCase();
  if (
    event.provider === "claude" &&
    (normalizedToolName === "todowrite" || normalizedToolName === "todo_write")
  ) {
    const tasks = extractTaskEntriesFromToolCall(item.name, inputFromUnknownDetail(item.detail));
    if (!tasks) {
      return state;
    }
    return appendTodoList(
      state,
      event.provider,
      tasks.map((entry) => ({ text: entry.text, completed: entry.completed })),
      timestamp,
      mutable,
      timelineCursor,
    );
  }

  if (
    event.provider === "claude" &&
    (normalizedToolName === "taskcreate" ||
      normalizedToolName === "taskupdate" ||
      normalizedToolName === "tasklist")
  ) {
    return state;
  }

  const tasks = extractTaskEntriesFromToolCall(item.name, inputFromUnknownDetail(item.detail));
  if (tasks) {
    return appendTodoList(
      state,
      event.provider,
      tasks.map((entry) => ({ text: entry.text, completed: entry.completed })),
      timestamp,
      mutable,
      timelineCursor,
    );
  }

  return appendAgentToolCall({
    state,
    data: {
      provider: event.provider,
      callId: item.callId,
      name: item.name,
      status: item.status,
      error: item.error,
      detail: item.detail,
      metadata: item.metadata,
      ...(item.agentMessage ? { agentMessage: item.agentMessage } : {}),
    },
    timestamp,
    mutable,
    timelineCursor,
    turnId: event.turnId,
  });
}

function reduceTimelineCompaction(
  state: StreamItem[],
  item: Extract<
    Extract<AgentStreamEventPayload, { type: "timeline" }>["item"],
    { type: "compaction" }
  >,
  timestamp: Date,
  mutable: MutableFlag,
  timelineCursor?: TimelinePosition,
): StreamItem[] {
  if (item.status === "completed") {
    const loadingIdx = findRow(
      state,
      mutable,
      ["compaction:loading"],
      (row) => row.kind === "compaction" && row.status === "loading",
    );
    const existing = loadingIdx >= 0 ? state[loadingIdx] : undefined;
    if (loadingIdx >= 0 && existing && existing.kind === "compaction") {
      const updated: CompactionItem = {
        ...existing,
        ...(timelineCursor ? { timelineCursor } : {}),
        status: "completed",
        trigger: item.trigger ?? existing.trigger,
        preTokens: item.preTokens ?? existing.preTokens,
      };
      return spliceReplaceMaybe(state, loadingIdx, 1, [updated], mutable);
    }
    if (loadingIdx >= 0) {
      return state;
    }
  }
  const compaction: CompactionItem = {
    kind: "compaction",
    id: createUniqueTimelineId(state, "compaction", item.status, timestamp),
    ...(timelineCursor ? { timelineCursor } : {}),
    timestamp,
    status: item.status,
    trigger: item.trigger,
    preTokens: item.preTokens,
  };
  return pushMaybe(state, compaction, mutable);
}

function reduceTimelineEvent(
  state: StreamItem[],
  event: Extract<AgentStreamEventPayload, { type: "timeline" }>,
  timestamp: Date,
  source: StreamUpdateSource,
  mutable: MutableFlag,
  reservedItemIds?: ReadonlySet<string>,
  timelineCursor?: TimelinePosition,
): StreamItem[] {
  const item = event.item;
  switch (item.type) {
    case "user_message":
      return appendUserMessage(
        state,
        item.text,
        timestamp,
        source,
        mutable,
        item.messageId,
        item.clientMessageId,
        timelineCursor,
        event.turnId,
      );
    case "assistant_message":
      return appendAssistantMessage(
        state,
        item.text,
        timestamp,
        source,
        mutable,
        item.messageId,
        reservedItemIds,
        timelineCursor,
      );
    case "reasoning":
      return appendThought(state, item.text, timestamp, mutable, timelineCursor, event.turnId);
    case "tool_call":
      return reduceTimelineToolCall(state, event, item, timestamp, mutable, timelineCursor);
    case "todo": {
      const items: TodoEntry[] = (item.items ?? []).map((todo) => ({
        text: todo.text,
        completed: todo.completed,
        id: todo.id,
        status: todo.status,
        activeForm: todo.activeForm,
      }));
      return appendTodoList(state, event.provider, items, timestamp, mutable, timelineCursor);
    }
    case "error": {
      const notification: NotificationItem = {
        kind: "notification",
        sourceType: "error",
        id: createUniqueTimelineId(state, "error", item.message ?? "", timestamp),
        ...(timelineCursor ? { timelineCursor } : {}),
        timestamp,
        level: "error",
        message: item.message ?? "Unknown error",
      };
      return appendNotification(state, notification, mutable);
    }
    case "notification": {
      const notification: NotificationItem = {
        kind: "notification",
        sourceType: "notification",
        id: createUniqueTimelineId(state, "notification", item.message, timestamp),
        ...(timelineCursor ? { timelineCursor } : {}),
        timestamp,
        level: item.level,
        message: item.message,
      };
      return appendNotification(state, notification, mutable);
    }
    case "compaction":
      return reduceTimelineCompaction(state, item, timestamp, mutable, timelineCursor);
    case "plugin":
      return appendPluginTimelineItem(state, item, timestamp, mutable, timelineCursor);
    default:
      return state;
  }
}

interface ReduceInternalOptions {
  source: StreamUpdateSource;
  mutable: MutableFlag;
  deferFinalize: boolean;
  reservedItemIds?: ReadonlySet<string>;
  timelineCursor?: TimelinePosition;
}

function reduceStreamUpdateImpl(
  state: StreamItem[],
  event: AgentStreamEventPayload,
  timestamp: Date,
  options: ReduceInternalOptions,
): StreamItem[] {
  const { source, mutable, deferFinalize, reservedItemIds, timelineCursor } = options;
  // Reset per event so turn membership only covers rows this event wrote.
  if (mutable) mutable.written.length = 0;
  switch (event.type) {
    case "timeline": {
      const nextState = reduceTimelineEvent(
        state,
        event,
        timestamp,
        source,
        mutable,
        reservedItemIds,
        timelineCursor,
      );
      const updated = applyTimelineTurnId(state, nextState, event, mutable);
      return deferFinalize || event.item.type === "reasoning"
        ? updated
        : finalizeActiveThoughts(updated, mutable);
    }
    case "thread_started":
    case "turn_started":
    case "turn_completed":
    case "turn_failed":
    case "turn_canceled":
    case "permission_requested":
    case "permission_resolved":
    case "attention_required":
      return deferFinalize ? state : finalizeActiveThoughts(state, mutable);
    default:
      return state;
  }
}

/**
 * Reduce a single AgentManager stream event into the UI timeline
 */
export function reduceStreamUpdate(
  state: StreamItem[],
  event: AgentStreamEventPayload,
  timestamp: Date,
  options?: StreamUpdateOptions,
): StreamItem[] {
  return reduceStreamUpdateImpl(state, event, timestamp, {
    source: options?.source ?? "live",
    mutable: false,
    deferFinalize: false,
    reservedItemIds: options?.reservedItemIds,
    timelineCursor: options?.timelineCursor,
  });
}

function applyTimelineTurnId(
  previous: StreamItem[],
  items: StreamItem[],
  event: Extract<AgentStreamEventPayload, { type: "timeline" }>,
  mutable: MutableFlag,
): StreamItem[] {
  const clientMessageId =
    event.item.type === "user_message" ? event.item.clientMessageId : undefined;
  if (clientMessageId) {
    return reconcileCanonicalUserTurnMembership(items, clientMessageId, event.turnId, mutable);
  }

  if (!event.turnId) return items;
  if (mutable) {
    // The accumulator mutated `items` in place, so row ownership comes from the
    // write log instead of an identity comparison against `previous`.
    for (const index of mutable.written) {
      const item = items[index];
      if (!item || item.turnId === event.turnId) continue;
      items[index] = { ...item, turnId: event.turnId } as StreamItem;
      // The turn id is part of a tool call identity, so the row needs reindexing.
      indexRow(items, mutable, index);
    }
    return items;
  }
  if (items === previous) return items;
  // Assign membership only to rows written by this event, before finalizing
  // unrelated reasoning rows. Late lifecycle updates can replace an earlier row.
  return items.map((item, index) =>
    item === previous[index] || item.turnId === event.turnId
      ? item
      : ({ ...item, turnId: event.turnId } as StreamItem),
  );
}

function reconcileCanonicalUserTurnMembership(
  items: StreamItem[],
  clientMessageId: string,
  turnId: string | undefined,
  mutable: MutableFlag,
): StreamItem[] {
  const index = findRow(
    items,
    mutable,
    [`client:${clientMessageId}`],
    (row) => row.kind === "user_message" && row.clientMessageId === clientMessageId,
  );
  const matched = items[index];
  if (!matched || matched.kind !== "user_message" || matched.turnId === turnId) {
    return items;
  }

  // A canonical user row is authoritative for membership. This replaces a
  // provisional optimistic turn and clears it for daemons that do not emit IDs.
  const next = turnId
    ? { ...matched, turnId }
    : (() => {
        const { turnId: _, ...withoutTurnId } = matched;
        return withoutTurnId;
      })();
  return replaceAtMaybe(items, index, next, mutable);
}

/**
 * Hydrate stream state from a batch of AgentManager stream events.
 *
 * Mutates a private accumulator and finalizes thoughts once after replay.
 * The lookup index is built on demand. Shared lookup keys can require scanning
 * multiple rows, so replay cost depends on the event mix.
 */
export function hydrateStreamState(
  events: Array<{
    event: AgentStreamEventPayload;
    timestamp: Date;
    timelineCursor?: TimelinePosition;
  }>,
  options?: Pick<StreamUpdateOptions, "source" | "reservedItemIds">,
): StreamItem[] {
  const source = options?.source ?? "live";
  const state: StreamItem[] = [];
  const mutable: MutableTimeline = { written: [], index: null };
  for (let i = 0; i < events.length; i += 1) {
    const { event, timestamp, timelineCursor } = events[i];
    reduceStreamUpdateImpl(state, event, timestamp, {
      source,
      mutable,
      deferFinalize: true,
      reservedItemIds: options?.reservedItemIds,
      timelineCursor,
    });
  }
  return finalizeActiveThoughts(state, mutable);
}

/**
 * Streamable item kinds - items that can be incrementally streamed
 * and should be buffered in the head before committing to tail.
 */
type StreamableKind = "assistant_message" | "thought";

const STREAMABLE_KINDS = new Set<StreamItem["kind"]>(["assistant_message", "thought"]);

function isStreamableKind(kind: StreamItem["kind"]): kind is StreamableKind {
  return STREAMABLE_KINDS.has(kind);
}

const STREAM_COMPLETION_EVENTS = new Set<AgentStreamEventPayload["type"]>([
  "turn_completed",
  "turn_failed",
  "turn_canceled",
]);

function applyCompletionToTail(
  tail: StreamItem[],
  event: AgentStreamEventPayload,
  timestamp: Date,
  source: StreamUpdateSource,
): StreamItem[] {
  const finalized = finalizeActiveThoughts(tail, false);
  return reduceStreamUpdate(finalized, event, timestamp, { source });
}

/**
 * Determine what kind of StreamItem an event would produce
 */
function getEventItemKind(event: AgentStreamEventPayload): StreamItem["kind"] | null {
  if (event.type !== "timeline") {
    return null;
  }
  switch (event.item.type) {
    case "user_message":
      return "user_message";
    case "assistant_message":
      return "assistant_message";
    case "reasoning":
      return "thought";
    case "tool_call":
      return "tool_call";
    case "todo":
      return "todo_list";
    case "error":
    case "notification":
      return "notification";
    case "plugin":
      return "plugin";
    default:
      return null;
  }
}

function getIncomingAssistantMessageId(event: AgentStreamEventPayload): string | undefined {
  if (event.type !== "timeline" || event.item.type !== "assistant_message") {
    return undefined;
  }
  return event.item.messageId;
}

/**
 * Finalize head items before flushing to tail.
 * Marks thoughts as "ready" since they're no longer being streamed.
 */
function finalizeHeadItems(head: StreamItem[]): StreamItem[] {
  return head.map((item) => {
    if (item.kind === "thought" && item.status !== "ready") {
      return markThoughtReady(item);
    }
    return item;
  });
}

function getActiveAssistantHeadIndex(head: StreamItem[]): number {
  for (let index = head.length - 1; index >= 0; index -= 1) {
    if (head[index]?.kind === "assistant_message") {
      return index;
    }
  }
  return -1;
}

function getTailAssistantToResume(params: {
  incomingKind: StreamItem["kind"] | null;
  event: AgentStreamEventPayload;
  nextHead: StreamItem[];
  tailAssistant: StreamItem | undefined;
}): AssistantMessageItem | null {
  if (params.incomingKind !== "assistant_message" || params.nextHead.length !== 0) {
    return null;
  }
  if (params.tailAssistant?.kind !== "assistant_message") {
    return null;
  }
  const incomingMessageId = getIncomingAssistantMessageId(params.event);
  if (incomingMessageId !== undefined && params.tailAssistant.messageId !== incomingMessageId) {
    return null;
  }
  return params.tailAssistant;
}

/**
 * Flush head items to tail, avoiding duplicates.
 */
export function flushHeadToTail(tail: StreamItem[], head: StreamItem[]): StreamItem[] {
  if (head.length === 0) {
    return tail;
  }

  const finalized = finalizeHeadItems(head);
  const tailIds = new Set(tail.map((item) => item.id));
  const newItems = finalized.filter((item) => !tailIds.has(item.id));

  if (newItems.length === 0) {
    return tail;
  }
  return [...tail, ...newItems];
}

/**
 * Determine if the head should be flushed based on incoming event kind.
 * Flush when a different streamable lane starts, including a new identified assistant message.
 */
function shouldFlushHead(input: {
  head: StreamItem[];
  incomingKind: StreamItem["kind"] | null;
  event: AgentStreamEventPayload;
}): boolean {
  const { head, incomingKind, event } = input;
  if (head.length === 0) {
    return false;
  }

  // Non-timeline events don't trigger flush (except completion events handled separately)
  if (incomingKind === null) {
    return false;
  }

  // If incoming is not streamable, flush current head
  if (!isStreamableKind(incomingKind)) {
    return true;
  }

  // Find the last streamable item in head (skip trailing non-streamable items).
  let lastStreamable: StreamItem | undefined;
  for (let i = head.length - 1; i >= 0; i--) {
    if (isStreamableKind(head[i].kind)) {
      lastStreamable = head[i];
      break;
    }
  }

  if (!lastStreamable) {
    return true;
  }

  // If incoming kind is different from current head's streamable kind, flush
  if (lastStreamable.kind !== incomingKind) {
    return true;
  }

  if (incomingKind === "assistant_message" && lastStreamable.kind === "assistant_message") {
    const incomingMessageId = getIncomingAssistantMessageId(event);
    return incomingMessageId !== undefined && lastStreamable.messageId !== incomingMessageId;
  }

  return false;
}

export interface ApplyStreamEventResult {
  tail: StreamItem[];
  head: StreamItem[];
  changedTail: boolean;
  changedHead: boolean;
  acknowledgedClientMessageIds?: string[];
}

function applyCanonicalUserMessageEvent(params: {
  tail: StreamItem[];
  head: StreamItem[];
  event: AgentStreamEventPayload;
  timestamp: Date;
  timelineCursor?: TimelinePosition;
  unmatchedInsert?: "tail" | "head";
}): ApplyStreamEventResult | null {
  const { tail, head, event, timestamp, timelineCursor, unmatchedInsert = "tail" } = params;
  if (event.type !== "timeline" || event.item.type !== "user_message") return null;
  const normalized = normalizeChunk(event.item.text);

  const flushedTail = head.length > 0 ? flushHeadToTail(tail, head) : tail;
  const flushedHead = head.length > 0 ? [] : head;
  const canonical = createUserMessage({
    id:
      event.item.messageId ??
      createUniqueTimelineId([...tail, ...head], "user", normalized.chunk.trim(), timestamp),
    messageId: event.item.messageId,
    clientMessageId: event.item.clientMessageId,
    turnId: event.turnId,
    timelineCursor,
    text: normalized.chunk,
    timestamp,
  });
  if (unmatchedInsert === "head") {
    const reconciled = upsertUserMessageAcrossStream({
      tail,
      head,
      message: canonical,
      insert: normalized.hasContent ? "head" : "none",
      presentation: "existing",
    });
    const reconciledTail = canonical.clientMessageId
      ? reconcileCanonicalUserTurnMembership(
          reconciled.tail,
          canonical.clientMessageId,
          event.turnId,
          false,
        )
      : reconciled.tail;
    const reconciledHead = canonical.clientMessageId
      ? reconcileCanonicalUserTurnMembership(
          reconciled.head,
          canonical.clientMessageId,
          event.turnId,
          false,
        )
      : reconciled.head;
    return {
      tail: reconciledTail,
      head: reconciledHead,
      changedTail: reconciled.changedTail || reconciledTail !== reconciled.tail,
      changedHead: reconciled.changedHead || reconciledHead !== reconciled.head,
      acknowledgedClientMessageIds:
        reconciled.location?.matched && reconciled.location.message.clientMessageId
          ? [reconciled.location.message.clientMessageId]
          : [],
    };
  }
  const reconciled = placeCanonicalUserMessageAtTail(flushedTail, canonical, normalized.hasContent);
  const reconciledTail = canonical.clientMessageId
    ? reconcileCanonicalUserTurnMembership(
        reconciled.items,
        canonical.clientMessageId,
        event.turnId,
        false,
      )
    : reconciled.items;
  return {
    tail: reconciledTail,
    head: flushedHead,
    changedTail: flushedTail !== tail || reconciledTail !== flushedTail,
    changedHead: flushedHead !== head,
    acknowledgedClientMessageIds:
      reconciled.matched && reconciled.message.clientMessageId
        ? [reconciled.message.clientMessageId]
        : [],
  };
}

/**
 * Apply a stream event using head/tail model.
 *
 * - Tail: committed history (rarely changes during streaming)
 * - Head: active streaming items (frequently updated)
 *
 * Both use the same reduceStreamUpdate function. The difference is:
 * - Streamable items (assistant_message, thought) go to head
 * - Non-streamable items flush head to tail first, then go to tail
 * - Turn completion events flush head to tail
 */
export function applyStreamEvent(params: {
  tail: StreamItem[];
  head: StreamItem[];
  event: AgentStreamEventPayload;
  timestamp: Date;
  source?: StreamUpdateSource;
  timelineCursor?: TimelinePosition;
  unmatchedUserMessageInsert?: "tail" | "head";
}): ApplyStreamEventResult {
  const { tail, head, event, timestamp } = params;
  const canonicalUserResult = applyCanonicalUserMessageEvent({
    tail,
    head,
    event,
    timestamp,
    timelineCursor: params.timelineCursor,
    unmatchedInsert: params.unmatchedUserMessageInsert,
  });
  if (canonicalUserResult) return canonicalUserResult;
  const source = params.source ?? "live";
  let nextTail = tail;
  let nextHead = head;
  let changedTail = false;
  let changedHead = false;
  const flushHead = () => {
    if (nextHead.length === 0) {
      return;
    }
    const flushed = flushHeadToTail(nextTail, nextHead);
    if (flushed !== nextTail) {
      nextTail = flushed;
      changedTail = true;
    }
    nextHead = [];
    changedHead = true;
  };

  // Handle turn completion events - flush everything
  if (STREAM_COMPLETION_EVENTS.has(event.type)) {
    flushHead();
    const finalized = applyCompletionToTail(nextTail, event, timestamp, source);
    if (finalized !== nextTail) {
      nextTail = finalized;
      changedTail = true;
    }
    return { tail: nextTail, head: nextHead, changedTail, changedHead };
  }

  const incomingKind = getEventItemKind(event);

  // Check if we need to flush head before processing this event
  if (
    shouldFlushHead({
      head: nextHead,
      incomingKind,
      event,
    })
  ) {
    flushHead();
  }

  const tailAssistant = getTailAssistantToResume({
    incomingKind,
    event,
    nextHead,
    tailAssistant: nextTail.at(-1),
  });
  if (tailAssistant) {
    nextTail = nextTail.slice(0, -1);
    nextHead = [tailAssistant];
    changedTail = true;
    changedHead = true;
  }

  // For streamable kinds, apply to head
  if (incomingKind !== null && isStreamableKind(incomingKind)) {
    const reservedItemIds =
      incomingKind === "assistant_message" && getActiveAssistantHeadIndex(nextHead) < 0
        ? new Set(nextTail.map((item) => item.id))
        : undefined;
    const reduced = reduceStreamUpdate(nextHead, event, timestamp, {
      source,
      reservedItemIds,
      timelineCursor: params.timelineCursor,
    });
    if (reduced !== nextHead) {
      nextHead = reduced;
      changedHead = true;
    }
    return { tail: nextTail, head: nextHead, changedTail, changedHead };
  }

  // For non-streamable kinds or non-timeline events, apply to tail
  const reduced = reduceStreamUpdate(nextTail, event, timestamp, {
    source,
    timelineCursor: params.timelineCursor,
  });
  if (reduced !== nextTail) {
    nextTail = reduced;
    changedTail = true;
  }

  return { tail: nextTail, head: nextHead, changedTail, changedHead };
}
