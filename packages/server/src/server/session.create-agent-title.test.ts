import { describe, expect, test } from "vitest";

import type { AgentAttachment } from "@getpaseo/protocol/messages";

import {
  resolveCreateAgentTitles,
  resolveFirstAgentPromptTitle,
} from "./agent/create-agent-title.js";

function chatHistoryAttachment(text: string): AgentAttachment {
  return {
    type: "text",
    mimeType: "text/plain",
    contextKind: "chat_history",
    title: "Chat history",
    text,
  };
}

describe("resolveCreateAgentTitles", () => {
  test("derives a provisional title from prompt when explicit title is absent", () => {
    const resolved = resolveCreateAgentTitles({
      configTitle: undefined,
      initialPrompt: "Implement auth retries with backoff\n\ninclude tests",
    });

    expect(resolved.explicitTitle).toBeNull();
    expect(resolved.provisionalTitle).toBe("Implement auth retries with backoff");
  });

  test("preserves explicit title and does not treat it as provisional", () => {
    const resolved = resolveCreateAgentTitles({
      configTitle: "  Keep This Title  ",
      initialPrompt: "Ignored prompt title",
    });

    expect(resolved.explicitTitle).toBe("Keep This Title");
    expect(resolved.provisionalTitle).toBe("Keep This Title");
  });

  test("returns null values when prompt and title are empty", () => {
    const resolved = resolveCreateAgentTitles({
      configTitle: "   ",
      initialPrompt: "   ",
    });

    expect(resolved.explicitTitle).toBeNull();
    expect(resolved.provisionalTitle).toBeNull();
  });

  test("titles a fork from its typed prompt", () => {
    const resolved = resolveCreateAgentTitles({
      initialPrompt: "Keep going on the retries",
      attachments: [
        chatHistoryAttachment(
          [
            "<chat-history-summary>",
            "Chat history from a previous Paseo agent.",
            "Source agent: Investigate the fork title",
            "</chat-history-summary>",
          ].join("\n"),
        ),
      ],
    });

    expect(resolved.provisionalTitle).toBe("Keep going on the retries");
  });

  test("falls back to a Re: source-agent title for a pill-only fork", () => {
    const resolved = resolveCreateAgentTitles({
      attachments: [
        chatHistoryAttachment(
          [
            "<chat-history-summary>",
            "Chat history from a previous Paseo agent.",
            "Source agent: Investigate the fork title",
            "Source agent id: agent-1234",
            "</chat-history-summary>",
          ].join("\n"),
        ),
      ],
    });

    expect(resolved.provisionalTitle).toBe("Re: Investigate the fork title");
  });

  test("falls back to Re: Chat history when the fork has no source agent title", () => {
    const resolved = resolveCreateAgentTitles({
      attachments: [
        chatHistoryAttachment(
          ["<chat-history-summary>", "Some body", "</chat-history-summary>"].join("\n"),
        ),
      ],
    });

    expect(resolved.provisionalTitle).toBe("Re: Chat history");
  });

  test("does not double-prefix a source agent title that already starts with Re:", () => {
    const provisionalTitle = resolveFirstAgentPromptTitle({
      attachments: [
        chatHistoryAttachment(
          [
            "<chat-history-summary>",
            "Source agent: Re: Investigate the fork title",
            "</chat-history-summary>",
          ].join("\n"),
        ),
      ],
    });

    expect(provisionalTitle).toBe("Re: Investigate the fork title");
  });
});
