import { z } from "zod";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { normalizeProviderReplayTimestamp } from "../../provider-history-timestamps.js";
import type { AgentTimelineItem } from "../../agent-sdk-types.js";

export const CodexHookRunSchema = z.object({
  id: z.string(),
  eventName: z.string(),
  status: z.string(),
  statusMessage: z.string().nullable().optional(),
  entries: z.array(z.object({ kind: z.string(), text: z.string() })),
});

export function codexHookFailureMessage(run: z.infer<typeof CodexHookRunSchema>): string | null {
  if (run.status !== "blocked" && run.status !== "failed" && run.status !== "stopped") {
    return null;
  }
  const reasons = run.entries
    .filter((entry) => entry.kind === "feedback" || entry.kind === "error" || entry.kind === "stop")
    .map((entry) => entry.text.trim())
    .filter((text) => text.length > 0);
  const reason = reasons.join("\n") || run.statusMessage?.trim();
  let label = `${run.eventName} hook ${run.status}`;
  if (run.eventName === "preToolUse" && run.status === "blocked") {
    label = "Command blocked by PreToolUse hook";
  } else if (run.eventName === "userPromptSubmit" && run.status === "blocked") {
    label = "Prompt blocked";
  }
  return reason ? `${label}: ${reason}` : label;
}

interface HookHistoryEntry {
  item: Extract<AgentTimelineItem, { type: "error" }>;
  timestamp: string | undefined;
}

const RolloutRecordSchema = z.object({
  type: z.string(),
  timestamp: z.unknown().optional(),
  payload: z.object({
    type: z.string().optional(),
    id: z.string().optional(),
    turn_id: z.string().optional(),
    call_id: z.string().optional(),
    name: z.string().optional(),
    output: z.unknown().optional(),
    item: z.object({ id: z.string().optional() }).optional(),
    internal_chat_message_metadata_passthrough: z
      .object({ turn_id: z.string().optional() })
      .optional(),
  }),
});
const ScriptOutputSchema = z.array(z.object({ type: z.literal("input_text"), text: z.string() }));
type RolloutRecord = z.infer<typeof RolloutRecordSchema>;

function parseRolloutRecord(line: string): RolloutRecord | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch (error) {
    // A live rollout can end with a partially written JSON record.
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  const parsed = RolloutRecordSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function readScriptHookFailure(output: unknown): string | null {
  const parsed = ScriptOutputSchema.safeParse(output);
  if (!parsed.success || !parsed.data[0]?.text.startsWith("Script failed\n")) {
    return null;
  }
  // Code mode appends the runtime error after script output. Earlier blocks
  // can quote hook errors even when a different runtime error fails the script.
  const match = parsed.data
    .at(-1)
    ?.text.match(/^Script error:\n(Command blocked by PreToolUse hook: [\s\S]+)$/);
  return match?.[1].trim() ?? null;
}

class CodexHookHistory {
  private readonly scriptCalls = new Set<string>();
  private readonly seenFailures = new Set<string>();
  private readonly pendingByTurnId = new Map<string, HookHistoryEntry[]>();
  private readonly entriesByItemId = new Map<
    string,
    { turnId: string; entries: HookHistoryEntry[] }
  >();
  private readonly turnOrder: string[] = [];
  private readonly turnIndexById = new Map<string, number>();
  private endedTurns = 0;
  private currentTurnId: string | null = null;

  entriesBeforeItem(id: unknown): HookHistoryEntry[] {
    if (typeof id !== "string") return [];
    const entry = this.entriesByItemId.get(id);
    if (!entry) return [];
    this.entriesByItemId.delete(id);
    return entry.entries;
  }

  private entriesAtTurnEnd(id: unknown): HookHistoryEntry[] {
    if (typeof id !== "string") return [];
    const pending = this.pendingByTurnId.get(id) ?? [];
    this.pendingByTurnId.delete(id);
    const unattached: HookHistoryEntry[] = [];
    for (const [itemId, entry] of this.entriesByItemId) {
      if (entry.turnId !== id) continue;
      unattached.push(...entry.entries);
      this.entriesByItemId.delete(itemId);
    }
    // A failure whose boundary item never reaches the projection still belongs to the turn.
    return [...unattached, ...pending];
  }

  /**
   * End every rollout turn before `id`, including turns the read returned rows for, so a
   * turn with no rows still ends in rollout order before the next turn's items.
   */
  entriesBeforeTurn(id: string | undefined): HookHistoryEntry[] {
    const index = id === undefined ? undefined : this.turnIndexById.get(id);
    if (index === undefined || index <= this.endedTurns) return [];
    return this.endTurns(index);
  }

  /** End entries of every rollout turn not yet ended, in rollout order. */
  entriesAfterTurns(): HookHistoryEntry[] {
    return this.endTurns(this.turnOrder.length);
  }

  private endTurns(end: number): HookHistoryEntry[] {
    const entries: HookHistoryEntry[] = [];
    for (; this.endedTurns < end; this.endedTurns++) {
      entries.push(...this.entriesAtTurnEnd(this.turnOrder[this.endedTurns]));
    }
    return entries;
  }

  receive(record: RolloutRecord): void {
    const { type, payload } = record;
    if (type === "turn_context") this.currentTurnId = payload.turn_id ?? null;
    if (type === "event_msg" && payload.type === "task_started") {
      this.currentTurnId = payload.turn_id ?? null;
    }
    const turnId =
      payload.internal_chat_message_metadata_passthrough?.turn_id ??
      payload.turn_id ??
      this.currentTurnId;
    if (!turnId) return;
    if (!this.turnIndexById.has(turnId)) {
      this.turnIndexById.set(turnId, this.turnOrder.length);
      this.turnOrder.push(turnId);
    }
    if (type === "event_msg") {
      this.receiveItemBoundary(payload, turnId);
    } else if (type === "response_item") {
      this.receiveResponseItem(record, turnId);
    }
  }

  private receiveItemBoundary(payload: RolloutRecord["payload"], turnId: string): void {
    const itemId = payload.item?.id;
    if (payload.type !== "item_completed" || !itemId) return;
    const entries = this.pendingByTurnId.get(turnId);
    if (!entries) return;
    this.entriesByItemId.set(itemId, { turnId, entries });
    this.pendingByTurnId.delete(turnId);
  }

  private receiveResponseItem({ payload, timestamp }: RolloutRecord, turnId: string): void {
    if (!payload.call_id) return;
    if (payload.type === "custom_tool_call" && payload.name === "exec") {
      this.scriptCalls.add(payload.call_id);
      return;
    }
    if (payload.type !== "custom_tool_call_output" || !this.scriptCalls.has(payload.call_id))
      return;
    const message = readScriptHookFailure(payload.output);
    if (!message || this.seenFailures.has(payload.call_id)) return;
    this.seenFailures.add(payload.call_id);
    const pending = this.pendingByTurnId.get(turnId) ?? [];
    pending.push({
      item: { type: "error", message },
      timestamp: normalizeProviderReplayTimestamp(timestamp) ?? undefined,
    });
    this.pendingByTurnId.set(turnId, pending);
  }
}

/** Recover code-mode hook blocks that Codex omits from thread/read items. */
export async function readCodexHookFailures(rolloutPath: string | null): Promise<CodexHookHistory> {
  const history = new CodexHookHistory();
  if (!rolloutPath) return history;
  const stream = createReadStream(rolloutPath, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      const record = parseRolloutRecord(line);
      if (record) history.receive(record);
    }
  } catch (error) {
    // Ephemeral or removed transcripts have no supplementary history.
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  } finally {
    lines.close();
    stream.destroy();
  }
  return history;
}
