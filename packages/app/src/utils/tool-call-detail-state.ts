import type { ToolCallDetail } from "@getpaseo/protocol/agent-types";

function hasMeaningfulUnknownValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some(hasMeaningfulUnknownValue);
  }
  if (typeof value === "object") {
    return Object.values(value).some(hasMeaningfulUnknownValue);
  }
  return true;
}

function hasMeaningfulSearchDetail(detail: Extract<ToolCallDetail, { type: "search" }>): boolean {
  if (detail.query.trim().length > 0) return true;
  if (detail.content) return true;
  if (detail.filePaths && detail.filePaths.length > 0) return true;
  if (detail.webResults && detail.webResults.length > 0) return true;
  if (detail.annotations && detail.annotations.length > 0) return true;
  return false;
}

function hasMeaningfulReadLikeDetail(detail: { filePath?: unknown; content?: unknown }): boolean {
  return Boolean(detail.filePath || detail.content);
}

function hasMeaningfulEditDetail(detail: Extract<ToolCallDetail, { type: "edit" }>): boolean {
  return Boolean(detail.filePath || detail.unifiedDiff || detail.oldString || detail.newString);
}

function hasMeaningfulFetchDetail(detail: Extract<ToolCallDetail, { type: "fetch" }>): boolean {
  return Boolean(detail.url || detail.result || detail.codeText);
}

function hasMeaningfulPlainTextDetail(
  detail: Extract<ToolCallDetail, { type: "plain_text" }>,
): boolean {
  return Boolean(detail.label || detail.text);
}

function hasMeaningfulUnknownDetail(detail: Extract<ToolCallDetail, { type: "unknown" }>): boolean {
  return hasMeaningfulUnknownValue(detail.input) || hasMeaningfulUnknownValue(detail.output);
}

export function hasMeaningfulToolCallDetail(detail: ToolCallDetail | undefined): boolean {
  if (!detail) {
    return false;
  }

  switch (detail.type) {
    case "shell":
      return Boolean(detail.command.trim() || detail.output);
    case "read":
      return hasMeaningfulReadLikeDetail(detail);
    case "edit":
      return hasMeaningfulEditDetail(detail);
    case "write":
      return hasMeaningfulReadLikeDetail(detail);
    case "search":
      return hasMeaningfulSearchDetail(detail);
    case "fetch":
      return hasMeaningfulFetchDetail(detail);
    case "worktree_setup":
    // A sub-agent card is a launch marker; the child's activity lives in the sub-agent panel.
    case "sub_agent":
      return false;
    case "plain_text":
      return hasMeaningfulPlainTextDetail(detail);
    case "plan":
      return detail.text.trim().length > 0;
    case "unknown":
      return hasMeaningfulUnknownDetail(detail);
  }
}

// Claude resolves its plan/question prompts through the permission flow: by the time either
// is visible at all, the model has already finished generating the call, so the rest of its
// "running" time is a human decision wait, not work in progress. A loading skeleton there
// implies content is still coming, which is never true - show the empty state instead.
const PERMISSION_GATED_TOOL_NAMES = new Set(["exitplanmode", "askuserquestion"]);

export function isPendingToolCallDetail(params: {
  toolName: string;
  detail: ToolCallDetail | undefined;
  status: "executing" | "running" | "completed" | "failed" | "canceled";
  error: unknown;
}): boolean {
  if (params.detail?.type === "worktree_setup" || params.detail?.type === "sub_agent") return false;
  if (PERMISSION_GATED_TOOL_NAMES.has(params.toolName.trim().toLowerCase())) {
    return false;
  }
  const isRunning = params.status === "running" || params.status === "executing";
  return isRunning && params.error == null && !hasMeaningfulToolCallDetail(params.detail);
}
