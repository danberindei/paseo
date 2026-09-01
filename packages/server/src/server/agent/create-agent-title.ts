import { MAX_EXPLICIT_AGENT_TITLE_CHARS } from "@getpaseo/protocol/agent-title-limits";
import type { AgentAttachment, FirstAgentContext } from "@getpaseo/protocol/messages";

const MAX_INITIAL_AGENT_TITLE_CHARS = Math.min(60, MAX_EXPLICIT_AGENT_TITLE_CHARS);

const CHAT_HISTORY_WRAPPER = /<chat-history-summary>([\s\S]*?)<\/chat-history-summary>/;
const SOURCE_AGENT_LINE = /^Source agent:\s*(.+)$/m;
const CHAT_HISTORY_FALLBACK_TITLE = "Chat history";

function clampTitle(text: string): string | null {
  const firstContentLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (!firstContentLine) {
    return null;
  }
  const normalized = firstContentLine.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }
  const clamped = normalized.slice(0, MAX_INITIAL_AGENT_TITLE_CHARS).trim();
  return clamped.length > 0 ? clamped : null;
}

function withRePrefix(title: string): string {
  return /^re:/i.test(title) ? title : `Re: ${title}`;
}

function deriveForkFallbackTitle(attachments?: AgentAttachment[]): string | null {
  for (const attachment of attachments ?? []) {
    if (attachment.type !== "text" || attachment.contextKind !== "chat_history") {
      continue;
    }
    const wrapperInterior = attachment.text.match(CHAT_HISTORY_WRAPPER)?.[1] ?? "";
    const sourceTitle = wrapperInterior.match(SOURCE_AGENT_LINE)?.[1]?.trim();
    return clampTitle(withRePrefix(sourceTitle || CHAT_HISTORY_FALLBACK_TITLE));
  }
  return null;
}

export function resolveCreateAgentTitles(options: {
  configTitle?: string | null;
  initialPrompt?: string | null;
  attachments?: AgentAttachment[];
}): { explicitTitle: string | null; provisionalTitle: string | null } {
  const explicitTitle =
    typeof options.configTitle === "string" && options.configTitle.trim().length > 0
      ? options.configTitle.trim()
      : null;
  const trimmedPrompt = options.initialPrompt?.trim();
  const provisionalTitle =
    explicitTitle ??
    (trimmedPrompt ? clampTitle(trimmedPrompt) : deriveForkFallbackTitle(options.attachments));

  return {
    explicitTitle,
    provisionalTitle,
  };
}

export function resolveFirstAgentPromptTitle(firstAgentContext?: FirstAgentContext): string | null {
  return (
    resolveCreateAgentTitles({
      initialPrompt: firstAgentContext?.prompt,
      attachments: firstAgentContext?.attachments,
    }).provisionalTitle ?? null
  );
}
